import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

// ─── Types ────────────────────────────────────────────────────
type KioskScreen = 'screensaver' | 'idle' | 'select' | 'pin' | 'brief'

interface RosterEmployee {
  user_id: string; full_name: string | null; role: string; department_id: string | null
  is_in: boolean; clocked_today: boolean; on_break: boolean
  clock_in_at: string | null; clock_out_at: string | null
  schedule_start: string | null; schedule_end: string | null
}
interface WeekShift {
  id: string; user_id: string; full_name: string | null; role: string
  department_id: string | null; scheduled_date: string
  start_time: string; end_time: string; note: string | null
  is_in: boolean; clocked: boolean
}
interface KioskPost { id: string; title: string; content: string | null; created_at: string }
interface KioskEvent { id: string; title: string; event_start: string; event_end: string | null }
interface DisplayData {
  posts: KioskPost[]; events: KioskEvent[]
  roster: RosterEmployee[]; week_roster: WeekShift[]
  today: string; week_start: string; week_end: string
}
interface SelectEmployee {
  id: string; full_name: string | null; role: string; has_pin: boolean
}
interface ActionResult {
  action: 'in' | 'out' | 'break_start' | 'break_end'
  user: string; user_id: string
  clock_in_at?: string; clock_out_at?: string
  duration_minutes?: number; streak?: number; must_read_count?: number
  break_start?: string; break_end?: string; break_minutes?: number
}

// ─── Constants ────────────────────────────────────────────────
const DAYS_SHORT = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
const DEPT_PALETTE = [
  '#4BACC6', '#8064A2', '#C0504D', '#9BBB59',
  '#F79646', '#4F81BD', '#00B4D8', '#E76F51'
]

// ─── Helpers ──────────────────────────────────────────────────
function fmtClock(d: Date) {
  return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}
function fmtClockNoSec(d: Date) {
  return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })
}
function fmtFullDate(d: Date) {
  return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}
function fmtShortDate(d: Date) {
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}
function fmtTime12(t: string | null) {
  if (!t) return ''
  const [h, m] = t.split(':')
  const hour = parseInt(h)
  return `${hour % 12 || 12}:${m}${hour >= 12 ? 'pm' : 'am'}`
}
function fmtDatetime(s: string) {
  return new Date(s).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true })
}
function fmtEventDate(s: string) {
  return new Date(s).toLocaleDateString('en-AU', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: true
  })
}
function greeting(d: Date) {
  const h = d.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}
function initials(name: string | null) {
  if (!name) return '?'
  return name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase()
}
function isoDate(d: Date) { return d.toISOString().split('T')[0] }
function deptColor(deptId: string | null, allIds: string[]) {
  if (!deptId) return '#4BACC6'
  const idx = allIds.indexOf(deptId)
  return DEPT_PALETTE[idx % DEPT_PALETTE.length]
}

// ─── Confetti ─────────────────────────────────────────────────
function Confetti() {
  const pieces = Array.from({ length: 80 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 1.8,
    duration: 1.8 + Math.random() * 2,
    color: ['#4BACC6', '#9BBB59', '#F79646', '#8064A2', '#4F81BD', '#C0504D', '#fff'][i % 7],
    size: 5 + Math.random() * 9,
    rotate: Math.random() * 360,
    isRect: i % 3 !== 0,
  }))
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999, overflow: 'hidden' }}>
      {pieces.map(p => (
        <div key={p.id} style={{
          position: 'absolute', left: `${p.left}%`, top: '-20px',
          width: p.size, height: p.size * (p.isRect ? 0.5 : 1),
          background: p.color, borderRadius: p.isRect ? '2px' : '50%',
          animation: `confettiFall ${p.duration}s ${p.delay}s ease-in forwards`,
          transform: `rotate(${p.rotate}deg)`,
        }} />
      ))}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────
export default function KioskPage() {
  const [screen, setScreen] = useState<KioskScreen>('idle')
  const [now, setNow] = useState(new Date())
  const [displayData, setDisplayData] = useState<DisplayData | null>(null)
  const [employees, setEmployees] = useState<SelectEmployee[]>([])
  const [selectedEmp, setSelectedEmp] = useState<SelectEmployee | null>(null)
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [pinAttempts, setPinAttempts] = useState(0)
  const [pinLocked, setPinLocked] = useState(false)
  const [lockoutSecs, setLockoutSecs] = useState(0)
  const [actionResult, setActionResult] = useState<ActionResult | null>(null)
  const [empSearch, setEmpSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [showCelebration, setShowCelebration] = useState(false)
  const [activeDay, setActiveDay] = useState(0)
  const [briefTimer, setBriefTimer] = useState(12)
  const [breakMode, setBreakMode] = useState(false)
  const [postIdx, setPostIdx] = useState(0)

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lockoutRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const briefRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const dataRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const allDeptIds = [...new Set([
    ...(displayData?.roster ?? []).map(r => r.department_id),
    ...(displayData?.week_roster ?? []).map(r => r.department_id),
  ].filter(Boolean) as string[])]

  // ── Clock ──────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // ── Set active day to today ────────────────────────────────
  useEffect(() => {
    const day = new Date().getDay()
    setActiveDay(day === 0 ? 6 : day - 1)
  }, [])

  // ── Post carousel ─────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => {
      setPostIdx(i => displayData ? (i + 1) % Math.max(1, displayData.posts.length) : 0)
    }, 5000)
    return () => clearInterval(t)
  }, [displayData])

  // ── Load data ─────────────────────────────────────────────
  const loadData = useCallback(async () => {
    const [{ data: display }, { data: emps }] = await Promise.all([
      supabase.rpc('get_kiosk_display'),
      supabase.rpc('get_kiosk_employees'),
    ])
    if (display) setDisplayData(display as DisplayData)
    if (emps) setEmployees(emps as SelectEmployee[])
  }, [])

  useEffect(() => {
    loadData()
    dataRef.current = setInterval(loadData, 30000)
    return () => { if (dataRef.current) clearInterval(dataRef.current) }
  }, [loadData])

  // ── Idle / screensaver timer ───────────────────────────────
  function resetIdleTimer() {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    if (screen === 'screensaver') setScreen('idle')
    idleTimerRef.current = setTimeout(() => setScreen('screensaver'), 90000)
  }

  useEffect(() => {
    resetIdleTimer()
    const events = ['touchstart', 'mousemove', 'keydown', 'click']
    events.forEach(e => window.addEventListener(e, resetIdleTimer))
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      events.forEach(e => window.removeEventListener(e, resetIdleTimer))
    }
  }, [screen])

  // ── Brief countdown ───────────────────────────────────────
  useEffect(() => {
    if (screen !== 'brief') { setBriefTimer(12); if (briefRef.current) clearInterval(briefRef.current); return }
    setBriefTimer(12)
    briefRef.current = setInterval(() => {
      setBriefTimer(t => {
        if (t <= 1) { clearInterval(briefRef.current!); resetToIdle(); return 0 }
        return t - 1
      })
    }, 1000)
    return () => { if (briefRef.current) clearInterval(briefRef.current) }
  }, [screen])

  // ── Lockout ───────────────────────────────────────────────
  function startLockout() {
    setPinLocked(true); setLockoutSecs(60)
    lockoutRef.current = setInterval(() => {
      setLockoutSecs(s => {
        if (s <= 1) { clearInterval(lockoutRef.current!); setPinLocked(false); setPinAttempts(0); return 0 }
        return s - 1
      })
    }, 1000)
  }

  function resetToIdle() {
    setScreen('idle'); setSelectedEmp(null); setPin('')
    setPinError(''); setActionResult(null); setShowCelebration(false)
    setBreakMode(false); setEmpSearch(''); loadData()
  }

  // ── PIN ───────────────────────────────────────────────────
  function handleDigit(d: string) {
    if (pinLocked || pin.length >= 4) return
    const newPin = pin + d
    setPin(newPin); setPinError('')
    if (newPin.length === 4) submitPin(newPin)
  }

  function handleBackspace() { setPin(p => p.slice(0, -1)); setPinError('') }

  async function submitPin(p: string) {
    setLoading(true)
    try {
      if (breakMode) {
        const { data } = await supabase.rpc('kiosk_break_action', {
          p_pin: p,
          p_user_id: selectedEmp?.id ?? null
        })
        if (!data?.success) handlePinError(data?.error ?? 'Invalid PIN')
        else { setActionResult(data as ActionResult); setScreen('brief') }
      } else {
        const { data } = await supabase.rpc('kiosk_clock_action', {
          p_pin: p,
          p_user_id: selectedEmp?.id ?? null
        })
        if (!data?.success) handlePinError(data?.error ?? 'Invalid PIN')
        else {
          const result = data as ActionResult
          setActionResult(result)
          if (result.action === 'in' && (result.streak ?? 0) >= 1) {
            setShowCelebration(true)
            setTimeout(() => setShowCelebration(false), 3500)
          }
          setScreen('brief')
        }
      }
    } finally { setLoading(false) }
  }

  function handlePinError(msg: string) {
    const n = pinAttempts + 1
    setPinAttempts(n); setPinError(msg); setPin('')
    if (n >= 3) startLockout()
  }

  function startBreakMode(emp: SelectEmployee) {
    setSelectedEmp(emp); setBreakMode(true)
    setPin(''); setPinError(''); setScreen('pin')
  }

  // ── Week helpers ──────────────────────────────────────────
  function getWeekDays(): Date[] {
    if (!displayData) return []
    const start = new Date(displayData.week_start + 'T12:00:00')
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start); d.setDate(d.getDate() + i); return d
    })
  }

  function getShiftsForDay(dayDate: Date): WeekShift[] {
    if (!displayData) return []
    return displayData.week_roster.filter(s => s.scheduled_date === isoDate(dayDate))
  }

  const weekDays = getWeekDays()
  const todayRoster = displayData?.roster ?? []
  const inNow = todayRoster.filter(r => r.is_in && !r.on_break).length
  const onBreak = todayRoster.filter(r => r.on_break).length
  const totalScheduled = todayRoster.length
  const attendancePct = totalScheduled > 0 ? Math.round(((inNow + onBreak) / totalScheduled) * 100) : 0
  const filteredEmps = employees.filter(e => !empSearch || e.full_name?.toLowerCase().includes(empSearch.toLowerCase()))
  const todayStr = isoDate(new Date())

  // Circumference for SVG ring
  const R = 54
  const CIRC = 2 * Math.PI * R

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;600&display=swap');

        *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; -webkit-tap-highlight-color:transparent; }
        html, body, #root { height:100%; overflow:hidden; }
        body { font-family:'Inter', system-ui, sans-serif; background:#060e1a; color:white; }

        /* ─── Animations ─────────────────────────────────────── */
        @keyframes confettiFall { 0%{transform:translateY(-20px) rotate(0deg);opacity:1} 100%{transform:translateY(110vh) rotate(720deg);opacity:0} }
        @keyframes fadeIn       { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeInFast   { from{opacity:0} to{opacity:1} }
        @keyframes slideUp      { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
        @keyframes scaleIn      { from{opacity:0;transform:scale(0.88)} to{opacity:1;transform:scale(1)} }
        @keyframes checkPop     { 0%{transform:scale(0) rotate(-15deg)} 60%{transform:scale(1.18) rotate(3deg)} 100%{transform:scale(1) rotate(0)} }
        @keyframes pinBounce    { 0%{transform:scale(1)} 35%{transform:scale(0.88)} 100%{transform:scale(1)} }
        @keyframes digitPop     { 0%{transform:scale(0.4);opacity:0} 70%{transform:scale(1.15)} 100%{transform:scale(1);opacity:1} }
        @keyframes streakIn     { 0%{transform:scale(0) rotate(-8deg);opacity:0} 65%{transform:scale(1.12) rotate(2deg)} 100%{transform:scale(1) rotate(0);opacity:1} }
        @keyframes progressBar  { from{width:100%} to{width:0%} }
        @keyframes pulse        { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes orbFloat1    { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(60px,-45px) scale(1.1)} }
        @keyframes orbFloat2    { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(-50px,55px) scale(0.9)} }
        @keyframes orbFloat3    { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(35px,35px) scale(1.06)} }
        @keyframes tickerMove   { 0%{transform:translateX(100vw)} 100%{transform:translateX(-100%)} }
        @keyframes scanLine     { 0%{top:0} 100%{top:100%} }
        @keyframes badgePulse   { 0%,100%{box-shadow:0 0 0 0 rgba(34,197,94,0.4)} 50%{box-shadow:0 0 0 6px rgba(34,197,94,0)} }

        /* ─── Kiosk Root ─────────────────────────────────────── */
        .kiosk { width:100vw; height:100vh; overflow:hidden; position:relative; background:#060e1a; }

        /* Background orbs */
        .bg-orbs { position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0; }
        .orb { position:absolute;border-radius:50%;filter:blur(100px);opacity:0.15; }
        .orb-1 { width:600px;height:600px;background:#4BACC6;top:-150px;left:-150px;animation:orbFloat1 16s ease-in-out infinite; }
        .orb-2 { width:500px;height:500px;background:#8064A2;bottom:-100px;right:-100px;animation:orbFloat2 18s ease-in-out infinite; }
        .orb-3 { width:350px;height:350px;background:#4F81BD;top:50%;left:45%;animation:orbFloat3 12s ease-in-out infinite; }

        /* Subtle grid */
        .bg-grid { position:absolute;inset:0;pointer-events:none;z-index:0;
          background-image:linear-gradient(rgba(75,172,198,0.03) 1px, transparent 1px),
                           linear-gradient(90deg, rgba(75,172,198,0.03) 1px, transparent 1px);
          background-size:52px 52px;
        }

        /* ════════════════════════════════════════════
           SCREENSAVER
        ════════════════════════════════════════════ */
        .screensaver {
          position:absolute;inset:0;z-index:50;
          display:flex;flex-direction:column;align-items:center;justify-content:center;
          cursor:pointer;animation:fadeInFast 1.5s ease;
        }
        .ss-time {
          font-size:clamp(80px,14vw,160px);font-weight:900;letter-spacing:-0.05em;line-height:1;
          font-variant-numeric:tabular-nums;
          background:linear-gradient(170deg,#ffffff 0%,rgba(255,255,255,0.55) 100%);
          -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
        }
        .ss-date { font-size:clamp(14px,2vw,24px);font-weight:400;color:rgba(255,255,255,0.35);margin-top:0.6rem;letter-spacing:0.2em;text-transform:uppercase; }
        .ss-logo { margin-top:4rem;display:flex;align-items:center;gap:0.85rem; }
        .ss-logo-mark { width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#4BACC6,#365F91);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(75,172,198,0.3); }
        .ss-logo-name { font-size:1.6rem;font-weight:800;letter-spacing:-0.02em;color:rgba(255,255,255,0.8); }
        .ss-touch { margin-top:3.5rem;display:flex;align-items:center;gap:0.5rem;font-size:0.8rem;font-weight:500;color:rgba(255,255,255,0.2);letter-spacing:0.25em;text-transform:uppercase;animation:pulse 2.5s ease-in-out infinite; }
        .ss-touch-line { width:40px;height:1px;background:rgba(255,255,255,0.15); }

        /* ════════════════════════════════════════════
           MAIN IDLE LAYOUT
        ════════════════════════════════════════════ */
        .idle-wrap { position:relative;z-index:1;width:100vw;height:100vh;display:grid;grid-template-columns:380px 1fr 340px;grid-template-rows:1fr auto; }

        /* ── Header bar ── */
        .top-bar {
          grid-column:1/-1;grid-row:1;
          display:grid;grid-template-columns:380px 1fr 340px;
          height:72px;flex-shrink:0;
          background:rgba(255,255,255,0.02);
          border-bottom:1px solid rgba(255,255,255,0.06);
          backdrop-filter:blur(20px);
          align-items:center;
          position:relative;z-index:10;
        }
        .top-bar-brand { display:flex;align-items:center;gap:0.75rem;padding:0 1.75rem; }
        .top-bar-logo { width:34px;height:34px;border-radius:8px;background:linear-gradient(135deg,#4BACC6,#365F91);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 12px rgba(75,172,198,0.3); }
        .top-bar-name { font-size:1.05rem;font-weight:800;letter-spacing:-0.02em; }
        .top-bar-tag { font-size:0.55rem;font-weight:600;color:rgba(75,172,198,0.6);text-transform:uppercase;letter-spacing:0.15em; }
        .top-bar-center { display:flex;align-items:center;justify-content:center;gap:2rem; }
        .top-stat { text-align:center; }
        .top-stat-val { font-size:1.35rem;font-weight:800;color:white;line-height:1;font-variant-numeric:tabular-nums; }
        .top-stat-label { font-size:0.58rem;font-weight:600;color:rgba(255,255,255,0.25);text-transform:uppercase;letter-spacing:0.1em;margin-top:0.15rem; }
        .top-stat-div { width:1px;height:28px;background:rgba(255,255,255,0.07); }
        .top-bar-right { display:flex;align-items:center;justify-content:flex-end;padding:0 1.75rem;gap:1rem; }
        .top-time { font-size:1.25rem;font-weight:700;color:rgba(255,255,255,0.7);font-variant-numeric:tabular-nums;font-family:'JetBrains Mono',monospace; }
        .top-date { font-size:0.72rem;font-weight:500;color:rgba(255,255,255,0.3); }

        /* ─────────────────────────────────────────────
           LEFT PANEL — Weekly Roster
        ───────────────────────────────────────────── */
        .panel-left {
          grid-column:1;grid-row:1;
          padding:5rem 1.5rem 1.5rem;
          border-right:1px solid rgba(255,255,255,0.05);
          display:flex;flex-direction:column;overflow:hidden;
        }
        .panel-label { font-size:0.6rem;font-weight:700;color:rgba(255,255,255,0.2);text-transform:uppercase;letter-spacing:0.18em;margin-bottom:1rem; }

        /* Day tab strip */
        .day-strip { display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-bottom:1rem;flex-shrink:0; }
        .day-btn {
          padding:0.5rem 0.2rem;border-radius:8px;border:1px solid transparent;
          background:transparent;color:rgba(255,255,255,0.2);
          font-size:0.6rem;font-weight:700;cursor:pointer;text-align:center;
          transition:all 0.15s;font-family:inherit;letter-spacing:0.05em;
        }
        .day-btn:hover { background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.6); }
        .day-btn.today { color:#4BACC6;border-color:rgba(75,172,198,0.25); }
        .day-btn.active { background:rgba(75,172,198,0.12);border-color:rgba(75,172,198,0.35);color:white;font-weight:800; }
        .day-btn-date { font-size:0.7rem;font-weight:800;margin-top:2px; }
        .day-btn-count { font-size:0.55rem;color:rgba(255,255,255,0.25);margin-top:1px; }
        .day-btn.active .day-btn-count { color:rgba(75,172,198,0.6); }

        /* Roster list */
        .roster-list { flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:3px; }
        .roster-list::-webkit-scrollbar { width:0; }

        .roster-row {
          display:flex;align-items:center;gap:0.7rem;
          padding:0.6rem 0.75rem;border-radius:10px;
          background:rgba(255,255,255,0.025);
          border:1px solid rgba(255,255,255,0.04);
          transition:all 0.15s;
        }
        .roster-row.is-in { background:rgba(34,197,94,0.06);border-color:rgba(34,197,94,0.15); }
        .roster-row.on-break { background:rgba(245,158,11,0.06);border-color:rgba(245,158,11,0.15); }
        .roster-row.done { background:rgba(75,172,198,0.04);border-color:rgba(75,172,198,0.1); }

        .roster-avatar {
          width:30px;height:30px;border-radius:50%;
          display:flex;align-items:center;justify-content:center;
          font-size:0.6rem;font-weight:800;color:white;flex-shrink:0;
          position:relative;
        }
        .roster-online-dot {
          position:absolute;bottom:-1px;right:-1px;
          width:9px;height:9px;border-radius:50%;
          border:1.5px solid #060e1a;
          animation:badgePulse 2s ease-in-out infinite;
        }
        .roster-name { font-size:0.78rem;font-weight:600;color:rgba(255,255,255,0.8);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .roster-time { font-size:0.62rem;color:rgba(255,255,255,0.3);flex-shrink:0; }
        .roster-badge {
          font-size:0.55rem;font-weight:700;padding:0.1rem 0.4rem;border-radius:999px;
          letter-spacing:0.05em;text-transform:uppercase;flex-shrink:0;
        }
        .roster-badge.in   { background:rgba(34,197,94,0.15);color:#86efac; }
        .roster-badge.brk  { background:rgba(245,158,11,0.15);color:#fcd34d; }
        .roster-badge.done { background:rgba(75,172,198,0.12);color:#7dd3fc; }

        .roster-empty { text-align:center;padding:2.5rem 1rem;color:rgba(255,255,255,0.15);font-size:0.8rem; }

        /* ─────────────────────────────────────────────
           CENTER PANEL — Clock & CTA
        ───────────────────────────────────────────── */
        .panel-center {
          grid-column:2;grid-row:1;
          display:flex;flex-direction:column;align-items:center;justify-content:center;
          padding:5rem 2rem 2rem;gap:0;
        }
        .center-greeting { font-size:0.75rem;font-weight:600;color:rgba(255,255,255,0.25);text-transform:uppercase;letter-spacing:0.2em;margin-bottom:1.5rem; }
        .center-clock {
          font-size:clamp(64px,9vw,112px);font-weight:900;
          font-variant-numeric:tabular-nums;letter-spacing:-0.04em;line-height:1;
          font-family:'Inter',sans-serif;
          background:linear-gradient(170deg,#ffffff 20%,rgba(255,255,255,0.5) 100%);
          -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
          margin-bottom:0.35rem;
        }
        .center-date { font-size:0.85rem;font-weight:400;color:rgba(255,255,255,0.3);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:2.5rem; }

        /* Attendance ring */
        .attendance-wrap { position:relative;width:140px;height:140px;margin-bottom:2.5rem; }
        .att-svg { transform:rotate(-90deg); }
        .att-track { fill:none;stroke:rgba(255,255,255,0.05);stroke-width:6; }
        .att-fill-main { fill:none;stroke:#4BACC6;stroke-width:6;stroke-linecap:round;transition:stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1); }
        .att-fill-break { fill:none;stroke:#f59e0b;stroke-width:6;stroke-linecap:round;transition:stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1); }
        .att-center { position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center; }
        .att-pct { font-size:1.65rem;font-weight:900;color:white;line-height:1;font-variant-numeric:tabular-nums; }
        .att-label { font-size:0.55rem;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.1em;margin-top:0.2rem; }

        /* Legend */
        .att-legend { display:flex;gap:1.25rem;margin-bottom:2.5rem; }
        .att-legend-item { display:flex;align-items:center;gap:0.4rem;font-size:0.72rem;color:rgba(255,255,255,0.4); }
        .att-legend-dot { width:8px;height:8px;border-radius:50%;flex-shrink:0; }

        /* CTA button */
        .cta-btn {
          width:100%;max-width:340px;
          padding:1.2rem 2rem;
          background:linear-gradient(135deg,#4BACC6 0%,#4F81BD 50%,#365F91 100%);
          border:none;border-radius:16px;
          font-size:1.05rem;font-weight:800;color:white;
          cursor:pointer;transition:all 0.2s;font-family:inherit;
          letter-spacing:0.01em;
          box-shadow:0 8px 32px rgba(75,172,198,0.3),0 0 0 1px rgba(75,172,198,0.2);
          position:relative;overflow:hidden;
        }
        .cta-btn::after { content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,0.12),transparent);border-radius:16px; }
        .cta-btn:hover { transform:translateY(-2px);box-shadow:0 12px 40px rgba(75,172,198,0.45),0 0 0 1px rgba(75,172,198,0.3); }
        .cta-btn:active { transform:scale(0.99);box-shadow:0 4px 16px rgba(75,172,198,0.3); }
        .cta-btn-sub { font-size:0.7rem;opacity:0.65;font-weight:500;margin-top:0.2rem; }

        /* ─────────────────────────────────────────────
           RIGHT PANEL — Announcements & Events
        ───────────────────────────────────────────── */
        .panel-right {
          grid-column:3;grid-row:1;
          padding:5rem 1.5rem 1.5rem;
          border-left:1px solid rgba(255,255,255,0.05);
          display:flex;flex-direction:column;overflow:hidden;gap:0;
        }

        .announcement-card {
          background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);
          border-radius:12px;padding:1rem 1.1rem;margin-bottom:0.5rem;
          transition:all 0.15s;
        }
        .announcement-card:hover { background:rgba(255,255,255,0.05); }
        .announcement-dot { width:6px;height:6px;border-radius:50%;background:#4BACC6;flex-shrink:0;margin-top:4px; }
        .announcement-title { font-size:0.82rem;font-weight:600;color:rgba(255,255,255,0.8);line-height:1.4;flex:1; }
        .announcement-time { font-size:0.62rem;color:rgba(255,255,255,0.2);margin-top:0.35rem; }

        .event-card {
          background:rgba(128,100,162,0.08);border:1px solid rgba(128,100,162,0.2);
          border-radius:12px;padding:0.85rem 1.1rem;margin-bottom:0.5rem;
        }
        .event-header { display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem; }
        .event-icon { font-size:0.8rem; }
        .event-title { font-size:0.8rem;font-weight:600;color:rgba(255,255,255,0.8);flex:1; }
        .event-date { font-size:0.68rem;color:#c4b5fd;font-weight:500; }

        /* ─────────────────────────────────────────────
           TICKER
        ───────────────────────────────────────────── */
        .ticker-bar {
          grid-column:1/-1;grid-row:2;
          height:38px;
          background:rgba(0,0,0,0.5);
          border-top:1px solid rgba(255,255,255,0.05);
          display:flex;align-items:center;overflow:hidden;
          backdrop-filter:blur(20px);
          position:relative;z-index:10;
        }
        .ticker-label { padding:0 1.25rem;font-size:0.6rem;font-weight:800;color:#4BACC6;text-transform:uppercase;letter-spacing:0.15em;flex-shrink:0;border-right:1px solid rgba(255,255,255,0.06);height:100%;display:flex;align-items:center; }
        .ticker-track { flex:1;overflow:hidden;position:relative; }
        .ticker-content { display:inline-flex;gap:4rem;animation:tickerMove 50s linear infinite;white-space:nowrap;padding-left:2rem; }
        .ticker-item { font-size:0.72rem;color:rgba(255,255,255,0.35);display:flex;align-items:center;gap:0.5rem; }
        .ticker-item span { color:rgba(255,255,255,0.15); }

        /* ════════════════════════════════════════════
           EMPLOYEE SELECT SCREEN
        ════════════════════════════════════════════ */
        .select-screen {
          position:absolute;inset:0;z-index:40;
          background:rgba(6,14,26,0.96);backdrop-filter:blur(24px);
          display:flex;flex-direction:column;animation:fadeIn 0.2s ease;
        }
        .select-topbar {
          display:flex;align-items:center;justify-content:space-between;
          padding:1.5rem 2rem;border-bottom:1px solid rgba(255,255,255,0.06);
          flex-shrink:0;
        }
        .select-title { font-size:1.35rem;font-weight:800;color:white;letter-spacing:-0.02em; }
        .select-sub { font-size:0.8rem;color:rgba(255,255,255,0.3);margin-top:0.2rem; }
        .select-close { width:40px;height:40px;border-radius:10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.4);font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s; }
        .select-close:hover { background:rgba(255,255,255,0.1);color:white; }

        .select-search-wrap { padding:1.25rem 2rem 0.75rem;flex-shrink:0; }
        .select-search {
          width:100%;padding:0.85rem 1.25rem;
          background:rgba(255,255,255,0.04);
          border:1.5px solid rgba(255,255,255,0.08);
          border-radius:12px;color:white;font-size:0.95rem;
          outline:none;font-family:inherit;transition:border-color 0.15s;
        }
        .select-search:focus { border-color:rgba(75,172,198,0.45);background:rgba(255,255,255,0.06); }
        .select-search::placeholder { color:rgba(255,255,255,0.2); }

        .select-count { padding:0 2rem 0.75rem;font-size:0.72rem;color:rgba(255,255,255,0.2); }

        .emp-grid {
          flex:1;overflow-y:auto;padding:0 2rem 2rem;
          display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:0.65rem;
          align-content:start;
        }
        .emp-grid::-webkit-scrollbar { width:4px; }
        .emp-grid::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.08);border-radius:999px; }

        .emp-card {
          display:flex;flex-direction:column;align-items:center;gap:0.55rem;
          padding:1.35rem 1rem 1.1rem;
          background:rgba(255,255,255,0.025);
          border:1px solid rgba(255,255,255,0.06);
          border-radius:14px;cursor:pointer;transition:all 0.15s;
          animation:scaleIn 0.2s ease both;
          position:relative;overflow:hidden;
        }
        .emp-card::before { content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(75,172,198,0),rgba(75,172,198,0));transition:background 0.2s;border-radius:14px; }
        .emp-card:hover { background:rgba(75,172,198,0.08);border-color:rgba(75,172,198,0.3);transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,0.3); }
        .emp-card:active { transform:scale(0.97); }
        .emp-card.no-pin { opacity:0.25;cursor:not-allowed; }
        .emp-card.no-pin:hover { transform:none;background:rgba(255,255,255,0.025);border-color:rgba(255,255,255,0.06); }

        .emp-avatar-wrap { position:relative; }
        .emp-avatar {
          width:56px;height:56px;border-radius:50%;
          display:flex;align-items:center;justify-content:center;
          font-size:1.05rem;font-weight:800;color:white;
          border:2px solid rgba(255,255,255,0.1);
        }
        .emp-status-ring { position:absolute;bottom:1px;right:1px;width:14px;height:14px;border-radius:50%;border:2px solid #060e1a; }
        .emp-name { font-size:0.8rem;font-weight:700;color:rgba(255,255,255,0.85);text-align:center;line-height:1.3; }
        .emp-role-text { font-size:0.62rem;color:rgba(255,255,255,0.3);text-transform:capitalize; }
        .emp-status-chip { font-size:0.58rem;font-weight:700;padding:0.12rem 0.5rem;border-radius:999px;letter-spacing:0.04em; }
        .emp-status-chip.in { background:rgba(34,197,94,0.15);color:#86efac; }
        .emp-status-chip.brk { background:rgba(245,158,11,0.15);color:#fcd34d; }

        /* ════════════════════════════════════════════
           PIN PAD SCREEN
        ════════════════════════════════════════════ */
        .pin-screen {
          position:absolute;inset:0;z-index:40;
          display:flex;flex-direction:column;align-items:center;justify-content:center;
          background:rgba(6,14,26,0.97);backdrop-filter:blur(24px);
          animation:fadeIn 0.2s ease;padding:2rem;
        }
        .pin-back {
          position:absolute;top:1.75rem;left:2rem;
          display:flex;align-items:center;gap:0.4rem;
          padding:0.5rem 1rem;
          background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);
          border-radius:9px;color:rgba(255,255,255,0.4);font-size:0.8rem;font-weight:600;
          cursor:pointer;font-family:inherit;transition:all 0.15s;
        }
        .pin-back:hover { background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.8); }

        .pin-emp-section { text-align:center;margin-bottom:2rem;animation:slideUp 0.25s ease; }
        .pin-emp-avatar {
          width:76px;height:76px;border-radius:50%;
          display:flex;align-items:center;justify-content:center;
          font-size:1.5rem;font-weight:800;color:white;
          margin:0 auto 0.85rem;
          border:2px solid rgba(255,255,255,0.12);
          box-shadow:0 8px 32px rgba(0,0,0,0.4);
        }
        .pin-emp-name { font-size:1.3rem;font-weight:800;color:white;margin-bottom:0.25rem; }
        .pin-action { font-size:0.8rem;color:rgba(255,255,255,0.35);letter-spacing:0.05em; }

        .pin-dots { display:flex;gap:1rem;margin-bottom:0.75rem;justify-content:center; }
        .pin-dot { width:14px;height:14px;border-radius:50%;border:2px solid rgba(255,255,255,0.15);transition:all 0.15s; }
        .pin-dot.filled { background:#4BACC6;border-color:#4BACC6;box-shadow:0 0 12px rgba(75,172,198,0.5);animation:digitPop 0.2s cubic-bezier(0.34,1.56,0.64,1); }

        .pin-feedback { height:28px;display:flex;align-items:center;justify-content:center;margin-bottom:1.5rem; }
        .pin-error-msg { font-size:0.82rem;color:#fca5a5;font-weight:600; }
        .pin-locked-msg { font-size:0.88rem;color:#fcd34d;font-weight:700;animation:pulse 1s ease-in-out infinite; }
        .pin-attempts { font-size:0.72rem;color:rgba(255,255,255,0.25); }

        .pin-pad { display:grid;grid-template-columns:repeat(3,1fr);gap:10px;width:264px; }
        .pin-key {
          aspect-ratio:1;border-radius:14px;
          border:1px solid rgba(255,255,255,0.08);
          background:rgba(255,255,255,0.04);
          color:white;font-size:1.55rem;font-weight:600;
          cursor:pointer;transition:all 0.12s;font-family:'Inter',sans-serif;
          display:flex;align-items:center;justify-content:center;
          position:relative;overflow:hidden;
        }
        .pin-key:hover:not(:disabled) { background:rgba(255,255,255,0.09);border-color:rgba(255,255,255,0.16); }
        .pin-key:active:not(:disabled) { animation:pinBounce 0.2s ease;background:rgba(75,172,198,0.18);border-color:rgba(75,172,198,0.4); }
        .pin-key:disabled { opacity:0.15;cursor:not-allowed; }
        .pin-key.del { font-size:1.1rem;color:rgba(255,255,255,0.4); }
        .pin-key.zero { grid-column:2; }
        .pin-key-sub { font-size:0.45rem;letter-spacing:0.12em;color:rgba(255,255,255,0.2);font-weight:600;margin-top:2px; }

        /* Break toggle on PIN screen */
        .pin-break-toggle {
          margin-top:1.75rem;
          padding:0.65rem 1.5rem;
          background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);
          border-radius:10px;color:#fcd34d;font-size:0.82rem;font-weight:700;
          cursor:pointer;font-family:inherit;transition:all 0.15s;
        }
        .pin-break-toggle:hover { background:rgba(245,158,11,0.15); }

        /* ════════════════════════════════════════════
           BRIEF / RESULT SCREEN
        ════════════════════════════════════════════ */
        .brief-screen {
          position:absolute;inset:0;z-index:40;
          display:flex;flex-direction:column;align-items:center;justify-content:center;
          background:rgba(6,14,26,0.97);backdrop-filter:blur(24px);
          animation:fadeIn 0.25s ease;padding:2rem;text-align:center;
        }

        .brief-icon-wrap {
          width:96px;height:96px;border-radius:50%;
          display:flex;align-items:center;justify-content:center;
          font-size:2.25rem;margin:0 auto 1.5rem;
          animation:checkPop 0.45s cubic-bezier(0.34,1.56,0.64,1);
          position:relative;
        }
        .brief-icon-wrap::before { content:'';position:absolute;inset:-8px;border-radius:50%;opacity:0.2; }
        .brief-icon-wrap.in::before { background:#22c55e;animation:pulse 2s ease-in-out infinite; }
        .brief-icon-wrap.out::before { background:#4BACC6;animation:pulse 2s ease-in-out infinite; }
        .brief-icon-wrap.brk::before { background:#f59e0b;animation:pulse 2s ease-in-out infinite; }
        .brief-icon-wrap.in { background:rgba(34,197,94,0.12);border:2px solid rgba(34,197,94,0.3); }
        .brief-icon-wrap.out { background:rgba(75,172,198,0.12);border:2px solid rgba(75,172,198,0.3); }
        .brief-icon-wrap.brk { background:rgba(245,158,11,0.12);border:2px solid rgba(245,158,11,0.3); }

        .brief-name { font-size:1.65rem;font-weight:900;color:white;margin-bottom:0.3rem;letter-spacing:-0.02em;animation:slideUp 0.3s ease 0.08s both; }
        .brief-action-label { font-size:0.9rem;color:rgba(255,255,255,0.4);margin-bottom:1.75rem;animation:slideUp 0.3s ease 0.12s both; }

        .brief-info-card { background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:1.1rem 2rem;margin-bottom:1.25rem;animation:slideUp 0.3s ease 0.18s both; }
        .brief-time-big { font-size:1.75rem;font-weight:800;color:#4BACC6;font-variant-numeric:tabular-nums;font-family:'JetBrains Mono',monospace; }
        .brief-time-label { font-size:0.65rem;color:rgba(255,255,255,0.25);text-transform:uppercase;letter-spacing:0.12em;margin-top:0.25rem; }
        .brief-duration { font-size:1rem;font-weight:600;color:rgba(255,255,255,0.5);margin-top:0.5rem; }

        /* Streak */
        .brief-streak {
          display:inline-flex;align-items:center;gap:0.65rem;
          background:rgba(245,158,11,0.08);border:1.5px solid rgba(245,158,11,0.25);
          border-radius:999px;padding:0.65rem 1.5rem;
          margin-bottom:1rem;
          animation:streakIn 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.3s both;
        }
        .brief-streak-icon { font-size:1.35rem; }
        .brief-streak-text { font-size:0.92rem;font-weight:800;color:#fcd34d; }
        .brief-streak-sub { font-size:0.72rem;color:rgba(255,255,255,0.3);margin-top:0.15rem; }

        /* Must-read nudge */
        .brief-nudge {
          display:flex;align-items:center;gap:0.75rem;
          background:rgba(192,80,77,0.08);border:1px solid rgba(192,80,77,0.2);
          border-radius:12px;padding:0.85rem 1.25rem;
          max-width:380px;margin-bottom:1.25rem;
          animation:slideUp 0.3s ease 0.4s both;text-align:left;
        }
        .brief-nudge-text { font-size:0.8rem;color:rgba(255,255,255,0.65);line-height:1.55; }
        .brief-nudge-text strong { color:#fca5a5; }

        /* Progress bar */
        .brief-progress-wrap { margin-top:1.5rem;animation:slideUp 0.3s ease 0.45s both; }
        .brief-progress-bar { width:240px;height:2px;background:rgba(255,255,255,0.06);border-radius:999px;overflow:hidden;margin:0 auto 0.4rem; }
        .brief-progress-fill { height:100%;background:rgba(255,255,255,0.18);border-radius:999px;animation:progressBar linear forwards; }
        .brief-return-label { font-size:0.68rem;color:rgba(255,255,255,0.18); }

        .brief-break-btn {
          margin-top:0.75rem;padding:0.65rem 1.75rem;
          background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);
          border-radius:10px;color:#fcd34d;font-size:0.82rem;font-weight:700;
          cursor:pointer;font-family:inherit;transition:all 0.15s;
          animation:slideUp 0.3s ease 0.35s both;
        }
        .brief-break-btn:hover { background:rgba(245,158,11,0.15); }

        .brief-home {
          margin-top:0.5rem;padding:0.55rem 1.25rem;
          background:transparent;border:1px solid rgba(255,255,255,0.08);
          border-radius:9px;color:rgba(255,255,255,0.3);font-size:0.78rem;font-weight:600;
          cursor:pointer;font-family:inherit;transition:all 0.15s;
        }
        .brief-home:hover { background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.7); }

        /* Loading */
        .loading-overlay { position:absolute;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:99;backdrop-filter:blur(6px); }
        @keyframes spin { to{transform:rotate(360deg)} }
        .spinner { width:52px;height:52px;border:3px solid rgba(75,172,198,0.15);border-top-color:#4BACC6;border-radius:50%;animation:spin 0.75s linear infinite; }

        @media(max-width:960px) { .panel-left,.panel-right{display:none} .idle-wrap{grid-template-columns:1fr} .top-bar{grid-template-columns:1fr} }
      `}</style>

      <div className="kiosk">
        {/* Background */}
        <div className="bg-orbs">
          <div className="orb orb-1" />
          <div className="orb orb-2" />
          <div className="orb orb-3" />
        </div>
        <div className="bg-grid" />

        {showCelebration && <Confetti />}

        {/* ══════════════════════════════════════════
            SCREENSAVER
        ══════════════════════════════════════════ */}
        {screen === 'screensaver' && (
          <div className="screensaver" onClick={() => { setScreen('idle'); resetIdleTimer() }}>
            <div className="ss-time">{fmtClockNoSec(now)}</div>
            <div className="ss-date">{fmtFullDate(now)}</div>
            <div className="ss-logo">
              <div className="ss-logo-mark">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1.5"/>
                  <rect x="14" y="3" width="7" height="7" rx="1.5"/>
                  <rect x="3" y="14" width="7" height="7" rx="1.5"/>
                  <rect x="14" y="14" width="7" height="7" rx="1.5"/>
                </svg>
              </div>
              <div className="ss-logo-name">InfoWall</div>
            </div>
            <div className="ss-touch">
              <div className="ss-touch-line" />
              Tap to clock in or out
              <div className="ss-touch-line" />
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════
            MAIN IDLE
        ══════════════════════════════════════════ */}
        {screen === 'idle' && (
          <div className="idle-wrap">

            {/* Top bar */}
            <div className="top-bar">
              <div className="top-bar-brand">
                <div className="top-bar-logo">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1.5"/>
                    <rect x="14" y="3" width="7" height="7" rx="1.5"/>
                    <rect x="3" y="14" width="7" height="7" rx="1.5"/>
                    <rect x="14" y="14" width="7" height="7" rx="1.5"/>
                  </svg>
                </div>
                <div>
                  <div className="top-bar-name">InfoWall</div>
                  <div className="top-bar-tag">Enterprise Kiosk</div>
                </div>
              </div>

              <div className="top-bar-center">
                {[
                  { val: inNow, label: 'In Office', color: '#22c55e' },
                  null,
                  { val: onBreak, label: 'On Break', color: '#f59e0b' },
                  null,
                  { val: totalScheduled - inNow - onBreak, label: 'Absent', color: '#6b7280' },
                  null,
                  { val: `${attendancePct}%`, label: 'Attendance', color: '#4BACC6' },
                ].map((s, i) =>
                  s === null
                    ? <div key={i} className="top-stat-div" />
                    : (
                      <div key={i} className="top-stat">
                        <div className="top-stat-val" style={{ color: s.color }}>{s.val}</div>
                        <div className="top-stat-label">{s.label}</div>
                      </div>
                    )
                )}
              </div>

              <div className="top-bar-right">
                <div style={{ textAlign: 'right' }}>
                  <div className="top-time">{fmtClockNoSec(now)}</div>
                  <div className="top-date">{fmtShortDate(now)}</div>
                </div>
              </div>
            </div>

            {/* ── LEFT: Weekly Roster ── */}
            <div className="panel-left">
              <div className="panel-label">Weekly Roster</div>

              {/* Day tabs */}
              <div className="day-strip">
                {DAYS_SHORT.map((day, i) => {
                  const dayDate = weekDays[i]
                  const isToday = dayDate && isoDate(dayDate) === todayStr
                  const shifts = dayDate ? getShiftsForDay(dayDate) : []
                  return (
                    <button
                      key={i}
                      className={`day-btn${isToday ? ' today' : ''}${activeDay === i ? ' active' : ''}`}
                      onClick={() => setActiveDay(i)}
                    >
                      {day}
                      <div className="day-btn-date">{dayDate ? dayDate.getDate() : ''}</div>
                      {shifts.length > 0 && <div className="day-btn-count">{shifts.length}</div>}
                    </button>
                  )
                })}
              </div>

              {/* Roster */}
              <div className="roster-list">
                {(() => {
                  const dayDate = weekDays[activeDay]
                  if (!dayDate) return null
                  const isToday = isoDate(dayDate) === todayStr

                  if (isToday) {
                    if (todayRoster.length === 0) return <div className="roster-empty">No employees with PIN today</div>
                    return todayRoster.map(emp => {
                      const color = deptColor(emp.department_id, allDeptIds)
                      return (
                        <div key={emp.user_id} className={`roster-row${emp.is_in && !emp.on_break ? ' is-in' : emp.on_break ? ' on-break' : emp.clocked_today ? ' done' : ''}`}>
                          <div className="roster-avatar" style={{ background: color }}>
                            {initials(emp.full_name)}
                            {(emp.is_in || emp.on_break) && (
                              <div className="roster-online-dot" style={{ background: emp.on_break ? '#f59e0b' : '#22c55e' }} />
                            )}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="roster-name">{emp.full_name}</div>
                            <div className="roster-time">
                              {emp.schedule_start ? `${fmtTime12(emp.schedule_start)} – ${fmtTime12(emp.schedule_end)}` : emp.role}
                            </div>
                          </div>
                          {emp.is_in && !emp.on_break && <span className="roster-badge in">In</span>}
                          {emp.on_break && <span className="roster-badge brk">Break</span>}
                          {!emp.is_in && !emp.on_break && emp.clocked_today && <span className="roster-badge done">Done</span>}
                        </div>
                      )
                    })
                  } else {
                    const shifts = getShiftsForDay(dayDate)
                    if (shifts.length === 0) return (
                      <div className="roster-empty">No shifts scheduled<br />for {DAYS_SHORT[activeDay]} {fmtShortDate(dayDate)}</div>
                    )
                    return shifts.map(s => {
                      const color = deptColor(s.department_id, allDeptIds)
                      return (
                        <div key={s.id} className={`roster-row${s.is_in ? ' is-in' : s.clocked ? ' done' : ''}`}>
                          <div className="roster-avatar" style={{ background: color }}>
                            {initials(s.full_name)}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="roster-name">{s.full_name}</div>
                            <div className="roster-time">{fmtTime12(s.start_time)} – {fmtTime12(s.end_time)}</div>
                            {s.note && <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.2)', marginTop: '1px' }}>{s.note}</div>}
                          </div>
                          {s.is_in && <span className="roster-badge in">In</span>}
                          {!s.is_in && s.clocked && <span className="roster-badge done">Done</span>}
                        </div>
                      )
                    })
                  }
                })()}
              </div>
            </div>

            {/* ── CENTER: Clock & CTA ── */}
            <div className="panel-center">
              <div className="center-greeting">{greeting(now)}</div>
              <div className="center-clock">{fmtClockNoSec(now)}</div>
              <div className="center-date">{fmtFullDate(now)}</div>

              {/* Attendance ring */}
              <div className="attendance-wrap">
                <svg className="att-svg" viewBox="0 0 128 128" width="140" height="140">
                  <circle className="att-track" cx="64" cy="64" r={R} />
                  {/* Green arc: clocked in */}
                  <circle
                    className="att-fill-main" cx="64" cy="64" r={R}
                    strokeDasharray={CIRC}
                    strokeDashoffset={CIRC * (1 - (totalScheduled > 0 ? inNow / totalScheduled : 0))}
                  />
                  {/* Amber arc: on break (stacked) */}
                  <circle
                    className="att-fill-break" cx="64" cy="64" r={R}
                    strokeDasharray={CIRC}
                    strokeDashoffset={CIRC * (1 - (totalScheduled > 0 ? (inNow + onBreak) / totalScheduled : 0))}
                    style={{ opacity: onBreak > 0 ? 1 : 0 }}
                  />
                </svg>
                <div className="att-center">
                  <div className="att-pct">{attendancePct}%</div>
                  <div className="att-label">Present</div>
                </div>
              </div>

              <div className="att-legend">
                <div className="att-legend-item">
                  <div className="att-legend-dot" style={{ background: '#22c55e' }} />
                  {inNow} in office
                </div>
                {onBreak > 0 && (
                  <div className="att-legend-item">
                    <div className="att-legend-dot" style={{ background: '#f59e0b' }} />
                    {onBreak} on break
                  </div>
                )}
                <div className="att-legend-item">
                  <div className="att-legend-dot" style={{ background: 'rgba(255,255,255,0.15)' }} />
                  {totalScheduled} total
                </div>
              </div>

              <button
                className="cta-btn"
                onClick={() => { setEmpSearch(''); setScreen('select') }}
              >
                <div>👆 Clock In / Out</div>
                <div className="cta-btn-sub">Tap to get started</div>
              </button>
            </div>

            {/* ── RIGHT: Announcements + Events ── */}
            <div className="panel-right">
              {displayData?.posts && displayData.posts.length > 0 && (
                <>
                  <div className="panel-label">Latest Announcements</div>
                  {displayData.posts.slice(0, 4).map(post => (
                    <div key={post.id} className="announcement-card">
                      <div style={{ display: 'flex', gap: '0.6rem' }}>
                        <div className="announcement-dot" style={{ marginTop: '4px' }} />
                        <div>
                          <div className="announcement-title">{post.title}</div>
                          <div className="announcement-time">
                            {new Date(post.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {displayData?.events && displayData.events.length > 0 && (
                <>
                  <div className="panel-label" style={{ marginTop: '1rem' }}>Upcoming Events</div>
                  {displayData.events.slice(0, 3).map(evt => (
                    <div key={evt.id} className="event-card">
                      <div className="event-header">
                        <span className="event-icon">📅</span>
                        <div className="event-title">{evt.title}</div>
                      </div>
                      <div className="event-date">{fmtEventDate(evt.event_start)}</div>
                    </div>
                  ))}
                </>
              )}

              {(!displayData?.posts?.length && !displayData?.events?.length) && (
                <div style={{ color: 'rgba(255,255,255,0.1)', fontSize: '0.8rem', textAlign: 'center', paddingTop: '2rem' }}>
                  No announcements
                </div>
              )}
            </div>

            {/* Ticker */}
            <div className="ticker-bar">
              <div className="ticker-label">Live</div>
              <div className="ticker-track">
                <div className="ticker-content">
                  {[
                    `${inNow} team member${inNow !== 1 ? 's' : ''} currently in office`,
                    ...(displayData?.posts ?? []).map(p => `📢  ${p.title}`),
                    ...(displayData?.events ?? []).map(e => `📅  ${e.title}  ·  ${fmtEventDate(e.event_start)}`),
                    `🕐  ${fmtFullDate(now)}`,
                    `${attendancePct}% attendance today`,
                  ].map((item, i) => (
                    <span key={i} className="ticker-item">
                      {item}
                      <span>  ◆  </span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════
            EMPLOYEE SELECT
        ══════════════════════════════════════════ */}
        {screen === 'select' && (
          <div className="select-screen">
            <div className="select-topbar">
              <div>
                <div className="select-title">Select your name</div>
                <div className="select-sub">Find yourself to clock in or out</div>
              </div>
              <button className="select-close" onClick={() => { setScreen('idle'); setEmpSearch('') }}>✕</button>
            </div>

            <div className="select-search-wrap">
              <input
                className="select-search"
                placeholder="🔍   Search by name…"
                value={empSearch}
                onChange={e => setEmpSearch(e.target.value)}
                autoFocus
              />
            </div>

            <div className="select-count">
              {filteredEmps.length} employee{filteredEmps.length !== 1 ? 's' : ''}
            </div>

            <div className="emp-grid">
              {filteredEmps.map((emp, i) => {
                const roster = displayData?.roster.find(r => r.user_id === emp.id)
                const isIn = roster?.is_in ?? false
                const isOnBreak = roster?.on_break ?? false
                const color = `hsl(${(emp.full_name?.charCodeAt(0) ?? 0) * 15 % 360}, 55%, 38%)`
                return (
                  <div
                    key={emp.id}
                    className={`emp-card${!emp.has_pin ? ' no-pin' : ''}`}
                    style={{ animationDelay: `${Math.min(i * 0.02, 0.3)}s` }}
                    onClick={() => {
                      if (!emp.has_pin) return
                      setSelectedEmp(emp); setBreakMode(false)
                      setPin(''); setPinError(''); setPinAttempts(0)
                      setScreen('pin')
                    }}
                  >
                    <div className="emp-avatar-wrap">
                      <div className="emp-avatar" style={{ background: color }}>
                        {initials(emp.full_name)}
                      </div>
                      <div className="emp-status-ring" style={{
                        background: isIn && !isOnBreak ? '#22c55e' : isOnBreak ? '#f59e0b' : 'rgba(255,255,255,0.1)'
                      }} />
                    </div>
                    <div className="emp-name">{emp.full_name ?? 'Unknown'}</div>
                    <div className="emp-role-text">{emp.role}</div>
                    {isIn && !isOnBreak && <span className="emp-status-chip in">● Clocked in</span>}
                    {isOnBreak && <span className="emp-status-chip brk">☕ On break</span>}
                    {!emp.has_pin && <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.15)' }}>No PIN set</span>}
                  </div>
                )
              })}

              {filteredEmps.length === 0 && (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '4rem 2rem', color: 'rgba(255,255,255,0.15)' }}>
                  <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem', opacity: 0.4 }}>🔍</div>
                  <div style={{ fontSize: '0.9rem' }}>No employees found for "{empSearch}"</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════
            PIN PAD
        ══════════════════════════════════════════ */}
        {screen === 'pin' && selectedEmp && (
          <div className="pin-screen">
            <button className="pin-back" onClick={() => { setScreen('select'); setPin(''); setPinError('') }}>
              ← Back
            </button>

            {/* Employee info */}
            <div className="pin-emp-section">
              <div className="pin-emp-avatar" style={{
                background: `hsl(${(selectedEmp.full_name?.charCodeAt(0) ?? 0) * 15 % 360}, 55%, 38%)`
              }}>
                {initials(selectedEmp.full_name)}
              </div>
              <div className="pin-emp-name">{selectedEmp.full_name}</div>
              <div className="pin-action">
                {breakMode
                  ? (displayData?.roster.find(r => r.user_id === selectedEmp.id)?.on_break ? 'Enter PIN to end break' : 'Enter PIN to start break')
                  : (displayData?.roster.find(r => r.user_id === selectedEmp.id)?.is_in ? 'Enter PIN to clock out' : 'Enter PIN to clock in')}
              </div>
            </div>

            {/* PIN dots */}
            <div className="pin-dots">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className={`pin-dot${i < pin.length ? ' filled' : ''}`} />
              ))}
            </div>

            {/* Feedback */}
            <div className="pin-feedback">
              {pinLocked ? (
                <div className="pin-locked-msg">🔒 Locked — try again in {lockoutSecs}s</div>
              ) : pinError ? (
                <div>
                  <div className="pin-error-msg">{pinError}</div>
                  {pinAttempts > 0 && pinAttempts < 3 && (
                    <div className="pin-attempts">{3 - pinAttempts} attempt{3 - pinAttempts !== 1 ? 's' : ''} remaining</div>
                  )}
                </div>
              ) : null}
            </div>

            {/* Keypad */}
            <div className="pin-pad">
              {[
                { d: '1', sub: '' }, { d: '2', sub: 'ABC' }, { d: '3', sub: 'DEF' },
                { d: '4', sub: 'GHI' }, { d: '5', sub: 'JKL' }, { d: '6', sub: 'MNO' },
                { d: '7', sub: 'PQRS' }, { d: '8', sub: 'TUV' }, { d: '9', sub: 'WXYZ' },
              ].map(({ d, sub }) => (
                <button
                  key={d}
                  className="pin-key"
                  onClick={() => handleDigit(d)}
                  disabled={pinLocked || loading}
                >
                  <div>
                    <div>{d}</div>
                    {sub && <div className="pin-key-sub">{sub}</div>}
                  </div>
                </button>
              ))}
              {/* Bottom row */}
              <button className="pin-key" style={{ opacity: 0, pointerEvents: 'none' }} disabled />
              <button className="pin-key zero" onClick={() => handleDigit('0')} disabled={pinLocked || loading}>0</button>
              <button className="pin-key del" onClick={handleBackspace} disabled={pinLocked || loading || pin.length === 0}>⌫</button>
            </div>

            {/* Break toggle for clocked-in employees */}
            {(() => {
              const roster = displayData?.roster.find(r => r.user_id === selectedEmp.id)
              if (!roster?.is_in && !roster?.on_break) return null
              return (
                <button className="pin-break-toggle" onClick={() => { setBreakMode(b => !b); setPin(''); setPinError('') }}>
                  {breakMode
                    ? '↩ Clock out instead'
                    : roster.on_break ? '☕ End break instead' : '☕ Start break instead'}
                </button>
              )
            })()}
          </div>
        )}

        {/* ══════════════════════════════════════════
            BRIEF / RESULT
        ══════════════════════════════════════════ */}
        {screen === 'brief' && actionResult && (
          <div className="brief-screen">
            {/* Icon */}
            <div className={`brief-icon-wrap${actionResult.action === 'in' ? ' in' : actionResult.action === 'out' ? ' out' : ' brk'}`}>
              {actionResult.action === 'in' ? '✓' : actionResult.action === 'out' ? '👋' : actionResult.action === 'break_start' ? '☕' : '💪'}
            </div>

            <div className="brief-name">{actionResult.user}</div>
            <div className="brief-action-label">
              {actionResult.action === 'in' && 'Successfully clocked in'}
              {actionResult.action === 'out' && 'Successfully clocked out — great work today!'}
              {actionResult.action === 'break_start' && 'Break started — enjoy your break'}
              {actionResult.action === 'break_end' && 'Break ended — welcome back!'}
            </div>

            {/* Time card */}
            <div className="brief-info-card">
              {actionResult.action === 'in' && actionResult.clock_in_at && (
                <>
                  <div className="brief-time-big">{fmtDatetime(actionResult.clock_in_at)}</div>
                  <div className="brief-time-label">Clocked in at</div>
                </>
              )}
              {actionResult.action === 'out' && actionResult.clock_out_at && (
                <>
                  <div className="brief-time-big">{fmtDatetime(actionResult.clock_out_at)}</div>
                  <div className="brief-time-label">Clocked out at</div>
                  {actionResult.duration_minutes != null && (
                    <div className="brief-duration">
                      Shift: {Math.floor(actionResult.duration_minutes / 60)}h {Math.round(actionResult.duration_minutes % 60)}m
                    </div>
                  )}
                </>
              )}
              {actionResult.action === 'break_start' && actionResult.break_start && (
                <>
                  <div className="brief-time-big">{fmtDatetime(actionResult.break_start)}</div>
                  <div className="brief-time-label">Break started at</div>
                </>
              )}
              {actionResult.action === 'break_end' && actionResult.break_end && (
                <>
                  <div className="brief-time-big">{fmtDatetime(actionResult.break_end)}</div>
                  <div className="brief-time-label">Break ended at</div>
                  {actionResult.break_minutes != null && (
                    <div className="brief-duration">{actionResult.break_minutes} minute break</div>
                  )}
                </>
              )}
            </div>

            {/* Streak */}
            {actionResult.action === 'in' && (actionResult.streak ?? 0) > 0 && (
              <div className="brief-streak">
                <span className="brief-streak-icon">
                  {(actionResult.streak ?? 0) >= 14 ? '🔥' : (actionResult.streak ?? 0) >= 7 ? '⚡' : (actionResult.streak ?? 0) >= 3 ? '✨' : '⭐'}
                </span>
                <div>
                  <div className="brief-streak-text">
                    {actionResult.streak === 1 ? 'Day 1 streak — keep it up!' : `${actionResult.streak}-day attendance streak!`}
                  </div>
                  <div className="brief-streak-sub">
                    {(actionResult.streak ?? 0) >= 14 ? 'Incredible consistency 🏆' : (actionResult.streak ?? 0) >= 7 ? 'Amazing commitment!' : 'Great work!'}
                  </div>
                </div>
              </div>
            )}

            {/* Must-read nudge */}
            {actionResult.action === 'in' && (actionResult.must_read_count ?? 0) > 0 && (
              <div className="brief-nudge">
                <span style={{ fontSize: '1.35rem', flexShrink: 0 }}>📋</span>
                <div className="brief-nudge-text">
                  You have <strong>{actionResult.must_read_count} must-read {actionResult.must_read_count === 1 ? 'post' : 'posts'}</strong> waiting.
                  Log in to InfoWall to read and acknowledge {actionResult.must_read_count === 1 ? 'it' : 'them'}.
                </div>
              </div>
            )}

            {/* Break button after clock-in */}
            {actionResult.action === 'in' && (
              <button className="brief-break-btn" onClick={() => {
                const emp = employees.find(e => e.id === actionResult.user_id || e.full_name === actionResult.user)
                if (emp) startBreakMode(emp)
              }}>
                ☕ Start a break
              </button>
            )}

            {/* Auto-return */}
            <div className="brief-progress-wrap">
              <div className="brief-progress-bar">
                <div className="brief-progress-fill" style={{ animationDuration: `${briefTimer}s` }} />
              </div>
              <div className="brief-return-label">Returning in {briefTimer}s</div>
            </div>
            <button className="brief-home" onClick={resetToIdle}>Return now</button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="loading-overlay">
            <div className="spinner" />
          </div>
        )}
      </div>
    </>
  )
}
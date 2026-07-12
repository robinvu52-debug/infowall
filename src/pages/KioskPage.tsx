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
  id: string; user_id: string; full_name: string | null; role: string; department_id: string | null
  scheduled_date: string; start_time: string; end_time: string; note: string | null
  is_in: boolean; clocked: boolean
}
interface KioskPost { id: string; title: string; content: string | null; created_at: string }
interface KioskEvent { id: string; title: string; event_start: string; event_end: string | null }
interface DisplayData {
  posts: KioskPost[]; events: KioskEvent[]
  roster: RosterEmployee[]; week_roster: WeekShift[]
  today: string; week_start: string; week_end: string
}
interface SelectEmployee { id: string; full_name: string | null; role: string; has_pin: boolean }
interface ActionResult {
  action: 'in' | 'out' | 'break_start' | 'break_end'
  user: string; clock_in_at?: string; clock_out_at?: string
  duration_minutes?: number; streak?: number; must_read_count?: number
  break_start?: string; break_end?: string; break_minutes?: number
}

// ─── Helpers ──────────────────────────────────────────────────
const DEPT_COLORS = ['#4BACC6','#8064A2','#C0504D','#9BBB59','#F79646','#4F81BD','#243F60','#365F91']
const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

function fmtClock(d: Date) {
  return d.toLocaleTimeString('en-AU', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false })
}
function fmtDate(d: Date) {
  return d.toLocaleDateString('en-AU', { weekday:'long', day:'numeric', month:'long', year:'numeric' })
}
function fmtTime12(t: string | null) {
  if (!t) return ''
  const [h, m] = t.split(':')
  const hour = parseInt(h)
  return `${hour % 12 || 12}:${m}${hour >= 12 ? 'pm' : 'am'}`
}
function fmtDatetime(s: string) {
  return new Date(s).toLocaleTimeString('en-AU', { hour:'2-digit', minute:'2-digit', hour12:true })
}
function fmtEventDate(s: string) {
  return new Date(s).toLocaleDateString('en-AU', { weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', hour12:true })
}
function greeting(d: Date) {
  const h = d.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}
function initials(name: string | null) {
  if (!name) return '?'
  return name.split(' ').filter(Boolean).slice(0,2).map(n=>n[0]).join('').toUpperCase()
}
function deptColor(deptId: string | null, depts: string[]) {
  if (!deptId) return '#4BACC6'
  const idx = depts.indexOf(deptId)
  return DEPT_COLORS[idx % DEPT_COLORS.length]
}
function isoDate(d: Date) { return d.toISOString().split('T')[0] }

// ─── Confetti component ───────────────────────────────────────
function Confetti() {
  const pieces = Array.from({ length: 60 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 1.5,
    duration: 1.5 + Math.random() * 2,
    color: ['#4BACC6','#9BBB59','#F79646','#8064A2','#4F81BD','#C0504D'][i % 6],
    size: 6 + Math.random() * 8,
    rotate: Math.random() * 360,
  }))
  return (
    <div style={{ position:'fixed', inset:0, pointerEvents:'none', zIndex:999, overflow:'hidden' }}>
      {pieces.map(p => (
        <div key={p.id} style={{
          position:'absolute', left:`${p.left}%`, top:'-20px',
          width:p.size, height:p.size,
          background:p.color, borderRadius: p.id%3===0 ? '50%' : p.id%3===1 ? '2px' : '0',
          animation:`confettiFall ${p.duration}s ${p.delay}s ease-in forwards`,
          transform:`rotate(${p.rotate}deg)`,
        }} />
      ))}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────
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
  const [showCelebration, setShowCelebration] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeDay, setActiveDay] = useState(0) // 0=Mon … 6=Sun
  const [briefTimer, setBriefTimer] = useState(10)
  const [postIdx, setPostIdx] = useState(0)
  const [eventIdx, setEventIdx] = useState(0)
  const [breakMode, setBreakMode] = useState(false) // PIN is for break action

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lockoutRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const briefRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const dataRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // All unique dept IDs for color mapping
  const allDeptIds = [...new Set([
    ...(displayData?.roster ?? []).map(r=>r.department_id),
    ...(displayData?.week_roster ?? []).map(r=>r.department_id),
  ].filter(Boolean) as string[])]

  // Active week day (Mon=0 … Sun=6)
  useEffect(() => {
    const day = new Date().getDay() // 0=Sun
    setActiveDay(day === 0 ? 6 : day - 1)
  }, [])

  // ── Clock ──────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // ── Post/Event carousel ────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => {
      setPostIdx(i => displayData ? (i+1) % Math.max(1, displayData.posts.length) : 0)
    }, 5000)
    return () => clearInterval(t)
  }, [displayData])

  useEffect(() => {
    const t = setInterval(() => {
      setEventIdx(i => displayData ? (i+1) % Math.max(1, displayData.events.length) : 0)
    }, 4000)
    return () => clearInterval(t)
  }, [displayData])

  // ── Load display data ──────────────────────────────────────
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

  // ── Idle timer (screensaver after 60s) ─────────────────────
  function resetIdleTimer() {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    if (screen === 'screensaver') setScreen('idle')
    idleTimerRef.current = setTimeout(() => setScreen('screensaver'), 60000)
  }
  useEffect(() => {
    resetIdleTimer()
    window.addEventListener('touchstart', resetIdleTimer)
    window.addEventListener('mousemove', resetIdleTimer)
    window.addEventListener('keydown', resetIdleTimer)
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      window.removeEventListener('touchstart', resetIdleTimer)
      window.removeEventListener('mousemove', resetIdleTimer)
      window.removeEventListener('keydown', resetIdleTimer)
    }
  }, [screen])

  // ── Brief countdown ────────────────────────────────────────
  useEffect(() => {
    if (screen !== 'brief') { setBriefTimer(10); if (briefRef.current) clearInterval(briefRef.current); return }
    setBriefTimer(10)
    briefRef.current = setInterval(() => {
      setBriefTimer(t => {
        if (t <= 1) {
          clearInterval(briefRef.current!)
          resetToIdle()
          return 0
        }
        return t - 1
      })
    }, 1000)
    return () => { if (briefRef.current) clearInterval(briefRef.current) }
  }, [screen])

  // ── Lockout countdown ──────────────────────────────────────
  function startLockout() {
    setPinLocked(true)
    setLockoutSecs(60)
    lockoutRef.current = setInterval(() => {
      setLockoutSecs(s => {
        if (s <= 1) {
          clearInterval(lockoutRef.current!)
          setPinLocked(false)
          setPinAttempts(0)
          return 0
        }
        return s - 1
      })
    }, 1000)
  }

  function resetToIdle() {
    setScreen('idle')
    setSelectedEmp(null)
    setPin('')
    setPinError('')
    setActionResult(null)
    setShowCelebration(false)
    setBreakMode(false)
    setEmpSearch('')
    loadData()
  }

  // ── PIN digit press ────────────────────────────────────────
  function handleDigit(d: string) {
    if (pinLocked || pin.length >= 4) return
    const newPin = pin + d
    setPin(newPin)
    setPinError('')
    if (newPin.length === 4) submitPin(newPin)
  }

  function handleBackspace() {
    setPin(p => p.slice(0, -1))
    setPinError('')
  }

  async function submitPin(p: string) {
    setLoading(true)
    try {
      if (breakMode) {
        const { data } = await supabase.rpc('kiosk_break_action', { p_pin: p })
        if (!data?.success) {
          handlePinError(data?.error ?? 'Invalid PIN')
        } else {
          setActionResult(data as ActionResult)
          setScreen('brief')
        }
      } else {
        const { data } = await supabase.rpc('kiosk_clock_action', { p_pin: p })
        if (!data?.success) {
          handlePinError(data?.error ?? 'Invalid PIN')
        } else {
          const result = data as ActionResult
          setActionResult(result)
          if (result.action === 'in' && ((result.streak ?? 0) >= 3 || result.streak === 1)) {
            setShowCelebration(true)
            setTimeout(() => setShowCelebration(false), 3000)
          }
          setScreen('brief')
        }
      }
    } finally {
      setLoading(false)
    }
  }

  function handlePinError(msg: string) {
    const newAttempts = pinAttempts + 1
    setPinAttempts(newAttempts)
    setPinError(msg)
    setPin('')
    if (newAttempts >= 3) startLockout()
  }

  // ── Break mode: employee selects themselves then hits PIN ──
  function startBreakMode(emp: SelectEmployee) {
    setSelectedEmp(emp)
    setBreakMode(true)
    setPin('')
    setPinError('')
    setScreen('pin')
  }

  // ── Week roster helpers ────────────────────────────────────
  function getWeekDays(): Date[] {
    if (!displayData) return []
    const start = new Date(displayData.week_start + 'T12:00:00')
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start)
      d.setDate(d.getDate() + i)
      return d
    })
  }

  function getShiftsForDay(dayDate: Date): WeekShift[] {
    if (!displayData) return []
    const dayStr = isoDate(dayDate)
    return displayData.week_roster.filter(s => s.scheduled_date === dayStr)
  }

  function todayStr() { return isoDate(new Date()) }

  const weekDays = getWeekDays()
  const todayRoster = displayData?.roster ?? []
  const inCount = todayRoster.filter(r => r.is_in).length
  const totalCount = todayRoster.length
  const filteredEmps = employees.filter(e => !empSearch || e.full_name?.toLowerCase().includes(empSearch.toLowerCase()))

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');
        * { box-sizing:border-box; margin:0; padding:0; -webkit-tap-highlight-color:transparent; }
        html,body,#root { height:100%; overflow:hidden; }
        body { font-family:'Nunito',sans-serif; background:#0a1520; }

        @keyframes confettiFall {
          0%   { transform:translateY(-20px) rotate(0deg); opacity:1; }
          100% { transform:translateY(110vh) rotate(720deg); opacity:0; }
        }
        @keyframes orb1 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(60px,-40px) scale(1.1)} }
        @keyframes orb2 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(-50px,60px) scale(0.9)} }
        @keyframes orb3 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(40px,40px) scale(1.05)} }
        @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @keyframes scaleIn{ from{opacity:0;transform:scale(0.6)} to{opacity:1;transform:scale(1)} }
        @keyframes slideUp{ from{opacity:0;transform:translateY(30px)} to{opacity:1;transform:translateY(0)} }
        @keyframes slideLeft{ from{opacity:0;transform:translateX(-30px)} to{opacity:1;transform:translateX(0)} }
        @keyframes checkPop { 0%{transform:scale(0)} 60%{transform:scale(1.2)} 100%{transform:scale(1)} }
        @keyframes pinBounce { 0%{transform:scale(1)} 30%{transform:scale(0.92)} 100%{transform:scale(1)} }
        @keyframes streakBounce { 0%{transform:scale(0) rotate(-10deg)} 60%{transform:scale(1.15) rotate(3deg)} 100%{transform:scale(1) rotate(0)} }
        @keyframes tickerScroll { 0%{transform:translateX(100%)} 100%{transform:translateX(-100%)} }
        @keyframes briefProgress { from{width:100%} to{width:0%} }
        @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        @keyframes digitIn { from{opacity:0;transform:scale(0.5)} to{opacity:1;transform:scale(1)} }

        .kiosk { width:100vw; height:100vh; overflow:hidden; position:relative; background:#0a1520; color:white; user-select:none; }
        .kiosk-bg { position:absolute;inset:0;overflow:hidden;pointer-events:none; }
        .orb { position:absolute;border-radius:50%;filter:blur(80px);opacity:0.25; }
        .orb1 { width:500px;height:500px;background:#4BACC6;top:-100px;left:-100px;animation:orb1 12s ease-in-out infinite; }
        .orb2 { width:400px;height:400px;background:#8064A2;bottom:-80px;right:-80px;animation:orb2 14s ease-in-out infinite; }
        .orb3 { width:300px;height:300px;background:#4F81BD;top:40%;left:50%;animation:orb3 10s ease-in-out infinite; }
        .kiosk-grid { position:absolute;inset:0;background-image:linear-gradient(rgba(75,172,198,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(75,172,198,0.04) 1px,transparent 1px);background-size:48px 48px; }

        /* ── Screensaver ── */
        .screensaver {
          position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
          cursor:pointer;z-index:10;
        }
        .ss-time { font-size:clamp(72px,12vw,140px);font-weight:900;letter-spacing:-0.04em;line-height:1;
          background:linear-gradient(135deg,#fff 0%,rgba(255,255,255,0.6) 100%);
          -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
        }
        .ss-date { font-size:clamp(16px,2.5vw,28px);font-weight:600;color:rgba(255,255,255,0.5);margin-top:0.5rem;letter-spacing:0.1em;text-transform:uppercase; }
        .ss-brand { font-size:clamp(24px,3.5vw,40px);font-weight:800;color:rgba(255,255,255,0.85);margin-top:2.5rem;letter-spacing:-0.02em; }
        .ss-touch { display:flex;align-items:center;gap:0.75rem;margin-top:2rem;font-size:clamp(12px,1.8vw,18px);color:rgba(255,255,255,0.3);letter-spacing:0.15em;text-transform:uppercase;animation:pulse 2.5s ease-in-out infinite; }
        .ss-touch-dot { width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,0.3); }

        /* ── Main idle ── */
        .idle-layout { display:grid;grid-template-columns:1fr 320px 1fr;height:100vh;gap:0;position:relative;z-index:1; }

        /* Left: weekly roster */
        .panel-left { padding:1.5rem;display:flex;flex-direction:column;border-right:1px solid rgba(255,255,255,0.06);overflow:hidden; }
        .panel-title { font-size:0.65rem;font-weight:800;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.12em;margin-bottom:1rem; }

        /* Day tabs */
        .day-tabs { display:flex;gap:0.3rem;margin-bottom:0.85rem;flex-shrink:0; }
        .day-tab { flex:1;padding:0.4rem 0;border-radius:7px;border:1px solid rgba(255,255,255,0.08);background:transparent;color:rgba(255,255,255,0.3);font-size:0.7rem;font-weight:700;cursor:pointer;text-align:center;transition:all 0.15s;font-family:inherit; }
        .day-tab:hover { background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.7); }
        .day-tab.today { border-color:rgba(75,172,198,0.4);color:#4BACC6;font-weight:800; }
        .day-tab.active { background:rgba(75,172,198,0.15);border-color:rgba(75,172,198,0.5);color:white;font-weight:800; }

        /* Roster list for selected day */
        .day-shifts { flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:0.4rem; }
        .day-shifts::-webkit-scrollbar { width:0; }

        .shift-card { display:flex;align-items:center;gap:0.65rem;padding:0.6rem 0.75rem;background:rgba(255,255,255,0.04);border-radius:10px;border:1px solid rgba(255,255,255,0.06);transition:all 0.15s; }
        .shift-card.is-in { background:rgba(34,197,94,0.08);border-color:rgba(34,197,94,0.2); }
        .shift-card.on-break { background:rgba(245,158,11,0.08);border-color:rgba(245,158,11,0.2); }
        .shift-card.clocked { background:rgba(75,172,198,0.06);border-color:rgba(75,172,198,0.15); }
        .shift-avatar { width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:800;flex-shrink:0;color:white; }
        .shift-name { flex:1;font-size:0.82rem;font-weight:700;color:rgba(255,255,255,0.85);white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .shift-time { font-size:0.7rem;color:rgba(255,255,255,0.35);flex-shrink:0; }
        .shift-status { font-size:0.62rem;font-weight:800;padding:0.12rem 0.45rem;border-radius:999px;flex-shrink:0; }
        .shift-status.in  { background:rgba(34,197,94,0.2);color:#86efac; }
        .shift-status.brk { background:rgba(245,158,11,0.2);color:#fcd34d; }
        .shift-status.done{ background:rgba(75,172,198,0.2);color:#7dd3fc; }

        /* Today summary */
        .today-summary { display:flex;align-items:center;gap:0.5rem;padding:0.65rem 0.75rem;background:rgba(255,255,255,0.04);border-radius:10px;border:1px solid rgba(255,255,255,0.07);margin-bottom:0.75rem;flex-shrink:0; }
        .today-summary-stat { flex:1;text-align:center; }
        .today-summary-val { font-size:1.4rem;font-weight:900;color:#4BACC6;line-height:1; }
        .today-summary-label { font-size:0.6rem;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.06em;margin-top:0.15rem; }
        .today-summary-divider { width:1px;height:32px;background:rgba(255,255,255,0.08); }

        /* Center panel */
        .panel-center { display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:1.5rem 1.25rem;position:relative; }
        .center-clock { text-align:center;margin-top:auto;margin-bottom:auto; }
        .clock-time { font-size:clamp(52px,7vw,88px);font-weight:900;letter-spacing:-0.04em;line-height:1;
          background:linear-gradient(135deg,#fff 0%,rgba(255,255,255,0.7) 100%);
          -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
        }
        .clock-date { font-size:clamp(11px,1.4vw,15px);color:rgba(255,255,255,0.4);margin-top:0.5rem;letter-spacing:0.08em;text-transform:uppercase; }
        .clock-greeting { font-size:clamp(14px,1.8vw,20px);font-weight:800;color:rgba(255,255,255,0.7);margin-top:1.25rem; }

        /* Live attendance ring */
        .attendance-ring { position:relative;width:120px;height:120px;margin:1.5rem auto; }
        .ring-svg { transform:rotate(-90deg); }
        .ring-bg { fill:none;stroke:rgba(255,255,255,0.06);stroke-width:8; }
        .ring-fill { fill:none;stroke:#4BACC6;stroke-width:8;stroke-linecap:round;transition:stroke-dashoffset 1s ease; }
        .ring-text { position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center; }
        .ring-count { font-size:1.75rem;font-weight:900;color:white;line-height:1; }
        .ring-label { font-size:0.6rem;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.08em; }

        /* CTA button */
        .clock-in-cta {
          width:100%;padding:1rem 1.5rem;
          background:linear-gradient(135deg,#4BACC6,#4F81BD);
          border:none;border-radius:16px;
          font-size:1.1rem;font-weight:800;color:white;
          cursor:pointer;transition:all 0.2s;
          box-shadow:0 8px 32px rgba(75,172,198,0.35);
          font-family:inherit;
        }
        .clock-in-cta:hover { transform:translateY(-2px);box-shadow:0 12px 40px rgba(75,172,198,0.5); }
        .clock-in-cta:active { transform:scale(0.98); }

        /* Right: announcements + events */
        .panel-right { padding:1.5rem;display:flex;flex-direction:column;border-left:1px solid rgba(255,255,255,0.06);overflow:hidden; }
        .post-card { background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:0.9rem 1rem;margin-bottom:0.75rem;flex-shrink:0; }
        .post-card-title { font-size:0.88rem;font-weight:700;color:rgba(255,255,255,0.85);margin-bottom:0.35rem;line-height:1.3; }
        .post-card-content { font-size:0.75rem;color:rgba(255,255,255,0.4);line-height:1.6;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden; }
        .post-card-time { font-size:0.62rem;color:rgba(255,255,255,0.25);margin-top:0.4rem; }

        .event-card { background:rgba(128,100,162,0.12);border:1px solid rgba(128,100,162,0.25);border-radius:12px;padding:0.9rem 1rem;margin-bottom:0.6rem;flex-shrink:0; }
        .event-card-title { font-size:0.85rem;font-weight:700;color:rgba(255,255,255,0.85);margin-bottom:0.25rem; }
        .event-card-date { font-size:0.72rem;color:#c4b5fd;font-weight:600; }

        /* Ticker */
        .ticker { position:absolute;bottom:0;left:0;right:0;height:40px;background:rgba(0,0,0,0.4);border-top:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;overflow:hidden;backdrop-filter:blur(10px); }
        .ticker-label { padding:0 1.25rem;font-size:0.65rem;font-weight:800;color:#4BACC6;text-transform:uppercase;letter-spacing:0.1em;flex-shrink:0;border-right:1px solid rgba(255,255,255,0.1);margin-right:1rem; }
        .ticker-track { flex:1;overflow:hidden; }
        .ticker-content { display:inline-flex;gap:3rem;animation:tickerScroll 40s linear infinite;white-space:nowrap; }
        .ticker-item { font-size:0.75rem;color:rgba(255,255,255,0.5);font-weight:500; }
        .ticker-dot { color:rgba(255,255,255,0.15);font-size:0.5rem;vertical-align:middle; }

        /* ── Employee select ── */
        .select-screen { position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;background:rgba(10,21,32,0.97);backdrop-filter:blur(20px);animation:fadeIn 0.25s ease; }
        .select-header { display:flex;align-items:center;justify-content:space-between;padding:1.5rem 2rem;border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0; }
        .select-title { font-size:1.5rem;font-weight:800;color:white;letter-spacing:-0.02em; }
        .select-back { padding:0.55rem 1.25rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:10px;color:rgba(255,255,255,0.6);font-size:0.85rem;font-weight:600;cursor:pointer;font-family:inherit;transition:all 0.15s; }
        .select-back:hover { background:rgba(255,255,255,0.1);color:white; }
        .select-search-wrap { padding:1rem 2rem;flex-shrink:0; }
        .select-search { width:100%;padding:0.85rem 1.25rem;background:rgba(255,255,255,0.06);border:1.5px solid rgba(255,255,255,0.1);border-radius:12px;color:white;font-size:1rem;outline:none;font-family:inherit;transition:border-color 0.15s; }
        .select-search:focus { border-color:rgba(75,172,198,0.5); }
        .select-search::placeholder { color:rgba(255,255,255,0.25); }
        .emp-grid { flex:1;overflow-y:auto;padding:0.5rem 2rem 2rem;display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:0.75rem;align-content:start; }
        .emp-grid::-webkit-scrollbar { width:4px; }
        .emp-grid::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.1);border-radius:999px; }
        .emp-card { display:flex;flex-direction:column;align-items:center;gap:0.65rem;padding:1.25rem 1rem;background:rgba(255,255,255,0.04);border:1.5px solid rgba(255,255,255,0.08);border-radius:14px;cursor:pointer;transition:all 0.15s;animation:scaleIn 0.2s ease both; }
        .emp-card:hover { background:rgba(75,172,198,0.1);border-color:rgba(75,172,198,0.4);transform:translateY(-2px); }
        .emp-card:active { transform:scale(0.97); }
        .emp-card.no-pin { opacity:0.35;cursor:not-allowed; }
        .emp-avatar { width:60px;height:60px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.2rem;font-weight:800;color:white;position:relative; }
        .emp-status-dot { position:absolute;bottom:2px;right:2px;width:13px;height:13px;border-radius:50%;border:2px solid #0a1520; }
        .emp-name { font-size:0.85rem;font-weight:700;color:rgba(255,255,255,0.85);text-align:center;line-height:1.3; }
        .emp-role { font-size:0.65rem;color:rgba(255,255,255,0.35);text-transform:capitalize; }
        .emp-status-badge { font-size:0.6rem;font-weight:700;padding:0.12rem 0.45rem;border-radius:999px; }
        .emp-status-badge.in { background:rgba(34,197,94,0.2);color:#86efac; }
        .emp-status-badge.brk { background:rgba(245,158,11,0.2);color:#fcd34d; }

        /* ── PIN pad ── */
        .pin-screen { position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(10,21,32,0.97);backdrop-filter:blur(20px);animation:fadeIn 0.2s ease;padding:2rem; }
        .pin-back { position:absolute;top:1.5rem;left:2rem;padding:0.5rem 1.1rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:9px;color:rgba(255,255,255,0.5);font-size:0.82rem;font-weight:600;cursor:pointer;font-family:inherit;transition:all 0.15s; }
        .pin-back:hover { color:white;background:rgba(255,255,255,0.09); }

        .pin-emp-avatar { width:72px;height:72px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.4rem;font-weight:800;color:white;margin-bottom:0.85rem;border:2px solid rgba(255,255,255,0.15); }
        .pin-emp-name { font-size:1.2rem;font-weight:800;color:white;margin-bottom:0.25rem; }
        .pin-action-label { font-size:0.78rem;color:rgba(255,255,255,0.35);margin-bottom:1.75rem;letter-spacing:0.05em; }

        .pin-dots { display:flex;gap:0.85rem;margin-bottom:0.75rem; }
        .pin-dot { width:18px;height:18px;border-radius:50%;border:2px solid rgba(255,255,255,0.2);transition:all 0.15s; }
        .pin-dot.filled { background:#4BACC6;border-color:#4BACC6;animation:digitIn 0.15s cubic-bezier(0.34,1.56,0.64,1); }

        .pin-error { font-size:0.82rem;color:#fca5a5;font-weight:600;margin-bottom:1.25rem;min-height:22px;text-align:center; }
        .pin-locked { font-size:0.9rem;color:#fcd34d;font-weight:700;margin-bottom:1.25rem;text-align:center;animation:pulse 1s ease-in-out infinite; }

        .pin-pad { display:grid;grid-template-columns:repeat(3,1fr);gap:0.65rem;width:280px; }
        .pin-btn { aspect-ratio:1;border-radius:16px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.06);color:white;font-size:1.5rem;font-weight:700;cursor:pointer;transition:all 0.12s;font-family:inherit;display:flex;align-items:center;justify-content:center; }
        .pin-btn:hover:not(:disabled) { background:rgba(255,255,255,0.12);border-color:rgba(255,255,255,0.2);transform:scale(1.04); }
        .pin-btn:active:not(:disabled) { animation:pinBounce 0.18s ease;background:rgba(75,172,198,0.2);border-color:rgba(75,172,198,0.5); }
        .pin-btn.backspace { font-size:1.1rem;color:rgba(255,255,255,0.4); }
        .pin-btn.zero { grid-column:2; }
        .pin-btn:disabled { opacity:0.2;cursor:not-allowed; }

        /* ── Brief / result screen ── */
        .brief-screen { position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(10,21,32,0.97);backdrop-filter:blur(20px);animation:fadeIn 0.3s ease;padding:2rem;text-align:center; }

        .brief-icon { width:90px;height:90px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:2.2rem;margin:0 auto 1.25rem;animation:checkPop 0.45s cubic-bezier(0.34,1.56,0.64,1); }
        .brief-icon.success-in  { background:rgba(34,197,94,0.15);border:2px solid rgba(34,197,94,0.35); }
        .brief-icon.success-out { background:rgba(75,172,198,0.15);border:2px solid rgba(75,172,198,0.35); }
        .brief-icon.break-start { background:rgba(245,158,11,0.15);border:2px solid rgba(245,158,11,0.35); }
        .brief-icon.break-end   { background:rgba(155,187,89,0.15);border:2px solid rgba(155,187,89,0.35); }

        .brief-name { font-size:1.5rem;font-weight:800;color:white;margin-bottom:0.35rem;animation:slideUp 0.3s ease 0.1s both; }
        .brief-action { font-size:1rem;color:rgba(255,255,255,0.5);margin-bottom:1.5rem;animation:slideUp 0.3s ease 0.15s both; }
        .brief-time { font-size:1.25rem;font-weight:700;color:#4BACC6;animation:slideUp 0.3s ease 0.2s both; }
        .brief-duration { font-size:0.85rem;color:rgba(255,255,255,0.4);margin-top:0.25rem;animation:slideUp 0.3s ease 0.22s both; }

        /* Streak */
        .brief-streak { display:inline-flex;align-items:center;gap:0.6rem;background:rgba(245,158,11,0.12);border:1.5px solid rgba(245,158,11,0.3);border-radius:999px;padding:0.55rem 1.25rem;margin-top:1.25rem;animation:streakBounce 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.35s both; }
        .brief-streak-fire { font-size:1.4rem; }
        .brief-streak-text { font-size:0.95rem;font-weight:800;color:#fcd34d; }

        /* Must-read nudge */
        .brief-mustread { display:flex;align-items:center;gap:0.65rem;background:rgba(192,80,77,0.1);border:1px solid rgba(192,80,77,0.25);border-radius:12px;padding:0.75rem 1.25rem;margin-top:1rem;max-width:360px;animation:slideUp 0.3s ease 0.45s both; }
        .brief-mustread-text { font-size:0.82rem;color:rgba(255,255,255,0.7);text-align:left;line-height:1.45; }
        .brief-mustread-text strong { color:#fca5a5; }

        /* Progress bar */
        .brief-progress { width:260px;height:3px;background:rgba(255,255,255,0.08);border-radius:999px;margin-top:2rem;overflow:hidden; }
        .brief-progress-fill { height:100%;background:rgba(255,255,255,0.2);border-radius:999px;animation:briefProgress linear forwards; }
        .brief-return { font-size:0.72rem;color:rgba(255,255,255,0.2);margin-top:0.5rem; }
        .brief-home-btn { margin-top:1.25rem;padding:0.6rem 1.5rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:rgba(255,255,255,0.5);font-size:0.85rem;font-weight:600;cursor:pointer;font-family:inherit;transition:all 0.15s; }
        .brief-home-btn:hover { background:rgba(255,255,255,0.1);color:white; }

        /* Break action from brief */
        .brief-break-btn { margin-top:1rem;padding:0.7rem 1.75rem;background:rgba(245,158,11,0.12);border:1.5px solid rgba(245,158,11,0.35);border-radius:12px;color:#fcd34d;font-size:0.9rem;font-weight:700;cursor:pointer;font-family:inherit;transition:all 0.15s;animation:slideUp 0.3s ease 0.4s both; }
        .brief-break-btn:hover { background:rgba(245,158,11,0.2); }

        /* Loading overlay */
        .loading-overlay { position:absolute;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:50;backdrop-filter:blur(4px); }
        @keyframes spin { to{transform:rotate(360deg)} }
        .spinner { width:48px;height:48px;border:3px solid rgba(255,255,255,0.1);border-top-color:#4BACC6;border-radius:50%;animation:spin 0.8s linear infinite; }

        @media(max-width:900px) {
          .idle-layout { grid-template-columns:1fr; }
          .panel-left,.panel-right { display:none; }
        }
      `}</style>

      <div className="kiosk">
        {/* Background */}
        <div className="kiosk-bg">
          <div className="orb orb1" />
          <div className="orb orb2" />
          <div className="orb orb3" />
          <div className="kiosk-grid" />
        </div>

        {showCelebration && <Confetti />}

        {/* ── SCREENSAVER ── */}
        {screen === 'screensaver' && (
          <div className="screensaver" onClick={resetIdleTimer}>
            <div className="ss-time">{fmtClock(now)}</div>
            <div className="ss-date">{fmtDate(now)}</div>
            <div className="ss-brand">InfoWall</div>
            <div className="ss-touch">
              <div className="ss-touch-dot" />
              Touch anywhere to clock in
              <div className="ss-touch-dot" />
            </div>
          </div>
        )}

        {/* ── MAIN IDLE ── */}
        {screen === 'idle' && (
          <>
            <div className="idle-layout">
              {/* ── LEFT: Weekly roster ── */}
              <div className="panel-left">
                <div className="panel-title">📅 Weekly Roster</div>

                {/* Today stats */}
                <div className="today-summary">
                  <div className="today-summary-stat">
                    <div className="today-summary-val">{inCount}</div>
                    <div className="today-summary-label">In now</div>
                  </div>
                  <div className="today-summary-divider" />
                  <div className="today-summary-stat">
                    <div className="today-summary-val">{totalCount - inCount}</div>
                    <div className="today-summary-label">Not in</div>
                  </div>
                  <div className="today-summary-divider" />
                  <div className="today-summary-stat">
                    <div className="today-summary-val">{totalCount > 0 ? Math.round((inCount/totalCount)*100) : 0}%</div>
                    <div className="today-summary-label">Attendance</div>
                  </div>
                </div>

                {/* Day selector */}
                <div className="day-tabs">
                  {DAYS.map((day, i) => {
                    const dayDate = weekDays[i]
                    const isToday = dayDate && isoDate(dayDate) === todayStr()
                    const shifts = dayDate ? getShiftsForDay(dayDate) : []
                    return (
                      <button
                        key={i}
                        className={`day-tab${isToday ? ' today' : ''}${activeDay === i ? ' active' : ''}`}
                        onClick={() => setActiveDay(i)}
                      >
                        {day}
                        {shifts.length > 0 && (
                          <div style={{ fontSize:'0.55rem', marginTop:'1px', opacity:0.6 }}>{shifts.length}</div>
                        )}
                      </button>
                    )
                  })}
                </div>

                {/* Shifts for selected day */}
                <div className="day-shifts">
                  {(() => {
                    const dayDate = weekDays[activeDay]
                    if (!dayDate) return null
                    const isToday = isoDate(dayDate) === todayStr()
                    const shifts = getShiftsForDay(dayDate)

                    if (isToday) {
                      // Show live roster for today
                      const dayRoster = todayRoster.length > 0 ? todayRoster : shifts.map(s => ({
                        user_id: s.user_id, full_name: s.full_name, role: s.role,
                        department_id: s.department_id, is_in: s.is_in, clocked_today: s.clocked,
                        on_break: false, clock_in_at: null, clock_out_at: null,
                        schedule_start: s.start_time, schedule_end: s.end_time,
                      }))
                      return dayRoster.map(emp => {
                        const color = deptColor(emp.department_id, allDeptIds)
                        return (
                          <div key={emp.user_id}
                            className={`shift-card${emp.is_in ? ' is-in' : emp.on_break ? ' on-break' : emp.clocked_today ? ' clocked' : ''}`}
                          >
                            <div className="shift-avatar" style={{ background:color }}>
                              {initials(emp.full_name)}
                            </div>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div className="shift-name">{emp.full_name}</div>
                              <div className="shift-time">
                                {emp.schedule_start ? `${fmtTime12(emp.schedule_start)} – ${fmtTime12(emp.schedule_end)}` : emp.role}
                              </div>
                            </div>
                            {emp.is_in && !emp.on_break && <span className="shift-status in">● In</span>}
                            {emp.on_break && <span className="shift-status brk">☕ Break</span>}
                            {!emp.is_in && emp.clocked_today && <span className="shift-status done">✓ Done</span>}
                          </div>
                        )
                      })
                    } else {
                      // Show scheduled shifts for other days
                      if (shifts.length === 0) return (
                        <div style={{ textAlign:'center', color:'rgba(255,255,255,0.2)', fontSize:'0.8rem', paddingTop:'2rem' }}>
                          No shifts scheduled
                        </div>
                      )
                      return shifts.map(s => {
                        const color = deptColor(s.department_id, allDeptIds)
                        return (
                          <div key={s.id} className={`shift-card${s.is_in ? ' is-in' : s.clocked ? ' clocked' : ''}`}>
                            <div className="shift-avatar" style={{ background:color }}>
                              {initials(s.full_name)}
                            </div>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div className="shift-name">{s.full_name}</div>
                              <div className="shift-time">{fmtTime12(s.start_time)} – {fmtTime12(s.end_time)}</div>
                              {s.note && <div style={{ fontSize:'0.62rem', color:'rgba(255,255,255,0.25)', marginTop:'1px' }}>{s.note}</div>}
                            </div>
                            {s.is_in && <span className="shift-status in">● In</span>}
                            {!s.is_in && s.clocked && <span className="shift-status done">✓ Done</span>}
                          </div>
                        )
                      })
                    }
                  })()}
                </div>
              </div>

              {/* ── CENTER: Clock + CTA ── */}
              <div className="panel-center">
                <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', width:'100%' }}>
                  <div className="center-clock">
                    <div className="clock-time">{fmtClock(now)}</div>
                    <div className="clock-date">{fmtDate(now)}</div>
                    <div className="clock-greeting">{greeting(now)}, team 👋</div>
                  </div>

                  {/* Attendance ring */}
                  {totalCount > 0 && (
                    <div className="attendance-ring">
                      <svg className="ring-svg" viewBox="0 0 120 120" width="120" height="120">
                        <circle className="ring-bg" cx="60" cy="60" r="52" />
                        <circle
                          className="ring-fill" cx="60" cy="60" r="52"
                          strokeDasharray={`${2 * Math.PI * 52}`}
                          strokeDashoffset={`${2 * Math.PI * 52 * (1 - inCount / totalCount)}`}
                        />
                      </svg>
                      <div className="ring-text">
                        <div className="ring-count">{inCount}</div>
                        <div className="ring-label">of {totalCount} in</div>
                      </div>
                    </div>
                  )}
                </div>

                <button className="clock-in-cta" onClick={() => { setEmpSearch(''); setScreen('select') }}>
                  👆 Clock In / Out
                </button>
              </div>

              {/* ── RIGHT: Announcements + Events ── */}
              <div className="panel-right">
                {/* Announcements */}
                {displayData?.posts && displayData.posts.length > 0 && (
                  <>
                    <div className="panel-title">📢 Latest Announcements</div>
                    {displayData.posts.slice(0, 3).map((post, i) => (
                      <div key={post.id} className="post-card" style={{ animationDelay:`${i*0.08}s`, animation:'slideLeft 0.3s ease both' }}>
                        <div className="post-card-title">{post.title}</div>
                        {post.content && <div className="post-card-content">{post.content}</div>}
                        <div className="post-card-time">
                          {new Date(post.created_at).toLocaleDateString('en-AU', { day:'numeric', month:'short' })}
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {/* Upcoming events */}
                {displayData?.events && displayData.events.length > 0 && (
                  <>
                    <div className="panel-title" style={{ marginTop:'0.75rem' }}>📅 Upcoming Events</div>
                    {displayData.events.slice(0, 3).map((evt, i) => (
                      <div key={evt.id} className="event-card" style={{ animationDelay:`${i*0.08}s` }}>
                        <div className="event-card-title">{evt.title}</div>
                        <div className="event-card-date">{fmtEventDate(evt.event_start)}</div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>

            {/* Ticker */}
            <div className="ticker">
              <div className="ticker-label">InfoWall</div>
              <div className="ticker-track">
                <div className="ticker-content">
                  {[
                    ...(displayData?.posts ?? []).map(p => `📢 ${p.title}`),
                    ...(displayData?.events ?? []).map(e => `📅 ${e.title} · ${fmtEventDate(e.event_start)}`),
                    `⏰ ${fmtDate(now)}`,
                    `👥 ${inCount} of ${totalCount} team members in today`,
                  ].map((item, i) => (
                    <span key={i} className="ticker-item">
                      {item}
                      <span className="ticker-dot"> ◆ </span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── EMPLOYEE SELECT ── */}
        {screen === 'select' && (
          <div className="select-screen">
            <div className="select-header">
              <div className="select-title">Who are you?</div>
              <button className="select-back" onClick={() => { setScreen('idle'); setEmpSearch('') }}>✕ Cancel</button>
            </div>
            <div className="select-search-wrap">
              <input
                className="select-search"
                placeholder="🔍  Search by name…"
                value={empSearch}
                onChange={e => setEmpSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div className="emp-grid">
              {filteredEmps.map((emp, i) => {
                const roster = displayData?.roster.find(r => r.user_id === emp.id)
                const isIn = roster?.is_in ?? false
                const onBreak = roster?.on_break ?? false
                const color = deptColor(null, [])
                return (
                  <div
                    key={emp.id}
                    className={`emp-card${!emp.has_pin ? ' no-pin' : ''}`}
                    style={{ animationDelay:`${i*0.03}s` }}
                    onClick={() => {
                      if (!emp.has_pin) return
                      setSelectedEmp(emp)
                      setBreakMode(false)
                      setPin('')
                      setPinError('')
                      setPinAttempts(0)
                      setScreen('pin')
                    }}
                  >
                    <div className="emp-avatar" style={{ background:`linear-gradient(135deg,#4BACC6,#243F60)` }}>
                      {initials(emp.full_name)}
                      <div className="emp-status-dot" style={{
                        background: isIn && !onBreak ? '#22c55e' : onBreak ? '#f59e0b' : '#374151'
                      }} />
                    </div>
                    <div className="emp-name">{emp.full_name ?? 'Unknown'}</div>
                    <div className="emp-role">{emp.role}</div>
                    {isIn && !onBreak && <span className="emp-status-badge in">● Clocked in</span>}
                    {onBreak && <span className="emp-status-badge brk">☕ On break</span>}
                    {!emp.has_pin && <span style={{ fontSize:'0.6rem', color:'rgba(255,255,255,0.2)' }}>No PIN set</span>}
                  </div>
                )
              })}
              {filteredEmps.length === 0 && (
                <div style={{ gridColumn:'1/-1', textAlign:'center', color:'rgba(255,255,255,0.2)', padding:'3rem', fontSize:'0.9rem' }}>
                  No employees found
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── PIN PAD ── */}
        {screen === 'pin' && selectedEmp && (
          <div className="pin-screen">
            <button className="pin-back" onClick={() => { setScreen('select'); setPin(''); setPinError('') }}>← Back</button>

            {/* Employee avatar */}
            <div className="pin-emp-avatar" style={{ background:'linear-gradient(135deg,#4BACC6,#243F60)' }}>
              {initials(selectedEmp.full_name)}
            </div>
            <div className="pin-emp-name">{selectedEmp.full_name}</div>
            <div className="pin-action-label">
              {breakMode
                ? (() => {
                    const roster = displayData?.roster.find(r => r.user_id === selectedEmp.id)
                    return roster?.on_break ? 'Enter PIN to end break' : 'Enter PIN to start break'
                  })()
                : (() => {
                    const roster = displayData?.roster.find(r => r.user_id === selectedEmp.id)
                    return roster?.is_in ? 'Enter PIN to clock out' : 'Enter PIN to clock in'
                  })()
              }
            </div>

            {/* PIN dots */}
            <div className="pin-dots">
              {[0,1,2,3].map(i => (
                <div key={i} className={`pin-dot${i < pin.length ? ' filled' : ''}`} />
              ))}
            </div>

            {/* Error / lockout */}
            {pinLocked ? (
              <div className="pin-locked">🔒 Too many attempts · Locked for {lockoutSecs}s</div>
            ) : (
              <div className="pin-error">{pinError}</div>
            )}

            {/* Keypad */}
            <div className="pin-pad">
              {['1','2','3','4','5','6','7','8','9'].map(d => (
                <button key={d} className="pin-btn" onClick={() => handleDigit(d)} disabled={pinLocked || loading}>
                  {d}
                </button>
              ))}
              <button className="pin-btn" disabled style={{ opacity:0 }} />
              <button className="pin-btn zero" onClick={() => handleDigit('0')} disabled={pinLocked || loading}>
                0
              </button>
              <button className="pin-btn backspace" onClick={handleBackspace} disabled={pinLocked || loading || pin.length === 0}>
                ⌫
              </button>
            </div>

            {/* Break toggle for clocked-in employees */}
            {(() => {
              const roster = displayData?.roster.find(r => r.user_id === selectedEmp.id)
              if (!roster?.is_in && !roster?.on_break) return null
              return (
                <button
                  style={{ marginTop:'1.5rem', padding:'0.55rem 1.25rem', background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.3)', borderRadius:'10px', color:'#fcd34d', fontSize:'0.82rem', fontWeight:700, cursor:'pointer', fontFamily:'inherit', transition:'all 0.15s' }}
                  onClick={() => { setBreakMode(b => !b); setPin(''); setPinError('') }}
                >
                  {breakMode ? '↩ Clock out instead' : roster.on_break ? '☕ End break instead' : '☕ Start break instead'}
                </button>
              )
            })()}
          </div>
        )}

        {/* ── BRIEF ── */}
        {screen === 'brief' && actionResult && (
          <div className="brief-screen">

            {/* Icon */}
            <div className={`brief-icon${
              actionResult.action === 'in' ? ' success-in'
              : actionResult.action === 'out' ? ' success-out'
              : actionResult.action === 'break_start' ? ' break-start'
              : ' break-end'
            }`}>
              {actionResult.action === 'in' ? '✓'
               : actionResult.action === 'out' ? '👋'
               : actionResult.action === 'break_start' ? '☕'
               : '💪'}
            </div>

            {/* Name + action */}
            <div className="brief-name">{actionResult.user}</div>
            <div className="brief-action">
              {actionResult.action === 'in' && 'Successfully clocked in'}
              {actionResult.action === 'out' && 'Successfully clocked out'}
              {actionResult.action === 'break_start' && 'Break started — enjoy!'}
              {actionResult.action === 'break_end' && 'Break ended — welcome back!'}
            </div>

            {/* Time / duration */}
            {actionResult.action === 'in' && actionResult.clock_in_at && (
              <div className="brief-time">Clocked in at {fmtDatetime(actionResult.clock_in_at)}</div>
            )}
            {actionResult.action === 'out' && (
              <>
                <div className="brief-time">Clocked out at {fmtDatetime(actionResult.clock_out_at!)}</div>
                {actionResult.duration_minutes && (
                  <div className="brief-duration">
                    Shift duration: {Math.floor(actionResult.duration_minutes / 60)}h {Math.round(actionResult.duration_minutes % 60)}m
                  </div>
                )}
              </>
            )}
            {actionResult.action === 'break_start' && actionResult.break_start && (
              <div className="brief-time">Break started at {fmtDatetime(actionResult.break_start)}</div>
            )}
            {actionResult.action === 'break_end' && actionResult.break_minutes && (
              <>
                <div className="brief-time">Break ended at {fmtDatetime(actionResult.break_end!)}</div>
                <div className="brief-duration">Break was {actionResult.break_minutes} minute{actionResult.break_minutes !== 1 ? 's' : ''}</div>
              </>
            )}

            {/* Streak badge */}
            {actionResult.action === 'in' && (actionResult.streak ?? 0) > 0 && (
              <div className="brief-streak">
                <span className="brief-streak-fire">
                  {(actionResult.streak ?? 0) >= 7 ? '🔥' : (actionResult.streak ?? 0) >= 3 ? '⚡' : '✨'}
                </span>
                <span className="brief-streak-text">
                  {actionResult.streak === 1
                    ? "Day 1 — keep it up!"
                    : `${actionResult.streak}-day attendance streak!`}
                </span>
              </div>
            )}

            {/* Must-read nudge */}
            {actionResult.action === 'in' && (actionResult.must_read_count ?? 0) > 0 && (
              <div className="brief-mustread">
                <span style={{ fontSize:'1.25rem', flexShrink:0 }}>📋</span>
                <div className="brief-mustread-text">
                  You have <strong>{actionResult.must_read_count} unread must-read {actionResult.must_read_count === 1 ? 'post' : 'posts'}</strong>.
                  Log in to InfoWall to acknowledge {actionResult.must_read_count === 1 ? 'it' : 'them'}.
                </div>
              </div>
            )}

            {/* Break button after clock in */}
            {actionResult.action === 'in' && (
              <button
                className="brief-break-btn"
                onClick={() => {
                  const emp = employees.find(e => e.full_name === actionResult.user)
                  if (emp) { startBreakMode(emp) }
                }}
              >
                ☕ Start a break
              </button>
            )}

            {/* Auto-return progress */}
            <div className="brief-progress">
              <div className="brief-progress-fill" style={{ animationDuration:`${briefTimer + 0.5}s` }} />
            </div>
            <div className="brief-return">Returning in {briefTimer}s</div>
            <button className="brief-home-btn" onClick={resetToIdle}>Return to kiosk</button>
          </div>
        )}

        {/* Loading overlay */}
        {loading && (
          <div className="loading-overlay">
            <div className="spinner" />
          </div>
        )}
      </div>
    </>
  )
}
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type KioskState = 'idle' | 'select' | 'pin' | 'brief'

interface Employee {
  id: string; full_name: string; role: string
  department: string | null; has_pin: boolean
}
interface RosterEntry {
  full_name: string; department: string | null
  start_time: string; end_time: string
}
interface DisplayPost {
  id: string; title: string; content: string
  created_at: string; must_read: boolean
}
interface DisplayEvent {
  id: string; title: string; content: string
  event_start: string | null; event_end: string | null
}
interface DisplayData {
  announcements: DisplayPost[]
  events: DisplayEvent[]
  roster: RosterEntry[]
}
interface Schedule { start_time: string; end_time: string; note: string | null }
interface KioskPostItem { title: string; content: string; post_type: string; must_read: boolean }
interface BriefData {
  full_name: string; role: string; department: string | null
  action: 'clocked_in' | 'clocked_out'; time: string
  schedules: Schedule[]; must_read_count: number; announcements: KioskPostItem[]
}

const BRIEF_MS = 20000

function fmtTime(t: string) { return t?.slice(0, 5) ?? '' }
function fmt12(ts: string) {
  return new Date(ts).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true })
}
function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}
function fmtEventDate(s: string | null) {
  if (!s) return 'Soon'
  return new Date(s).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
}

export default function KioskPage() {
  const navigate = useNavigate()
  const [state, setState] = useState<KioskState>('idle')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [employeeSearch, setEmployeeSearch] = useState('')
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null)
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState(false)
  const [shake, setShake] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [brief, setBrief] = useState<BriefData | null>(null)
  const [display, setDisplay] = useState<DisplayData | null>(null)
  const [clock, setClock] = useState(new Date())
  const [featuredIdx, setFeaturedIdx] = useState(0)
  const [briefPct, setBriefPct] = useState(0)
  const [loadingEmployees, setLoadingEmployees] = useState(false)
  const [slideIn, setSlideIn] = useState(true)
  const briefRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const featuredRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const loadDisplay = useCallback(async () => {
    const { data } = await supabase.rpc('get_kiosk_display')
    if (data) setDisplay(data as DisplayData)
  }, [])

  useEffect(() => {
    loadDisplay()
    const t = setInterval(loadDisplay, 60000)
    return () => clearInterval(t)
  }, [loadDisplay])

  useEffect(() => {
    if (state !== 'idle' || !display?.announcements.length) return
    featuredRef.current = setInterval(() => {
      setSlideIn(false)
      setTimeout(() => {
        setFeaturedIdx(i => (i + 1) % (display?.announcements.length ?? 1))
        setSlideIn(true)
      }, 350)
    }, 7000)
    return () => { if (featuredRef.current) clearInterval(featuredRef.current) }
  }, [state, display?.announcements.length])

  useEffect(() => {
    if (state !== 'brief') return
    setBriefPct(0)
    const start = Date.now()
    briefRef.current = setInterval(() => {
      const pct = Math.min(100, ((Date.now() - start) / BRIEF_MS) * 100)
      setBriefPct(pct)
      if (pct >= 100) { clearInterval(briefRef.current!); returnToIdle() }
    }, 50)
    return () => { if (briefRef.current) clearInterval(briefRef.current) }
  }, [state])

  function returnToIdle() {
    setState('idle'); setBrief(null); setBriefPct(0)
    setSelectedEmployee(null); setPin(''); setPinError(false); setEmployeeSearch('')
  }

  async function openSelectScreen() {
    setLoadingEmployees(true); setState('select'); setEmployeeSearch('')
    const { data } = await supabase.rpc('get_kiosk_employees')
    setEmployees((data as Employee[]) ?? [])
    setLoadingEmployees(false)
  }

  function selectEmployee(emp: Employee) {
    setSelectedEmployee(emp); setPin(''); setPinError(false); setState('pin')
  }

  async function handlePin(digit: string) {
    if (pin.length >= 4 || processing) return
    const next = pin + digit
    setPin(next)
    if (next.length === 4) {
      setProcessing(true)
      const { data, error } = await supabase.rpc('kiosk_clock_action', { p_pin: next })
      setProcessing(false)
      if (error || !data || (data as any).error === 'invalid_pin') {
        setShake(true); setPinError(true); setPin('')
        setTimeout(() => setShake(false), 600)
      } else {
        setBrief(data as BriefData)
        setPin(''); setPinError(false); setState('brief')
      }
    }
  }

  function handleBackspace() {
    if (!processing) { setPin(p => p.slice(0, -1)); setPinError(false) }
  }

  const timeStr = clock.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true })
  const secsStr = ('0' + clock.getSeconds()).slice(-2)
  const dateStr = clock.toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }).toUpperCase()

  const featured = display?.announcements[featuredIdx]
  const roster = display?.roster ?? []
  const allPosts = display?.announcements ?? []
  const allEvents = display?.events ?? []
  const tickerItems = [...allPosts.map(p => p.title), ...allEvents.map(e => e.title)]
  const secsLeft = Math.ceil(((100 - briefPct) / 100) * (BRIEF_MS / 1000))

  const filteredEmployees = employees.filter(e =>
    !employeeSearch ||
    e.full_name.toLowerCase().includes(employeeSearch.toLowerCase()) ||
    (e.department ?? '').toLowerCase().includes(employeeSearch.toLowerCase())
  )
  const byDept = filteredEmployees.reduce((acc, emp) => {
    const key = emp.department ?? 'No Department'
    if (!acc[key]) acc[key] = []
    acc[key].push(emp)
    return acc
  }, {} as Record<string, Employee[]>)

  return (
    <>
      <style>{`
        @keyframes kTicker   { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
        @keyframes kPulse    { 0%,100%{opacity:1} 50%{opacity:0.25} }
        @keyframes kOrb1     { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(50px,-70px) scale(1.1)} }
        @keyframes kOrb2     { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(-45px,55px) scale(0.9)} }
        @keyframes kOrb3     { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(35px,45px) scale(1.06)} }
        @keyframes kGrid     { 0%{background-position:0 0} 100%{background-position:56px 56px} }
        @keyframes kScan     { 0%{top:-2%} 100%{top:102%} }
        @keyframes kFadeIn   { from{opacity:0} to{opacity:1} }
        @keyframes kSlideUp  { from{opacity:0;transform:translateY(28px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes kShake    { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-10px)} 40%{transform:translateX(10px)} 60%{transform:translateX(-8px)} 80%{transform:translateX(8px)} }
        @keyframes kFloat    { 0%,100%{transform:translateX(-50%) translateY(0)} 50%{transform:translateX(-50%) translateY(-6px)} }
        @keyframes kBriefIn  { from{opacity:0;transform:scale(0.97)} to{opacity:1;transform:scale(1)} }
        @keyframes kRosterIn { from{opacity:0;transform:translateX(-10px)} to{opacity:1;transform:translateX(0)} }
        @keyframes kPostIn   { from{opacity:0;transform:translateX(10px)} to{opacity:1;transform:translateX(0)} }

        *,*::before,*::after { box-sizing:border-box; margin:0; padding:0; }

        .kiosk {
          height:100vh; width:100%;
          background:#060c17; color:white;
          font-family:'Nunito','Segoe UI',system-ui,sans-serif;
          display:flex; flex-direction:column;
          overflow:hidden; user-select:none; position:relative;
        }

        /* Background */
        .k-bg { position:absolute;inset:0;pointer-events:none;z-index:0;overflow:hidden; }
        .k-bg-grid {
          position:absolute;inset:0;
          background-image:
            linear-gradient(rgba(75,172,198,0.035) 1px,transparent 1px),
            linear-gradient(90deg,rgba(75,172,198,0.035) 1px,transparent 1px);
          background-size:56px 56px;
          animation:kGrid 10s linear infinite;
        }
        .k-orb { position:absolute;border-radius:50%;filter:blur(90px);pointer-events:none; }
        .k-orb-1 { width:550px;height:550px;top:-180px;left:-120px;background:radial-gradient(circle,rgba(54,95,145,0.3),transparent 70%);animation:kOrb1 20s ease-in-out infinite; }
        .k-orb-2 { width:450px;height:450px;bottom:-120px;right:-80px;background:radial-gradient(circle,rgba(75,172,198,0.15),transparent 70%);animation:kOrb2 26s ease-in-out infinite; }
        .k-orb-3 { width:320px;height:320px;top:40%;left:38%;background:radial-gradient(circle,rgba(36,63,96,0.22),transparent 70%);animation:kOrb3 16s ease-in-out infinite; }
        .k-scan { position:absolute;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,rgba(75,172,198,0.07),transparent);animation:kScan 9s linear infinite;pointer-events:none; }

        /* Corner brackets */
        .k-bracket { position:absolute;width:56px;height:56px;pointer-events:none;z-index:1; }
        .k-bracket-tl { top:14px;left:14px;border-top:1.5px solid rgba(75,172,198,0.22);border-left:1.5px solid rgba(75,172,198,0.22);border-radius:4px 0 0 0; }
        .k-bracket-tr { top:14px;right:14px;border-top:1.5px solid rgba(75,172,198,0.22);border-right:1.5px solid rgba(75,172,198,0.22);border-radius:0 4px 0 0; }
        .k-bracket-bl { bottom:42px;left:14px;border-bottom:1.5px solid rgba(75,172,198,0.22);border-left:1.5px solid rgba(75,172,198,0.22);border-radius:0 0 0 4px; }
        .k-bracket-br { bottom:42px;right:14px;border-bottom:1.5px solid rgba(75,172,198,0.22);border-right:1.5px solid rgba(75,172,198,0.22);border-radius:0 0 4px 0; }

        /* Topbar */
        .k-topbar {
          position:relative;z-index:10;flex-shrink:0;
          display:flex;align-items:center;justify-content:space-between;
          padding:0.75rem 1.75rem;
          background:rgba(6,12,23,0.75);
          border-bottom:1px solid rgba(75,172,198,0.1);
          backdrop-filter:blur(10px);
        }

        .k-brand { display:flex;align-items:center;gap:0.75rem; }
        .k-brand-mark {
          width:32px;height:32px;border-radius:9px;
          background:linear-gradient(135deg,#4BACC6,#365F91);
          display:flex;align-items:center;justify-content:center;
          box-shadow:0 2px 10px rgba(75,172,198,0.3);
        }
        .k-brand-mark svg { width:16px;height:16px; }
        .k-brand-name { font-size:1.05rem;font-weight:900;color:white;letter-spacing:-0.02em;line-height:1.1; }
        .k-brand-sub { font-size:0.55rem;font-weight:700;color:rgba(75,172,198,0.6);letter-spacing:0.15em;text-transform:uppercase; }

        .k-topbar-clock { text-align:center; }
        .k-clock-time { font-size:2rem;font-weight:800;color:white;font-variant-numeric:tabular-nums;letter-spacing:-0.03em;line-height:1; }
        .k-clock-secs { font-size:0.9rem;color:rgba(75,172,198,0.6);font-weight:700;vertical-align:super;margin-left:0.1em; }
        .k-clock-date { font-size:0.6rem;color:rgba(255,255,255,0.3);font-weight:700;letter-spacing:0.1em;margin-top:0.1rem; }

        .k-live-pill {
          display:flex;align-items:center;gap:0.4rem;
          background:rgba(75,172,198,0.08);border:1px solid rgba(75,172,198,0.2);
          border-radius:999px;padding:0.32rem 0.85rem;
          font-size:0.65rem;font-weight:800;color:#4BACC6;letter-spacing:0.14em;
        }
        .k-live-dot { width:6px;height:6px;border-radius:50%;background:#4BACC6;animation:kPulse 1.5s ease-in-out infinite; }

        /* Main 3-col */
        .k-main {
          position:relative;z-index:5;flex:1;display:grid;
          grid-template-columns:260px 1fr 300px;
          min-height:0;overflow:hidden;
        }

        /* Left — roster */
        .k-panel-left {
          padding:1.25rem 1rem 1.25rem 1.25rem;
          border-right:1px solid rgba(255,255,255,0.05);
          display:flex;flex-direction:column;gap:0.85rem;
          overflow-y:auto;background:rgba(0,0,0,0.12);
        }
        .k-panel-left::-webkit-scrollbar { width:2px; }
        .k-panel-left::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.06);border-radius:999px; }

        .k-panel-label {
          font-size:0.58rem;font-weight:800;letter-spacing:0.16em;
          color:rgba(255,255,255,0.22);text-transform:uppercase;
          display:flex;align-items:center;gap:0.5rem;flex-shrink:0;
        }
        .k-panel-label::before { content:'';width:14px;height:1px;background:rgba(75,172,198,0.4); }

        .k-roster-card {
          display:flex;align-items:center;gap:0.65rem;
          background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);
          border-radius:11px;padding:0.7rem 0.85rem;
          cursor:pointer;transition:all 0.18s;
          animation:kRosterIn 0.4s ease both;
          border:none; font-family:inherit; text-align:left; width:100%;
        }
        .k-roster-card:hover { background:rgba(75,172,198,0.1);border:1px solid rgba(75,172,198,0.28);transform:translateX(3px); }
        .k-roster-card:active { transform:scale(0.97); }
        .k-roster-avatar {
          width:34px;height:34px;border-radius:50%;flex-shrink:0;
          background:linear-gradient(135deg,#4F81BD,#1a3a5c);
          display:flex;align-items:center;justify-content:center;
          font-size:0.88rem;font-weight:800;color:white;
          border:1.5px solid rgba(79,129,189,0.3);
        }
        .k-roster-name { font-size:0.8rem;font-weight:700;color:rgba(255,255,255,0.85);display:block;line-height:1.2; }
        .k-roster-time { font-size:0.66rem;color:rgba(75,172,198,0.65);display:block;margin-top:0.1rem;font-weight:600; }

        .k-no-roster { flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:rgba(255,255,255,0.15);font-size:0.8rem;text-align:center;gap:0.5rem; }

        /* Center — slideshow */
        .k-center {
          display:flex;flex-direction:column;align-items:center;justify-content:center;
          padding:2rem 2.5rem;position:relative;
        }
        .k-slide-ring { position:absolute;width:380px;height:380px;border-radius:50%;border:1px solid rgba(75,172,198,0.06);pointer-events:none; }
        .k-slide-ring-2 { position:absolute;width:480px;height:480px;border-radius:50%;border:1px solid rgba(79,129,189,0.04);pointer-events:none; }
        .k-slide-area { position:relative;z-index:2;width:100%;max-width:520px;text-align:center; }

        .k-slide-eyebrow { display:flex;align-items:center;justify-content:center;gap:0.55rem;margin-bottom:1.35rem; }
        .k-slide-line { width:28px;height:1px;background:rgba(75,172,198,0.35); }

        .k-badge { display:inline-block;font-size:0.6rem;font-weight:800;padding:0.2rem 0.65rem;border-radius:4px;letter-spacing:0.1em;text-transform:uppercase; }
        .k-badge-must { background:rgba(75,172,198,0.14);color:#4BACC6;border:1px solid rgba(75,172,198,0.28); }
        .k-badge-ann { background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.38);border:1px solid rgba(255,255,255,0.09); }
        .k-badge-event { background:rgba(128,100,162,0.12);color:#b89fda;border:1px solid rgba(128,100,162,0.25); }

        .k-slide-title {
          font-size:clamp(1.5rem,2.8vw,2.4rem);font-weight:800;color:white;
          line-height:1.2;letter-spacing:-0.025em;margin-bottom:1rem;
          transition:opacity 0.35s ease,transform 0.35s ease;
        }
        .k-slide-title.in  { opacity:1;transform:translateY(0); }
        .k-slide-title.out { opacity:0;transform:translateY(-14px); }

        .k-slide-content {
          font-size:0.88rem;color:rgba(255,255,255,0.42);line-height:1.72;
          display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;
          transition:opacity 0.35s ease 0.05s,transform 0.35s ease 0.05s;
        }
        .k-slide-content.in  { opacity:1;transform:translateY(0); }
        .k-slide-content.out { opacity:0;transform:translateY(-10px); }

        .k-slide-dots { display:flex;justify-content:center;gap:0.4rem;margin-top:1.5rem; }
        .k-slide-dot { width:22px;height:3px;border-radius:999px;background:rgba(255,255,255,0.1);transition:all 0.35s;cursor:pointer; }
        .k-slide-dot.active { background:#4BACC6;width:34px; }
        .k-slide-counter { position:absolute;bottom:-1.75rem;left:50%;transform:translateX(-50%);font-size:0.6rem;color:rgba(255,255,255,0.18);font-weight:700;letter-spacing:0.08em; }

        /* Right — posts */
        .k-panel-right {
          padding:1.25rem 1.25rem 1.25rem 1rem;
          border-left:1px solid rgba(255,255,255,0.05);
          display:flex;flex-direction:column;gap:0.55rem;
          overflow-y:auto;background:rgba(0,0,0,0.12);
        }
        .k-panel-right::-webkit-scrollbar { width:2px; }
        .k-panel-right::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.06);border-radius:999px; }

        .k-post-card { background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:0.75rem 0.85rem;transition:all 0.18s;animation:kPostIn 0.35s ease both; }
        .k-post-card:hover { background:rgba(255,255,255,0.05);border-color:rgba(255,255,255,0.1); }
        .k-event-card { background:rgba(128,100,162,0.06);border:1px solid rgba(128,100,162,0.15);border-radius:10px;padding:0.75rem 0.85rem;animation:kPostIn 0.35s ease both; }
        .k-post-badges { display:flex;gap:0.3rem;margin-bottom:0.35rem;flex-wrap:wrap; }
        .k-post-title { font-size:0.78rem;font-weight:600;color:rgba(255,255,255,0.75);line-height:1.35;margin-bottom:0.18rem; }
        .k-post-sub { font-size:0.65rem;color:rgba(255,255,255,0.27);font-weight:500; }

        /* Ticker */
        .k-ticker-wrap {
          position:relative;z-index:10;flex-shrink:0;
          height:32px;overflow:hidden;
          background:rgba(75,172,198,0.05);
          border-top:1px solid rgba(75,172,198,0.1);
          display:flex;align-items:center;
        }
        .k-ticker { display:flex;white-space:nowrap;animation:kTicker 50s linear infinite;font-size:0.68rem;font-weight:600;color:rgba(75,172,198,0.58);letter-spacing:0.05em; }
        .k-ticker-item { padding:0 2.5rem; }
        .k-ticker-sep { color:rgba(75,172,198,0.28); }

        /* Bottom bar */
        .k-bottom {
          position:relative;z-index:10;flex-shrink:0;
          display:flex;align-items:center;justify-content:center;
          padding:0.55rem 1.5rem;
          background:rgba(4,9,18,0.85);
          border-top:1px solid rgba(255,255,255,0.04);
          backdrop-filter:blur(10px);
          gap:1rem;
        }
        .k-bottom-line { flex:1;height:1px;background:linear-gradient(90deg,transparent,rgba(75,172,198,0.12),transparent); }
        .k-dashboard-btn {
          padding:0.42rem 1.6rem;
          background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.09);
          border-radius:999px;color:rgba(255,255,255,0.3);font-size:0.72rem;font-weight:600;
          cursor:pointer;transition:all 0.18s;letter-spacing:0.03em;white-space:nowrap;font-family:inherit;
        }
        .k-dashboard-btn:hover { background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.65);border-color:rgba(255,255,255,0.18); }

        /* Floating CTA */
        .k-float-cta {
          position:fixed;bottom:3.5rem;left:50%;transform:translateX(-50%);
          z-index:50;
          padding:0.95rem 3.25rem;
          background:linear-gradient(135deg,#4BACC6,#365F91);
          border:none;border-radius:999px;
          color:white;font-size:0.88rem;font-weight:800;
          letter-spacing:0.07em;cursor:pointer;font-family:inherit;
          box-shadow:0 8px 40px rgba(75,172,198,0.4),0 0 0 1px rgba(75,172,198,0.15),inset 0 1px 0 rgba(255,255,255,0.12);
          animation:kFloat 3.5s ease-in-out infinite;
          transition:filter 0.15s,box-shadow 0.15s;white-space:nowrap;
        }
        .k-float-cta:hover { filter:brightness(1.18);box-shadow:0 14px 50px rgba(75,172,198,0.6);animation:none;transform:translateX(-50%) translateY(-4px); }
        .k-float-cta:active { transform:translateX(-50%) scale(0.97); }

        /* Select overlay */
        .k-select-overlay { position:fixed;inset:0;z-index:200;background:rgba(6,12,23,0.97);backdrop-filter:blur(20px);display:flex;flex-direction:column;animation:kFadeIn 0.2s ease; }
        .k-select-header { display:flex;align-items:center;justify-content:space-between;padding:1.25rem 2rem;border-bottom:1px solid rgba(75,172,198,0.1);flex-shrink:0; }
        .k-select-title { font-size:1.2rem;font-weight:800;color:white; }
        .k-select-sub { font-size:0.78rem;color:rgba(255,255,255,0.35);margin-top:0.15rem; }
        .k-select-close { background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:rgba(255,255,255,0.55);font-size:0.82rem;font-weight:600;padding:0.5rem 1rem;cursor:pointer;transition:all 0.15s;font-family:inherit; }
        .k-select-close:hover { background:rgba(255,255,255,0.1);color:white; }
        .k-select-search-wrap { padding:0.85rem 2rem;border-bottom:1px solid rgba(255,255,255,0.05);flex-shrink:0; }
        .k-select-search { width:100%;max-width:460px;padding:0.7rem 1.1rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:white;font-size:0.9rem;font-family:inherit;outline:none; }
        .k-select-search::placeholder { color:rgba(255,255,255,0.25); }
        .k-select-search:focus { border-color:rgba(75,172,198,0.5);background:rgba(75,172,198,0.05); }
        .k-select-body { flex:1;overflow-y:auto;padding:1.25rem 2rem; }
        .k-select-body::-webkit-scrollbar { width:4px; }
        .k-select-body::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.08);border-radius:999px; }

        .k-dept-section { margin-bottom:1.75rem; }
        .k-dept-heading { font-size:0.6rem;font-weight:800;letter-spacing:0.14em;color:rgba(255,255,255,0.22);text-transform:uppercase;margin-bottom:0.75rem;display:flex;align-items:center;gap:0.6rem; }
        .k-dept-heading::after { content:'';flex:1;height:1px;background:rgba(255,255,255,0.06); }

        .k-emp-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:0.6rem; }
        .k-emp-card { display:flex;align-items:center;gap:0.7rem;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:0.85rem 1rem;cursor:pointer;transition:all 0.15s;animation:kFadeIn 0.25s ease both;font-family:inherit; }
        .k-emp-card:hover { background:rgba(79,129,189,0.12);border-color:rgba(79,129,189,0.35);transform:translateY(-2px); }
        .k-emp-card:active { transform:scale(0.97); }
        .k-emp-card.no-pin { opacity:0.4;cursor:not-allowed; }
        .k-emp-card.no-pin:hover { background:rgba(255,255,255,0.03);border-color:rgba(255,255,255,0.07);transform:none; }
        .k-emp-avatar { width:40px;height:40px;border-radius:50%;flex-shrink:0;background:linear-gradient(135deg,#4F81BD,#243F60);display:flex;align-items:center;justify-content:center;font-size:0.95rem;font-weight:800;color:white; }
        .k-emp-name { font-size:0.85rem;font-weight:700;color:white;display:block;line-height:1.2; }
        .k-emp-dept { font-size:0.7rem;color:rgba(255,255,255,0.35);display:block;margin-top:0.12rem; }
        .k-emp-no-pin { font-size:0.64rem;color:rgba(192,80,77,0.75);display:block;margin-top:0.15rem; }
        .k-select-empty { text-align:center;padding:4rem;color:rgba(255,255,255,0.2);font-size:0.88rem; }

        /* PIN overlay */
        .k-pin-overlay { position:fixed;inset:0;z-index:300;background:rgba(6,12,23,0.97);backdrop-filter:blur(20px);display:flex;align-items:center;justify-content:center;animation:kFadeIn 0.18s ease; }
        .k-pin-card {
          background:rgba(12,22,38,0.95);border:1px solid rgba(75,172,198,0.15);
          border-radius:22px;padding:2.25rem 1.85rem;width:330px;text-align:center;
          box-shadow:0 30px 80px rgba(0,0,0,0.7),0 0 0 1px rgba(75,172,198,0.08);
          animation:kSlideUp 0.3s cubic-bezier(0.34,1.56,0.64,1);
          position:relative;overflow:hidden;
        }
        .k-pin-card::before { content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(75,172,198,0.4),transparent); }
        .k-pin-card.shake { animation:kShake 0.55s ease; }

        .k-pin-avatar { width:68px;height:68px;border-radius:50%;background:linear-gradient(135deg,#4BACC6,#243F60);display:flex;align-items:center;justify-content:center;font-size:1.75rem;font-weight:800;color:white;margin:0 auto 0.8rem;border:2px solid rgba(75,172,198,0.25);box-shadow:0 0 30px rgba(75,172,198,0.2); }
        .k-pin-name { font-size:1.25rem;font-weight:800;color:white;margin-bottom:0.2rem; }
        .k-pin-dept { font-size:0.78rem;color:rgba(255,255,255,0.35);text-transform:capitalize;margin-bottom:0.75rem; }
        .k-pin-prompt { font-size:0.78rem;color:rgba(255,255,255,0.3);margin-bottom:0.25rem; }

        .k-pin-dots { display:flex;justify-content:center;gap:0.85rem;margin:1rem 0 0.25rem; }
        .k-pin-dot { width:13px;height:13px;border-radius:50%;border:2px solid rgba(255,255,255,0.14);background:transparent;transition:all 0.15s; }
        .k-pin-dot.filled { background:#4BACC6;border-color:#4BACC6;box-shadow:0 0 10px rgba(75,172,198,0.6); }
        .k-pin-dot.error { background:#C0504D;border-color:#C0504D; }

        .k-pin-error-msg { color:#e8a09e;font-size:0.76rem;font-weight:600;margin:0.5rem 0 0.25rem; }
        .k-pin-processing { font-size:0.8rem;color:#4BACC6;font-weight:600;margin:0.5rem 0;animation:kPulse 1s ease-in-out infinite; }

        .k-pin-grid { display:grid;grid-template-columns:repeat(3,1fr);gap:0.5rem;margin:1rem 0; }
        .k-pin-key { aspect-ratio:1;border-radius:11px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);color:white;font-size:1.3rem;font-weight:700;cursor:pointer;transition:all 0.1s;display:flex;align-items:center;justify-content:center;font-family:inherit; }
        .k-pin-key:hover { background:rgba(75,172,198,0.15);border-color:rgba(75,172,198,0.3); }
        .k-pin-key:active { transform:scale(0.91);background:rgba(75,172,198,0.25); }
        .k-pin-key:disabled { opacity:0.3;cursor:not-allowed; }
        .k-pin-del { font-size:1rem;color:rgba(255,255,255,0.45); }
        .k-pin-empty { visibility:hidden;pointer-events:none; }

        .k-pin-back { width:100%;padding:0.52rem;margin-bottom:0.4rem;background:transparent;border:1px solid rgba(255,255,255,0.07);border-radius:8px;color:rgba(255,255,255,0.35);font-size:0.78rem;font-weight:600;cursor:pointer;transition:all 0.15s;font-family:inherit; }
        .k-pin-back:hover { background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.65); }
        .k-pin-cancel { width:100%;padding:0.52rem;background:transparent;border:1px solid rgba(255,255,255,0.06);border-radius:8px;color:rgba(255,255,255,0.22);font-size:0.74rem;font-weight:600;cursor:pointer;transition:all 0.15s;font-family:inherit; }
        .k-pin-cancel:hover { background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.55); }

        /* Brief */
        .k-brief { flex:1;display:flex;flex-direction:column;animation:kBriefIn 0.4s ease;position:relative;z-index:5; }
        .k-brief-banner { padding:0.85rem 1.75rem;display:flex;align-items:center;gap:0.75rem;font-size:0.95rem;font-weight:700;flex-shrink:0; }
        .k-brief-banner.in { background:rgba(75,172,198,0.1);border-bottom:1px solid rgba(75,172,198,0.14);color:#4BACC6; }
        .k-brief-banner.out { background:rgba(128,100,162,0.1);border-bottom:1px solid rgba(128,100,162,0.14);color:#b89fda; }
        .k-brief-time { margin-left:auto;font-size:0.8rem;opacity:0.6; }

        .k-brief-body { flex:1;display:grid;grid-template-columns:1fr 1fr;gap:2rem;padding:2rem;max-width:1000px;margin:0 auto;width:100%; }
        .k-brief-left { display:flex;flex-direction:column;gap:1.5rem; }
        .k-brief-right { display:flex;flex-direction:column;gap:1rem; }

        .k-brief-greeting { font-size:clamp(1.8rem,4vw,3rem);font-weight:800;letter-spacing:-0.025em;color:white;line-height:1.1; }
        .k-brief-role { font-size:0.88rem;color:rgba(255,255,255,0.32);margin-top:0.35rem;text-transform:capitalize; }
        .k-brief-section-label { font-size:0.6rem;font-weight:800;letter-spacing:0.14em;color:rgba(255,255,255,0.22);text-transform:uppercase;margin-bottom:0.6rem; }

        .k-brief-sched-item { background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-left:3px solid #4BACC6;border-radius:10px;padding:0.8rem 1rem;margin-bottom:0.5rem; }
        .k-brief-sched-time { font-size:1rem;font-weight:800;color:white;font-variant-numeric:tabular-nums; }
        .k-brief-sched-note { font-size:0.78rem;color:rgba(255,255,255,0.32);margin-top:0.1rem; }
        .k-brief-sched-empty { color:rgba(255,255,255,0.2);font-size:0.85rem; }

        .k-brief-must { background:rgba(192,80,77,0.08);border:1px solid rgba(192,80,77,0.18);border-radius:10px;padding:0.85rem 1rem;display:flex;gap:0.75rem; }
        .k-brief-must-title { font-size:0.88rem;font-weight:700;color:#e8a09e; }
        .k-brief-must-sub { font-size:0.75rem;color:rgba(232,160,158,0.6);margin-top:0.1rem; }

        .k-brief-ann-item { padding:0.65rem 0;border-bottom:1px solid rgba(255,255,255,0.05); }
        .k-brief-ann-item:last-child { border-bottom:none; }
        .k-brief-ann-title { font-size:0.85rem;font-weight:600;color:rgba(255,255,255,0.68);line-height:1.3; }
        .k-brief-ann-type { font-size:0.68rem;color:rgba(255,255,255,0.22);margin-top:0.12rem; }

        .k-brief-footer { padding:1rem 1.75rem;border-top:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:1rem;flex-shrink:0; }
        .k-brief-progress-wrap { flex:1; }
        .k-brief-progress-label { font-size:0.7rem;color:rgba(255,255,255,0.22);margin-bottom:0.3rem; }
        .k-brief-progress-track { height:3px;background:rgba(255,255,255,0.06);border-radius:999px;overflow:hidden; }
        .k-brief-progress-fill { height:100%;background:linear-gradient(90deg,#4BACC6,#4F81BD);border-radius:999px;transition:width 0.05s linear; }
        .k-brief-done-btn { padding:0.6rem 1.5rem;background:rgba(75,172,198,0.1);border:1px solid rgba(75,172,198,0.22);border-radius:8px;color:#4BACC6;font-size:0.85rem;font-weight:700;cursor:pointer;transition:all 0.15s;white-space:nowrap;font-family:inherit; }
        .k-brief-done-btn:hover { background:#4BACC6;border-color:#4BACC6;color:white; }

        @media(max-width:900px) {
          .k-main { grid-template-columns:1fr; }
          .k-panel-left,.k-panel-right { display:none; }
          .k-brief-body { grid-template-columns:1fr; }
          .k-emp-grid { grid-template-columns:1fr 1fr; }
        }
      `}</style>

      <div className="kiosk">

        {/* Background */}
        <div className="k-bg">
          <div className="k-bg-grid" />
          <div className="k-orb k-orb-1" />
          <div className="k-orb k-orb-2" />
          <div className="k-orb k-orb-3" />
          <div className="k-scan" />
        </div>

        {/* Corner brackets */}
        <div className="k-bracket k-bracket-tl" />
        <div className="k-bracket k-bracket-tr" />
        <div className="k-bracket k-bracket-bl" />
        <div className="k-bracket k-bracket-br" />

        {/* ═══ IDLE ═══ */}
        {state === 'idle' && (
          <>
            <div className="k-topbar">
              <div className="k-brand">
                <div className="k-brand-mark">
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1.5"/>
                    <rect x="14" y="3" width="7" height="7" rx="1.5"/>
                    <rect x="3" y="14" width="7" height="7" rx="1.5"/>
                    <rect x="14" y="14" width="7" height="7" rx="1.5"/>
                  </svg>
                </div>
                <div>
                  <div className="k-brand-name">InfoWall</div>
                  <div className="k-brand-sub">Employee Kiosk</div>
                </div>
              </div>

              <div className="k-topbar-clock">
                <div className="k-clock-time">
                  {timeStr}<span className="k-clock-secs">{secsStr}</span>
                </div>
                <div className="k-clock-date">{dateStr}</div>
              </div>

              <div className="k-live-pill">
                <div className="k-live-dot" />
                LIVE
              </div>
            </div>

            <div className="k-main">
              {/* LEFT */}
              <div className="k-panel-left">
                <div className="k-panel-label">Today's Roster</div>
                {roster.length === 0 ? (
                  <div className="k-no-roster">
                    <span style={{ fontSize: '1.75rem', opacity: 0.4 }}>📅</span>
                    <span>No shifts scheduled today</span>
                  </div>
                ) : roster.map((r, i) => (
                  <button
                    key={i}
                    className="k-roster-card"
                    style={{ animationDelay: `${i * 0.06}s`, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
                    onClick={openSelectScreen}
                  >
                    <div className="k-roster-avatar">{r.full_name.charAt(0).toUpperCase()}</div>
                    <div>
                      <span className="k-roster-name">{r.full_name.split(' ')[0]}</span>
                      <span className="k-roster-time">{fmtTime(r.start_time)} – {fmtTime(r.end_time)}</span>
                    </div>
                  </button>
                ))}
              </div>

              {/* CENTER */}
              <div className="k-center">
                <div className="k-slide-ring" />
                <div className="k-slide-ring-2" />
                <div className="k-slide-area">
                  {featured ? (
                    <>
                      <div className="k-slide-eyebrow">
                        <div className="k-slide-line" />
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          {featured.must_read && <span className="k-badge k-badge-must">Must-read</span>}
                          <span className="k-badge k-badge-ann">Announcement</span>
                        </div>
                        <div className="k-slide-line" />
                      </div>
                      <h2 className={`k-slide-title ${slideIn ? 'in' : 'out'}`}>{featured.title}</h2>
                      <p className={`k-slide-content ${slideIn ? 'in' : 'out'}`}>{featured.content}</p>
                      {(display?.announcements.length ?? 0) > 1 && (
                        <>
                          <div className="k-slide-dots">
                            {display!.announcements.map((_, i) => (
                              <div key={i} className={`k-slide-dot${i === featuredIdx ? ' active' : ''}`} onClick={() => setFeaturedIdx(i)} />
                            ))}
                          </div>
                          <div className="k-slide-counter">{featuredIdx + 1} / {display!.announcements.length}</div>
                        </>
                      )}
                    </>
                  ) : (
                    <div style={{ color: 'rgba(255,255,255,0.15)', fontSize: '0.9rem' }}>No announcements to display.</div>
                  )}
                </div>
              </div>

              {/* RIGHT */}
              <div className="k-panel-right">
                <div className="k-panel-label">All Posts</div>
                {allPosts.map((p, i) => (
                  <div key={i} className="k-post-card" style={{ animationDelay: `${i * 0.05}s` }}>
                    <div className="k-post-badges">
                      {p.must_read && <span className="k-badge k-badge-must">Must-read</span>}
                      <span className="k-badge k-badge-ann">Announcement</span>
                    </div>
                    <div className="k-post-title">{p.title}</div>
                    {p.created_at && <div className="k-post-sub">{timeAgo(p.created_at)}</div>}
                  </div>
                ))}
                {allEvents.map((ev, i) => (
                  <div key={`ev${i}`} className="k-event-card" style={{ animationDelay: `${(allPosts.length + i) * 0.05}s` }}>
                    <div className="k-post-badges"><span className="k-badge k-badge-event">Event</span></div>
                    <div className="k-post-title">{ev.title}</div>
                    {ev.event_start && <div className="k-post-sub">{fmtEventDate(ev.event_start)}</div>}
                  </div>
                ))}
                {allPosts.length === 0 && allEvents.length === 0 && (
                  <div style={{ color: 'rgba(255,255,255,0.15)', fontSize: '0.8rem', textAlign: 'center', padding: '2rem 0' }}>
                    No posts to display.
                  </div>
                )}
              </div>
            </div>

            {tickerItems.length > 0 && (
              <div className="k-ticker-wrap">
                <div className="k-ticker">
                  {[...tickerItems, ...tickerItems].map((title, i) => (
                    <span key={i} className="k-ticker-item">
                      {title}<span className="k-ticker-sep"> ◆ </span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="k-bottom">
              <div className="k-bottom-line" />
              <button className="k-dashboard-btn" onClick={() => navigate('/login')}>
                🔐 Staff Dashboard
              </button>
              <div className="k-bottom-line" />
            </div>

            <button className="k-float-cta" onClick={openSelectScreen}>
              ⏱ &nbsp;CLOCK IN / CLOCK OUT
            </button>
          </>
        )}

        {/* ═══ SELECT ═══ */}
        {state === 'select' && (
          <div className="k-select-overlay">
            <div className="k-select-header">
              <div>
                <div className="k-select-title">Who are you?</div>
                <div className="k-select-sub">Select your name to clock in or clock out</div>
              </div>
              <button className="k-select-close" onClick={returnToIdle}>✕ Cancel</button>
            </div>
            <div className="k-select-search-wrap">
              <input
                className="k-select-search"
                placeholder="🔍   Search by name or department…"
                value={employeeSearch}
                onChange={e => setEmployeeSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div className="k-select-body">
              {loadingEmployees ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'rgba(255,255,255,0.25)', fontSize: '0.9rem' }}>
                  Loading…
                </div>
              ) : filteredEmployees.length === 0 ? (
                <div className="k-select-empty">No employees found for "{employeeSearch}"</div>
              ) : (
                Object.entries(byDept).sort(([a], [b]) => a.localeCompare(b)).map(([dept, emps]) => (
                  <div key={dept} className="k-dept-section">
                    <div className="k-dept-heading">{dept}</div>
                    <div className="k-emp-grid">
                      {emps.map((emp, i) => (
                        <button
                          key={emp.id}
                          className={`k-emp-card${!emp.has_pin ? ' no-pin' : ''}`}
                          style={{ animationDelay: `${i * 0.03}s` }}
                          onClick={() => emp.has_pin ? selectEmployee(emp) : undefined}
                          disabled={!emp.has_pin}
                          title={!emp.has_pin ? 'No kiosk PIN — see admin' : ''}
                        >
                          <div className="k-emp-avatar">{emp.full_name.charAt(0).toUpperCase()}</div>
                          <div>
                            <span className="k-emp-name">{emp.full_name}</span>
                            <span className="k-emp-dept" style={{ textTransform: 'capitalize' }}>{emp.role}</span>
                            {!emp.has_pin && <span className="k-emp-no-pin">No PIN set</span>}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ═══ PIN ═══ */}
        {state === 'pin' && selectedEmployee && (
          <div className="k-pin-overlay">
            <div className={`k-pin-card${shake ? ' shake' : ''}`}>
              <div className="k-pin-avatar">{selectedEmployee.full_name.charAt(0).toUpperCase()}</div>
              <div className="k-pin-name">{selectedEmployee.full_name}</div>
              <div className="k-pin-dept">{selectedEmployee.department ?? selectedEmployee.role}</div>
              <div className="k-pin-prompt">Enter your 4-digit PIN to continue</div>
              <div className="k-pin-dots">
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className={`k-pin-dot${pin.length > i ? (pinError ? ' error' : ' filled') : ''}`} />
                ))}
              </div>
              {pinError && <div className="k-pin-error-msg">Incorrect PIN — please try again</div>}
              {processing && <div className="k-pin-processing">Verifying…</div>}
              <div className="k-pin-grid">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
                  <button key={n} className="k-pin-key" onClick={() => handlePin(String(n))} disabled={processing}>{n}</button>
                ))}
                <button className="k-pin-key k-pin-empty" disabled />
                <button className="k-pin-key" onClick={() => handlePin('0')} disabled={processing}>0</button>
                <button className="k-pin-key k-pin-del" onClick={handleBackspace} disabled={processing}>⌫</button>
              </div>
              <button className="k-pin-back" onClick={() => { setPin(''); setPinError(false); setState('select') }}>
                ← Back to employee list
              </button>
              <button className="k-pin-cancel" onClick={returnToIdle}>Cancel</button>
            </div>
          </div>
        )}

        {/* ═══ BRIEF ═══ */}
        {state === 'brief' && brief && (
          <div className="k-brief">
            <div className={`k-brief-banner${brief.action === 'clocked_in' ? ' in' : ' out'}`}>
              <span style={{ fontSize: '1.2rem' }}>{brief.action === 'clocked_in' ? '✓' : '👋'}</span>
              <span>{brief.action === 'clocked_in' ? 'Clocked in successfully' : 'Clocked out — see you next time!'}</span>
              <span className="k-brief-time">{fmt12(brief.time)}</span>
            </div>

            <div className="k-brief-body">
              <div className="k-brief-left">
                <div>
                  <div className="k-brief-greeting">
                    {brief.action === 'clocked_in' ? 'Good morning' : 'See you'},{' '}
                    {brief.full_name?.split(' ')[0] ?? 'there'}
                  </div>
                  <div className="k-brief-role">{brief.department ?? brief.role}</div>
                </div>
                <div>
                  <div className="k-brief-section-label">Today's Schedule</div>
                  {brief.schedules.length === 0 ? (
                    <div className="k-brief-sched-empty">No shifts scheduled today.</div>
                  ) : brief.schedules.map((s, i) => (
                    <div key={i} className="k-brief-sched-item">
                      <div className="k-brief-sched-time">{fmtTime(s.start_time)} – {fmtTime(s.end_time)}</div>
                      {s.note && <div className="k-brief-sched-note">{s.note}</div>}
                    </div>
                  ))}
                </div>
                {brief.must_read_count > 0 && (
                  <div className="k-brief-must">
                    <span style={{ fontSize: '1.2rem', flexShrink: 0 }}>⚠</span>
                    <div>
                      <div className="k-brief-must-title">
                        {brief.must_read_count} must-read {brief.must_read_count === 1 ? 'post' : 'posts'} pending
                      </div>
                      <div className="k-brief-must-sub">Open the dashboard to review and acknowledge</div>
                    </div>
                  </div>
                )}
              </div>

              <div className="k-brief-right">
                <div className="k-brief-section-label">Recent Updates</div>
                {brief.announcements.length === 0 ? (
                  <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.85rem' }}>Nothing new right now.</div>
                ) : brief.announcements.map((a, i) => (
                  <div key={i} className="k-brief-ann-item">
                    <div className="k-brief-ann-title">{a.title}</div>
                    <div className="k-brief-ann-type">
                      {a.post_type === 'news_event' ? '📅 Event' : a.must_read ? '⚠ Must-read' : '📢 Announcement'}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="k-brief-footer">
              <div className="k-brief-progress-wrap">
                <div className="k-brief-progress-label">Returning to kiosk in {secsLeft}s</div>
                <div className="k-brief-progress-track">
                  <div className="k-brief-progress-fill" style={{ width: `${briefPct}%` }} />
                </div>
              </div>
              <button className="k-brief-done-btn" onClick={returnToIdle}>Done</button>
            </div>
          </div>
        )}

      </div>
    </>
  )
}
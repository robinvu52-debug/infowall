import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type KioskState = 'idle' | 'pin' | 'brief'

interface Schedule { start_time: string; end_time: string; note: string | null }
interface KioskPost { title: string; content: string; post_type: string; must_read: boolean }
interface BriefData {
  full_name: string; role: string; department: string | null
  action: 'clocked_in' | 'clocked_out'; time: string
  schedules: Schedule[]; must_read_count: number; announcements: KioskPost[]
}
interface DisplayData {
  announcements: { id: string; title: string; content: string; created_at: string }[]
  events: { id: string; title: string; content: string; event_start: string | null; event_end: string | null }[]
}

const BRIEF_MS = 22000

function fmt12(ts: string) {
  return new Date(ts).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true })
}
function fmtTime(t: string) { return t?.slice(0, 5) ?? '' }
function fmtEventDate(s: string | null) {
  if (!s) return ''
  return new Date(s).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
}

export default function KioskPage() {
  const navigate = useNavigate()
  const [state, setState] = useState<KioskState>('idle')
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState(false)
  const [shake, setShake] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [brief, setBrief] = useState<BriefData | null>(null)
  const [display, setDisplay] = useState<DisplayData | null>(null)
  const [clock, setClock] = useState(new Date())
  const [annIdx, setAnnIdx] = useState(0)
  const [briefPct, setBriefPct] = useState(0)
  const briefRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const annRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Load display data
  const loadDisplay = useCallback(async () => {
    const { data } = await supabase.rpc('get_kiosk_display')
    if (data) setDisplay(data as DisplayData)
  }, [])

  useEffect(() => {
    loadDisplay()
    const t = setInterval(loadDisplay, 60000)
    return () => clearInterval(t)
  }, [loadDisplay])

  // Cycle announcements on idle
  useEffect(() => {
    if (state !== 'idle' || !display?.announcements.length) return
    annRef.current = setInterval(() => {
      setAnnIdx(i => (i + 1) % display.announcements.length)
    }, 6000)
    return () => { if (annRef.current) clearInterval(annRef.current) }
  }, [state, display?.announcements.length])

  // Brief countdown
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

  function returnToIdle() { setState('idle'); setBrief(null); setBriefPct(0) }

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

  function handleBackspace() { if (!processing) { setPin(p => p.slice(0, -1)); setPinError(false) } }

  const H = clock.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })
  const S = ('0' + clock.getSeconds()).slice(-2)
  const dateLabel = clock.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const ann = display?.announcements[annIdx]
  const secsLeft = Math.ceil(((100 - briefPct) / 100) * (BRIEF_MS / 1000))

  return (
    <>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:.65;transform:scale(1)}50%{opacity:1;transform:scale(1.015)} }
        @keyframes slideUp { from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:translateY(0)} }
        @keyframes shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-10px)} 40%{transform:translateX(10px)} 60%{transform:translateX(-8px)} 80%{transform:translateX(8px)} }
        @keyframes fadeIn { from{opacity:0}to{opacity:1} }
        @keyframes tickerIn { from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)} }
        @keyframes briefIn { from{opacity:0;transform:scale(0.97)}to{opacity:1;transform:scale(1)} }
        @keyframes floatBtn { 0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)} }

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .kiosk {
          min-height: 100vh; width: 100%;
          background: #07131a;
          color: white;
          font-family: -apple-system, 'Inter', sans-serif;
          overflow: hidden;
          position: relative;
          display: flex; flex-direction: column;
          user-select: none;
        }

        /* ════ IDLE ════ */
        .idle-screen { flex: 1; display: flex; flex-direction: column; }

        .kiosk-topbar {
          display: flex; align-items: center; justify-content: space-between;
          padding: 1.25rem 2rem;
          background: rgba(0,0,0,0.3);
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .kiosk-brand { display: flex; align-items: center; gap: 0.65rem; }
        .kiosk-brand-logo {
          width: 36px; height: 36px; border-radius: 10px;
          background: linear-gradient(135deg,#00e5e5,#007a8a);
          display: flex; align-items: center; justify-content: center;
        }
        .kiosk-brand-logo svg { width: 18px; height: 18px; }
        .kiosk-brand-name { font-size: 1.1rem; font-weight: 800; letter-spacing: -0.02em; }
        .kiosk-brand-sub { font-size: 0.75rem; color: rgba(255,255,255,0.4); font-weight: 500; margin-top: 0.1rem; }
        .kiosk-topbar-date { font-size: 0.88rem; color: rgba(255,255,255,0.45); font-weight: 500; text-align: right; }

        .idle-center {
          flex: 1; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          padding: 2rem 2rem 6rem;
          gap: 0;
        }

        .kiosk-clock-wrap { text-align: center; margin-bottom: 2.5rem; }
        .kiosk-clock {
          font-size: clamp(5rem, 14vw, 9rem); font-weight: 800;
          letter-spacing: -0.04em; line-height: 1;
          background: linear-gradient(135deg, #fff 40%, #00e5e5);
          -webkit-background-clip: text; background-clip: text; color: transparent;
          font-variant-numeric: tabular-nums;
        }
        .kiosk-clock-seconds {
          font-size: clamp(1.5rem, 4vw, 2.5rem); font-weight: 700;
          color: rgba(0,229,229,0.65); font-variant-numeric: tabular-nums;
          display: inline-block; margin-left: 0.25em; vertical-align: super;
        }
        .kiosk-date { font-size: 1rem; color: rgba(255,255,255,0.4); font-weight: 500; margin-top: 0.5rem; letter-spacing: 0.02em; }

        .idle-bottom { width: 100%; max-width: 960px; display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; }

        .kiosk-panel {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px; overflow: hidden;
        }
        .kiosk-panel-header {
          padding: 0.75rem 1.2rem; border-bottom: 1px solid rgba(255,255,255,0.06);
          font-size: 0.7rem; font-weight: 700; color: rgba(255,255,255,0.35);
          text-transform: uppercase; letter-spacing: 0.1em;
          display: flex; align-items: center; gap: 0.5rem;
        }
        .kiosk-panel-dot { width: 6px; height: 6px; border-radius: 50%; background: #00e5e5; animation: pulse 2s ease-in-out infinite; }

        .kiosk-ann-body { padding: 1.2rem; min-height: 100px; }
        .kiosk-ann-title { font-size: 1rem; font-weight: 700; color: white; margin-bottom: 0.5rem; line-height: 1.3; animation: tickerIn 0.5s ease both; }
        .kiosk-ann-content { font-size: 0.82rem; color: rgba(255,255,255,0.5); line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; animation: tickerIn 0.5s ease 0.08s both; }
        .kiosk-ann-dots { display: flex; gap: 0.35rem; padding: 0 1.2rem 1rem; }
        .kiosk-ann-dot { width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,0.15); transition: background 0.3s; }
        .kiosk-ann-dot.active { background: #00e5e5; }

        .kiosk-event-list { padding: 0.5rem 0; }
        .kiosk-event-item { display: flex; align-items: flex-start; gap: 0.85rem; padding: 0.75rem 1.2rem; border-bottom: 1px solid rgba(255,255,255,0.04); }
        .kiosk-event-item:last-child { border-bottom: none; }
        .kiosk-event-date-badge { background: rgba(0,229,229,0.1); border: 1px solid rgba(0,229,229,0.2); border-radius: 8px; padding: 0.3rem 0.6rem; flex-shrink: 0; text-align: center; }
        .kiosk-event-date-text { font-size: 0.7rem; font-weight: 700; color: #00e5e5; white-space: nowrap; }
        .kiosk-event-title { font-size: 0.88rem; font-weight: 600; color: rgba(255,255,255,0.8); line-height: 1.3; }
        .kiosk-event-time { font-size: 0.73rem; color: rgba(255,255,255,0.35); margin-top: 0.2rem; }
        .kiosk-no-events { padding: 1.5rem 1.2rem; color: rgba(255,255,255,0.2); font-size: 0.85rem; }

        .kiosk-cta-wrap { margin-top: 2rem; }
        .kiosk-cta {
          padding: 1rem 3rem;
          background: linear-gradient(135deg, #00b8b8, #007a8a);
          border: none; border-radius: 14px;
          color: white; font-size: 1.05rem; font-weight: 700;
          cursor: pointer; letter-spacing: 0.02em;
          animation: pulse 2.5s ease-in-out infinite;
          box-shadow: 0 0 40px rgba(0,184,184,0.25);
          transition: transform 0.15s;
        }
        .kiosk-cta:hover { transform: scale(1.03); }
        .kiosk-cta:active { transform: scale(0.97); }

        /* ════ FLOATING STAFF LOGIN BUTTON ════ */
        .kiosk-staff-btn {
          position: fixed;
          bottom: 1.75rem;
          left: 50%;
          transform: translateX(-50%);
          z-index: 200;
          display: flex; align-items: center; gap: 0.55rem;
          padding: 0.6rem 1.4rem;
          background: rgba(13, 45, 58, 0.75);
          backdrop-filter: blur(14px);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 999px;
          color: rgba(255,255,255,0.55);
          font-size: 0.8rem; font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
          box-shadow: 0 4px 20px rgba(0,0,0,0.35);
          letter-spacing: 0.01em;
        }
        .kiosk-staff-btn:hover {
          background: rgba(0,184,184,0.2);
          border-color: rgba(0,229,229,0.35);
          color: rgba(255,255,255,0.9);
          transform: translateX(-50%) translateY(-2px);
          box-shadow: 0 8px 28px rgba(0,0,0,0.4);
        }
        .kiosk-staff-btn:active { transform: translateX(-50%) translateY(0); }
        .kiosk-staff-icon { font-size: 0.85rem; opacity: 0.7; }

        /* ════ PIN OVERLAY ════ */
        .pin-overlay {
          position: fixed; inset: 0; z-index: 100;
          background: rgba(7,19,26,0.88);
          backdrop-filter: blur(12px);
          display: flex; align-items: center; justify-content: center;
          animation: fadeIn 0.2s ease;
        }
        .pin-card {
          background: #0d2234; border: 1px solid rgba(255,255,255,0.1);
          border-radius: 24px; padding: 2.5rem 2rem;
          width: 340px; text-align: center;
          box-shadow: 0 30px 80px rgba(0,0,0,0.5);
          animation: slideUp 0.3s cubic-bezier(0.34,1.56,0.64,1);
        }
        .pin-card.shake { animation: shake 0.55s ease; }
        .pin-title { font-size: 1.25rem; font-weight: 800; margin-bottom: 0.4rem; }
        .pin-sub { font-size: 0.82rem; color: rgba(255,255,255,0.4); margin-bottom: 1.75rem; }
        .pin-dots { display: flex; justify-content: center; gap: 0.85rem; margin-bottom: 2rem; }
        .pin-dot { width: 16px; height: 16px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.2); background: transparent; transition: all 0.15s; }
        .pin-dot.filled { background: #00e5e5; border-color: #00e5e5; box-shadow: 0 0 10px rgba(0,229,229,0.5); }
        .pin-dot.error { background: #ef4444; border-color: #ef4444; box-shadow: 0 0 10px rgba(239,68,68,0.5); }
        .pin-error-msg { color: #fca5a5; font-size: 0.8rem; font-weight: 600; margin: -1.2rem 0 1.2rem; }
        .pin-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.6rem; margin-bottom: 1.25rem; }
        .pin-key {
          aspect-ratio: 1; border-radius: 12px;
          background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08);
          color: white; font-size: 1.35rem; font-weight: 700;
          cursor: pointer; transition: all 0.1s;
          display: flex; align-items: center; justify-content: center;
        }
        .pin-key:hover { background: rgba(255,255,255,0.12); }
        .pin-key:active { background: rgba(0,229,229,0.2); transform: scale(0.93); }
        .pin-key.del { font-size: 1.1rem; color: rgba(255,255,255,0.5); }
        .pin-key.empty { cursor: default; opacity: 0; pointer-events: none; }
        .pin-key:disabled { opacity: 0.4; cursor: not-allowed; }
        .pin-processing { font-size: 0.85rem; color: #00e5e5; font-weight: 600; margin-bottom: 0.75rem; animation: pulse 1s ease-in-out infinite; }
        .pin-cancel { background: none; border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; color: rgba(255,255,255,0.45); font-size: 0.85rem; font-weight: 600; padding: 0.6rem 1.5rem; cursor: pointer; transition: all 0.15s; width: 100%; }
        .pin-cancel:hover { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.8); }

        /* ════ BRIEF ════ */
        .brief-screen { flex: 1; display: flex; flex-direction: column; animation: briefIn 0.4s cubic-bezier(0.34,1.4,0.64,1); }
        .brief-banner {
          padding: 1rem 2rem; display: flex; align-items: center; gap: 0.75rem;
          font-size: 1rem; font-weight: 700;
        }
        .brief-banner.in { background: rgba(0,184,184,0.15); border-bottom: 1px solid rgba(0,229,229,0.2); color: #5eead4; }
        .brief-banner.out { background: rgba(99,102,241,0.12); border-bottom: 1px solid rgba(99,102,241,0.2); color: #a5b4fc; }
        .brief-banner-icon { font-size: 1.4rem; }
        .brief-banner-time { font-size: 0.82rem; opacity: 0.7; margin-left: auto; font-weight: 500; }

        .brief-body {
          flex: 1; display: grid; grid-template-columns: 1fr 1fr;
          gap: 1.5rem; padding: 2rem;
          max-width: 1200px; margin: 0 auto; width: 100%;
        }
        .brief-left { display: flex; flex-direction: column; gap: 1.5rem; }
        .brief-right { display: flex; flex-direction: column; gap: 1.25rem; }
        .brief-greeting-name { font-size: clamp(2rem, 5vw, 3.2rem); font-weight: 800; letter-spacing: -0.03em; color: white; line-height: 1.1; }
        .brief-greeting-sub { font-size: 0.9rem; color: rgba(255,255,255,0.4); font-weight: 500; margin-top: 0.4rem; text-transform: capitalize; }
        .brief-section-label { font-size: 0.68rem; font-weight: 700; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 0.6rem; }
        .brief-schedule-empty { color: rgba(255,255,255,0.25); font-size: 0.85rem; }
        .brief-schedule-item { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07); border-radius: 12px; padding: 0.85rem 1.1rem; margin-bottom: 0.6rem; border-left: 3px solid #00e5e5; }
        .brief-schedule-time { font-size: 1.1rem; font-weight: 800; color: white; font-variant-numeric: tabular-nums; }
        .brief-schedule-note { font-size: 0.8rem; color: rgba(255,255,255,0.4); margin-top: 0.2rem; }
        .brief-must-read { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2); border-radius: 12px; padding: 1rem 1.2rem; display: flex; align-items: flex-start; gap: 0.75rem; }
        .brief-must-read-icon { font-size: 1.3rem; flex-shrink: 0; }
        .brief-must-read-title { font-size: 0.92rem; font-weight: 700; color: #fca5a5; }
        .brief-must-read-sub { font-size: 0.78rem; color: rgba(252,165,165,0.65); margin-top: 0.15rem; }
        .brief-ann-item { border-bottom: 1px solid rgba(255,255,255,0.05); padding: 0.7rem 0; }
        .brief-ann-item:last-child { border-bottom: none; }
        .brief-ann-title { font-size: 0.88rem; font-weight: 600; color: rgba(255,255,255,0.75); }
        .brief-ann-type { font-size: 0.7rem; color: rgba(255,255,255,0.3); margin-top: 0.15rem; text-transform: capitalize; }
        .brief-footer { padding: 1.25rem 2rem; border-top: 1px solid rgba(255,255,255,0.06); display: flex; align-items: center; gap: 1.25rem; }
        .brief-progress-wrap { flex: 1; }
        .brief-progress-label { font-size: 0.75rem; color: rgba(255,255,255,0.35); margin-bottom: 0.35rem; }
        .brief-progress-track { height: 4px; background: rgba(255,255,255,0.08); border-radius: 999px; overflow: hidden; }
        .brief-progress-fill { height: 100%; background: linear-gradient(90deg, #00e5e5, #00b8b8); border-radius: 999px; transition: width 0.05s linear; }
        .brief-done-btn { padding: 0.7rem 1.75rem; background: #0d2d3a; border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; color: white; font-size: 0.9rem; font-weight: 700; cursor: pointer; transition: all 0.15s; white-space: nowrap; }
        .brief-done-btn:hover { background: #00b8b8; border-color: #00b8b8; }

        @media (max-width: 768px) {
          .idle-bottom { grid-template-columns: 1fr; }
          .brief-body { grid-template-columns: 1fr; }
          .kiosk-clock { font-size: clamp(4rem, 18vw, 6rem); }
        }
      `}</style>

      <div className="kiosk">

        {/* ════ IDLE ════ */}
        {state === 'idle' && (
          <div className="idle-screen">
            <div className="kiosk-topbar">
              <div className="kiosk-brand">
                <div className="kiosk-brand-logo">
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1" />
                    <rect x="14" y="3" width="7" height="7" rx="1" />
                    <rect x="3" y="14" width="7" height="7" rx="1" />
                    <rect x="14" y="14" width="7" height="7" rx="1" />
                  </svg>
                </div>
                <div>
                  <div className="kiosk-brand-name">InfoWall</div>
                  <div className="kiosk-brand-sub">Employee Kiosk</div>
                </div>
              </div>
              <div className="kiosk-topbar-date">{dateLabel}</div>
            </div>

            <div className="idle-center">
              <div className="kiosk-clock-wrap">
                <div>
                  <span className="kiosk-clock">{H}</span>
                  <span className="kiosk-clock-seconds">{S}</span>
                </div>
                <div className="kiosk-date">{dateLabel}</div>
              </div>

              <div className="idle-bottom">
                {/* Announcements */}
                <div className="kiosk-panel">
                  <div className="kiosk-panel-header">
                    <div className="kiosk-panel-dot" />
                    Latest announcements
                  </div>
                  {ann ? (
                    <>
                      <div className="kiosk-ann-body" key={annIdx}>
                        <div className="kiosk-ann-title">{ann.title}</div>
                        <div className="kiosk-ann-content">{ann.content}</div>
                      </div>
                      {(display?.announcements.length ?? 0) > 1 && (
                        <div className="kiosk-ann-dots">
                          {display!.announcements.map((_, i) => (
                            <div key={i} className={`kiosk-ann-dot${i === annIdx ? ' active' : ''}`} />
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="kiosk-ann-body" style={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.85rem' }}>
                      No announcements right now.
                    </div>
                  )}
                </div>

                {/* Events */}
                <div className="kiosk-panel">
                  <div className="kiosk-panel-header">
                    <div className="kiosk-panel-dot" style={{ background: '#a5b4fc' }} />
                    Upcoming events
                  </div>
                  {!display?.events.length ? (
                    <div className="kiosk-no-events">No upcoming events.</div>
                  ) : (
                    <div className="kiosk-event-list">
                      {display.events.slice(0, 4).map(ev => (
                        <div key={ev.id} className="kiosk-event-item">
                          <div className="kiosk-event-date-badge">
                            <div className="kiosk-event-date-text">
                              {ev.event_start ? fmtEventDate(ev.event_start) : 'Soon'}
                            </div>
                          </div>
                          <div>
                            <div className="kiosk-event-title">{ev.title}</div>
                            {ev.event_start && (
                              <div className="kiosk-event-time">
                                {new Date(ev.event_start).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true })}
                                {ev.event_end && ` – ${new Date(ev.event_end).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true })}`}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="kiosk-cta-wrap">
                <button className="kiosk-cta" onClick={() => setState('pin')}>
                  Tap to Clock In / Clock Out
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ════ PIN OVERLAY ════ */}
        {state === 'pin' && (
          <div className="pin-overlay" onClick={() => { if (!processing) { setState('idle'); setPin(''); setPinError(false) } }}>
            <div className={`pin-card${shake ? ' shake' : ''}`} onClick={e => e.stopPropagation()}>
              <div className="pin-title">Enter your PIN</div>
              <div className="pin-sub">4-digit personal code</div>

              <div className="pin-dots">
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className={`pin-dot${pin.length > i ? (pinError ? ' error' : ' filled') : ''}`} />
                ))}
              </div>

              {pinError && <div className="pin-error-msg">Incorrect PIN — try again</div>}
              {processing && <div className="pin-processing">Verifying…</div>}

              <div className="pin-grid">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
                  <button key={n} className="pin-key" onClick={() => handlePin(String(n))} disabled={processing}>{n}</button>
                ))}
                <button className="pin-key empty" disabled />
                <button className="pin-key" onClick={() => handlePin('0')} disabled={processing}>0</button>
                <button className="pin-key del" onClick={handleBackspace} disabled={processing}>⌫</button>
              </div>

              <button className="pin-cancel" onClick={() => { setState('idle'); setPin(''); setPinError(false) }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ════ BRIEF ════ */}
        {state === 'brief' && brief && (
          <div className="brief-screen">
            <div className={`brief-banner${brief.action === 'clocked_in' ? ' in' : ' out'}`}>
              <span className="brief-banner-icon">{brief.action === 'clocked_in' ? '✓' : '👋'}</span>
              <span>{brief.action === 'clocked_in' ? 'Clocked in successfully' : 'Clocked out — see you tomorrow!'}</span>
              <span className="brief-banner-time">{fmt12(brief.time)}</span>
            </div>

            <div className="brief-body">
              <div className="brief-left">
                <div>
                  <div className="brief-greeting-name">
                    {brief.action === 'clocked_in' ? 'Good morning' : 'See you'},{' '}
                    {brief.full_name?.split(' ')[0] ?? 'there'}
                  </div>
                  <div className="brief-greeting-sub">{brief.department ?? brief.role}</div>
                </div>

                <div>
                  <div className="brief-section-label">Today's schedule</div>
                  {brief.schedules.length === 0 ? (
                    <div className="brief-schedule-empty">No shifts scheduled for today.</div>
                  ) : brief.schedules.map((s, i) => (
                    <div key={i} className="brief-schedule-item">
                      <div className="brief-schedule-time">{fmtTime(s.start_time)} – {fmtTime(s.end_time)}</div>
                      {s.note && <div className="brief-schedule-note">{s.note}</div>}
                    </div>
                  ))}
                </div>

                {brief.must_read_count > 0 && (
                  <div className="brief-must-read">
                    <span className="brief-must-read-icon">⚠</span>
                    <div>
                      <div className="brief-must-read-title">
                        {brief.must_read_count} must-read {brief.must_read_count === 1 ? 'post' : 'posts'} pending
                      </div>
                      <div className="brief-must-read-sub">Open the dashboard to review and acknowledge</div>
                    </div>
                  </div>
                )}
              </div>

              <div className="brief-right">
                <div className="brief-section-label">Recent updates</div>
                {brief.announcements.length === 0 ? (
                  <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.85rem' }}>Nothing new right now.</div>
                ) : brief.announcements.map((a, i) => (
                  <div key={i} className="brief-ann-item">
                    <div className="brief-ann-title">{a.title}</div>
                    <div className="brief-ann-type">
                      {a.post_type === 'news_event' ? '📅 Event' : a.must_read ? '⚠ Must-read' : '📢 Announcement'}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="brief-footer">
              <div className="brief-progress-wrap">
                <div className="brief-progress-label">Returning to kiosk in {secsLeft}s</div>
                <div className="brief-progress-track">
                  <div className="brief-progress-fill" style={{ width: `${briefPct}%` }} />
                </div>
              </div>
              <button className="brief-done-btn" onClick={returnToIdle}>Done</button>
            </div>
          </div>
        )}

        {/* ════ FLOATING STAFF LOGIN ════ */}
        <button
          className="kiosk-staff-btn"
          onClick={() => navigate('/login')}
        >
          <span className="kiosk-staff-icon">🔐</span>
          Staff login
        </button>

      </div>
    </>
  )
}
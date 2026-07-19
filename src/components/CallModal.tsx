import { useEffect, useRef, useState } from 'react'

type CallPhase = 'ringing' | 'active' | 'ended'

interface Props {
  isOpen: boolean
  roomName: string
  displayName: string
  callType: 'audio' | 'video'
  otherName: string
  isOutgoing: boolean
  remoteStatus?: string | null
  onEnd: () => void
  onAccept: () => void
  onDecline: () => void
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase()
}

export default function CallModal({
  isOpen, roomName, displayName, callType,
  otherName, isOutgoing, remoteStatus, onEnd, onAccept, onDecline
}: Props) {
  const [phase, setPhase] = useState<CallPhase>('ringing')
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Reset phase when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setPhase('ringing')
      setElapsed(0)
      // Play ringtone for incoming
      if (!isOutgoing) {
        try {
          audioRef.current = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAA...')
        } catch {}
      }
    } else {
      clearInterval(timerRef.current!)
      setPhase('ringing')
      setElapsed(0)
      audioRef.current?.pause()
    }
  }, [isOpen, isOutgoing])

  // Timer when active
  useEffect(() => {
    if (phase === 'active') {
      timerRef.current = setInterval(() => setElapsed(t => t + 1), 1000)
    } else {
      clearInterval(timerRef.current!)
    }
    return () => clearInterval(timerRef.current!)
  }, [phase])

  // ── React to the OTHER side's action, delivered via the `remoteStatus` prop ──
  // Without this, a caller's screen has no way to know the callee picked up
  // (or declined) — it just sits on "Calling…" forever. This was the bug.
  useEffect(() => {
    if (!isOpen || !remoteStatus) return
    if (remoteStatus === 'active' && isOutgoing && phase === 'ringing') {
      // The callee accepted on their end — bring the caller into the active call too
      audioRef.current?.pause()
      setPhase('active')
    }
    if ((remoteStatus === 'declined' || remoteStatus === 'missed' || remoteStatus === 'ended') && phase !== 'ended') {
      audioRef.current?.pause()
      setPhase('ended')
      setTimeout(() => onEnd(), 900)
    }
  }, [remoteStatus, isOpen, isOutgoing, phase])

  function handleAccept() {
    audioRef.current?.pause()
    setPhase('active')
    onAccept()
  }

  function handleDecline() {
    audioRef.current?.pause()
    setPhase('ended')
    onDecline()
    setTimeout(() => onEnd(), 600)
  }

  function handleEnd() {
    audioRef.current?.pause()
    setPhase('ended')
    setTimeout(() => onEnd(), 900)
  }

  function fmtTime(s: number) {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }

  const jitsiUrl = [
    `https://meet.jit.si/${encodeURIComponent(roomName)}`,
    `#config.prejoinPageEnabled=false`,
    `&config.startWithVideoMuted=${callType === 'audio'}`,
    `&config.startWithAudioMuted=false`,
    `&config.disableDeepLinking=true`,
    `&config.enableWelcomePage=false`,
    `&config.toolbarButtons=["microphone","camera","hangup","chat","tileview","fullscreen","settings","select-background"]`,
    `&userInfo.displayName=${encodeURIComponent(displayName)}`,
  ].join('')

  if (!isOpen) return null

  return (
    <>
      <style>{`
        @keyframes callFadeIn  { from{opacity:0;backdrop-filter:blur(0px)} to{opacity:1;backdrop-filter:blur(20px)} }
        @keyframes callSlideUp { from{opacity:0;transform:translateY(32px) scale(0.95)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes endFade     { from{opacity:1;transform:scale(1)} to{opacity:0;transform:scale(0.94)} }
        @keyframes ringPulse   { 0%,100%{transform:scale(1);opacity:0.7} 50%{transform:scale(1.12);opacity:1} }
        @keyframes wave        { 0%{transform:translate(-50%,-50%) scale(1);opacity:0.6} 100%{transform:translate(-50%,-50%) scale(2.6);opacity:0} }
        @keyframes wave2       { 0%{transform:translate(-50%,-50%) scale(1);opacity:0.4} 100%{transform:translate(-50%,-50%) scale(2.1);opacity:0} }
        @keyframes wave3       { 0%{transform:translate(-50%,-50%) scale(1);opacity:0.25} 100%{transform:translate(-50%,-50%) scale(1.7);opacity:0} }
        @keyframes acceptPulse { 0%,100%{box-shadow:0 0 0 0 rgba(34,197,94,0.5)} 50%{box-shadow:0 0 0 10px rgba(34,197,94,0)} }
        @keyframes spin        { to{transform:rotate(360deg)} }
        @keyframes callEndDown { from{opacity:1;transform:scale(1)} to{opacity:0;transform:scale(0.9) translateY(12px)} }

        .cm-overlay {
          position:fixed;inset:0;z-index:9000;
          background:rgba(0,0,0,0.88);
          backdrop-filter:blur(20px);
          display:flex;align-items:center;justify-content:center;
          animation:callFadeIn 0.25s ease forwards;
        }
        .cm-overlay.ending { animation:endFade 0.7s ease forwards; }

        /* ─── RINGING CARD ─── */
        .cm-card {
          width:340px;
          background:linear-gradient(160deg,#0c1825 0%,#1a2d42 55%,#243f60 100%);
          border-radius:28px;
          border:1px solid rgba(255,255,255,0.07);
          box-shadow:0 40px 100px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06);
          padding:2.5rem 2rem 2.25rem;
          display:flex;flex-direction:column;align-items:center;
          text-align:center;
          animation:callSlideUp 0.35s cubic-bezier(0.34,1.1,0.64,1) forwards;
          position:relative;overflow:hidden;
        }
        .cm-card::before {
          content:'';position:absolute;top:0;left:0;right:0;bottom:0;
          background:radial-gradient(ellipse 80% 60% at 50% 0%,rgba(75,172,198,0.1),transparent 70%);
          pointer-events:none;
        }

        .cm-status {
          font-size:0.7rem;font-weight:700;
          color:rgba(255,255,255,0.35);
          text-transform:uppercase;letter-spacing:0.2em;
          margin-bottom:2rem;
        }
        .cm-status.incoming { color:rgba(34,197,94,0.7); }

        /* Avatar with wave rings */
        .cm-avatar-section { position:relative;width:100px;height:100px;margin-bottom:1.5rem; }
        .cm-wave {
          position:absolute;top:50%;left:50%;
          width:100px;height:100px;border-radius:50%;
          border:2px solid rgba(75,172,198,0.3);
          animation:wave 2.4s ease-out infinite;
        }
        .cm-wave:nth-child(2) { animation:wave2 2.4s ease-out 0.8s infinite;border-color:rgba(75,172,198,0.2); }
        .cm-wave:nth-child(3) { animation:wave3 2.4s ease-out 1.6s infinite;border-color:rgba(75,172,198,0.12); }
        .cm-avatar {
          position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
          width:84px;height:84px;border-radius:50%;
          background:linear-gradient(135deg,#4bacc6 0%,#243f60 100%);
          display:flex;align-items:center;justify-content:center;
          font-size:1.85rem;font-weight:900;color:white;
          border:3px solid rgba(255,255,255,0.12);
          box-shadow:0 8px 32px rgba(0,0,0,0.4);
          animation:ringPulse 2s ease-in-out infinite;
          z-index:2;
        }

        .cm-name { font-size:1.6rem;font-weight:900;color:white;letter-spacing:-0.025em;margin-bottom:0.4rem; }
        .cm-type-row {
          display:flex;align-items:center;gap:0.4rem;
          font-size:0.8rem;color:rgba(255,255,255,0.35);
          margin-bottom:2.25rem;
        }

        /* Buttons */
        .cm-actions { display:flex;align-items:center;gap:2.5rem;justify-content:center;width:100%; }
        .cm-btn-wrap { display:flex;flex-direction:column;align-items:center;gap:0.55rem; }
        .cm-btn {
          width:68px;height:68px;border-radius:50%;border:none;
          display:flex;align-items:center;justify-content:center;
          font-size:1.55rem;cursor:pointer;
          transition:all 0.18s;box-shadow:0 4px 20px rgba(0,0,0,0.3);
          position:relative;
        }
        .cm-btn:hover { transform:scale(1.08); }
        .cm-btn:active { transform:scale(0.96); }
        .cm-btn-label {
          font-size:0.7rem;font-weight:700;
          color:rgba(255,255,255,0.4);letter-spacing:0.05em;
        }
        .cm-btn.decline { background:linear-gradient(135deg,#c0504d,#a33a37); }
        .cm-btn.decline:hover { background:linear-gradient(135deg,#d85c59,#c0504d);box-shadow:0 6px 24px rgba(192,80,77,0.45); }
        .cm-btn.accept {
          background:linear-gradient(135deg,#22c55e,#16a34a);
          animation:acceptPulse 2s ease-in-out infinite;
        }
        .cm-btn.accept:hover { background:linear-gradient(135deg,#2dd472,#22c55e);box-shadow:0 6px 24px rgba(34,197,94,0.45); }
        .cm-btn.cancel { background:rgba(255,255,255,0.1);border:1.5px solid rgba(255,255,255,0.15); }
        .cm-btn.cancel:hover { background:rgba(192,80,77,0.3);border-color:rgba(192,80,77,0.5); }
        .cm-btn.end { background:linear-gradient(135deg,#c0504d,#a33a37); }
        .cm-btn.end:hover { background:linear-gradient(135deg,#d85c59,#c0504d); }

        /* ─── ACTIVE CALL ─── */
        .cm-active {
          width:92vw;max-width:1280px;height:88vh;
          background:#060e1a;border-radius:20px;
          overflow:hidden;display:flex;flex-direction:column;
          box-shadow:0 40px 100px rgba(0,0,0,0.8);
          border:1px solid rgba(255,255,255,0.06);
          animation:callSlideUp 0.3s ease forwards;
        }
        .cm-active-bar {
          display:flex;align-items:center;justify-content:space-between;
          padding:0.85rem 1.5rem;
          background:rgba(0,0,0,0.6);
          border-bottom:1px solid rgba(255,255,255,0.06);
          flex-shrink:0;
        }
        .cm-active-left { display:flex;align-items:center;gap:0.85rem; }
        .cm-active-dot { width:9px;height:9px;border-radius:50%;background:#22c55e;animation:ringPulse 2s ease-in-out infinite; }
        .cm-active-name { font-size:0.95rem;font-weight:800;color:white; }
        .cm-active-type { font-size:0.72rem;color:rgba(255,255,255,0.35);margin-top:0.1rem;display:flex;align-items:center;gap:0.3rem; }
        .cm-active-timer { font-size:1rem;font-weight:700;color:rgba(255,255,255,0.5);font-variant-numeric:tabular-nums;font-family:'JetBrains Mono','Courier New',monospace; }
        .cm-iframe { flex:1;border:none;width:100%;display:block;background:#060e1a; }
        .cm-end-bar {
          display:flex;align-items:center;justify-content:center;
          padding:0.85rem;background:rgba(0,0,0,0.75);
          border-top:1px solid rgba(255,255,255,0.06);flex-shrink:0;
        }
        .cm-end-full {
          display:flex;align-items:center;gap:0.55rem;
          padding:0.65rem 2rem;background:linear-gradient(135deg,#c0504d,#a33a37);
          color:white;border:none;border-radius:999px;
          font-size:0.9rem;font-weight:800;cursor:pointer;font-family:inherit;
          transition:all 0.15s;box-shadow:0 4px 20px rgba(192,80,77,0.35);
        }
        .cm-end-full:hover { background:linear-gradient(135deg,#d85c59,#c0504d);transform:scale(1.04); }

        /* ─── ENDED ─── */
        .cm-ended {
          background:linear-gradient(160deg,#0c1825,#1a2d42);
          border-radius:28px;border:1px solid rgba(255,255,255,0.07);
          padding:2.5rem 2rem;display:flex;flex-direction:column;
          align-items:center;gap:0.65rem;text-align:center;
          animation:callSlideUp 0.25s ease forwards;min-width:280px;
        }
        .cm-ended-icon { font-size:2.5rem;margin-bottom:0.25rem; }
        .cm-ended-title { font-size:1.2rem;font-weight:800;color:white; }
        .cm-ended-sub { font-size:0.82rem;color:rgba(255,255,255,0.35); }
      `}</style>

      <div className={`cm-overlay${phase === 'ended' ? ' ending' : ''}`}>

        {/* ── RINGING ── */}
        {phase === 'ringing' && (
          <div className="cm-card">
            <div className={`cm-status${!isOutgoing ? ' incoming' : ''}`}>
              {isOutgoing ? 'Calling…' : `Incoming ${callType} call`}
            </div>

            <div className="cm-avatar-section">
              {!isOutgoing && (
                <>
                  <div className="cm-wave" />
                  <div className="cm-wave" />
                  <div className="cm-wave" />
                </>
              )}
              <div className="cm-avatar">{initials(otherName)}</div>
            </div>

            <div className="cm-name">{otherName}</div>
            <div className="cm-type-row">
              <span>{callType === 'video' ? '📹' : '📞'}</span>
              <span>InfoWall {callType === 'video' ? 'Video' : 'Voice'} Call</span>
            </div>

            <div className="cm-actions">
              {/* Decline / Cancel */}
              <div className="cm-btn-wrap">
                <button
                  className={`cm-btn ${isOutgoing ? 'cancel' : 'decline'}`}
                  onClick={isOutgoing ? handleEnd : handleDecline}
                >
                  📵
                </button>
                <span className="cm-btn-label">{isOutgoing ? 'Cancel' : 'Decline'}</span>
              </div>

              {/* Accept (incoming only) */}
              {!isOutgoing && (
                <div className="cm-btn-wrap">
                  <button className="cm-btn accept" onClick={handleAccept}>
                    {callType === 'video' ? '📹' : '📞'}
                  </button>
                  <span className="cm-btn-label">Accept</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── ACTIVE ── */}
        {phase === 'active' && (
          <div className="cm-active">
            <div className="cm-active-bar">
              <div className="cm-active-left">
                <div className="cm-active-dot" />
                <div>
                  <div className="cm-active-name">{otherName}</div>
                  <div className="cm-active-type">
                    <span>{callType === 'video' ? '📹' : '📞'}</span>
                    {callType === 'video' ? 'Video call' : 'Voice call'} · InfoWall
                  </div>
                </div>
              </div>
              <div className="cm-active-timer">{fmtTime(elapsed)}</div>
            </div>

            <iframe
              className="cm-iframe"
              src={jitsiUrl}
              allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write"
              title="InfoWall Call"
            />

            <div className="cm-end-bar">
              <button className="cm-end-full" onClick={handleEnd}>
                📵 End Call &nbsp;·&nbsp; {fmtTime(elapsed)}
              </button>
            </div>
          </div>
        )}

        {/* ── ENDED ── */}
        {phase === 'ended' && (
          <div className="cm-ended">
            <div className="cm-ended-icon">📵</div>
            <div className="cm-ended-title">Call ended</div>
            <div className="cm-ended-sub">
              {elapsed > 0 ? `Duration ${fmtTime(elapsed)}` : 'Call not connected'} · {otherName}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

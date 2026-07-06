import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { generateSummary } from '../lib/summarize'

interface HighlightPost {
  title: string
  content: string | null
}

const REDIRECT_MS = 8000

function WelcomePage() {
  const [fullName, setFullName] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [mustReadCount, setMustReadCount] = useState(0)
  const [eventCount, setEventCount] = useState(0)
  const [feedCount, setFeedCount] = useState(0)
  const [highlight, setHighlight] = useState<HighlightPost | null>(null)
  const [dataReady, setDataReady] = useState(false)
  const [progress, setProgress] = useState(0)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { navigate('/login'); return }

      const [
        { data: profile },
        { count: mustReadTotal },
        { count: eventTotal },
        { count: feedTotal },
        { data: latest },
      ] = await Promise.all([
        supabase.from('profiles').select('full_name, role').eq('id', user.id).single(),
        supabase.from('posts').select('id', { count: 'exact', head: true }).eq('must_read', true),
        supabase.from('posts').select('id', { count: 'exact', head: true }).eq('post_type', 'news_event'),
        supabase.from('feed_posts').select('id', { count: 'exact', head: true }),
        supabase.from('posts').select('title, content').eq('must_read', true)
          .order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ])

      if (cancelled) return

      setFullName(profile?.full_name ?? null)
      setRole(profile?.role ?? null)
      setMustReadCount(mustReadTotal ?? 0)
      setEventCount(eventTotal ?? 0)
      setFeedCount(feedTotal ?? 0)
      if (latest) setHighlight({ title: latest.title, content: latest.content })

      // Small delay so the entrance animation always has data to animate in with —
      // this is the "sync" fix: previously the timer could fire before data resolved.
      setDataReady(true)
    }

    load()
    return () => { cancelled = true }
  }, [navigate])

  // Only start the redirect countdown once data has actually loaded
  useEffect(() => {
    if (!dataReady) return

    const start = Date.now()
    const tick = setInterval(() => {
      const elapsed = Date.now() - start
      const pct = Math.min(100, (elapsed / REDIRECT_MS) * 100)
      setProgress(pct)
      if (pct >= 100) {
        clearInterval(tick)
        navigate('/dashboard')
      }
    }, 30)

    return () => clearInterval(tick)
  }, [dataReady, navigate])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const firstName = fullName?.split(' ')[0] ?? 'there'
  const highlightSummary = highlight ? generateSummary(highlight.content) : ''

  return (
    <>
      <style>{`
        @keyframes floatUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.85); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes drift {
          0%   { transform: translate(0, 0) scale(1); }
          50%  { transform: translate(20px, -30px) scale(1.08); }
          100% { transform: translate(0, 0) scale(1); }
        }
        @keyframes drift2 {
          0%   { transform: translate(0, 0) scale(1); }
          50%  { transform: translate(-25px, 20px) scale(1.05); }
          100% { transform: translate(0, 0) scale(1); }
        }
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes ringPulse {
          0%   { transform: scale(0.9); opacity: 0.8; }
          70%  { transform: scale(1.6); opacity: 0; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes checkDraw {
          from { stroke-dashoffset: 24; }
          to   { stroke-dashoffset: 0; }
        }

        .welcome-screen {
          min-height: 100vh;
          display: flex; align-items: center; justify-content: center;
          background: linear-gradient(135deg, #0d2d3a 0%, #0a4d52 45%, #00b8b8 100%);
          background-size: 200% 200%;
          color: white;
          padding: 2rem;
          position: relative;
          overflow: hidden;
        }

        /* Ambient floating blobs */
        .blob {
          position: absolute;
          border-radius: 50%;
          filter: blur(60px);
          opacity: 0.35;
          pointer-events: none;
        }
        .blob-1 {
          width: 380px; height: 380px;
          background: #00e5e5;
          top: -120px; left: -100px;
          animation: drift 14s ease-in-out infinite;
        }
        .blob-2 {
          width: 320px; height: 320px;
          background: #0d2d3a;
          bottom: -100px; right: -80px;
          animation: drift2 16s ease-in-out infinite;
        }
        .blob-3 {
          width: 220px; height: 220px;
          background: #00fff0;
          top: 40%; right: 8%;
          opacity: 0.18;
          animation: drift 11s ease-in-out infinite reverse;
        }

        .welcome-card {
          position: relative;
          z-index: 2;
          text-align: center;
          max-width: 520px;
          width: 100%;
        }

        /* Avatar ring */
        .avatar-stage {
          position: relative;
          width: 90px; height: 90px;
          margin: 0 auto 1.5rem;
          display: flex; align-items: center; justify-content: center;
          opacity: 0;
          animation: scaleIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s forwards;
        }

        .avatar-ring {
          position: absolute; inset: 0;
          border-radius: 50%;
          border: 2px solid rgba(255,255,255,0.5);
          animation: ringPulse 2.2s ease-out infinite;
        }
        .avatar-ring.delay { animation-delay: 1.1s; }

        .avatar-circle {
          width: 72px; height: 72px;
          border-radius: 50%;
          background: rgba(255,255,255,0.15);
          backdrop-filter: blur(8px);
          border: 1.5px solid rgba(255,255,255,0.4);
          display: flex; align-items: center; justify-content: center;
          font-size: 1.6rem; font-weight: 800;
          position: relative; z-index: 1;
        }

        .welcome-greeting {
          font-size: 1.05rem;
          font-weight: 500;
          opacity: 0;
          color: rgba(255,255,255,0.75);
          margin: 0 0 0.4rem;
          animation: floatUp 0.6s ease 0.25s forwards;
        }

        .welcome-name {
          font-size: clamp(2.2rem, 6vw, 3.1rem);
          font-weight: 800;
          margin: 0;
          letter-spacing: -0.03em;
          opacity: 0;
          animation: floatUp 0.65s ease 0.4s forwards;
        }

        .welcome-role-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          margin-top: 0.85rem;
          padding: 0.3rem 0.9rem;
          background: rgba(255,255,255,0.12);
          border: 1px solid rgba(255,255,255,0.25);
          border-radius: 999px;
          font-size: 0.78rem;
          font-weight: 600;
          text-transform: capitalize;
          opacity: 0;
          animation: floatUp 0.6s ease 0.55s forwards;
        }

        .welcome-stats {
          display: flex;
          gap: 0.85rem;
          justify-content: center;
          margin-top: 2.1rem;
          opacity: 0;
          animation: floatUp 0.65s ease 0.75s forwards;
        }

        .stat-card {
          background: rgba(255,255,255,0.1);
          backdrop-filter: blur(6px);
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 16px;
          padding: 1rem 1.3rem;
          min-width: 100px;
          transition: transform 0.2s, background 0.2s;
        }
        .stat-card:hover {
          background: rgba(255,255,255,0.16);
          transform: translateY(-2px);
        }

        .stat-value {
          font-size: 1.7rem;
          font-weight: 800;
          margin: 0;
          line-height: 1;
        }

        .stat-label {
          font-size: 0.74rem;
          opacity: 0.75;
          margin: 0.35rem 0 0;
          font-weight: 500;
        }

        .welcome-highlight {
          margin-top: 1.6rem;
          background: rgba(255,255,255,0.1);
          backdrop-filter: blur(6px);
          border: 1px solid rgba(255,255,255,0.18);
          border-radius: 14px;
          padding: 1.1rem 1.3rem;
          text-align: left;
          opacity: 0;
          animation: floatUp 0.65s ease 0.95s forwards;
        }

        .welcome-highlight-label {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.74rem;
          font-weight: 700;
          opacity: 0.85;
          margin: 0 0 0.5rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .ai-sparkle {
          display: inline-block;
          background: linear-gradient(90deg, #fff 0%, #00fff0 50%, #fff 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: shimmer 2.5s linear infinite;
        }

        .welcome-highlight-title {
          font-weight: 700;
          margin: 0 0 0.3rem;
          font-size: 0.96rem;
        }

        .welcome-highlight-summary {
          font-size: 0.86rem;
          opacity: 0.85;
          margin: 0;
          line-height: 1.55;
        }

        .welcome-footer {
          margin-top: 1.8rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.85rem;
          opacity: 0;
          animation: fadeIn 0.6s ease 1.2s forwards;
        }

        .welcome-sub {
          font-size: 0.86rem;
          opacity: 0.7;
          margin: 0;
        }

        .progress-track {
          width: 180px;
          height: 3px;
          background: rgba(255,255,255,0.2);
          border-radius: 999px;
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #00e5e5, #fff);
          border-radius: 999px;
          transition: width 0.03s linear;
        }

        .welcome-skip-button {
          padding: 0.6rem 1.5rem;
          background: rgba(255,255,255,0.14);
          color: white;
          border: 1px solid rgba(255,255,255,0.3);
          border-radius: 9px;
          font-size: 0.86rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.18s;
        }
        .welcome-skip-button:hover {
          background: rgba(255,255,255,0.24);
          transform: translateY(-1px);
        }

        @media (prefers-reduced-motion: reduce) {
          .welcome-greeting, .welcome-name, .welcome-role-pill,
          .welcome-stats, .welcome-highlight, .welcome-footer,
          .avatar-stage, .blob, .avatar-ring, .ai-sparkle {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
          }
        }

        @media (max-width: 480px) {
          .welcome-stats { flex-wrap: wrap; }
          .stat-card { min-width: 88px; padding: 0.85rem 1rem; }
        }
      `}</style>

      <div className="welcome-screen">
        <div className="blob blob-1" />
        <div className="blob blob-2" />
        <div className="blob blob-3" />

        <div className="welcome-card">

          <div className="avatar-stage">
            <div className="avatar-ring" />
            <div className="avatar-ring delay" />
            <div className="avatar-circle">
              {firstName.charAt(0).toUpperCase()}
            </div>
          </div>

          <p className="welcome-greeting">{greeting},</p>
          <h1 className="welcome-name">{firstName}</h1>

          {role && (
            <div className="welcome-role-pill">
              <span>👋</span> Signed in as {role}
            </div>
          )}

          <div className="welcome-stats">
            <div className="stat-card">
              <p className="stat-value">{mustReadCount}</p>
              <p className="stat-label">Must-read</p>
            </div>
            <div className="stat-card">
              <p className="stat-value">{eventCount}</p>
              <p className="stat-label">Events</p>
            </div>
            <div className="stat-card">
              <p className="stat-value">{feedCount}</p>
              <p className="stat-label">Feed posts</p>
            </div>
          </div>

          {highlight && (
            <div className="welcome-highlight">
              <p className="welcome-highlight-label">
                <span className="ai-sparkle">✦ AI Summary</span>
              </p>
              <p className="welcome-highlight-title">{highlight.title}</p>
              <p className="welcome-highlight-summary">{highlightSummary}</p>
            </div>
          )}

          <div className="welcome-footer">
            <p className="welcome-sub">Taking you to your dashboard…</p>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <button onClick={() => navigate('/dashboard')} className="welcome-skip-button">
              Skip to dashboard →
            </button>
          </div>

        </div>
      </div>
    </>
  )
}

export default WelcomePage
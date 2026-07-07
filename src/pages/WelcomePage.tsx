import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { generateSummary } from '../lib/summarize'

interface Profile {
  id: string; full_name: string | null; role: string; department_id: string | null
}
interface RecentPost {
  id: string; title: string; content: string | null; must_read: boolean; post_type: string
}

const WELCOME_DURATION = 8000

function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function getRoleLabel(role: string): string {
  const map: Record<string, string> = {
    admin: 'Administrator', hr: 'HR Staff', manager: 'Team Manager', employee: 'Team Member'
  }
  return map[role] ?? role
}

export default function WelcomePage() {
  const navigate = useNavigate()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [recentPost, setRecentPost] = useState<RecentPost | null>(null)
  const [stats, setStats] = useState({ posts: 0, users: 0, mustRead: 0 })
  const [progress, setProgress] = useState(0)
  const [ready, setReady] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startRef = useRef(Date.now())

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { navigate('/login'); return }

      const [{ data: p }, { data: pp }, { data: ps }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('posts').select('id,title,content,must_read,post_type').order('created_at', { ascending: false }).limit(1),
        supabase.from('profiles').select('id', { count: 'exact', head: false }),
      ])

      const { count: postCount } = await supabase.from('posts').select('id', { count: 'exact', head: true })
      const { count: mustReadCount } = await supabase.from('acknowledgements').select('id', { count: 'exact', head: true }).eq('user_id', user.id)

      setProfile(p)
      setRecentPost(pp?.[0] ?? null)
      setStats({ posts: postCount ?? 0, users: ps?.length ?? 0, mustRead: mustReadCount ?? 0 })

      setTimeout(() => setReady(true), 120)
    }
    load()

    startRef.current = Date.now()
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startRef.current
      const pct = Math.min(100, (elapsed / WELCOME_DURATION) * 100)
      setProgress(pct)
      if (pct >= 100) {
        clearInterval(timerRef.current!)
        navigate('/dashboard')
      }
    }, 40)

    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [navigate])

  const greeting = getGreeting()
  const firstName = profile?.full_name?.split(' ')[0] ?? 'there'
  const summary = generateSummary(recentPost?.content)
  const secsLeft = Math.ceil(((100 - progress) / 100) * (WELCOME_DURATION / 1000))

  return (
    <>
      <style>{`
        @keyframes wFadeIn   { from{opacity:0} to{opacity:1} }
        @keyframes wSlideUp  { from{opacity:0;transform:translateY(28px)} to{opacity:1;transform:translateY(0)} }
        @keyframes wSlideRight { from{opacity:0;transform:translateX(-20px)} to{opacity:1;transform:translateX(0)} }
        @keyframes wOrb1     { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(60px,-80px) scale(1.15)} }
        @keyframes wOrb2     { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(-50px,60px) scale(0.9)} }
        @keyframes wOrb3     { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(40px,50px) scale(1.08)} }
        @keyframes wGrid     { 0%{background-position:0 0} 100%{background-position:56px 56px} }
        @keyframes wPulse    { 0%,100%{opacity:1} 50%{opacity:0.45} }
        @keyframes wBounce   { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
        @keyframes wCountIn  { from{opacity:0;transform:translateY(10px) scale(0.85)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes wSpin     { to{transform:rotate(360deg)} }
        @keyframes wShimmer  { 0%{background-position:-300px 0} 100%{background-position:300px 0} }

        .wp {
          min-height: 100vh; width: 100%;
          background: #0c1829;
          font-family: 'Nunito', 'Segoe UI', system-ui, sans-serif;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          position: relative; overflow: hidden;
          padding: 2rem 1.5rem;
        }

        /* Background layers */
        .wp-bg { position: absolute; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }

        .wp-grid {
          position: absolute; inset: 0;
          background-image:
            linear-gradient(rgba(75,172,198,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(75,172,198,0.04) 1px, transparent 1px);
          background-size: 56px 56px;
          animation: wGrid 10s linear infinite;
        }

        .wp-orb {
          position: absolute; border-radius: 50%;
          filter: blur(90px); pointer-events: none;
        }
        .wp-orb-1 {
          width: 600px; height: 600px; top: -200px; left: -150px;
          background: radial-gradient(circle, rgba(54,95,145,0.35), transparent 70%);
          animation: wOrb1 20s ease-in-out infinite;
        }
        .wp-orb-2 {
          width: 500px; height: 500px; bottom: -150px; right: -100px;
          background: radial-gradient(circle, rgba(75,172,198,0.2), transparent 70%);
          animation: wOrb2 26s ease-in-out infinite;
        }
        .wp-orb-3 {
          width: 350px; height: 350px; top: 40%; left: 45%;
          background: radial-gradient(circle, rgba(36,63,96,0.3), transparent 70%);
          animation: wOrb3 16s ease-in-out infinite;
        }

        /* Radial vignette */
        .wp-vignette {
          position: absolute; inset: 0;
          background: radial-gradient(ellipse at center, transparent 40%, rgba(8,14,26,0.6) 100%);
        }

        /* Content */
        .wp-content {
          position: relative; z-index: 10;
          width: 100%; max-width: 760px;
          display: flex; flex-direction: column;
          align-items: center; gap: 2rem;
          opacity: 0;
          transition: opacity 0.5s ease;
        }
        .wp-content.ready { opacity: 1; }

        /* Brand pill */
        .wp-brand-pill {
          display: inline-flex; align-items: center; gap: 0.55rem;
          background: rgba(75,172,198,0.1); border: 1px solid rgba(75,172,198,0.2);
          border-radius: 999px; padding: 0.38rem 1rem;
          animation: wSlideDown 0.5s ease 0.1s both;
        }
        @keyframes wSlideDown { from{opacity:0;transform:translateY(-12px)} to{opacity:1;transform:translateY(0)} }
        .wp-brand-dot { width: 7px; height: 7px; border-radius: 50%; background: #4BACC6; animation: wPulse 2s ease-in-out infinite; }
        .wp-brand-label { font-size: 0.72rem; font-weight: 800; color: rgba(75,172,198,0.8); letter-spacing: 0.14em; text-transform: uppercase; }

        /* Greeting */
        .wp-greeting-wrap { text-align: center; animation: wSlideUp 0.55s ease 0.2s both; }
        .wp-greeting-line {
          font-size: clamp(2.2rem, 6vw, 4rem);
          font-weight: 800; line-height: 1.1;
          letter-spacing: -0.03em; color: white;
          margin-bottom: 0.65rem;
        }
        .wp-greeting-name { color: #4BACC6; }
        .wp-greeting-sub { font-size: 1rem; color: rgba(255,255,255,0.4); font-weight: 500; }

        /* Role chip */
        .wp-role-chip {
          display: inline-flex; align-items: center; gap: 0.4rem;
          background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
          border-radius: 999px; padding: 0.38rem 1rem;
          font-size: 0.8rem; font-weight: 700; color: rgba(255,255,255,0.65);
          letter-spacing: 0.02em;
          animation: wSlideUp 0.5s ease 0.35s both;
        }
        .wp-role-dot { width: 7px; height: 7px; border-radius: 50%; }

        /* Stats row */
        .wp-stats {
          display: flex; gap: 1px;
          background: rgba(255,255,255,0.07);
          border-radius: 16px; overflow: hidden;
          border: 1px solid rgba(255,255,255,0.07);
          width: 100%; max-width: 520px;
          animation: wSlideUp 0.5s ease 0.45s both;
        }
        .wp-stat {
          flex: 1; padding: 1.1rem 0.75rem; text-align: center;
          background: rgba(255,255,255,0.03);
          transition: background 0.15s;
        }
        .wp-stat:hover { background: rgba(75,172,198,0.08); }
        .wp-stat-val {
          display: block; font-size: 1.75rem; font-weight: 800;
          color: white; line-height: 1; margin-bottom: 0.3rem;
          letter-spacing: -0.02em;
          animation: wCountIn 0.5s cubic-bezier(0.34,1.56,0.64,1) both;
        }
        .wp-stat-val:nth-child(1) { animation-delay: 0.5s; }
        .wp-stat-label { font-size: 0.68rem; font-weight: 700; color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: 0.07em; }

        /* Latest post card */
        .wp-post-card {
          width: 100%; max-width: 560px;
          background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.09);
          border-radius: 16px; padding: 1.25rem 1.4rem;
          animation: wSlideUp 0.5s ease 0.55s both;
          backdrop-filter: blur(8px);
        }
        .wp-post-card-header { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.85rem; }
        .wp-post-card-icon { width: 28px; height: 28px; border-radius: 8px; background: rgba(75,172,198,0.15); display: flex; align-items: center; justify-content: center; font-size: 0.82rem; flex-shrink: 0; border: 1px solid rgba(75,172,198,0.2); }
        .wp-post-card-label { font-size: 0.65rem; font-weight: 800; color: rgba(75,172,198,0.7); text-transform: uppercase; letter-spacing: 0.12em; }
        .wp-post-title { font-size: 0.95rem; font-weight: 700; color: white; margin-bottom: 0.5rem; line-height: 1.3; }
        .wp-ai-row { display: flex; align-items: flex-start; gap: 0.45rem; }
        .wp-ai-icon { color: #4BACC6; font-size: 0.8rem; flex-shrink: 0; margin-top: 0.15rem; }
        .wp-ai-label { font-size: 0.65rem; font-weight: 800; color: #4BACC6; text-transform: uppercase; letter-spacing: 0.1em; margin-right: 0.3rem; }
        .wp-ai-text { font-size: 0.82rem; color: rgba(255,255,255,0.5); line-height: 1.6; }
        .wp-post-must { display: inline-flex; align-items: center; gap: 0.3rem; background: rgba(192,80,77,0.12); border: 1px solid rgba(192,80,77,0.25); border-radius: 999px; padding: 0.18rem 0.6rem; font-size: 0.65rem; font-weight: 800; color: #fca5a5; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 0.65rem; }

        /* Progress bar */
        .wp-progress-section {
          width: 100%; max-width: 480px; text-align: center;
          animation: wSlideUp 0.5s ease 0.65s both;
        }
        .wp-progress-label {
          font-size: 0.78rem; color: rgba(255,255,255,0.3); font-weight: 600;
          margin-bottom: 0.65rem; display: flex; align-items: center; justify-content: center; gap: 0.5rem;
        }
        .wp-progress-secs { color: #4BACC6; font-weight: 800; font-variant-numeric: tabular-nums; }
        .wp-progress-track {
          height: 3px; background: rgba(255,255,255,0.08);
          border-radius: 999px; overflow: hidden; margin-bottom: 1.1rem;
        }
        .wp-progress-fill {
          height: 100%; border-radius: 999px;
          background: linear-gradient(90deg, #4BACC6, #4F81BD, #365F91);
          transition: width 0.06s linear;
        }

        /* CTA button */
        .wp-cta {
          display: inline-flex; align-items: center; gap: 0.6rem;
          padding: 0.85rem 2.25rem;
          background: linear-gradient(135deg, #4BACC6, #365F91);
          color: white; border: none; border-radius: 12px;
          font-size: 0.92rem; font-weight: 700; cursor: pointer;
          font-family: inherit; letter-spacing: 0.02em;
          box-shadow: 0 6px 24px rgba(75,172,198,0.3), 0 0 0 1px rgba(75,172,198,0.1);
          transition: all 0.18s;
          animation: wBounce 3s ease-in-out infinite;
        }
        .wp-cta:hover {
          filter: brightness(1.12);
          box-shadow: 0 10px 32px rgba(75,172,198,0.45);
          animation: none; transform: translateY(-2px);
        }
        .wp-cta:active { transform: scale(0.97); animation: none; }

        /* Corner decorations */
        .wp-corner { position: absolute; pointer-events: none; z-index: 1; }
        .wp-corner-tl { top: 20px; left: 20px; width: 60px; height: 60px; border-top: 1.5px solid rgba(75,172,198,0.2); border-left: 1.5px solid rgba(75,172,198,0.2); border-radius: 6px 0 0 0; }
        .wp-corner-tr { top: 20px; right: 20px; width: 60px; height: 60px; border-top: 1.5px solid rgba(75,172,198,0.2); border-right: 1.5px solid rgba(75,172,198,0.2); border-radius: 0 6px 0 0; }
        .wp-corner-bl { bottom: 20px; left: 20px; width: 60px; height: 60px; border-bottom: 1.5px solid rgba(75,172,198,0.2); border-left: 1.5px solid rgba(75,172,198,0.2); border-radius: 0 0 0 6px; }
        .wp-corner-br { bottom: 20px; right: 20px; width: 60px; height: 60px; border-bottom: 1.5px solid rgba(75,172,198,0.2); border-right: 1.5px solid rgba(75,172,198,0.2); border-radius: 0 0 6px 0; }

        @media(max-width:600px) {
          .wp-stats { max-width:100%; }
          .wp-post-card { max-width:100%; }
          .wp-progress-section { max-width:100%; }
          .wp-greeting-line { font-size:clamp(1.8rem,8vw,2.6rem); }
        }
      `}</style>

      <div className="wp">
        {/* Background */}
        <div className="wp-bg">
          <div className="wp-grid" />
          <div className="wp-orb wp-orb-1" />
          <div className="wp-orb wp-orb-2" />
          <div className="wp-orb wp-orb-3" />
          <div className="wp-vignette" />
        </div>

        {/* Corner decorations */}
        <div className="wp-corner wp-corner-tl" />
        <div className="wp-corner wp-corner-tr" />
        <div className="wp-corner wp-corner-bl" />
        <div className="wp-corner wp-corner-br" />

        <div className={`wp-content${ready ? ' ready' : ''}`}>

          {/* Brand pill */}
          <div className="wp-brand-pill">
            <div className="wp-brand-dot" />
            <span className="wp-brand-label">InfoWall Enterprise</span>
          </div>

          {/* Greeting */}
          <div className="wp-greeting-wrap">
            <h1 className="wp-greeting-line">
              {greeting},<br />
              <span className="wp-greeting-name">{firstName}</span>
            </h1>
            <p className="wp-greeting-sub">Welcome back to your workspace</p>
          </div>

          {/* Role chip */}
          {profile && (
            <div className="wp-role-chip">
              <div className="wp-role-dot" style={{
                background: profile.role === 'admin' ? '#fca5a5' : profile.role === 'hr' ? '#c4b5fd' : profile.role === 'manager' ? '#93c5fd' : '#86efac'
              }} />
              {getRoleLabel(profile.role)}
            </div>
          )}

          {/* Stats */}
          <div className="wp-stats">
            {[
              { val: stats.posts,    label: 'Posts',         icon: '📢', delay: '0.5s' },
              { val: stats.users,    label: 'Team members',  icon: '👥', delay: '0.58s' },
              { val: stats.mustRead, label: 'Read by you',   icon: '✓',  delay: '0.66s' },
            ].map((s, i) => (
              <div key={i} className="wp-stat">
                <span className="wp-stat-val" style={{ animationDelay: s.delay }}>{s.val.toLocaleString()}</span>
                <span className="wp-stat-label">{s.label}</span>
              </div>
            ))}
          </div>

          {/* Latest post */}
          {recentPost && (
            <div className="wp-post-card">
              <div className="wp-post-card-header">
                <div className="wp-post-card-icon">{recentPost.post_type === 'news_event' ? '📅' : '📢'}</div>
                <span className="wp-post-card-label">Latest announcement</span>
              </div>
              {recentPost.must_read && (
                <div className="wp-post-must">⚠ Must-read</div>
              )}
              <div className="wp-post-title">{recentPost.title}</div>
              {summary && (
                <div className="wp-ai-row">
                  <span className="wp-ai-icon">✦</span>
                  <div>
                    <span className="wp-ai-label">AI Summary</span>
                    <span className="wp-ai-text">{summary}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Progress + CTA */}
          <div className="wp-progress-section">
            <div className="wp-progress-label">
              Heading to your dashboard in <span className="wp-progress-secs">{secsLeft}s</span>
            </div>
            <div className="wp-progress-track">
              <div className="wp-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <button className="wp-cta" onClick={() => navigate('/dashboard')}>
              Go to dashboard →
            </button>
          </div>

        </div>
      </div>
    </>
  )
}
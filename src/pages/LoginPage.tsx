import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password })

    if (signInError) {
      setError(signInError.message)
      setLoading(false)
      return
    }

    if (data.user) {
      await supabase.from('attendance').insert({ user_id: data.user.id })
    }

    setLoading(false)
    navigate('/welcome')
  }

  return (
    <>
      <style>{`
        .login-page {
          min-height:100vh; display:flex;
          font-family:'Nunito','Segoe UI',system-ui,sans-serif;
        }

        .login-hero {
          flex:1; display:flex; flex-direction:column;
          align-items:flex-start; justify-content:center;
          padding:3rem 4rem;
          background:linear-gradient(135deg,#1A2B3C 0%,#243F60 50%,#365F91 100%);
          position:relative; overflow:hidden;
        }

        .login-hero-bg { position:absolute;inset:0;pointer-events:none;overflow:hidden; }
        .login-hero-orb { position:absolute;border-radius:50%;filter:blur(80px);opacity:0.2; }
        .login-hero-orb-1 { width:400px;height:400px;background:#4BACC6;top:-150px;right:-100px; }
        .login-hero-orb-2 { width:300px;height:300px;background:#4F81BD;bottom:-100px;left:-80px; }

        .login-brand {
          display:flex; align-items:center; gap:0.75rem;
          margin-bottom:3rem; position:relative; z-index:1;
        }
        .login-brand-logo {
          width:44px; height:44px; border-radius:12px;
          background:linear-gradient(135deg,#4BACC6,#365F91);
          display:flex; align-items:center; justify-content:center;
        }
        .login-brand-logo svg { width:22px; height:22px; }
        .login-brand-name { font-size:1.3rem;font-weight:900;color:white;letter-spacing:-0.02em; }

        .login-hero-title {
          font-size:clamp(2rem,4vw,3.2rem); font-weight:800; color:white;
          line-height:1.15; letter-spacing:-0.03em;
          margin-bottom:1rem; position:relative; z-index:1;
        }
        .login-hero-title span { color:#4BACC6; }

        .login-hero-sub {
          font-size:1rem; color:rgba(255,255,255,0.55);
          line-height:1.65; max-width:420px;
          margin-bottom:3rem; position:relative; z-index:1;
        }

        .login-stats { display:flex; gap:2rem; position:relative; z-index:1; }
        .login-stat-val { font-size:1.8rem;font-weight:800;color:white;line-height:1; }
        .login-stat-label { font-size:0.75rem;color:rgba(255,255,255,0.45);font-weight:600;margin-top:0.2rem; }

        .login-form-side {
          width:480px; flex-shrink:0;
          display:flex; align-items:center; justify-content:center;
          padding:3rem; background:white;
        }

        .login-form-wrap { width:100%; max-width:380px; }

        .login-form-title {
          font-size:1.65rem; font-weight:800; color:#1A2B3C;
          margin-bottom:0.4rem; letter-spacing:-0.02em;
        }
        .login-form-sub { font-size:0.88rem;color:#7A8899;margin-bottom:2rem; }

        .login-field { margin-bottom:1.1rem; }
        .login-label {
          display:block; font-size:0.78rem; font-weight:700;
          color:#4A5568; text-transform:uppercase;
          letter-spacing:0.05em; margin-bottom:0.4rem;
        }
        .login-input {
          width:100%; padding:0.75rem 1rem;
          border:1.5px solid #E2E6EA; border-radius:10px;
          font-size:0.92rem; color:#1A2B3C; font-family:inherit;
          outline:none; transition:border-color 0.15s; box-sizing:border-box;
        }
        .login-input:focus { border-color:#4F81BD; box-shadow:0 0 0 3px rgba(79,129,189,0.1); }

        .login-error {
          background:#FDECEA; border:1px solid #F4BDBB;
          border-radius:9px; padding:0.75rem 1rem;
          color:#C0504D; font-size:0.85rem; font-weight:500;
          margin-bottom:1rem;
        }

        .login-btn {
          width:100%; padding:0.85rem;
          background:linear-gradient(135deg,#365F91,#243F60);
          color:white; border:none; border-radius:10px;
          font-size:0.95rem; font-weight:700; cursor:pointer;
          transition:filter 0.15s; font-family:inherit; letter-spacing:0.01em;
        }
        .login-btn:hover:not(:disabled) { filter:brightness(1.1); }
        .login-btn:disabled { opacity:0.6; cursor:not-allowed; }

        .login-footer {
          text-align:center; margin-top:1.25rem;
          font-size:0.8rem; color:#9CA3AF;
        }
        .login-footer a {
          color:#4F81BD; font-weight:600; cursor:pointer;
          text-decoration:none;
        }
        .login-footer a:hover { text-decoration:underline; }

        .login-divider {
          display:flex; align-items:center; gap:0.75rem;
          margin:1.25rem 0;
        }
        .login-divider-line { flex:1; height:1px; background:#E2E6EA; }
        .login-divider-text { font-size:0.75rem; color:#9CA3AF; font-weight:600; white-space:nowrap; }

        @media(max-width:768px){
          .login-page { flex-direction:column; }
          .login-hero { padding:2rem; min-height:auto; }
          .login-form-side { width:100%; padding:2rem; }
        }
      `}</style>

      <div className="login-page">

        <div className="login-hero">
          <div className="login-hero-bg">
            <div className="login-hero-orb login-hero-orb-1" />
            <div className="login-hero-orb login-hero-orb-2" />
          </div>

          <div className="login-brand">
            <div className="login-brand-logo">
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1"/>
                <rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/>
                <rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
            </div>
            <span className="login-brand-name">InfoWall</span>
          </div>

          <h1 className="login-hero-title">
            InfoWall <span>Enterprise</span><br/>
            Communication Platform
          </h1>

          <p className="login-hero-sub">
            One place for announcements, events, and messages — delivered
            in real time to every person in your organisation.
          </p>

          <div className="login-stats">
            <div>
              <div className="login-stat-val">99.9%</div>
              <div className="login-stat-label">Uptime</div>
            </div>
            <div>
              <div className="login-stat-val">24/7</div>
              <div className="login-stat-label">Always on</div>
            </div>
            <div>
              <div className="login-stat-val">Secure</div>
              <div className="login-stat-label">Encrypted</div>
            </div>
          </div>
        </div>

        <div className="login-form-side">
          <div className="login-form-wrap">
            <h2 className="login-form-title">Welcome back</h2>
            <p className="login-form-sub">Sign in to your InfoWall account to continue</p>

            {error && <div className="login-error">⚠ {error}</div>}

            <form onSubmit={handleSubmit}>
              <div className="login-field">
                <label className="login-label">Email address</label>
                <input
                  className="login-input"
                  type="email"
                  placeholder="you@infowall.test"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="login-field">
                <label className="login-label">Password</label>
                <input
                  className="login-input"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
              </div>

              <button className="login-btn" type="submit" disabled={loading}>
                {loading ? 'Signing in…' : 'Sign in →'}
              </button>
            </form>

            <div className="login-divider">
              <div className="login-divider-line" />
              <span className="login-divider-text">OR</span>
              <div className="login-divider-line" />
            </div>

            <div className="login-footer">
              Using a shared screen?{' '}
              <a onClick={() => navigate('/kiosk')}>Go to kiosk →</a>
            </div>

            <div className="login-footer" style={{ marginTop: '0.5rem' }}>
              Trouble signing in?{' '}
              <a href="#">Contact IT support</a>
            </div>
          </div>
        </div>

      </div>
    </>
  )
}
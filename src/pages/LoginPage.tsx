import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
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

    navigate('/welcome')
  }

  return (
    <div className="login-page">
      {/* Hero */}
      <div className="login-hero">
        <div className="login-logo-row">
          <div className="login-logo-icon">
            <svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
              <rect x="2" y="2" width="7" height="7" rx="1.5" />
              <rect x="11" y="2" width="7" height="7" rx="1.5" />
              <rect x="2" y="11" width="7" height="7" rx="1.5" />
              <rect x="11" y="11" width="7" height="7" rx="1.5" opacity=".45" />
            </svg>
          </div>
          <span className="login-logo-text">InfoWall</span>
        </div>

        <h1>Enterprise Communication Platform</h1>
        <p>
          One place for announcements, events, and messages — delivered
          in real time to every person in your organisation.
        </p>

        <div className="login-stats">
          <div className="login-stat">
            <strong>99.9%</strong>
            <span>Uptime</span>
          </div>
          <div className="login-stat">
            <strong>24 / 7</strong>
            <span>Always on</span>
          </div>
          <div className="login-stat">
            <strong>Secure</strong>
            <span>End-to-end</span>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="login-form-side">
        <div className="login-form-box">
          <h2>Welcome back</h2>
          <p className="subtitle">Sign in to your account to continue</p>

          {error && <div className="login-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                placeholder="••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="login-recover">
            Trouble signing in? <a href="#">Contact IT support</a>
          </p>
        </div>
      </div>
    </div>
  )
}

export default LoginPage

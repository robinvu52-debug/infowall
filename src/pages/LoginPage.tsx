import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Mode = 'signin' | 'signup' | 'forgot' | 'reset' | 'sent'

function EyeIcon({ show }: { show: boolean }) {
  return show ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  )
}

function PasswordStrength({ password }: { password: string }) {
  const checks = [
    { label: 'At least 8 characters', ok: password.length >= 8 },
    { label: 'One uppercase letter', ok: /[A-Z]/.test(password) },
    { label: 'One number', ok: /[0-9]/.test(password) },
    { label: 'One special character', ok: /[^a-zA-Z0-9]/.test(password) },
  ]
  const score = checks.filter(c => c.ok).length
  const colors = ['#e5e7eb', '#ef4444', '#f59e0b', '#3b82f6', '#22c55e']
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong']

  if (!password) return null

  return (
    <div style={{ marginTop: '0.5rem' }}>
      <div style={{ display: 'flex', gap: '4px', marginBottom: '0.4rem' }}>
        {[1, 2, 3, 4].map(i => (
          <div key={i} style={{
            flex: 1, height: '3px', borderRadius: '999px',
            background: i <= score ? colors[score] : '#e5e7eb',
            transition: 'background 0.3s ease',
          }} />
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '0.72rem', color: colors[score], fontWeight: 700 }}>{labels[score]}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
        {checks.map(c => (
          <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem', color: c.ok ? '#16a34a' : '#9ca3af', transition: 'color 0.2s' }}>
            <span style={{ fontSize: '0.65rem' }}>{c.ok ? '✓' : '○'}</span>
            {c.label}
          </div>
        ))}
      </div>
    </div>
  )
}

const FEATURES = [
  { icon: '📢', title: 'Company-wide Announcements', desc: 'Reach every employee instantly with targeted posts' },
  { icon: '💬', title: 'Real-time Direct Messages', desc: 'Chat privately with colleagues across the organisation' },
  { icon: '🖥', title: 'Smart Kiosk System', desc: 'Clock in and out with PIN from any shared terminal' },
  { icon: '📊', title: 'Live Analytics Dashboard', desc: 'Track engagement, attendance and team performance' },
]

export default function LoginPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('signin')

  // Fields
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')

  // UI
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showPwd, setShowPwd] = useState(false)
  const [showConfirmPwd, setShowConfirmPwd] = useState(false)
  const [showNewPwd, setShowNewPwd] = useState(false)
  const [showConfirmNewPwd, setShowConfirmNewPwd] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [featureIdx, setFeatureIdx] = useState(0)

  // Feature carousel
  useEffect(() => {
    const t = setInterval(() => setFeatureIdx(i => (i + 1) % FEATURES.length), 3500)
    return () => clearInterval(t)
  }, [])

  // Detect password reset link from Supabase email
  useEffect(() => {
    const hash = window.location.hash
    if (hash.includes('type=recovery')) {
      setMode('reset')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  // If already logged in skip to welcome
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && mode !== 'reset') navigate('/welcome')
    })
  }, [])

  function clearState() {
    setError(null); setSuccess(null); setTouched({})
  }
  function switchMode(m: Mode) {
    clearState(); setMode(m)
    setPassword(''); setConfirmPassword(''); setShowPwd(false); setShowConfirmPwd(false)
  }
  function touch(field: string) { setTouched(p => ({ ...p, [field]: true })) }

  // ── Sign In ──────────────────────────────────────────────
  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !password) { setError('Please fill in all fields.'); return }
    setLoading(true); setError(null)
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) { setError(err.message); setLoading(false); return }
    navigate('/welcome')
  }

  // ── Sign Up ──────────────────────────────────────────────
  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault()
    if (!fullName.trim()) { setError('Please enter your full name.'); return }
    if (!email) { setError('Please enter your email.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return }
    if (!agreed) { setError('Please agree to the terms to continue.'); return }

    setLoading(true); setError(null)

    const { data, error: signUpErr } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } }
    })

    if (signUpErr) { setError(signUpErr.message); setLoading(false); return }

    // Create profile row
    if (data.user) {
      await supabase.from('profiles').insert({
        id: data.user.id,
        full_name: fullName.trim(),
        role: 'employee',
      })
    }

    if (data.session) {
      navigate('/welcome')
    } else {
      setSuccess('Account created! Check your email to confirm before signing in.')
      switchMode('sent')
    }
    setLoading(false)
  }

  // ── Forgot Password ──────────────────────────────────────
  async function handleForgot(e: React.FormEvent) {
    e.preventDefault()
    if (!email) { setError('Please enter your email address.'); return }
    setLoading(true); setError(null)
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    setMode('sent')
  }

  // ── Reset Password ───────────────────────────────────────
  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (newPassword !== confirmNewPassword) { setError('Passwords do not match.'); return }
    setLoading(true); setError(null)
    const { error: err } = await supabase.auth.updateUser({ password: newPassword })
    setLoading(false)
    if (err) { setError(err.message); return }
    setSuccess('Password updated successfully!')
    setTimeout(() => switchMode('signin'), 1500)
  }

  // ── Validation helpers ───────────────────────────────────
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  const pwMatch = password === confirmPassword
  const newPwMatch = newPassword === confirmNewPassword

  const inp = (hasError: boolean) => ({
    width: '100%',
    padding: '0.75rem 1rem',
    border: `1.5px solid ${hasError ? '#fca5a5' : '#e5e7eb'}`,
    borderRadius: '10px',
    fontSize: '0.92rem',
    color: '#111827',
    background: 'white',
    outline: 'none',
    fontFamily: 'inherit',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    boxSizing: 'border-box' as const,
  })

  const fieldErr = (cond: boolean, msg: string) =>
    cond ? <div style={{ fontSize: '0.72rem', color: '#ef4444', marginTop: '0.3rem', fontWeight: 600 }}>{msg}</div> : null

  const modeTitle: Record<Mode, string> = {
    signin: 'Welcome back',
    signup: 'Create your account',
    forgot: 'Reset your password',
    reset: 'Set new password',
    sent: 'Check your email',
  }
  const modeSub: Record<Mode, string> = {
    signin: 'Sign in to your InfoWall workspace',
    signup: 'Join your team on InfoWall',
    forgot: "We'll send you a link to reset your password",
    reset: 'Choose a strong new password',
    sent: '',
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800;900&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Nunito', sans-serif; }

        @keyframes fadeSlideUp   { from{opacity:0;transform:translateY(18px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeSlideDown { from{opacity:0;transform:translateY(-12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes orb1 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(50px,-30px) scale(1.08)} }
        @keyframes orb2 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(-40px,50px) scale(0.92)} }
        @keyframes orb3 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(30px,30px) scale(1.04)} }
        @keyframes featureFade { from{opacity:0;transform:translateX(16px)} to{opacity:1;transform:translateX(0)} }
        @keyframes spin { to{transform:rotate(360deg)} }
        @keyframes checkPop { 0%{transform:scale(0)} 60%{transform:scale(1.2)} 100%{transform:scale(1)} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }

        .lp-wrap { display:flex;min-height:100vh;font-family:'Nunito',sans-serif; }

        /* ── Left panel ── */
        .lp-left {
          width: 480px; flex-shrink: 0;
          background: linear-gradient(160deg, #0a1520 0%, #1A2B3C 40%, #243F60 100%);
          display: flex; flex-direction: column;
          padding: 3rem 3rem 2.5rem;
          position: relative; overflow: hidden;
        }
        .lp-orb { position:absolute;border-radius:50%;filter:blur(70px);opacity:0.2;pointer-events:none; }
        .lp-orb1 { width:350px;height:350px;background:#4BACC6;top:-80px;left:-80px;animation:orb1 12s ease-in-out infinite; }
        .lp-orb2 { width:280px;height:280px;background:#8064A2;bottom:-60px;right:-60px;animation:orb2 14s ease-in-out infinite; }
        .lp-orb3 { width:200px;height:200px;background:#4F81BD;top:45%;left:40%;animation:orb3 10s ease-in-out infinite; }
        .lp-grid { position:absolute;inset:0;background-image:linear-gradient(rgba(75,172,198,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(75,172,198,0.04) 1px,transparent 1px);background-size:40px 40px;pointer-events:none; }

        .lp-brand { display:flex;align-items:center;gap:0.75rem;position:relative;z-index:1;margin-bottom:auto; }
        .lp-brand-mark { width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#4BACC6,#365F91);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 4px 16px rgba(75,172,198,0.35); }
        .lp-brand-name { font-size:1.25rem;font-weight:900;color:white;letter-spacing:-0.02em; }
        .lp-brand-tag { font-size:0.6rem;font-weight:700;color:rgba(75,172,198,0.7);text-transform:uppercase;letter-spacing:0.12em; }

        .lp-hero { position:relative;z-index:1;margin-top:3rem; }
        .lp-hero-title { font-size:2.2rem;font-weight:900;color:white;line-height:1.15;letter-spacing:-0.03em;margin-bottom:1rem; }
        .lp-hero-title span { background:linear-gradient(135deg,#4BACC6,#7dd3fc);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text; }
        .lp-hero-sub { font-size:0.92rem;color:rgba(255,255,255,0.45);line-height:1.65;margin-bottom:2.5rem; }

        .lp-feature { animation:featureFade 0.4s ease both; }
        .lp-feature-card { background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:1.1rem 1.25rem;display:flex;align-items:flex-start;gap:0.85rem;margin-bottom:0.6rem; }
        .lp-feature-icon { font-size:1.35rem;flex-shrink:0;margin-top:0.05rem; }
        .lp-feature-title { font-size:0.88rem;font-weight:700;color:rgba(255,255,255,0.85);margin-bottom:0.2rem; }
        .lp-feature-desc { font-size:0.75rem;color:rgba(255,255,255,0.35);line-height:1.5; }

        .lp-dots { display:flex;gap:0.45rem;margin-top:1.25rem; }
        .lp-dot { width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,0.15);transition:all 0.3s; }
        .lp-dot.active { background:#4BACC6;width:20px;border-radius:999px; }

        .lp-trust { position:relative;z-index:1;margin-top:auto;padding-top:2rem; }
        .lp-trust-text { font-size:0.72rem;color:rgba(255,255,255,0.25);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:0.75rem; }
        .lp-trust-stats { display:flex;gap:1.5rem; }
        .lp-stat-val { font-size:1.25rem;font-weight:900;color:white;line-height:1; }
        .lp-stat-label { font-size:0.65rem;color:rgba(255,255,255,0.3);margin-top:0.15rem; }

        /* ── Right panel ── */
        .lp-right { flex:1;display:flex;align-items:center;justify-content:center;background:#f9fafb;padding:2rem; }
        .lp-form-wrap { width:100%;max-width:440px;animation:fadeSlideUp 0.35s ease both; }

        .lp-form-header { margin-bottom:1.85rem; }
        .lp-form-title { font-size:1.75rem;font-weight:900;color:#111827;letter-spacing:-0.025em;margin-bottom:0.35rem; }
        .lp-form-sub { font-size:0.88rem;color:#6b7280;line-height:1.5; }

        /* Mode tabs */
        .lp-tabs { display:flex;background:white;border:1px solid #e5e7eb;border-radius:12px;padding:4px;gap:4px;margin-bottom:1.75rem;box-shadow:0 1px 3px rgba(0,0,0,0.05); }
        .lp-tab { flex:1;padding:0.55rem;border:none;background:transparent;border-radius:9px;font-size:0.82rem;font-weight:600;color:#6b7280;cursor:pointer;transition:all 0.15s;font-family:inherit; }
        .lp-tab:hover { color:#374151; }
        .lp-tab.active { background:#243F60;color:white;box-shadow:0 2px 8px rgba(36,63,96,0.2); }

        /* Field */
        .lp-field { margin-bottom:1rem; }
        .lp-label { display:block;font-size:0.8rem;font-weight:700;color:#374151;margin-bottom:0.45rem;letter-spacing:0.01em; }
        .lp-input-wrap { position:relative; }
        .lp-input-wrap input { padding-right:2.75rem !important; }
        .lp-eye { position:absolute;right:0.85rem;top:50%;transform:translateY(-50%);background:none;border:none;color:#9ca3af;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0.15rem;border-radius:4px;transition:color 0.12s; }
        .lp-eye:hover { color:#374151; }

        /* Buttons */
        .lp-btn-primary { width:100%;padding:0.85rem;background:linear-gradient(135deg,#243F60,#365F91);color:white;border:none;border-radius:11px;font-size:0.95rem;font-weight:800;cursor:pointer;transition:all 0.15s;font-family:inherit;letter-spacing:0.01em;box-shadow:0 4px 14px rgba(36,63,96,0.25);display:flex;align-items:center;justify-content:center;gap:0.5rem; }
        .lp-btn-primary:hover:not(:disabled) { transform:translateY(-1px);box-shadow:0 6px 20px rgba(36,63,96,0.35); }
        .lp-btn-primary:active:not(:disabled) { transform:scale(0.99); }
        .lp-btn-primary:disabled { opacity:0.6;cursor:not-allowed;transform:none; }

        .lp-btn-ghost { background:none;border:none;color:#4F81BD;font-size:0.82rem;font-weight:700;cursor:pointer;font-family:inherit;transition:color 0.12s;padding:0; }
        .lp-btn-ghost:hover { color:#243F60; }

        /* Error / success */
        .lp-error { display:flex;align-items:flex-start;gap:0.6rem;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:0.75rem 1rem;margin-bottom:1rem;font-size:0.82rem;color:#dc2626;font-weight:600;line-height:1.45;animation:fadeSlideDown 0.2s ease; }
        .lp-success { display:flex;align-items:flex-start;gap:0.6rem;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:0.75rem 1rem;margin-bottom:1rem;font-size:0.82rem;color:#16a34a;font-weight:600;line-height:1.45;animation:fadeSlideDown 0.2s ease; }

        /* Divider */
        .lp-divider { display:flex;align-items:center;gap:0.75rem;margin:1.25rem 0; }
        .lp-divider-line { flex:1;height:1px;background:#e5e7eb; }
        .lp-divider-label { font-size:0.72rem;color:#9ca3af;font-weight:600;white-space:nowrap; }

        /* Checkbox */
        .lp-check-row { display:flex;align-items:flex-start;gap:0.65rem;margin-bottom:1.25rem;cursor:pointer; }
        .lp-check-row input { width:16px;height:16px;margin-top:2px;flex-shrink:0;accent-color:#243F60;cursor:pointer; }
        .lp-check-label { font-size:0.78rem;color:#6b7280;line-height:1.5; }
        .lp-check-label a { color:#4F81BD;font-weight:700;text-decoration:none; }
        .lp-check-label a:hover { text-decoration:underline; }

        /* Spinner */
        .spinner { width:18px;height:18px;border:2.5px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 0.7s linear infinite;flex-shrink:0; }

        /* Sent screen */
        .lp-sent { text-align:center;padding:1rem 0; }
        .lp-sent-icon { width:72px;height:72px;border-radius:50%;background:#EEF4FB;border:2px solid #C5D9F1;display:flex;align-items:center;justify-content:center;font-size:1.85rem;margin:0 auto 1.25rem;animation:checkPop 0.45s cubic-bezier(0.34,1.56,0.64,1); }
        .lp-sent-title { font-size:1.35rem;font-weight:800;color:#111827;margin-bottom:0.5rem; }
        .lp-sent-sub { font-size:0.88rem;color:#6b7280;line-height:1.65;margin-bottom:1.75rem; }
        .lp-sent-email { font-weight:700;color:#243F60; }
        .lp-sent-resend { font-size:0.8rem;color:#9ca3af;margin-top:1.25rem; }
        .lp-sent-resend button { color:#4F81BD;font-weight:700;background:none;border:none;cursor:pointer;font-family:inherit;font-size:0.8rem;transition:color 0.12s; }
        .lp-sent-resend button:hover { color:#243F60; }

        /* Focus */
        input:focus { outline:none;border-color:#4BACC6 !important;box-shadow:0 0 0 3px rgba(75,172,198,0.12) !important; }

        /* Footer */
        .lp-footer { text-align:center;margin-top:1.85rem;font-size:0.78rem;color:#9ca3af; }
        .lp-footer a { color:#4F81BD;font-weight:700;text-decoration:none; }
        .lp-footer a:hover { text-decoration:underline; }

        @media(max-width:860px) { .lp-left{display:none} .lp-right{background:linear-gradient(160deg,#0a1520,#1A2B3C)} .lp-form-wrap{background:white;border-radius:20px;padding:2rem;box-shadow:0 20px 60px rgba(0,0,0,0.25)} .lp-form-title,.lp-form-sub{color:#111827} }
        @media(max-width:480px) { .lp-right{padding:1rem} .lp-form-wrap{padding:1.5rem;border-radius:16px} }
      `}</style>

      <div className="lp-wrap">
        {/* ── Left branding panel ── */}
        <div className="lp-left">
          <div className="lp-orb lp-orb1" />
          <div className="lp-orb lp-orb2" />
          <div className="lp-orb lp-orb3" />
          <div className="lp-grid" />

          <div className="lp-brand" style={{ marginBottom: '0' }}>
            <div className="lp-brand-mark">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1.5"/>
                <rect x="14" y="3" width="7" height="7" rx="1.5"/>
                <rect x="3" y="14" width="7" height="7" rx="1.5"/>
                <rect x="14" y="14" width="7" height="7" rx="1.5"/>
              </svg>
            </div>
            <div>
              <div className="lp-brand-name">InfoWall</div>
              <div className="lp-brand-tag">Enterprise</div>
            </div>
          </div>

          <div className="lp-hero">
            <h1 className="lp-hero-title">
              Your team's <span>command centre</span>
            </h1>
            <p className="lp-hero-sub">
              Everything your workforce needs — announcements, messages, shift tracking, and analytics — in one beautifully simple platform.
            </p>

            {/* Feature carousel */}
            <div className="lp-feature" key={featureIdx}>
              <div className="lp-feature-card">
                <div className="lp-feature-icon">{FEATURES[featureIdx].icon}</div>
                <div>
                  <div className="lp-feature-title">{FEATURES[featureIdx].title}</div>
                  <div className="lp-feature-desc">{FEATURES[featureIdx].desc}</div>
                </div>
              </div>
            </div>

            <div className="lp-dots">
              {FEATURES.map((_, i) => (
                <div key={i} className={`lp-dot${i === featureIdx ? ' active' : ''}`} onClick={() => setFeatureIdx(i)} style={{ cursor:'pointer' }} />
              ))}
            </div>
          </div>

          <div className="lp-trust">
            <div className="lp-trust-text">Trusted by teams</div>
            <div className="lp-trust-stats">
              {[
                { val: '59+', label: 'Team members' },
                { val: '5', label: 'Departments' },
                { val: '100%', label: 'Uptime' },
              ].map(s => (
                <div key={s.label}>
                  <div className="lp-stat-val">{s.val}</div>
                  <div className="lp-stat-label">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right form panel ── */}
        <div className="lp-right">
          <div className="lp-form-wrap">

            {/* ── SENT / EMAIL CONFIRMATION ── */}
            {mode === 'sent' && (
              <div className="lp-sent">
                <div className="lp-sent-icon">📬</div>
                <div className="lp-sent-title">Check your inbox</div>
                <div className="lp-sent-sub">
                  We sent a link to <span className="lp-sent-email">{email || 'your email'}</span>.<br />
                  Click it to {success?.includes('Account') ? 'confirm your account' : 'reset your password'}.<br />
                  Don't forget to check your spam folder.
                </div>
                <button className="lp-btn-primary" onClick={() => switchMode('signin')}>
                  ← Back to sign in
                </button>
                <div className="lp-sent-resend">
                  Didn't get it?{' '}
                  <button onClick={async () => {
                    if (success?.includes('Account')) {
                      await supabase.auth.resend({ type: 'signup', email })
                    } else {
                      await supabase.auth.resetPasswordForEmail(email, {
                        redirectTo: `${window.location.origin}/login`
                      })
                    }
                    setSuccess('Link resent!')
                  }}>
                    Resend link
                  </button>
                </div>
                {success === 'Link resent!' && (
                  <div style={{ fontSize:'0.78rem', color:'#16a34a', fontWeight:700, marginTop:'0.5rem' }}>✓ Link resent!</div>
                )}
              </div>
            )}

            {/* ── RESET PASSWORD ── */}
            {mode === 'reset' && (
              <>
                <div className="lp-form-header">
                  <div className="lp-form-title">{modeTitle.reset}</div>
                  <div className="lp-form-sub">{modeSub.reset}</div>
                </div>

                {error && <div className="lp-error">⚠ {error}</div>}
                {success && <div className="lp-success">✓ {success}</div>}

                <form onSubmit={handleReset}>
                  <div className="lp-field">
                    <label className="lp-label">New password</label>
                    <div className="lp-input-wrap">
                      <input
                        style={inp(touched.newPwd && newPassword.length > 0 && newPassword.length < 8)}
                        type={showNewPwd ? 'text' : 'password'}
                        placeholder="Create a strong password"
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        onBlur={() => touch('newPwd')}
                        autoFocus
                      />
                      <button type="button" className="lp-eye" onClick={() => setShowNewPwd(p => !p)}>
                        <EyeIcon show={showNewPwd} />
                      </button>
                    </div>
                    {touched.newPwd && <PasswordStrength password={newPassword} />}
                  </div>

                  <div className="lp-field">
                    <label className="lp-label">Confirm new password</label>
                    <div className="lp-input-wrap">
                      <input
                        style={inp(touched.confirmNewPwd && confirmNewPassword.length > 0 && !newPwMatch)}
                        type={showConfirmNewPwd ? 'text' : 'password'}
                        placeholder="Repeat your new password"
                        value={confirmNewPassword}
                        onChange={e => setConfirmNewPassword(e.target.value)}
                        onBlur={() => touch('confirmNewPwd')}
                      />
                      <button type="button" className="lp-eye" onClick={() => setShowConfirmNewPwd(p => !p)}>
                        <EyeIcon show={showConfirmNewPwd} />
                      </button>
                    </div>
                    {fieldErr(touched.confirmNewPwd && confirmNewPassword.length > 0 && !newPwMatch, 'Passwords do not match')}
                    {touched.confirmNewPwd && newPwMatch && confirmNewPassword.length > 0 && (
                      <div style={{ fontSize:'0.72rem', color:'#16a34a', marginTop:'0.3rem', fontWeight:600 }}>✓ Passwords match</div>
                    )}
                  </div>

                  <button className="lp-btn-primary" type="submit" disabled={loading} style={{ marginTop:'0.5rem' }}>
                    {loading ? <><div className="spinner" /> Updating…</> : '🔒 Update password'}
                  </button>
                </form>
              </>
            )}

            {/* ── SIGN IN / SIGN UP / FORGOT ── */}
            {(mode === 'signin' || mode === 'signup' || mode === 'forgot') && (
              <>
                {/* Tabs — only show for signin/signup */}
                {(mode === 'signin' || mode === 'signup') && (
                  <div className="lp-tabs">
                    <button className={`lp-tab${mode === 'signin' ? ' active' : ''}`} onClick={() => switchMode('signin')}>
                      Sign in
                    </button>
                    <button className={`lp-tab${mode === 'signup' ? ' active' : ''}`} onClick={() => switchMode('signup')}>
                      Create account
                    </button>
                  </div>
                )}

                <div className="lp-form-header">
                  <div className="lp-form-title">{modeTitle[mode]}</div>
                  <div className="lp-form-sub">{modeSub[mode]}</div>
                </div>

                {error && <div className="lp-error">⚠ {error}</div>}
                {success && <div className="lp-success">✓ {success}</div>}

                {/* ── SIGN IN FORM ── */}
                {mode === 'signin' && (
                  <form onSubmit={handleSignIn}>
                    <div className="lp-field">
                      <label className="lp-label">Email address</label>
                      <input
                        style={inp(touched.email && !!email && !emailValid)}
                        type="email"
                        placeholder="you@company.com"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        onBlur={() => touch('email')}
                        autoComplete="email"
                        autoFocus
                      />
                      {fieldErr(touched.email && !!email && !emailValid, 'Please enter a valid email')}
                    </div>

                    <div className="lp-field">
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'0.45rem' }}>
                        <label className="lp-label" style={{ margin:0 }}>Password</label>
                        <button type="button" className="lp-btn-ghost" onClick={() => switchMode('forgot')}>
                          Forgot password?
                        </button>
                      </div>
                      <div className="lp-input-wrap">
                        <input
                          style={inp(false)}
                          type={showPwd ? 'text' : 'password'}
                          placeholder="Your password"
                          value={password}
                          onChange={e => setPassword(e.target.value)}
                          autoComplete="current-password"
                        />
                        <button type="button" className="lp-eye" onClick={() => setShowPwd(p => !p)}>
                          <EyeIcon show={showPwd} />
                        </button>
                      </div>
                    </div>

                    <button className="lp-btn-primary" type="submit" disabled={loading} style={{ marginTop:'0.35rem' }}>
                      {loading ? <><div className="spinner" /> Signing in…</> : '→ Sign in to InfoWall'}
                    </button>

                    <div className="lp-divider">
                      <div className="lp-divider-line" />
                      <div className="lp-divider-label">New to InfoWall?</div>
                      <div className="lp-divider-line" />
                    </div>

                    <button
                      type="button"
                      onClick={() => switchMode('signup')}
                      style={{ width:'100%', padding:'0.78rem', border:'1.5px solid #e5e7eb', borderRadius:'11px', background:'white', fontSize:'0.92rem', fontWeight:700, color:'#374151', cursor:'pointer', fontFamily:'inherit', transition:'all 0.15s' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor='#4BACC6'; (e.currentTarget as HTMLButtonElement).style.color='#243F60' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor='#e5e7eb'; (e.currentTarget as HTMLButtonElement).style.color='#374151' }}
                    >
                      Create an account
                    </button>

                    <div className="lp-footer">
                      Having trouble?{' '}
                      <a href="mailto:admin@infowall.test">Contact your admin</a>
                    </div>
                  </form>
                )}

                {/* ── SIGN UP FORM ── */}
                {mode === 'signup' && (
                  <form onSubmit={handleSignUp}>
                    <div className="lp-field">
                      <label className="lp-label">Full name</label>
                      <input
                        style={inp(touched.name && fullName.trim().length > 0 && fullName.trim().split(' ').length < 2)}
                        type="text"
                        placeholder="Jane Smith"
                        value={fullName}
                        onChange={e => setFullName(e.target.value)}
                        onBlur={() => touch('name')}
                        autoComplete="name"
                        autoFocus
                      />
                      {fieldErr(touched.name && fullName.trim().length > 0 && fullName.trim().split(' ').filter(Boolean).length < 2, 'Please enter your first and last name')}
                    </div>

                    <div className="lp-field">
                      <label className="lp-label">Work email</label>
                      <input
                        style={inp(touched.email && !!email && !emailValid)}
                        type="email"
                        placeholder="you@company.com"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        onBlur={() => touch('email')}
                        autoComplete="email"
                      />
                      {fieldErr(touched.email && !!email && !emailValid, 'Please enter a valid email')}
                    </div>

                    <div className="lp-field">
                      <label className="lp-label">Password</label>
                      <div className="lp-input-wrap">
                        <input
                          style={inp(false)}
                          type={showPwd ? 'text' : 'password'}
                          placeholder="Create a strong password"
                          value={password}
                          onChange={e => setPassword(e.target.value)}
                          onBlur={() => touch('pwd')}
                          autoComplete="new-password"
                        />
                        <button type="button" className="lp-eye" onClick={() => setShowPwd(p => !p)}>
                          <EyeIcon show={showPwd} />
                        </button>
                      </div>
                      {touched.pwd && <PasswordStrength password={password} />}
                    </div>

                    <div className="lp-field">
                      <label className="lp-label">Confirm password</label>
                      <div className="lp-input-wrap">
                        <input
                          style={inp(touched.confirmPwd && !!confirmPassword && !pwMatch)}
                          type={showConfirmPwd ? 'text' : 'password'}
                          placeholder="Repeat your password"
                          value={confirmPassword}
                          onChange={e => setConfirmPassword(e.target.value)}
                          onBlur={() => touch('confirmPwd')}
                          autoComplete="new-password"
                        />
                        <button type="button" className="lp-eye" onClick={() => setShowConfirmPwd(p => !p)}>
                          <EyeIcon show={showConfirmPwd} />
                        </button>
                      </div>
                      {fieldErr(touched.confirmPwd && !!confirmPassword && !pwMatch, 'Passwords do not match')}
                      {touched.confirmPwd && pwMatch && confirmPassword.length > 0 && (
                        <div style={{ fontSize:'0.72rem', color:'#16a34a', marginTop:'0.3rem', fontWeight:600 }}>✓ Passwords match</div>
                      )}
                    </div>

                    <label className="lp-check-row">
                      <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
                      <span className="lp-check-label">
                        I agree to the <a href="#" onClick={e => e.preventDefault()}>Terms of Service</a> and{' '}
                        <a href="#" onClick={e => e.preventDefault()}>Privacy Policy</a>
                      </span>
                    </label>

                    <button className="lp-btn-primary" type="submit" disabled={loading}>
                      {loading ? <><div className="spinner" /> Creating account…</> : '✦ Create my account'}
                    </button>

                    <div className="lp-footer" style={{ marginTop:'1.25rem' }}>
                      Already have an account?{' '}
                      <a href="#" onClick={e => { e.preventDefault(); switchMode('signin') }}>Sign in</a>
                    </div>
                  </form>
                )}

                {/* ── FORGOT PASSWORD FORM ── */}
                {mode === 'forgot' && (
                  <>
                    <button
                      onClick={() => switchMode('signin')}
                      style={{ display:'flex', alignItems:'center', gap:'0.4rem', background:'none', border:'none', color:'#6b7280', fontSize:'0.82rem', fontWeight:600, cursor:'pointer', fontFamily:'inherit', marginBottom:'1.5rem', padding:0, transition:'color 0.12s' }}
                      onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color='#111827'}
                      onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color='#6b7280'}
                    >
                      ← Back to sign in
                    </button>

                    <form onSubmit={handleForgot}>
                      <div className="lp-field">
                        <label className="lp-label">Email address</label>
                        <input
                          style={inp(touched.email && !!email && !emailValid)}
                          type="email"
                          placeholder="you@company.com"
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          onBlur={() => touch('email')}
                          autoFocus
                        />
                        {fieldErr(touched.email && !!email && !emailValid, 'Please enter a valid email')}
                        <div style={{ fontSize:'0.75rem', color:'#9ca3af', marginTop:'0.5rem', lineHeight:1.5 }}>
                          We'll send a secure reset link to this address. It expires in 1 hour.
                        </div>
                      </div>

                      <button className="lp-btn-primary" type="submit" disabled={loading}>
                        {loading ? <><div className="spinner" /> Sending…</> : '📬 Send reset link'}
                      </button>

                      <div className="lp-footer">
                        Remember your password?{' '}
                        <a href="#" onClick={e => { e.preventDefault(); switchMode('signin') }}>Sign in</a>
                      </div>
                    </form>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
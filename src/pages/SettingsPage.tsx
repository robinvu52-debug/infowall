import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Navbar from '../components/Navbar'
import { useTheme } from '../contexts/ThemeContext'

interface Profile {
  id: string
  full_name: string | null
  role: string
  department_id: string | null
  bio: string | null
  email: string | null
  kiosk_pin: string | null
  joined_at: string | null
}
interface Department { id: string; name: string }

type Section = 'profile' | 'appearance' | 'password' | 'pin' | 'notifications' | 'account'

const SECTIONS: { id: Section; label: string; icon: string; desc: string }[] = [
  { id: 'profile',       label: 'Profile',        icon: '👤', desc: 'Name, bio and personal info' },
  { id: 'appearance',    label: 'Appearance',      icon: '🎨', desc: 'Theme, density and display' },
  { id: 'password',      label: 'Password',        icon: '🔒', desc: 'Change your password' },
  { id: 'pin',           label: 'Kiosk PIN',       icon: '🖥', desc: 'Manage your clock-in PIN' },
  { id: 'notifications', label: 'Notifications',   icon: '🔔', desc: 'Alerts and notification prefs' },
  { id: 'account',       label: 'Account',         icon: '⚙',  desc: 'Sign out and account actions' },
]

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ position:'relative', width:44, height:24, display:'inline-block', cursor:'pointer', flexShrink:0 }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ opacity:0, width:0, height:0, position:'absolute' }} />
      <div style={{
        position:'absolute', inset:0, borderRadius:999, background: checked ? '#4BACC6' : 'var(--border)',
        transition:'background 0.2s',
      }} />
      <div style={{
        position:'absolute', top:3, left: checked ? 23 : 3,
        width:18, height:18, borderRadius:'50%', background:'white',
        boxShadow:'0 1px 4px rgba(0,0,0,0.2)', transition:'left 0.2s',
      }} />
    </label>
  )
}

function SaveBanner({ show, saving }: { show: boolean; saving: boolean }) {
  if (!show && !saving) return null
  return (
    <div style={{
      position:'fixed', bottom:'1.5rem', left:'50%', transform:'translateX(-50%)',
      background: saving ? '#243F60' : '#16a34a',
      color:'white', padding:'0.65rem 1.5rem', borderRadius:'999px',
      fontSize:'0.85rem', fontWeight:700, zIndex:500,
      boxShadow:'0 4px 20px rgba(0,0,0,0.2)',
      display:'flex', alignItems:'center', gap:'0.5rem',
      animation:'fadeUp 0.25s ease',
      transition:'background 0.3s',
    }}>
      {saving ? <><div style={{ width:14, height:14, border:'2px solid rgba(255,255,255,0.3)', borderTopColor:'white', borderRadius:'50%', animation:'spin 0.7s linear infinite' }} /> Saving…</> : '✓ Saved successfully'}
    </div>
  )
}

function PasswordStrengthBar({ password }: { password: string }) {
  const checks = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^a-zA-Z0-9]/.test(password),
  ]
  const score = checks.filter(Boolean).length
  const colors = ['#e5e7eb','#ef4444','#f59e0b','#3b82f6','#22c55e']
  const labels = ['','Weak','Fair','Good','Strong']
  if (!password) return null
  return (
    <div style={{ marginTop:'0.5rem' }}>
      <div style={{ display:'flex', gap:4, marginBottom:'0.3rem' }}>
        {[1,2,3,4].map(i => (
          <div key={i} style={{ flex:1, height:3, borderRadius:999, background: i <= score ? colors[score] : 'var(--border)', transition:'background 0.3s' }} />
        ))}
      </div>
      <span style={{ fontSize:'0.72rem', color:colors[score], fontWeight:700 }}>{labels[score]}</span>
    </div>
  )
}

export default function SettingsPage() {
  const navigate = useNavigate()
  const { isDark, toggle: toggleTheme } = useTheme()

  const [profile, setProfile] = useState<Profile | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [activeSection, setActiveSection] = useState<Section>('profile')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Profile fields
  const [fullName, setFullName] = useState('')
  const [bio, setBio] = useState('')

  // Password fields
  const [currentPwd, setCurrentPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [showCurrentPwd, setShowCurrentPwd] = useState(false)
  const [showNewPwd, setShowNewPwd] = useState(false)
  const [showConfirmPwd, setShowConfirmPwd] = useState(false)

  // PIN fields
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [pinVisible, setPinVisible] = useState(false)

  // Notification prefs (stored in localStorage for now)
  const [notifMentions, setNotifMentions] = useState(true)
  const [notifMustRead, setNotifMustRead] = useState(true)
  const [notifMessages, setNotifMessages] = useState(true)
  const [notifFeedLikes, setNotifFeedLikes] = useState(false)

  // Appearance
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable')

  // Sign out confirm
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { navigate('/login'); return }
      const [{ data: p }, { data: ds }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('departments').select('*').order('name'),
      ])
      if (p) {
        setProfile(p)
        setFullName(p.full_name ?? '')
        setBio(p.bio ?? '')
        setCurrentPin(p.kiosk_pin ?? '')
      }
      setDepartments(ds ?? [])

      // Load notification prefs from localStorage
      const prefs = localStorage.getItem('infowall-notif-prefs')
      if (prefs) {
        const parsed = JSON.parse(prefs)
        setNotifMentions(parsed.mentions ?? true)
        setNotifMustRead(parsed.mustRead ?? true)
        setNotifMessages(parsed.messages ?? true)
        setNotifFeedLikes(parsed.feedLikes ?? false)
      }
      const d = localStorage.getItem('infowall-density')
      if (d === 'compact' || d === 'comfortable') setDensity(d)

      setLoading(false)
    }
    load()
    return () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current) }
  }, [navigate])

  function showSaved() {
    setSaved(true)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    savedTimerRef.current = setTimeout(() => setSaved(false), 2500)
  }

  function clearMessages() { setError(null); setSuccess(null) }

  // ── Save profile ──────────────────────────────────────────
  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    if (!fullName.trim()) { setError('Full name is required.'); return }
    if (fullName.trim().split(' ').filter(Boolean).length < 2) { setError('Please enter your first and last name.'); return }
    setSaving(true); clearMessages()
    const { error: err } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim(), bio: bio.trim() || null })
      .eq('id', profile!.id)
    setSaving(false)
    if (err) { setError(err.message); return }
    setProfile(p => p ? { ...p, full_name: fullName.trim(), bio: bio.trim() || null } : p)
    showSaved()
  }

  // ── Change password ───────────────────────────────────────
  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    clearMessages()
    if (!newPwd) { setError('Please enter a new password.'); return }
    if (newPwd.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (newPwd !== confirmPwd) { setError('Passwords do not match.'); return }
    setSaving(true)
    // Re-authenticate then update
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) { setError('Could not verify session.'); setSaving(false); return }
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPwd })
    if (signInErr) { setError('Current password is incorrect.'); setSaving(false); return }
    const { error: updateErr } = await supabase.auth.updateUser({ password: newPwd })
    setSaving(false)
    if (updateErr) { setError(updateErr.message); return }
    setCurrentPwd(''); setNewPwd(''); setConfirmPwd('')
    setSuccess('Password updated successfully!')
    showSaved()
  }

  // ── Save PIN ──────────────────────────────────────────────
  async function handleSavePin(e: React.FormEvent) {
    e.preventDefault()
    clearMessages()
    if (!/^\d{4}$/.test(newPin)) { setError('PIN must be exactly 4 digits.'); return }
    if (newPin !== confirmPin) { setError('PINs do not match.'); return }
    setSaving(true)
    const { error: err } = await supabase
      .from('profiles')
      .update({ kiosk_pin: newPin })
      .eq('id', profile!.id)
    setSaving(false)
    if (err) { setError(err.message); return }
    setProfile(p => p ? { ...p, kiosk_pin: newPin } : p)
    setCurrentPin(newPin); setNewPin(''); setConfirmPin('')
    setSuccess('Kiosk PIN updated!')
    showSaved()
  }

  // ── Remove PIN ────────────────────────────────────────────
  async function handleRemovePin() {
    if (!window.confirm('Remove your kiosk PIN? You won\'t be able to clock in until a new one is set.')) return
    setSaving(true)
    await supabase.from('profiles').update({ kiosk_pin: null }).eq('id', profile!.id)
    setSaving(false)
    setProfile(p => p ? { ...p, kiosk_pin: null } : p)
    setCurrentPin(''); setNewPin(''); setConfirmPin('')
    setSuccess('PIN removed.')
    showSaved()
  }

  // ── Save notification prefs ───────────────────────────────
  function handleSaveNotifPrefs() {
    const prefs = { mentions: notifMentions, mustRead: notifMustRead, messages: notifMessages, feedLikes: notifFeedLikes }
    localStorage.setItem('infowall-notif-prefs', JSON.stringify(prefs))
    showSaved()
  }

  // ── Save appearance ───────────────────────────────────────
  function handleSaveAppearance() {
    localStorage.setItem('infowall-density', density)
    document.documentElement.setAttribute('data-density', density)
    showSaved()
  }

  // ── Sign out ──────────────────────────────────────────────
  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', fontFamily:'Nunito,sans-serif', color:'var(--text-faint)' }}>
      Loading settings…
    </div>
  )

  const dept = departments.find(d => d.id === profile?.department_id)
  const ini = (profile?.full_name ?? '?').split(' ').filter(Boolean).slice(0,2).map(n=>n[0]).join('').toUpperCase()
  const avatarColor = '#4BACC6'

  return (
    <>
      <style>{`
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes spin { to{transform:rotate(360deg)} }
        @keyframes slideRight { from{opacity:0;transform:translateX(16px)} to{opacity:1;transform:translateX(0)} }

        *, *::before, *::after { box-sizing:border-box; }

        .st-page { min-height:100vh;background:var(--bg-page);font-family:'Nunito','Segoe UI',system-ui,sans-serif; }
        .st-layout { max-width:1000px;margin:0 auto;padding:2rem 1.5rem 5rem;display:grid;grid-template-columns:240px 1fr;gap:1.5rem;align-items:start; }

        /* ── Sidebar nav ── */
        .st-nav { background:var(--bg-surface);border:1px solid var(--border);border-radius:16px;overflow:hidden;position:sticky;top:76px; }

        /* Profile summary at top of nav */
        .st-nav-profile { display:flex;align-items:center;gap:0.75rem;padding:1.1rem 1.1rem 0.85rem;border-bottom:1px solid var(--border);cursor:pointer;transition:background 0.12s; }
        .st-nav-profile:hover { background:var(--bg-hover); }
        .st-nav-avatar { width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#4BACC6,#243F60);color:white;font-size:0.88rem;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0; }
        .st-nav-name { font-size:0.85rem;font-weight:700;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .st-nav-role { font-size:0.68rem;color:var(--text-faint);text-transform:capitalize;margin-top:0.1rem; }

        .st-nav-items { padding:0.4rem 0; }
        .st-nav-item { display:flex;align-items:center;gap:0.7rem;padding:0.65rem 1.1rem;cursor:pointer;transition:all 0.12s;border:none;background:transparent;width:100%;text-align:left;font-family:inherit;position:relative; }
        .st-nav-item:hover { background:var(--bg-hover); }
        .st-nav-item.active { background:var(--bg-active);color:#243F60; }
        .st-nav-item.active::before { content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:#4BACC6;border-radius:0 3px 3px 0; }
        .st-nav-item-icon { width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:0.85rem;flex-shrink:0;background:var(--bg-page);transition:all 0.12s; }
        .st-nav-item.active .st-nav-item-icon { background:#EEF4FB; }
        .st-nav-item-label { font-size:0.83rem;font-weight:600;color:var(--text-primary); }
        .st-nav-item-desc { font-size:0.68rem;color:var(--text-faint);margin-top:0.08rem; }

        .st-nav-ver { padding:0.75rem 1.1rem;border-top:1px solid var(--border);font-size:0.68rem;color:var(--text-ghost); }

        /* ── Main content ── */
        .st-main { display:flex;flex-direction:column;gap:1rem;animation:slideRight 0.2s ease; }

        /* Section header */
        .st-section-header { margin-bottom:0.25rem; }
        .st-section-title { font-size:1.25rem;font-weight:900;color:var(--text-primary);letter-spacing:-0.02em;margin-bottom:0.2rem; }
        .st-section-sub { font-size:0.82rem;color:var(--text-faint);line-height:1.5; }

        /* Card */
        .st-card { background:var(--bg-surface);border:1px solid var(--border);border-radius:14px;overflow:hidden; }
        .st-card-header { padding:1rem 1.4rem;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:0.6rem; }
        .st-card-header-icon { font-size:0.88rem; }
        .st-card-header-title { font-size:0.88rem;font-weight:800;color:var(--text-primary); }
        .st-card-header-sub { font-size:0.72rem;color:var(--text-faint);margin-left:auto; }
        .st-card-body { padding:1.4rem; }

        /* Form fields */
        .st-field { margin-bottom:1.1rem; }
        .st-field:last-child { margin-bottom:0; }
        .st-label { display:block;font-size:0.78rem;font-weight:700;color:var(--text-secondary);margin-bottom:0.45rem;letter-spacing:0.01em; }
        .st-input { width:100%;padding:0.7rem 1rem;border:1.5px solid var(--border);border-radius:10px;font-size:0.9rem;color:var(--text-primary);background:var(--bg-page);font-family:inherit;outline:none;transition:border-color 0.15s,box-shadow 0.15s; }
        .st-input:focus { border-color:#4BACC6;box-shadow:0 0 0 3px rgba(75,172,198,0.1); }
        .st-input.error { border-color:#fca5a5; }
        .st-textarea { width:100%;padding:0.7rem 1rem;border:1.5px solid var(--border);border-radius:10px;font-size:0.9rem;color:var(--text-primary);background:var(--bg-page);font-family:inherit;outline:none;resize:vertical;min-height:90px;line-height:1.65;transition:border-color 0.15s; }
        .st-textarea:focus { border-color:#4BACC6;box-shadow:0 0 0 3px rgba(75,172,198,0.1); }
        .st-input-wrap { position:relative; }
        .st-input-wrap .st-input { padding-right:2.75rem; }
        .st-eye { position:absolute;right:0.85rem;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text-faint);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0.15rem;border-radius:4px;transition:color 0.12s; }
        .st-eye:hover { color:var(--text-primary); }
        .st-hint { font-size:0.72rem;color:var(--text-faint);margin-top:0.3rem;line-height:1.5; }
        .st-field-row { display:grid;grid-template-columns:1fr 1fr;gap:0.85rem; }

        /* Readonly badge */
        .st-readonly { display:inline-flex;align-items:center;gap:0.4rem;padding:0.6rem 1rem;background:var(--bg-page);border:1.5px solid var(--border);border-radius:10px;font-size:0.88rem;color:var(--text-muted);font-weight:600; }
        .st-readonly-label { font-size:0.68rem;color:var(--text-ghost);margin-left:0.25rem; }

        /* Buttons */
        .st-btn-primary { display:flex;align-items:center;justify-content:center;gap:0.45rem;padding:0.7rem 1.5rem;background:#243F60;color:white;border:none;border-radius:10px;font-size:0.88rem;font-weight:700;cursor:pointer;font-family:inherit;transition:all 0.15s; }
        .st-btn-primary:hover:not(:disabled) { background:#365F91; }
        .st-btn-primary:disabled { opacity:0.45;cursor:not-allowed; }
        .st-btn-secondary { padding:0.7rem 1.5rem;background:var(--bg-page);color:var(--text-secondary);border:1.5px solid var(--border);border-radius:10px;font-size:0.88rem;font-weight:700;cursor:pointer;font-family:inherit;transition:all 0.15s; }
        .st-btn-secondary:hover { border-color:#4BACC6;color:var(--text-primary); }
        .st-btn-danger { padding:0.7rem 1.5rem;background:transparent;color:#C0504D;border:1.5px solid rgba(192,80,77,0.3);border-radius:10px;font-size:0.88rem;font-weight:700;cursor:pointer;font-family:inherit;transition:all 0.15s; }
        .st-btn-danger:hover { background:rgba(192,80,77,0.08);border-color:#C0504D; }
        .st-btn-row { display:flex;align-items:center;gap:0.65rem;flex-wrap:wrap; }

        /* Error / success */
        .st-error { display:flex;align-items:flex-start;gap:0.5rem;background:#fef2f2;border:1px solid #fecaca;border-radius:9px;padding:0.7rem 1rem;font-size:0.82rem;color:#dc2626;font-weight:600;margin-bottom:1rem;line-height:1.45; }
        .st-success { display:flex;align-items:flex-start;gap:0.5rem;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:9px;padding:0.7rem 1rem;font-size:0.82rem;color:#16a34a;font-weight:600;margin-bottom:1rem;line-height:1.45; }

        /* Toggle row */
        .st-toggle-row { display:flex;align-items:center;justify-content:space-between;padding:0.85rem 0;border-bottom:1px solid var(--border-light); }
        .st-toggle-row:last-child { border-bottom:none;padding-bottom:0; }
        .st-toggle-info { flex:1;min-width:0;margin-right:1.5rem; }
        .st-toggle-label { font-size:0.85rem;font-weight:700;color:var(--text-primary); }
        .st-toggle-sub { font-size:0.72rem;color:var(--text-faint);margin-top:0.18rem;line-height:1.45; }

        /* Theme selector */
        .st-theme-grid { display:grid;grid-template-columns:1fr 1fr;gap:0.75rem; }
        .st-theme-option { padding:1.1rem;border:2px solid var(--border);border-radius:12px;cursor:pointer;text-align:center;transition:all 0.15s;background:var(--bg-surface); }
        .st-theme-option:hover { border-color:#4BACC6; }
        .st-theme-option.selected { border-color:#4BACC6;background:#EEF4FB; }
        .st-theme-preview { width:100%;height:56px;border-radius:8px;margin-bottom:0.6rem;overflow:hidden;position:relative; }
        .st-theme-label { font-size:0.8rem;font-weight:700;color:var(--text-primary); }
        .st-theme-sub { font-size:0.68rem;color:var(--text-faint);margin-top:0.15rem; }

        /* Density option */
        .st-density-grid { display:grid;grid-template-columns:1fr 1fr;gap:0.75rem; }
        .st-density-option { padding:1rem;border:2px solid var(--border);border-radius:12px;cursor:pointer;transition:all 0.15s;background:var(--bg-surface); }
        .st-density-option:hover { border-color:#4BACC6; }
        .st-density-option.selected { border-color:#4BACC6;background:#EEF4FB; }
        .st-density-label { font-size:0.82rem;font-weight:700;color:var(--text-primary);margin-bottom:0.3rem; }
        .st-density-sub { font-size:0.72rem;color:var(--text-faint); }

        /* PIN display */
        .st-pin-display { display:flex;align-items:center;gap:0.85rem;padding:1rem;background:var(--bg-page);border:1.5px solid var(--border);border-radius:10px;margin-bottom:1rem; }
        .st-pin-dots { display:flex;gap:0.5rem; }
        .st-pin-dot { width:12px;height:12px;border-radius:50%;background:#4BACC6;transition:all 0.15s; }
        .st-pin-set-label { font-size:0.82rem;font-weight:600;color:var(--text-primary);flex:1; }
        .st-pin-not-set { font-size:0.82rem;color:var(--text-faint);font-style:italic; }

        /* Account section */
        .st-account-danger-zone { border:1.5px solid rgba(192,80,77,0.2);border-radius:12px;overflow:hidden; }
        .st-account-danger-header { background:rgba(192,80,77,0.05);padding:0.85rem 1.1rem;border-bottom:1px solid rgba(192,80,77,0.15); }
        .st-account-danger-title { font-size:0.78rem;font-weight:800;color:#C0504D;text-transform:uppercase;letter-spacing:0.08em; }
        .st-account-danger-body { padding:1.1rem; }
        .st-account-action { display:flex;align-items:center;justify-content:space-between;padding:0.75rem 0;border-bottom:1px solid var(--border-light); }
        .st-account-action:last-child { border-bottom:none;padding-bottom:0; }
        .st-account-action-info { flex:1;min-width:0;margin-right:1rem; }
        .st-account-action-label { font-size:0.85rem;font-weight:700;color:var(--text-primary); }
        .st-account-action-sub { font-size:0.72rem;color:var(--text-faint);margin-top:0.18rem; }

        /* Confirm box */
        .st-confirm { background:rgba(192,80,77,0.06);border:1px solid rgba(192,80,77,0.2);border-radius:10px;padding:1rem 1.1rem;margin-top:0.75rem; }
        .st-confirm-text { font-size:0.82rem;color:var(--text-secondary);margin-bottom:0.75rem;line-height:1.55; }
        .st-confirm-btns { display:flex;gap:0.5rem; }
        .st-confirm-yes { padding:0.45rem 1.1rem;background:#C0504D;color:white;border:none;border-radius:7px;font-size:0.82rem;font-weight:700;cursor:pointer;font-family:inherit; }
        .st-confirm-no { padding:0.45rem 1rem;background:var(--bg-page);color:var(--text-muted);border:1px solid var(--border);border-radius:7px;font-size:0.82rem;font-weight:600;cursor:pointer;font-family:inherit; }

        /* Info row */
        .st-info-row { display:flex;align-items:center;justify-content:space-between;padding:0.7rem 0;border-bottom:1px solid var(--border-light); }
        .st-info-row:last-child { border-bottom:none; }
        .st-info-label { font-size:0.78rem;color:var(--text-faint); }
        .st-info-value { font-size:0.82rem;font-weight:600;color:var(--text-primary);text-align:right; }

        /* Spinner inline */
        .st-spinner { width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 0.7s linear infinite; }

        @media(max-width:768px) {
          .st-layout { grid-template-columns:1fr;padding:1rem 1rem 4rem; }
          .st-nav { position:static; }
          .st-nav-items { display:flex;flex-wrap:wrap;gap:0.25rem;padding:0.5rem; }
          .st-nav-item { width:auto;border-radius:8px;padding:0.5rem 0.85rem; }
          .st-nav-item-desc { display:none; }
          .st-field-row { grid-template-columns:1fr; }
        }
      `}</style>

      <div className="st-page">
        <Navbar fullName={profile?.full_name ?? null} role={profile?.role ?? 'employee'} />

        <div className="st-layout">

          {/* ── Sidebar nav ── */}
          <div className="st-nav">
            <div className="st-nav-profile" onClick={() => navigate(`/profile/${profile?.id}`)}>
              <div className="st-nav-avatar">{ini}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div className="st-nav-name">{profile?.full_name ?? '—'}</div>
                <div className="st-nav-role">{profile?.role} · {dept?.name ?? 'No dept'}</div>
              </div>
              <span style={{ fontSize:'0.75rem', color:'var(--text-ghost)' }}>›</span>
            </div>

            <div className="st-nav-items">
              {SECTIONS.map(s => (
                <button
                  key={s.id}
                  className={`st-nav-item${activeSection === s.id ? ' active' : ''}`}
                  onClick={() => { setActiveSection(s.id); clearMessages() }}
                >
                  <div className="st-nav-item-icon">{s.icon}</div>
                  <div>
                    <div className="st-nav-item-label">{s.label}</div>
                    <div className="st-nav-item-desc">{s.desc}</div>
                  </div>
                </button>
              ))}
            </div>

            <div className="st-nav-ver">InfoWall · v1.0.0</div>
          </div>

          {/* ── Main ── */}
          <div className="st-main" key={activeSection}>

            {/* ════════════════════════════════════
                PROFILE
            ════════════════════════════════════ */}
            {activeSection === 'profile' && (
              <>
                <div className="st-section-header">
                  <div className="st-section-title">Profile Settings</div>
                  <div className="st-section-sub">Update your name, bio and personal information</div>
                </div>

                {/* Avatar card */}
                <div className="st-card">
                  <div className="st-card-header">
                    <span className="st-card-header-icon">🖼</span>
                    <span className="st-card-header-title">Profile picture</span>
                  </div>
                  <div className="st-card-body" style={{ display:'flex', alignItems:'center', gap:'1.25rem' }}>
                    <div style={{ width:72, height:72, borderRadius:'50%', background:'linear-gradient(135deg,#4BACC6,#243F60)', color:'white', fontSize:'1.5rem', fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, border:'3px solid var(--border)' }}>
                      {ini}
                    </div>
                    <div>
                      <div style={{ fontSize:'0.88rem', fontWeight:700, color:'var(--text-primary)', marginBottom:'0.25rem' }}>
                        Avatar initials
                      </div>
                      <div style={{ fontSize:'0.78rem', color:'var(--text-faint)', lineHeight:1.5 }}>
                        Your avatar is generated from your initials. Update your name below to change it.
                      </div>
                    </div>
                  </div>
                </div>

                {/* Personal info */}
                <div className="st-card">
                  <div className="st-card-header">
                    <span className="st-card-header-icon">👤</span>
                    <span className="st-card-header-title">Personal information</span>
                  </div>
                  <div className="st-card-body">
                    {error && <div className="st-error">⚠ {error}</div>}

                    <form onSubmit={handleSaveProfile}>
                      <div className="st-field">
                        <label className="st-label">Full name *</label>
                        <input
                          className="st-input"
                          value={fullName}
                          onChange={e => setFullName(e.target.value)}
                          placeholder="Jane Smith"
                        />
                        <div className="st-hint">Used everywhere in InfoWall — dashboard, messages, kiosk</div>
                      </div>

                      <div className="st-field-row">
                        <div className="st-field">
                          <label className="st-label">Email address</label>
                          <div className="st-readonly">
                            ✉ {profile?.email ?? 'Not set'}
                            <span className="st-readonly-label">Cannot be changed here</span>
                          </div>
                        </div>
                        <div className="st-field">
                          <label className="st-label">Role</label>
                          <div className="st-readonly" style={{ textTransform:'capitalize' }}>
                            🎭 {profile?.role ?? '—'}
                            <span className="st-readonly-label">Set by admin</span>
                          </div>
                        </div>
                      </div>

                      <div className="st-field">
                        <label className="st-label">Department</label>
                        <div className="st-readonly">
                          🏢 {dept?.name ?? 'Unassigned'}
                          <span className="st-readonly-label">Set by admin</span>
                        </div>
                      </div>

                      <div className="st-field">
                        <label className="st-label">Bio</label>
                        <textarea
                          className="st-textarea"
                          value={bio}
                          onChange={e => setBio(e.target.value)}
                          placeholder="Tell your team a bit about yourself…"
                          maxLength={300}
                        />
                        <div className="st-hint">{300 - bio.length} characters remaining · Shown on your profile</div>
                      </div>

                      <div className="st-btn-row">
                        <button type="submit" className="st-btn-primary" disabled={saving}>
                          {saving ? <><div className="st-spinner" /> Saving…</> : 'Save profile'}
                        </button>
                        <button type="button" className="st-btn-secondary" onClick={() => navigate(`/profile/${profile?.id}`)}>
                          View my profile →
                        </button>
                      </div>
                    </form>
                  </div>
                </div>

                {/* Account info */}
                <div className="st-card">
                  <div className="st-card-header">
                    <span className="st-card-header-icon">ℹ</span>
                    <span className="st-card-header-title">Account information</span>
                  </div>
                  <div className="st-card-body">
                    {[
                      { label:'Member since', value: profile?.joined_at ? new Date(profile.joined_at).toLocaleDateString('en-AU', { day:'numeric', month:'long', year:'numeric' }) : 'Unknown' },
                      { label:'Account ID', value: profile?.id?.slice(0,8).toUpperCase() + '…' },
                      { label:'Platform', value: 'InfoWall Enterprise' },
                    ].map(row => (
                      <div key={row.label} className="st-info-row">
                        <span className="st-info-label">{row.label}</span>
                        <span className="st-info-value">{row.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* ════════════════════════════════════
                APPEARANCE
            ════════════════════════════════════ */}
            {activeSection === 'appearance' && (
              <>
                <div className="st-section-header">
                  <div className="st-section-title">Appearance</div>
                  <div className="st-section-sub">Customise how InfoWall looks on your device</div>
                </div>

                {/* Theme */}
                <div className="st-card">
                  <div className="st-card-header">
                    <span className="st-card-header-icon">🌓</span>
                    <span className="st-card-header-title">Theme</span>
                    <span className="st-card-header-sub">Currently: {isDark ? 'Dark' : 'Light'}</span>
                  </div>
                  <div className="st-card-body">
                    <div className="st-theme-grid">
                      {/* Light theme */}
                      <div
                        className={`st-theme-option${!isDark ? ' selected' : ''}`}
                        onClick={() => { if (isDark) toggleTheme() }}
                      >
                        <div className="st-theme-preview" style={{ background:'#F2F4F7', display:'flex', flexDirection:'column', gap:4, padding:'8px 10px' }}>
                          <div style={{ height:8, borderRadius:4, background:'white', width:'60%' }} />
                          <div style={{ height:5, borderRadius:3, background:'#e5e7eb', width:'80%' }} />
                          <div style={{ height:5, borderRadius:3, background:'#e5e7eb', width:'50%' }} />
                          <div style={{ marginTop:2, display:'flex', gap:4 }}>
                            <div style={{ height:16, flex:1, borderRadius:5, background:'#EEF4FB', border:'1px solid #C5D9F1' }} />
                            <div style={{ height:16, flex:2, borderRadius:5, background:'white', border:'1px solid #e5e7eb' }} />
                          </div>
                        </div>
                        <div className="st-theme-label">☀️ Light</div>
                        <div className="st-theme-sub">Clean white interface</div>
                      </div>

                      {/* Dark theme */}
                      <div
                        className={`st-theme-option${isDark ? ' selected' : ''}`}
                        onClick={() => { if (!isDark) toggleTheme() }}
                      >
                        <div className="st-theme-preview" style={{ background:'#0d1520', display:'flex', flexDirection:'column', gap:4, padding:'8px 10px' }}>
                          <div style={{ height:8, borderRadius:4, background:'#152030', width:'60%', border:'1px solid #243447' }} />
                          <div style={{ height:5, borderRadius:3, background:'#1a2b3e', width:'80%' }} />
                          <div style={{ height:5, borderRadius:3, background:'#1a2b3e', width:'50%' }} />
                          <div style={{ marginTop:2, display:'flex', gap:4 }}>
                            <div style={{ height:16, flex:1, borderRadius:5, background:'rgba(75,172,198,0.1)', border:'1px solid rgba(75,172,198,0.2)' }} />
                            <div style={{ height:16, flex:2, borderRadius:5, background:'#152030', border:'1px solid #243447' }} />
                          </div>
                        </div>
                        <div className="st-theme-label">🌙 Dark</div>
                        <div className="st-theme-sub">Easy on the eyes</div>
                      </div>
                    </div>

                    <div style={{ marginTop:'1rem' }}>
                      <div className="st-toggle-row">
                        <div className="st-toggle-info">
                          <div className="st-toggle-label">Follow system preference</div>
                          <div className="st-toggle-sub">Automatically switch theme based on your OS setting</div>
                        </div>
                        <Toggle
                          checked={false}
                          onChange={() => {
                            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
                            if (prefersDark !== isDark) toggleTheme()
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Density */}
                <div className="st-card">
                  <div className="st-card-header">
                    <span className="st-card-header-icon">⊞</span>
                    <span className="st-card-header-title">Display density</span>
                  </div>
                  <div className="st-card-body">
                    <div className="st-density-grid">
                      <div
                        className={`st-density-option${density === 'comfortable' ? ' selected' : ''}`}
                        onClick={() => setDensity('comfortable')}
                      >
                        <div className="st-density-label">Comfortable</div>
                        <div className="st-density-sub">More spacing, easier to read</div>
                      </div>
                      <div
                        className={`st-density-option${density === 'compact' ? ' selected' : ''}`}
                        onClick={() => setDensity('compact')}
                      >
                        <div className="st-density-label">Compact</div>
                        <div className="st-density-sub">Less padding, more content</div>
                      </div>
                    </div>
                    <div style={{ marginTop:'1.1rem' }}>
                      <button className="st-btn-primary" onClick={handleSaveAppearance}>
                        Save appearance
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ════════════════════════════════════
                PASSWORD
            ════════════════════════════════════ */}
            {activeSection === 'password' && (
              <>
                <div className="st-section-header">
                  <div className="st-section-title">Change Password</div>
                  <div className="st-section-sub">Keep your account secure with a strong password</div>
                </div>

                <div className="st-card">
                  <div className="st-card-header">
                    <span className="st-card-header-icon">🔒</span>
                    <span className="st-card-header-title">Update password</span>
                  </div>
                  <div className="st-card-body">
                    {error && <div className="st-error">⚠ {error}</div>}
                    {success && <div className="st-success">✓ {success}</div>}

                    <form onSubmit={handleChangePassword}>
                      <div className="st-field">
                        <label className="st-label">Current password</label>
                        <div className="st-input-wrap">
                          <input
                            className="st-input"
                            type={showCurrentPwd ? 'text' : 'password'}
                            placeholder="Your current password"
                            value={currentPwd}
                            onChange={e => setCurrentPwd(e.target.value)}
                            autoComplete="current-password"
                          />
                          <button type="button" className="st-eye" onClick={() => setShowCurrentPwd(p => !p)}>
                            {showCurrentPwd ? '🙈' : '👁'}
                          </button>
                        </div>
                      </div>

                      <div className="st-field">
                        <label className="st-label">New password</label>
                        <div className="st-input-wrap">
                          <input
                            className="st-input"
                            type={showNewPwd ? 'text' : 'password'}
                            placeholder="Create a strong password"
                            value={newPwd}
                            onChange={e => setNewPwd(e.target.value)}
                            autoComplete="new-password"
                          />
                          <button type="button" className="st-eye" onClick={() => setShowNewPwd(p => !p)}>
                            {showNewPwd ? '🙈' : '👁'}
                          </button>
                        </div>
                        <PasswordStrengthBar password={newPwd} />
                      </div>

                      <div className="st-field">
                        <label className="st-label">Confirm new password</label>
                        <div className="st-input-wrap">
                          <input
                            className={`st-input${confirmPwd && confirmPwd !== newPwd ? ' error' : ''}`}
                            type={showConfirmPwd ? 'text' : 'password'}
                            placeholder="Repeat your new password"
                            value={confirmPwd}
                            onChange={e => setConfirmPwd(e.target.value)}
                            autoComplete="new-password"
                          />
                          <button type="button" className="st-eye" onClick={() => setShowConfirmPwd(p => !p)}>
                            {showConfirmPwd ? '🙈' : '👁'}
                          </button>
                        </div>
                        {confirmPwd && confirmPwd !== newPwd && (
                          <div style={{ fontSize:'0.72rem', color:'#ef4444', marginTop:'0.3rem', fontWeight:600 }}>Passwords do not match</div>
                        )}
                        {confirmPwd && confirmPwd === newPwd && newPwd.length > 0 && (
                          <div style={{ fontSize:'0.72rem', color:'#16a34a', marginTop:'0.3rem', fontWeight:600 }}>✓ Passwords match</div>
                        )}
                      </div>

                      <button
                        type="submit"
                        className="st-btn-primary"
                        disabled={saving || !currentPwd || !newPwd || !confirmPwd}
                      >
                        {saving ? <><div className="st-spinner" /> Updating…</> : '🔒 Update password'}
                      </button>
                    </form>
                  </div>
                </div>

                <div className="st-card">
                  <div className="st-card-header">
                    <span className="st-card-header-icon">📬</span>
                    <span className="st-card-header-title">Forgot your password?</span>
                  </div>
                  <div className="st-card-body">
                    <p style={{ fontSize:'0.85rem', color:'var(--text-muted)', lineHeight:1.65, marginBottom:'1rem' }}>
                      If you've forgotten your current password, you can request a reset link sent to your email address.
                    </p>
                    <button
                      className="st-btn-secondary"
                      onClick={async () => {
                        const { data: { user } } = await supabase.auth.getUser()
                        if (!user?.email) return
                        await supabase.auth.resetPasswordForEmail(user.email, { redirectTo: `${window.location.origin}/login` })
                        setSuccess('Reset link sent to your email!')
                      }}
                    >
                      📬 Send reset link to my email
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* ════════════════════════════════════
                KIOSK PIN
            ════════════════════════════════════ */}
            {activeSection === 'pin' && (
              <>
                <div className="st-section-header">
                  <div className="st-section-title">Kiosk PIN</div>
                  <div className="st-section-sub">Manage the 4-digit PIN you use to clock in at the kiosk terminal</div>
                </div>

                {/* Current PIN status */}
                <div className="st-card">
                  <div className="st-card-header">
                    <span className="st-card-header-icon">🖥</span>
                    <span className="st-card-header-title">Current PIN status</span>
                  </div>
                  <div className="st-card-body">
                    {profile?.kiosk_pin ? (
                      <>
                        <div className="st-pin-display">
                          <div className="st-pin-dots">
                            {[0,1,2,3].map(i => (
                              <div key={i} className="st-pin-dot" style={{ background: pinVisible ? 'transparent' : '#4BACC6', border: pinVisible ? '2px solid #4BACC6' : 'none' }}>
                              </div>
                            ))}
                          </div>
                          <div className="st-pin-set-label">
                            {pinVisible ? <span style={{ fontFamily:'monospace', fontSize:'1.1rem', letterSpacing:'0.3em', color:'#4BACC6' }}>{profile.kiosk_pin}</span> : 'PIN set ✓'}
                          </div>
                          <button
                            onClick={() => setPinVisible(p => !p)}
                            style={{ background:'none', border:'none', color:'var(--text-faint)', cursor:'pointer', fontSize:'0.8rem', fontWeight:600, fontFamily:'inherit', padding:'0.2rem 0.5rem', borderRadius:6, transition:'all 0.12s' }}
                          >
                            {pinVisible ? '🙈 Hide' : '👁 Show'}
                          </button>
                        </div>
                        <div className="st-hint" style={{ marginBottom:'1rem' }}>
                          Your PIN is used at the kiosk terminal to clock in and out. Keep it private.
                        </div>
                        <button className="st-btn-danger" onClick={handleRemovePin}>Remove PIN</button>
                      </>
                    ) : (
                      <div style={{ padding:'1rem', background:'var(--bg-page)', border:'1.5px dashed var(--border)', borderRadius:10, textAlign:'center', color:'var(--text-faint)', fontSize:'0.85rem', marginBottom:'1rem' }}>
                        <div style={{ fontSize:'1.5rem', marginBottom:'0.5rem' }}>🖥</div>
                        No PIN set — you won't be able to clock in at the kiosk until you set one.
                      </div>
                    )}
                  </div>
                </div>

                {/* Set new PIN */}
                <div className="st-card">
                  <div className="st-card-header">
                    <span className="st-card-header-icon">✏️</span>
                    <span className="st-card-header-title">{profile?.kiosk_pin ? 'Change PIN' : 'Set a PIN'}</span>
                  </div>
                  <div className="st-card-body">
                    {error && <div className="st-error">⚠ {error}</div>}
                    {success && <div className="st-success">✓ {success}</div>}

                    <form onSubmit={handleSavePin}>
                      <div className="st-field-row">
                        <div className="st-field">
                          <label className="st-label">New PIN (4 digits)</label>
                          <input
                            className="st-input"
                            type="password"
                            placeholder="e.g. 1234"
                            value={newPin}
                            onChange={e => setNewPin(e.target.value.replace(/\D/g,'').slice(0,4))}
                            maxLength={4}
                            inputMode="numeric"
                            pattern="\d{4}"
                          />
                        </div>
                        <div className="st-field">
                          <label className="st-label">Confirm new PIN</label>
                          <input
                            className={`st-input${confirmPin && confirmPin !== newPin ? ' error' : ''}`}
                            type="password"
                            placeholder="Repeat PIN"
                            value={confirmPin}
                            onChange={e => setConfirmPin(e.target.value.replace(/\D/g,'').slice(0,4))}
                            maxLength={4}
                            inputMode="numeric"
                          />
                          {confirmPin && confirmPin !== newPin && (
                            <div style={{ fontSize:'0.72rem', color:'#ef4444', marginTop:'0.3rem', fontWeight:600 }}>PINs do not match</div>
                          )}
                          {confirmPin && confirmPin === newPin && newPin.length === 4 && (
                            <div style={{ fontSize:'0.72rem', color:'#16a34a', marginTop:'0.3rem', fontWeight:600 }}>✓ PINs match</div>
                          )}
                        </div>
                      </div>

                      <div className="st-hint" style={{ marginBottom:'1rem' }}>
                        PIN must be exactly 4 digits. Avoid obvious combinations like 0000 or 1234 if you share a kiosk.
                      </div>

                      <button
                        type="submit"
                        className="st-btn-primary"
                        disabled={saving || newPin.length !== 4 || confirmPin.length !== 4}
                      >
                        {saving ? <><div className="st-spinner" /> Saving…</> : `🖥 ${profile?.kiosk_pin ? 'Update' : 'Set'} PIN`}
                      </button>
                    </form>
                  </div>
                </div>
              </>
            )}

            {/* ════════════════════════════════════
                NOTIFICATIONS
            ════════════════════════════════════ */}
            {activeSection === 'notifications' && (
              <>
                <div className="st-section-header">
                  <div className="st-section-title">Notifications</div>
                  <div className="st-section-sub">Choose what you get notified about</div>
                </div>

                <div className="st-card">
                  <div className="st-card-header">
                    <span className="st-card-header-icon">💬</span>
                    <span className="st-card-header-title">In-app notifications</span>
                  </div>
                  <div className="st-card-body">
                    {[
                      {
                        label: '@Mentions in messages',
                        sub: 'Get notified when someone @mentions you in a direct message or group chat',
                        value: notifMentions, set: setNotifMentions,
                      },
                      {
                        label: 'Must-read posts',
                        sub: 'Alert when HR or managers publish a post that requires your acknowledgement',
                        value: notifMustRead, set: setNotifMustRead,
                      },
                      {
                        label: 'New direct messages',
                        sub: 'Badge count on the Messages icon when you have unread messages',
                        value: notifMessages, set: setNotifMessages,
                      },
                      {
                        label: 'Likes on your feed posts',
                        sub: 'Notify when someone likes something you posted on the news feed',
                        value: notifFeedLikes, set: setNotifFeedLikes,
                      },
                    ].map(pref => (
                      <div key={pref.label} className="st-toggle-row">
                        <div className="st-toggle-info">
                          <div className="st-toggle-label">{pref.label}</div>
                          <div className="st-toggle-sub">{pref.sub}</div>
                        </div>
                        <Toggle checked={pref.value} onChange={pref.set} />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="st-card">
                  <div className="st-card-header">
                    <span className="st-card-header-icon">🔕</span>
                    <span className="st-card-header-title">Do not disturb</span>
                  </div>
                  <div className="st-card-body">
                    <div className="st-toggle-row">
                      <div className="st-toggle-info">
                        <div className="st-toggle-label">Mute all notifications</div>
                        <div className="st-toggle-sub">Silence all in-app alerts temporarily — useful during meetings or focus time</div>
                      </div>
                      <Toggle
                        checked={!notifMentions && !notifMustRead && !notifMessages && !notifFeedLikes}
                        onChange={v => {
                          setNotifMentions(!v); setNotifMustRead(!v); setNotifMessages(!v); setNotifFeedLikes(false)
                        }}
                      />
                    </div>
                  </div>
                </div>

                <div style={{ display:'flex', gap:'0.65rem' }}>
                  <button className="st-btn-primary" onClick={handleSaveNotifPrefs}>
                    Save preferences
                  </button>
                  <button
                    className="st-btn-secondary"
                    onClick={() => {
                      setNotifMentions(true); setNotifMustRead(true); setNotifMessages(true); setNotifFeedLikes(false)
                    }}
                  >
                    Reset to defaults
                  </button>
                </div>
              </>
            )}

            {/* ════════════════════════════════════
                ACCOUNT
            ════════════════════════════════════ */}
            {activeSection === 'account' && (
              <>
                <div className="st-section-header">
                  <div className="st-section-title">Account</div>
                  <div className="st-section-sub">Manage your session and account settings</div>
                </div>

                {/* Sessions */}
                <div className="st-card">
                  <div className="st-card-header">
                    <span className="st-card-header-icon">🔑</span>
                    <span className="st-card-header-title">Current session</span>
                  </div>
                  <div className="st-card-body">
                    <div className="st-info-row">
                      <span className="st-info-label">Account</span>
                      <span className="st-info-value">{profile?.email ?? '—'}</span>
                    </div>
                    <div className="st-info-row">
                      <span className="st-info-label">Role</span>
                      <span className="st-info-value" style={{ textTransform:'capitalize' }}>{profile?.role}</span>
                    </div>
                    <div className="st-info-row">
                      <span className="st-info-label">Department</span>
                      <span className="st-info-value">{dept?.name ?? 'Unassigned'}</span>
                    </div>
                    <div style={{ marginTop:'1.1rem' }}>
                      <button
                        className="st-btn-secondary"
                        onClick={() => setShowSignOutConfirm(p => !p)}
                      >
                        ⏻ Sign out
                      </button>
                      {showSignOutConfirm && (
                        <div className="st-confirm">
                          <div className="st-confirm-text">
                            Are you sure you want to sign out? You'll need your password to sign back in.
                          </div>
                          <div className="st-confirm-btns">
                            <button className="st-confirm-yes" onClick={handleSignOut}>Yes, sign out</button>
                            <button className="st-confirm-no" onClick={() => setShowSignOutConfirm(false)}>Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Danger zone */}
                <div className="st-account-danger-zone">
                  <div className="st-account-danger-header">
                    <div className="st-account-danger-title">⚠ Danger zone</div>
                  </div>
                  <div className="st-account-danger-body">
                    <div className="st-account-action">
                      <div className="st-account-action-info">
                        <div className="st-account-action-label">Export my data</div>
                        <div className="st-account-action-sub">Download a copy of all your posts, messages and activity</div>
                      </div>
                      <button
                        className="st-btn-danger"
                        onClick={async () => {
                          const { data: posts } = await supabase.from('feed_posts').select('*').eq('author_id', profile?.id)
                          const blob = new Blob([JSON.stringify({ profile, posts }, null, 2)], { type:'application/json' })
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement('a')
                          a.href = url; a.download = `infowall-export-${profile?.full_name?.replace(/\s/g,'-')}.json`
                          a.click(); URL.revokeObjectURL(url)
                        }}
                      >
                        Export
                      </button>
                    </div>

                    <div className="st-account-action">
                      <div className="st-account-action-info">
                        <div className="st-account-action-label">Delete account</div>
                        <div className="st-account-action-sub">Permanently remove your account and all associated data. This cannot be undone.</div>
                      </div>
                      <button className="st-btn-danger" onClick={() => setShowDeleteConfirm(p => !p)}>
                        Delete
                      </button>
                    </div>

                    {showDeleteConfirm && (
                      <div className="st-confirm" style={{ margin:'0.75rem 0 0' }}>
                        <div className="st-confirm-text">
                          <strong>This is permanent and cannot be undone.</strong> All your posts, messages, and attendance records will be deleted. To proceed, please contact your system administrator.
                        </div>
                        <div className="st-confirm-btns">
                          <button className="st-confirm-no" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <SaveBanner show={saved} saving={saving} />
    </>
  )
}
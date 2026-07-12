import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import GlobalSearch from './GlobalSearch'
import { useTheme } from '../contexts/ThemeContext'

interface NavbarProps { fullName: string | null; role: string }
interface Notification {
  id: string; type: string; actor_id: string | null; content: string | null
  read: boolean; created_at: string
  actor?: { full_name: string | null } | null
}

function getInitials(name: string | null): string {
  if (!name) return '?'
  return name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase()
}
function timeAgo(d: string): string {
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

const NAV_LINKS = (role: string) => [
  { path: '/dashboard',   label: 'Dashboard',   icon: '⊞',  show: true },
  { path: '/feed',        label: 'News Feed',   icon: '◎',  show: true },
  { path: '/messages',    label: 'Messages',    icon: '✉',  show: true },
  { path: '/create-post', label: 'Create Post', icon: '✦',  show: ['hr', 'manager', 'admin'].includes(role) },
  { path: '/admin',       label: 'Admin',       icon: '⚙',  show: role === 'admin' },
]

export default function Navbar({ fullName, role }: NavbarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [scrolled, setScrolled] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [showNotifs, setShowNotifs] = useState(false)
  const [unreadNotifCount, setUnreadNotifCount] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const notifRef = useRef<HTMLDivElement>(null)

  async function loadUnread(uid: string) {
    const { data: convs } = await supabase.from('conversations').select('id').or(`user1_id.eq.${uid},user2_id.eq.${uid}`)
    if (!convs || convs.length === 0) return
    const { count } = await supabase.from('messages').select('id', { count: 'exact', head: true }).in('conversation_id', convs.map(c => c.id)).neq('sender_id', uid).is('read_at', null)
    setUnreadCount(count ?? 0)
  }

  async function loadNotifications(uid: string) {
    const { data } = await supabase.from('notifications').select('*, actor:profiles!actor_id(full_name)').eq('user_id', uid).order('created_at', { ascending: false }).limit(20)
    if (data) { setNotifications(data as Notification[]); setUnreadNotifCount(data.filter(n => !n.read).length) }
  }

  async function markAllRead() {
    if (!currentUserId) return
    await supabase.from('notifications').update({ read: true }).eq('user_id', currentUserId).eq('read', false)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    setUnreadNotifCount(0)
  }

  async function markOneRead(id: string) {
    await supabase.from('notifications').update({ read: true }).eq('id', id)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
    setUnreadNotifCount(prev => Math.max(0, prev - 1))
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setCurrentUserId(user.id)
      loadUnread(user.id)
      loadNotifications(user.id)
      const channel = supabase.channel('navbar-realtime')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => loadUnread(user.id))
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, () => loadUnread(user.id))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, async (payload) => {
          const n = payload.new as Notification
          const { data: actor } = await supabase.from('profiles').select('full_name').eq('id', n.actor_id ?? '').single()
          setNotifications(prev => [{ ...n, actor: actor ?? null }, ...prev])
          setUnreadNotifCount(c => c + 1)
        })
        .subscribe()
      return () => { supabase.removeChannel(channel) }
    })
  }, [])

  // Cmd+K opens search
  useEffect(() => {
    function h(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(o => !o) }
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [])

  useEffect(() => {
    if (!showNotifs) return
    function h(e: MouseEvent) {
      if (!notifRef.current?.contains(e.target as Node)) setShowNotifs(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [showNotifs])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => { setMenuOpen(false) }, [location.pathname])
  useEffect(() => { document.body.style.overflow = menuOpen ? 'hidden' : ''; return () => { document.body.style.overflow = '' } }, [menuOpen])

  async function handleSignOut() { await supabase.auth.signOut(); navigate('/login') }
  function goTo(path: string) { navigate(path); setMenuOpen(false); setShowNotifs(false) }

  function getNotifIcon(type: string) {
    if (type === 'mention_message') return '💬'
    if (type === 'mention_comment') return '📢'
    return '🔔'
  }
  function getNotifLabel(n: Notification) {
    const actor = n.actor?.full_name ?? 'Someone'
    if (n.type === 'mention_message') return `${actor} mentioned you in a message`
    if (n.type === 'mention_comment') return `${actor} mentioned you in a thread`
    return `${actor} sent you a notification`
  }
  function handleNotifClick(n: Notification) {
    markOneRead(n.id)
    if (n.type === 'mention_message') navigate('/messages')
    else if (n.type === 'mention_comment') navigate('/dashboard')
    setShowNotifs(false)
  }

  const links = NAV_LINKS(role).filter(l => l.show)
  const isActive = (path: string) => location.pathname.startsWith(path)
  const roleColors: Record<string, string> = { admin: '#fca5a5', hr: '#c4b5fd', manager: '#93c5fd', employee: '#86efac' }
  const roleColor = roleColors[role] ?? 'rgba(255,255,255,0.5)'

  return (
    <>
      <style>{`
        :root { --nav-h: 60px; }
        .navbar-outer { position:sticky;top:0;z-index:300;height:var(--nav-h);background:#1B2B3A;border-bottom:1px solid rgba(255,255,255,0.07);transition:box-shadow 0.25s ease; }
        .navbar-outer.scrolled { box-shadow:0 4px 24px rgba(0,0,0,0.25); }
        .navbar-inner { height:100%;max-width:1600px;margin:0 auto;padding:0 1.5rem;display:flex;align-items:center;gap:0; }

        .nav-brand { display:flex;align-items:center;gap:0.6rem;text-decoration:none;border:none;background:none;cursor:pointer;padding:0;margin-right:1.25rem;flex-shrink:0;transition:opacity 0.15s; }
        .nav-brand:hover { opacity:0.85; }
        .nav-brand-mark { width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,#4BACC6 0%,#365F91 100%);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 8px rgba(75,172,198,0.35); }
        .nav-brand-mark svg { width:15px;height:15px; }
        .nav-brand-name { font-size:0.95rem;font-weight:900;color:white;letter-spacing:-0.02em;line-height:1.1; }
        .nav-brand-tagline { font-size:0.56rem;font-weight:700;color:rgba(75,172,198,0.7);letter-spacing:0.12em;text-transform:uppercase;line-height:1; }

        .nav-sep { width:1px;height:22px;background:rgba(255,255,255,0.08);margin:0 0.25rem;flex-shrink:0; }

        /* ── Search bar in nav ── */
        .nav-search-btn {
          display:flex;align-items:center;gap:0.5rem;
          padding:0.38rem 0.85rem;
          background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);
          border-radius:8px;cursor:pointer;transition:all 0.15s;
          color:rgba(255,255,255,0.4);font-size:0.8rem;font-family:inherit;
          white-space:nowrap;margin-right:0.5rem;flex-shrink:0;
          min-width:180px;
        }
        .nav-search-btn:hover { background:rgba(255,255,255,0.1);border-color:rgba(255,255,255,0.2);color:rgba(255,255,255,0.7); }
        .nav-search-icon { font-size:0.82rem; }
        .nav-search-label { flex:1; }
        .nav-search-kbd { font-size:0.58rem;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);border-radius:4px;padding:0.1rem 0.38rem;font-family:monospace;color:rgba(255,255,255,0.3); }

        .nav-links { display:flex;align-items:center;gap:0.1rem;flex:1; }
        .nav-link { position:relative;display:flex;align-items:center;gap:0.45rem;padding:0.42rem 0.9rem;border-radius:8px;border:none;background:transparent;font-size:0.84rem;font-weight:500;color:rgba(255,255,255,0.5);cursor:pointer;transition:all 0.15s;white-space:nowrap;font-family:inherit; }
        .nav-link-icon { font-size:0.78rem;line-height:1;opacity:0.7;transition:opacity 0.15s; }
        .nav-link:hover { background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.85); }
        .nav-link:hover .nav-link-icon { opacity:1; }
        .nav-link.active { background:rgba(75,172,198,0.12);color:white;font-weight:600; }
        .nav-link.active .nav-link-icon { opacity:1;color:#4BACC6; }
        .nav-link.active::after { content:'';position:absolute;bottom:-1px;left:50%;transform:translateX(-50%);width:18px;height:2px;background:linear-gradient(90deg,#4BACC6,#4F81BD);border-radius:999px; }
        .nav-badge { min-width:17px;height:17px;background:#C0504D;color:white;border-radius:999px;font-size:0.58rem;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 4px;line-height:1;box-shadow:0 2px 6px rgba(192,80,77,0.5);animation:badgePop 0.3s cubic-bezier(0.34,1.56,0.64,1); }
        @keyframes badgePop { from{transform:scale(0);opacity:0} to{transform:scale(1);opacity:1} }

        .nav-right { display:flex;align-items:center;gap:0.65rem;margin-left:auto;flex-shrink:0; }
        .nav-user-info { display:flex;flex-direction:column;align-items:flex-end; }
        .nav-user-name { font-size:0.8rem;font-weight:700;color:rgba(255,255,255,0.88);line-height:1.2;white-space:nowrap;max-width:140px;overflow:hidden;text-overflow:ellipsis; }
        .nav-user-role { font-size:0.62rem;font-weight:700;text-transform:capitalize;line-height:1.2; }

        /* Notification bell */
        .notif-bell-wrap { position:relative;flex-shrink:0; }
        .notif-bell { width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.18s;font-size:0.88rem;position:relative; }
        .notif-bell:hover { background:rgba(255,255,255,0.12); }
        .notif-bell.has-unread { background:rgba(75,172,198,0.1);border-color:rgba(75,172,198,0.3); }
        .notif-bell-badge { position:absolute;top:-3px;right:-3px;min-width:16px;height:16px;border-radius:999px;background:#C0504D;color:white;font-size:0.55rem;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 3px;border:2px solid #1B2B3A;animation:badgePop 0.3s cubic-bezier(0.34,1.56,0.64,1); }

        @keyframes notifIn { from{opacity:0;transform:translateY(-8px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }
        .notif-dropdown { position:absolute;top:calc(100% + 10px);right:-8px;width:340px;max-height:480px;background:white;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,0.15);z-index:400;overflow:hidden;display:flex;flex-direction:column;animation:notifIn 0.2s cubic-bezier(0.34,1.1,0.64,1); }
        .notif-header { display:flex;align-items:center;justify-content:space-between;padding:0.85rem 1.1rem;border-bottom:1px solid #f3f4f6;flex-shrink:0; }
        .notif-header-title { font-size:0.9rem;font-weight:800;color:#1A2B3C;display:flex;align-items:center;gap:0.4rem; }
        .notif-header-badge { background:#EEF4FB;color:#365F91;border-radius:999px;font-size:0.65rem;font-weight:800;padding:0.1rem 0.45rem; }
        .notif-mark-all { font-size:0.72rem;color:#4BACC6;font-weight:700;cursor:pointer;background:none;border:none;font-family:inherit; }
        .notif-mark-all:hover { color:#243F60; }
        .notif-list { overflow-y:auto;flex:1; }
        .notif-list::-webkit-scrollbar { width:3px; }
        .notif-list::-webkit-scrollbar-thumb { background:#e5e7eb;border-radius:999px; }
        .notif-item { display:flex;align-items:flex-start;gap:0.75rem;padding:0.85rem 1.1rem;cursor:pointer;transition:background 0.1s;border-bottom:1px solid #f9fafb; }
        .notif-item:hover { background:#f9fafb; }
        .notif-item.unread { background:#EEF4FB; }
        .notif-item.unread:hover { background:#e3edf8; }
        .notif-icon-wrap { width:34px;height:34px;border-radius:50%;background:#EEF4FB;border:1px solid #C5D9F1;display:flex;align-items:center;justify-content:center;font-size:0.85rem;flex-shrink:0; }
        .notif-body { flex:1;min-width:0; }
        .notif-label { font-size:0.8rem;font-weight:600;color:#1A2B3C;line-height:1.4;margin-bottom:0.2rem; }
        .notif-item.unread .notif-label { font-weight:700; }
        .notif-preview { font-size:0.75rem;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:0.2rem; }
        .notif-time { font-size:0.68rem;color:#9ca3af; }
        .notif-unread-dot { width:7px;height:7px;border-radius:50%;background:#4BACC6;flex-shrink:0;margin-top:5px; }
        .notif-empty { padding:2.5rem;text-align:center;color:#9ca3af;font-size:0.85rem;display:flex;flex-direction:column;align-items:center;gap:0.5rem; }

        .nav-avatar-wrap { position:relative;flex-shrink:0; }
        .nav-avatar { width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#4BACC6,#243F60);color:white;font-size:0.72rem;font-weight:800;display:flex;align-items:center;justify-content:center;border:2px solid rgba(255,255,255,0.1);cursor:pointer;transition:all 0.18s;user-select:none; }
        .nav-avatar:hover { border-color:#4BACC6;box-shadow:0 0 0 3px rgba(75,172,198,0.2);transform:scale(1.06); }
        .nav-avatar-tooltip { position:absolute;bottom:calc(100% + 10px);right:0;background:#0f1d2a;color:white;font-size:0.72rem;font-weight:600;padding:0.4rem 0.8rem;border-radius:8px;white-space:nowrap;pointer-events:none;opacity:0;transform:translateY(5px);transition:all 0.18s;z-index:50;border:1px solid rgba(255,255,255,0.08); }
        .nav-avatar-tooltip::after { content:'';position:absolute;top:100%;right:11px;border:5px solid transparent;border-top-color:#0f1d2a; }
        .nav-avatar-wrap:hover .nav-avatar-tooltip { opacity:1;transform:translateY(0); }

        .nav-signout { display:flex;align-items:center;gap:0.35rem;padding:0.38rem 0.85rem;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:rgba(255,255,255,0.5);font-size:0.78rem;font-weight:600;cursor:pointer;transition:all 0.15s;white-space:nowrap;font-family:inherit; }
        .nav-signout:hover { background:rgba(192,80,77,0.12);border-color:rgba(192,80,77,0.3);color:#fca5a5; }

        .nav-hamburger { display:none;flex-direction:column;justify-content:center;align-items:center;gap:5px;width:38px;height:38px;background:transparent;border:none;border-radius:8px;cursor:pointer;flex-shrink:0; }
        .nav-hamburger:hover { background:rgba(255,255,255,0.07); }
        .ham-bar { width:18px;height:2px;background:rgba(255,255,255,0.75);border-radius:2px;transition:transform 0.25s,opacity 0.2s,width 0.2s; }
        .nav-hamburger.open .ham-bar:nth-child(1) { transform:translateY(7px) rotate(45deg); }
        .nav-hamburger.open .ham-bar:nth-child(2) { opacity:0;width:0; }
        .nav-hamburger.open .ham-bar:nth-child(3) { transform:translateY(-7px) rotate(-45deg); }

        .nav-mobile-backdrop { position:fixed;inset:0;top:var(--nav-h);background:rgba(0,0,0,0.5);z-index:250;opacity:0;pointer-events:none;transition:opacity 0.22s ease;backdrop-filter:blur(2px); }
        .nav-mobile-backdrop.open { opacity:1;pointer-events:auto; }
        .nav-mobile-drawer { position:absolute;top:0;left:0;right:0;background:#1B2B3A;border-bottom:1px solid rgba(255,255,255,0.08);padding:0.75rem 1rem 1.25rem;transform:translateY(-8px);opacity:0;transition:transform 0.22s ease,opacity 0.22s ease;max-height:0;overflow:hidden; }
        .nav-mobile-backdrop.open .nav-mobile-drawer { transform:translateY(0);opacity:1;max-height:700px; }

        .mob-user-row { display:flex;align-items:center;gap:0.85rem;padding:0.85rem;margin-bottom:0.6rem;background:rgba(255,255,255,0.05);border-radius:12px;border:1px solid rgba(255,255,255,0.06);cursor:pointer;transition:background 0.12s; }
        .mob-user-row:hover { background:rgba(75,172,198,0.1); }
        .mob-avatar { width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#4BACC6,#243F60);color:white;font-size:0.9rem;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0; }
        .mob-name { font-size:0.92rem;font-weight:700;color:white;display:block;line-height:1.3; }
        .mob-role { font-size:0.72rem;font-weight:700;text-transform:capitalize;display:block;margin-top:0.1rem; }

        /* Mobile search row */
        .mob-search-btn { display:flex;align-items:center;gap:0.6rem;width:100%;padding:0.72rem 0.85rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:9px;font-size:0.88rem;font-weight:500;color:rgba(255,255,255,0.55);cursor:pointer;transition:all 0.12s;font-family:inherit;margin-bottom:0.6rem; }
        .mob-search-btn:hover { background:rgba(255,255,255,0.1);color:white; }

        .mob-links-section { margin-bottom:0.6rem; }
        .mob-section-label { font-size:0.6rem;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.1em;padding:0.5rem 0.85rem 0.3rem;display:block; }
        .mob-link { display:flex;align-items:center;gap:0.75rem;width:100%;padding:0.72rem 0.85rem;background:transparent;border:none;border-radius:9px;font-size:0.88rem;font-weight:500;color:rgba(255,255,255,0.65);cursor:pointer;transition:all 0.12s;text-align:left;font-family:inherit;margin-bottom:0.1rem; }
        .mob-link:hover { background:rgba(255,255,255,0.06);color:white; }
        .mob-link.active { background:rgba(75,172,198,0.12);color:white;font-weight:700; }
        .mob-link-icon { width:28px;height:28px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:0.82rem;flex-shrink:0;background:rgba(255,255,255,0.06); }
        .mob-link.active .mob-link-icon { background:rgba(75,172,198,0.2);color:#4BACC6; }
        .mob-divider { height:1px;background:rgba(255,255,255,0.07);margin:0.6rem 0; }
        .mob-signout { width:100%;padding:0.72rem 0.85rem;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:9px;color:rgba(255,255,255,0.65);font-size:0.85rem;font-weight:600;cursor:pointer;transition:all 0.15s;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:0.5rem; }
        .mob-signout:hover { background:rgba(192,80,77,0.12);border-color:rgba(192,80,77,0.3);color:#fca5a5; }

        @media(max-width:1200px) {
          .nav-search-btn { min-width:140px; }
          .nav-search-label { display:none; }
          .nav-search-btn { min-width:auto;padding:0.38rem 0.65rem; }
        }
        @media(max-width:1100px) {
          .navbar-inner { padding:0 1rem; }
          .nav-link { padding:0.4rem 0.7rem;font-size:0.8rem; }
          .nav-user-info { display:none; }
          .nav-brand-tagline { display:none; }
        }
        @media(max-width:768px) {
          .nav-links,.nav-sep,.nav-user-info,.nav-signout,.nav-avatar-wrap,.nav-search-btn { display:none; }
          .nav-hamburger { display:flex; }
          .navbar-inner { padding:0 1rem; }
          .notif-dropdown { right:-60px;width:300px; }
        }
      `}</style>

      <div className={`navbar-outer${scrolled ? ' scrolled' : ''}`}>
        <div className="navbar-inner">

          <button className="nav-brand" onClick={() => goTo('/dashboard')}>
            <div className="nav-brand-mark">
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/>
                <rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>
              </svg>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span className="nav-brand-name">InfoWall</span>
              <span className="nav-brand-tagline">Enterprise</span>
            </div>
          </button>

          {/* ── Search button ── */}
          <button className="nav-search-btn" onClick={() => setSearchOpen(true)}>
            <span className="nav-search-icon">🔍</span>
            <span className="nav-search-label">Search everything…</span>
            <kbd className="nav-search-kbd">⌘K</kbd>
          </button>

          <div className="nav-sep" />

          <nav className="nav-links">
            {links.map(link => (
              <button key={link.path} className={`nav-link${isActive(link.path) ? ' active' : ''}`} onClick={() => goTo(link.path)}>
                <span className="nav-link-icon">{link.icon}</span>
                {link.label}
                {link.path === '/messages' && unreadCount > 0 && (
                  <span className="nav-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
                )}
              </button>
            ))}
          </nav>

          <div className="nav-right">
            <div className="nav-user-info">
              <span className="nav-user-name">{fullName ?? ''}</span>
              <span className="nav-user-role" style={{ color: roleColor }}>{role}</span>
            </div>

            {/* Notification bell */}
            <div className="notif-bell-wrap" ref={notifRef}>
              <button className={`notif-bell${unreadNotifCount > 0 ? ' has-unread' : ''}`} onClick={() => setShowNotifs(o => !o)} title="Notifications">
                🔔
                {unreadNotifCount > 0 && <span className="notif-bell-badge">{unreadNotifCount > 99 ? '99+' : unreadNotifCount}</span>}
              </button>

              {showNotifs && (
                <div className="notif-dropdown">
                  <div className="notif-header">
                    <div className="notif-header-title">
                      Notifications
                      {unreadNotifCount > 0 && <span className="notif-header-badge">{unreadNotifCount} new</span>}
                    </div>
                    {unreadNotifCount > 0 && <button className="notif-mark-all" onClick={markAllRead}>Mark all read</button>}
                  </div>
                  <div className="notif-list">
                    {notifications.length === 0 ? (
                      <div className="notif-empty">
                        <div style={{ fontSize: '2rem', opacity: 0.4 }}>🔔</div>
                        <div style={{ fontWeight: 600, color: '#374151' }}>No notifications yet</div>
                        <div>Mentions and alerts will appear here</div>
                      </div>
                    ) : notifications.map(n => (
                      <div key={n.id} className={`notif-item${!n.read ? ' unread' : ''}`} onClick={() => handleNotifClick(n)}>
                        <div className="notif-icon-wrap">{getNotifIcon(n.type)}</div>
                        <div className="notif-body">
                          <div className="notif-label">{getNotifLabel(n)}</div>
                          {n.content && <div className="notif-preview">"{n.content}"</div>}
                          <div className="notif-time">{timeAgo(n.created_at)}</div>
                        </div>
                        {!n.read && <div className="notif-unread-dot" />}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="nav-avatar-wrap">
              <div className="nav-avatar" onClick={() => currentUserId && goTo(`/profile/${currentUserId}`)}>
                {getInitials(fullName)}
              </div>
              <div className="nav-avatar-tooltip">My profile</div>
            </div>

            <button className="nav-signout" onClick={handleSignOut}>
              <span style={{ fontSize: '0.78rem' }}>⏻</span>Sign out
            </button>
          </div>

          <button className={`nav-hamburger${menuOpen ? ' open' : ''}`} onClick={() => setMenuOpen(o => !o)}>
            <span className="ham-bar"/><span className="ham-bar"/><span className="ham-bar"/>
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      <div className={`nav-mobile-backdrop${menuOpen ? ' open' : ''}`} onClick={() => setMenuOpen(false)}>
        <div className="nav-mobile-drawer" onClick={e => e.stopPropagation()}>
          <div className="mob-user-row" onClick={() => { currentUserId && goTo(`/profile/${currentUserId}`) }}>
            <div className="mob-avatar">{getInitials(fullName)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span className="mob-name">{fullName ?? 'My profile'}</span>
              <span className="mob-role" style={{ color: roleColor }}>{role}</span>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.25)' }}>›</span>
          </div>

          {/* Mobile search */}
          <button className="mob-search-btn" onClick={() => { setMenuOpen(false); setSearchOpen(true) }}>
            <span>🔍</span> Search everything…
          </button>

          <div className="mob-links-section">
            <span className="mob-section-label">Navigation</span>
            {links.map(link => (
              <button key={link.path} className={`mob-link${isActive(link.path) ? ' active' : ''}`} onClick={() => goTo(link.path)}>
                <div className="mob-link-icon">{link.icon}</div>
                <span style={{ flex: 1 }}>{link.label}</span>
                {link.path === '/messages' && unreadCount > 0 && (
                  <span style={{ background: '#C0504D', color: 'white', borderRadius: 999, fontSize: '0.6rem', fontWeight: 800, padding: '0.12rem 0.45rem' }}>{unreadCount}</span>
                )}
              </button>
            ))}
          </div>
          <div className="mob-divider" />
          <button className="mob-signout" onClick={handleSignOut}><span>⏻</span> Sign out</button>
        </div>
      </div>

      {/* Global Search Modal */}
      <GlobalSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        currentUserId={currentUserId}
      />
    </>
  )
}
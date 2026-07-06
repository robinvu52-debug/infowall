import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'

interface NavbarProps {
  fullName: string | null
  role: string
}

function getInitials(name: string | null): string {
  if (!name) return '?'
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
}

const NAV_LINKS = (role: string) => [
  { path: '/dashboard',   label: 'Dashboard',   icon: '🏠', show: true },
  { path: '/feed',        label: 'News Feed',   icon: '📰', show: true },
  { path: '/create-post', label: 'Create post', icon: '✏️', show: ['hr', 'manager', 'admin'].includes(role) },
  { path: '/admin',       label: 'Admin',       icon: '⚙️', show: role === 'admin' },
]

function Navbar({ fullName, role }: NavbarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id)
    })
  }, [])

  // Close mobile menu on route change
  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  // Lock body scroll while mobile menu is open
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [menuOpen])

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  function goTo(path: string) {
    navigate(path)
    setMenuOpen(false)
  }

  const links = NAV_LINKS(role).filter(l => l.show)

  return (
    <>
      <style>{`
        :root {
          --nav-h: 58px;
          --nav-max-w: 1600px;
        }

        .navbar-outer {
          position: sticky;
          top: 0;
          z-index: 300;
          background: #0d2d3a;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }

        .navbar {
          display: flex;
          align-items: center;
          height: var(--nav-h);
          max-width: var(--nav-max-w);
          margin: 0 auto;
          padding: 0 1.5rem;
          gap: 0.25rem;
        }

        /* ── Brand ── */
        .navbar-brand {
          display: flex; align-items: center; gap: 0.5rem;
          cursor: pointer; padding: 0.3rem 0.6rem 0.3rem 0;
          border-radius: 8px; transition: opacity 0.15s;
          margin-right: 0.5rem; flex-shrink: 0;
          background: none; border: none;
        }
        .navbar-brand:hover { opacity: 0.8; }

        .navbar-brand-logo {
          display: flex; align-items: center; justify-content: center;
          width: 28px; height: 28px; border-radius: 8px;
          background: linear-gradient(135deg, #00e5e5, #007a8a);
          flex-shrink: 0;
        }
        .navbar-brand-logo svg { width: 14px; height: 14px; }

        .navbar-brand-name {
          font-size: 1rem; font-weight: 800;
          color: #fff; letter-spacing: -0.02em;
          white-space: nowrap;
        }

        .navbar-sep {
          width: 1px; height: 20px;
          background: rgba(255,255,255,0.1);
          margin: 0 0.6rem; flex-shrink: 0;
        }

        /* ── Desktop links ── */
        .navbar-links {
          display: flex; align-items: center;
          gap: 0.1rem; flex: 1; min-width: 0;
        }

        .navbar-link {
          position: relative;
          padding: 0.38rem 0.85rem;
          border-radius: 8px; border: none;
          background: transparent; font-size: 0.85rem;
          font-weight: 500; color: rgba(255,255,255,0.6);
          cursor: pointer; transition: all 0.15s; white-space: nowrap;
        }
        .navbar-link:hover {
          background: rgba(255,255,255,0.08);
          color: rgba(255,255,255,0.9);
        }
        .navbar-link.active {
          background: rgba(255,255,255,0.12);
          color: #fff; font-weight: 600;
        }
        .navbar-link.active::after {
          content: ''; position: absolute;
          bottom: -1px; left: 50%; transform: translateX(-50%);
          width: 20px; height: 2px;
          background: #00e5e5; border-radius: 999px;
        }

        /* ── Right side (desktop) ── */
        .navbar-right {
          display: flex; align-items: center;
          gap: 0.75rem; margin-left: auto; flex-shrink: 0;
        }

        .navbar-user-info {
          display: flex; flex-direction: column; align-items: flex-end;
        }
        .navbar-user-name {
          font-size: 0.82rem; font-weight: 600;
          color: rgba(255,255,255,0.9); line-height: 1.2;
          white-space: nowrap; max-width: 180px;
          overflow: hidden; text-overflow: ellipsis;
        }
        .navbar-user-role {
          font-size: 0.68rem; color: rgba(255,255,255,0.4);
          text-transform: capitalize; line-height: 1.2;
        }

        .navbar-avatar-wrap { position: relative; flex-shrink: 0; }

        .navbar-avatar {
          width: 32px; height: 32px; border-radius: 50%;
          background: linear-gradient(135deg, #00b8b8, #007a8a);
          color: white; font-size: 0.72rem; font-weight: 700;
          display: flex; align-items: center; justify-content: center;
          border: 2px solid rgba(255,255,255,0.15);
          cursor: pointer; transition: all 0.15s; user-select: none;
        }
        .navbar-avatar:hover {
          border-color: #00e5e5;
          box-shadow: 0 0 0 3px rgba(0,229,229,0.2);
          transform: scale(1.06);
        }

        .navbar-avatar-tooltip {
          position: absolute; bottom: calc(100% + 10px); right: 0;
          background: #1a3a4a; color: white;
          font-size: 0.75rem; font-weight: 600;
          padding: 0.4rem 0.75rem; border-radius: 8px;
          white-space: nowrap; pointer-events: none;
          opacity: 0; transform: translateY(4px);
          transition: all 0.18s; z-index: 50;
          border: 1px solid rgba(255,255,255,0.1);
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        }
        .navbar-avatar-tooltip::after {
          content: ''; position: absolute;
          top: 100%; right: 10px;
          border: 5px solid transparent;
          border-top-color: #1a3a4a;
        }
        .navbar-avatar-wrap:hover .navbar-avatar-tooltip {
          opacity: 1; transform: translateY(0); pointer-events: auto;
        }

        .navbar-signout {
          padding: 0.35rem 0.85rem;
          background: transparent;
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 7px; color: rgba(255,255,255,0.65);
          font-size: 0.8rem; font-weight: 500;
          cursor: pointer; transition: all 0.15s; white-space: nowrap;
        }
        .navbar-signout:hover {
          background: rgba(255,255,255,0.08);
          border-color: rgba(255,255,255,0.3);
          color: rgba(255,255,255,0.9);
        }

        /* ── Hamburger (hidden on desktop) ── */
        .navbar-hamburger {
          display: none;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          gap: 4px;
          width: 36px; height: 36px;
          background: transparent;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          flex-shrink: 0;
          transition: background 0.15s;
        }
        .navbar-hamburger:hover { background: rgba(255,255,255,0.08); }

        .hamburger-bar {
          width: 18px; height: 2px;
          background: white;
          border-radius: 2px;
          transition: transform 0.25s, opacity 0.2s;
        }
        .navbar-hamburger.open .hamburger-bar:nth-child(1) {
          transform: translateY(6px) rotate(45deg);
        }
        .navbar-hamburger.open .hamburger-bar:nth-child(2) {
          opacity: 0;
        }
        .navbar-hamburger.open .hamburger-bar:nth-child(3) {
          transform: translateY(-6px) rotate(-45deg);
        }

        /* ── Mobile dropdown panel ── */
        .navbar-mobile-panel {
          position: fixed;
          top: var(--nav-h);
          left: 0; right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.4);
          z-index: 250;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.2s;
        }
        .navbar-mobile-panel.open {
          opacity: 1;
          pointer-events: auto;
        }

        .navbar-mobile-sheet {
          background: #0d2d3a;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          padding: 0.75rem 1rem 1.25rem;
          transform: translateY(-12px);
          opacity: 0;
          transition: all 0.22s ease;
          max-height: 0;
          overflow: hidden;
        }
        .navbar-mobile-panel.open .navbar-mobile-sheet {
          transform: translateY(0);
          opacity: 1;
          max-height: 600px;
        }

        .mobile-user-row {
          display: flex; align-items: center; gap: 0.75rem;
          padding: 0.85rem 0.75rem;
          margin-bottom: 0.5rem;
          background: rgba(255,255,255,0.06);
          border-radius: 12px;
        }

        .mobile-user-avatar {
          width: 40px; height: 40px; border-radius: 50%;
          background: linear-gradient(135deg, #00b8b8, #007a8a);
          color: white; font-size: 0.85rem; font-weight: 700;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }

        .mobile-user-name {
          font-size: 0.92rem; font-weight: 700; color: white;
          display: block; line-height: 1.25;
        }
        .mobile-user-role {
          font-size: 0.74rem; color: rgba(255,255,255,0.5);
          text-transform: capitalize;
        }

        .mobile-link {
          display: flex; align-items: center; gap: 0.75rem;
          width: 100%;
          padding: 0.75rem 0.75rem;
          background: transparent;
          border: none;
          border-radius: 10px;
          font-size: 0.9rem;
          font-weight: 500;
          color: rgba(255,255,255,0.75);
          cursor: pointer;
          transition: all 0.12s;
          text-align: left;
          margin-bottom: 0.15rem;
        }
        .mobile-link:hover { background: rgba(255,255,255,0.07); }
        .mobile-link.active {
          background: rgba(0,229,229,0.12);
          color: #00e5e5;
          font-weight: 700;
        }
        .mobile-link-icon { font-size: 1rem; width: 22px; text-align: center; flex-shrink: 0; }

        .mobile-divider {
          border: none;
          border-top: 1px solid rgba(255,255,255,0.08);
          margin: 0.6rem 0;
        }

        .mobile-signout {
          width: 100%;
          padding: 0.75rem;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 10px;
          color: rgba(255,255,255,0.8);
          font-size: 0.88rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
        }
        .mobile-signout:hover {
          background: rgba(220,38,38,0.15);
          border-color: rgba(220,38,38,0.4);
          color: #fca5a5;
        }

        /* ════════════════════════════════ */
        /* Breakpoints */
        /* ════════════════════════════════ */

        /* Ultrawide: cap content width, more breathing room */
        @media (min-width: 1920px) {
          :root { --nav-max-w: 1800px; }
          .navbar { padding: 0 2.5rem; }
        }

        /* Large desktop / standard */
        @media (min-width: 1024px) {
          .navbar-links { gap: 0.2rem; }
        }

        /* Tablet — tighten spacing, hide role text */
        @media (max-width: 1023px) and (min-width: 769px) {
          .navbar { padding: 0 1.1rem; }
          .navbar-link { padding: 0.36rem 0.65rem; font-size: 0.82rem; }
          .navbar-user-info { display: none; }
        }

        /* Mobile — switch to hamburger menu */
        @media (max-width: 768px) {
          .navbar { padding: 0 0.85rem 0 1rem; }
          .navbar-sep { display: none; }
          .navbar-links { display: none; }
          .navbar-user-info { display: none; }
          .navbar-signout { display: none; }
          .navbar-avatar-wrap { display: none; }
          .navbar-hamburger { display: flex; }
        }

        @media (max-width: 380px) {
          .navbar-brand-name { display: none; }
        }
      `}</style>

      <div className="navbar-outer">
        <nav className="navbar">

          {/* Brand */}
          <button
            className="navbar-brand"
            onClick={() => goTo('/dashboard')}
            aria-label="Go to dashboard"
          >
            <div className="navbar-brand-logo">
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </div>
            <span className="navbar-brand-name">InfoWall</span>
          </button>

          <div className="navbar-sep" />

          {/* Desktop links */}
          <div className="navbar-links">
            {links.map(link => (
              <button
                key={link.path}
                className={`navbar-link${location.pathname === link.path ? ' active' : ''}`}
                onClick={() => goTo(link.path)}
              >
                {link.label}
              </button>
            ))}
          </div>

          {/* Desktop right side */}
          <div className="navbar-right">
            <div className="navbar-user-info">
              <span className="navbar-user-name">{fullName ?? ''}</span>
              <span className="navbar-user-role">{role}</span>
            </div>

            <div className="navbar-avatar-wrap">
              <div
                className="navbar-avatar"
                onClick={() => currentUserId && goTo(`/profile/${currentUserId}`)}
                role="button"
                aria-label="Go to your profile"
              >
                {getInitials(fullName)}
              </div>
              <div className="navbar-avatar-tooltip">View your profile</div>
            </div>

            <button className="navbar-signout" onClick={handleSignOut}>
              Sign out
            </button>
          </div>

          {/* Hamburger (mobile only) */}
          <button
            className={`navbar-hamburger${menuOpen ? ' open' : ''}`}
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
          >
            <span className="hamburger-bar" />
            <span className="hamburger-bar" />
            <span className="hamburger-bar" />
          </button>

        </nav>
      </div>

      {/* Mobile dropdown panel */}
      <div
        className={`navbar-mobile-panel${menuOpen ? ' open' : ''}`}
        onClick={() => setMenuOpen(false)}
      >
        <div className="navbar-mobile-sheet" onClick={e => e.stopPropagation()}>

          <div
            className="mobile-user-row"
            onClick={() => currentUserId && goTo(`/profile/${currentUserId}`)}
          >
            <div className="mobile-user-avatar">{getInitials(fullName)}</div>
            <div>
              <span className="mobile-user-name">{fullName ?? 'Your profile'}</span>
              <span className="mobile-user-role">{role}</span>
            </div>
          </div>

          {links.map(link => (
            <button
              key={link.path}
              className={`mobile-link${location.pathname === link.path ? ' active' : ''}`}
              onClick={() => goTo(link.path)}
            >
              <span className="mobile-link-icon">{link.icon}</span>
              {link.label}
            </button>
          ))}

          <hr className="mobile-divider" />

          <button className="mobile-signout" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </div>
    </>
  )
}

export default Navbar
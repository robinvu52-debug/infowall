import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Navbar from '../components/Navbar'
import { usePresence } from '../contexts/PresenceContext'

interface Profile {
  id: string
  full_name: string | null
  role: string
  department_id: string | null
  email: string | null
  bio: string | null
  joined_at: string | null
}
interface Department { id: string; name: string }

type ViewMode = 'grid' | 'list'
type SortBy = 'name' | 'role' | 'department' | 'joined'

const ROLE_COLORS: Record<string, string> = {
  admin: '#dc2626', hr: '#7c3aed', manager: '#1d4ed8', employee: '#16a34a'
}
const ROLE_BG: Record<string, string> = {
  admin: '#fef2f2', hr: '#faf5ff', manager: '#eff6ff', employee: '#f0fdf4'
}
const STATUS_COLOR: Record<string, string> = {
  online: '#22c55e', away: '#f59e0b', busy: '#ef4444', offline: '#9ca3af'
}
const STATUS_LABEL: Record<string, string> = {
  online: 'Online', away: 'Away', busy: 'Busy', offline: 'Offline'
}

function initials(name: string | null): string {
  if (!name) return '?'
  return name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase()
}

function avatarColor(name: string | null): string {
  if (!name) return '#4F81BD'
  const colors = ['#4BACC6','#8064A2','#C0504D','#9BBB59','#F79646','#4F81BD','#243F60','#365F91']
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

function fmtJoined(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })
}

function Avatar({ name, role, size = 48, statusKey }: { name: string | null; role?: string; size?: number; statusKey?: string }) {
  const bg = avatarColor(name)
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <div style={{
        width: size, height: size, borderRadius: '50%',
        background: `linear-gradient(135deg, ${bg}, #1A2B3C)`,
        color: 'white', fontSize: size * 0.34, fontWeight: 800,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {initials(name)}
      </div>
      {statusKey && statusKey !== 'offline' && (
        <div style={{
          position: 'absolute', bottom: 1, right: 1,
          width: size * 0.27, height: size * 0.27,
          borderRadius: '50%',
          background: STATUS_COLOR[statusKey] ?? '#9ca3af',
          border: '2px solid var(--bg-surface)',
        }} />
      )}
    </div>
  )
}

export default function EmployeeDirectoryPage() {
  const navigate = useNavigate()
  const { presenceUsers, onlineUserIds } = usePresence()

  const [myProfile, setMyProfile] = useState<Profile | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)

  // Filters & view
  const [search, setSearch] = useState('')
  const [filterDept, setFilterDept] = useState<string>('all')
  const [filterRole, setFilterRole] = useState<string>('all')
  const [filterOnline, setFilterOnline] = useState(false)
  const [sortBy, setSortBy] = useState<SortBy>('name')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [groupByDept, setGroupByDept] = useState(false)
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { navigate('/login'); return }

      const [{ data: me }, { data: ps }, { data: ds }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('profiles').select('*').order('full_name'),
        supabase.from('departments').select('*').order('name'),
      ])
      setMyProfile(me)
      setProfiles(ps ?? [])
      setDepartments(ds ?? [])
      setLoading(false)
    }
    load()
  }, [navigate])

  function getPresenceStatus(userId: string): string {
    const pu = presenceUsers.find(u => u.user_id === userId)
    return pu?.status ?? 'offline'
  }

  // Filter + sort
  const allRoles = [...new Set(profiles.map(p => p.role))].sort()

  const filtered = profiles.filter(p => {
    if (search && !p.full_name?.toLowerCase().includes(search.toLowerCase()) &&
        !p.role.toLowerCase().includes(search.toLowerCase())) return false
    if (filterDept !== 'all' && p.department_id !== filterDept) return false
    if (filterRole !== 'all' && p.role !== filterRole) return false
    if (filterOnline && !onlineUserIds.has(p.id)) return false
    return true
  }).sort((a, b) => {
    if (sortBy === 'name') return (a.full_name ?? '').localeCompare(b.full_name ?? '')
    if (sortBy === 'role') return a.role.localeCompare(b.role)
    if (sortBy === 'department') {
      const da = departments.find(d => d.id === a.department_id)?.name ?? ''
      const db = departments.find(d => d.id === b.department_id)?.name ?? ''
      return da.localeCompare(db)
    }
    if (sortBy === 'joined') return new Date(b.joined_at ?? 0).getTime() - new Date(a.joined_at ?? 0).getTime()
    return 0
  })

  // Group by department
  const grouped: { label: string; members: Profile[] }[] = groupByDept
    ? [
        ...departments.map(dept => ({
          label: dept.name,
          members: filtered.filter(p => p.department_id === dept.id)
        })).filter(g => g.members.length > 0),
        { label: 'No Department', members: filtered.filter(p => !p.department_id) }
      ].filter(g => g.members.length > 0)
    : [{ label: '', members: filtered }]

  // Stats
  const onlineCount = profiles.filter(p => onlineUserIds.has(p.id)).length
  const roleBreakdown = allRoles.map(r => ({
    role: r, count: profiles.filter(p => p.role === r).length
  }))

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Nunito, sans-serif', color: 'var(--text-faint)' }}>
      Loading directory…
    </div>
  )

  return (
    <>
      <style>{`
        @keyframes fadeUp   { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes slideIn  { from{opacity:0;transform:translateX(24px)} to{opacity:1;transform:translateX(0)} }
        @keyframes scaleIn  { from{opacity:0;transform:scale(0.94)} to{opacity:1;transform:scale(1)} }
        @keyframes shimmer  { 0%{background-position:-400px 0} 100%{background-position:400px 0} }

        *, *::before, *::after { box-sizing:border-box; }

        .dir-page { min-height:100vh;background:var(--bg-page);font-family:'Nunito','Segoe UI',system-ui,sans-serif; }

        /* ── Hero ── */
        .dir-hero {
          background:linear-gradient(135deg,#1A2B3C 0%,#243F60 60%,#365F91 100%);
          padding:2.5rem 2rem 0;position:relative;overflow:hidden;
        }
        .dir-hero-bg { position:absolute;inset:0;pointer-events:none;overflow:hidden; }
        .dir-hero-orb { position:absolute;border-radius:50%;filter:blur(60px);opacity:0.15; }
        .dir-hero-orb1 { width:300px;height:300px;background:#4BACC6;top:-80px;right:10%; }
        .dir-hero-orb2 { width:200px;height:200px;background:#8064A2;bottom:-40px;left:5%; }

        .dir-hero-inner { max-width:1200px;margin:0 auto;position:relative;z-index:1; }
        .dir-hero-top { display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:1.75rem;gap:1rem;flex-wrap:wrap; }
        .dir-hero-title { font-size:1.75rem;font-weight:900;color:white;letter-spacing:-0.025em;margin-bottom:0.3rem; }
        .dir-hero-sub { font-size:0.88rem;color:rgba(255,255,255,0.45);line-height:1.5; }

        /* Stats strip */
        .dir-stats { display:flex;gap:0;border-top:1px solid rgba(255,255,255,0.08);margin-top:1rem; }
        .dir-stat { flex:1;padding:1rem 0.5rem;text-align:center;border-right:1px solid rgba(255,255,255,0.06); }
        .dir-stat:last-child { border-right:none; }
        .dir-stat-val { font-size:1.5rem;font-weight:900;color:white;line-height:1; }
        .dir-stat-label { font-size:0.62rem;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.1em;margin-top:0.25rem; }
        .dir-stat-val.green { color:#86efac; }
        .dir-stat-val.teal  { color:#7dd3fc; }
        .dir-stat-val.purple{ color:#c4b5fd; }

        /* ── Controls ── */
        .dir-controls {
          background:var(--bg-surface);border-bottom:1px solid var(--border);
          padding:0.85rem 2rem;
          display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;
          position:sticky;top:60px;z-index:100;
          box-shadow:var(--shadow-sm);
        }
        .dir-search-wrap { display:flex;align-items:center;gap:0.5rem;background:var(--bg-page);border:1.5px solid var(--border);border-radius:10px;padding:0.5rem 0.85rem;flex:1;max-width:300px;transition:border-color 0.15s; }
        .dir-search-wrap:focus-within { border-color:#4BACC6;background:var(--bg-surface); }
        .dir-search-wrap input { background:transparent;border:none;outline:none;font-size:0.875rem;color:var(--text-primary);font-family:inherit;flex:1; }
        .dir-search-wrap input::placeholder { color:var(--text-faint); }

        .dir-select { padding:0.5rem 0.75rem;background:var(--bg-page);border:1.5px solid var(--border);border-radius:9px;font-size:0.82rem;color:var(--text-primary);font-family:inherit;outline:none;cursor:pointer;transition:border-color 0.15s; }
        .dir-select:focus { border-color:#4BACC6; }

        .dir-ctrl-btn { display:flex;align-items:center;gap:0.35rem;padding:0.5rem 0.85rem;background:var(--bg-page);border:1.5px solid var(--border);border-radius:9px;font-size:0.8rem;font-weight:600;color:var(--text-muted);cursor:pointer;transition:all 0.12s;font-family:inherit;white-space:nowrap; }
        .dir-ctrl-btn:hover { border-color:#4BACC6;color:var(--text-primary); }
        .dir-ctrl-btn.active { background:#EEF4FB;border-color:#4BACC6;color:#243F60; }

        .dir-view-toggle { display:flex;background:var(--bg-page);border:1.5px solid var(--border);border-radius:9px;overflow:hidden;flex-shrink:0; }
        .dir-view-btn { padding:0.45rem 0.7rem;background:transparent;border:none;color:var(--text-faint);cursor:pointer;font-size:0.88rem;transition:all 0.12s; }
        .dir-view-btn.active { background:#EEF4FB;color:#243F60; }

        .dir-results-count { font-size:0.75rem;color:var(--text-faint);margin-left:auto;flex-shrink:0; }

        /* ── Content ── */
        .dir-content { max-width:1200px;margin:0 auto;padding:1.75rem 2rem 4rem; }

        /* Group header */
        .dir-group { margin-bottom:2rem; }
        .dir-group-header { display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem; }
        .dir-group-label { font-size:0.72rem;font-weight:800;color:var(--text-faint);text-transform:uppercase;letter-spacing:0.1em; }
        .dir-group-line { flex:1;height:1px;background:var(--border); }
        .dir-group-count { font-size:0.68rem;color:var(--text-ghost); }

        /* Grid */
        .dir-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:0.85rem; }

        /* ── Grid Card ── */
        .dir-card {
          background:var(--bg-surface);border:1px solid var(--border);border-radius:16px;
          padding:1.5rem 1.25rem;display:flex;flex-direction:column;align-items:center;
          text-align:center;gap:0.6rem;cursor:pointer;
          transition:all 0.18s;animation:scaleIn 0.2s ease both;
          position:relative;overflow:hidden;
        }
        .dir-card::before { content:'';position:absolute;top:0;left:0;right:0;height:3px;background:transparent;transition:background 0.15s; }
        .dir-card:hover { box-shadow:var(--shadow-md);transform:translateY(-2px);border-color:#C5D9F1; }
        .dir-card:hover::before { background:linear-gradient(90deg,#4BACC6,#8064A2); }
        .dir-card-name { font-size:0.9rem;font-weight:800;color:var(--text-primary);line-height:1.3; }
        .dir-card-dept { font-size:0.72rem;color:var(--text-faint);margin-top:-0.2rem; }
        .dir-card-role { display:inline-flex;align-items:center;font-size:0.65rem;font-weight:700;padding:0.15rem 0.55rem;border-radius:999px;text-transform:capitalize;letter-spacing:0.03em; }
        .dir-card-status { font-size:0.68rem;color:var(--text-faint);display:flex;align-items:center;gap:0.3rem; }
        .dir-card-status-dot { width:7px;height:7px;border-radius:50%;flex-shrink:0; }

        /* Card action buttons */
        .dir-card-actions { display:flex;gap:0.4rem;width:100%;margin-top:0.25rem; }
        .dir-card-action { flex:1;padding:0.4rem 0.5rem;border-radius:8px;font-size:0.72rem;font-weight:700;cursor:pointer;transition:all 0.12s;font-family:inherit;border:none;display:flex;align-items:center;justify-content:center;gap:0.3rem; }
        .dir-card-action.msg { background:#EEF4FB;color:#365F91; }
        .dir-card-action.msg:hover { background:#C5D9F1;color:#243F60; }
        .dir-card-action.profile { background:var(--bg-page);color:var(--text-muted);border:1px solid var(--border); }
        .dir-card-action.profile:hover { background:var(--bg-hover);color:var(--text-primary); }

        /* ── List view ── */
        .dir-list { display:flex;flex-direction:column;gap:0.35rem; }
        .dir-list-row {
          display:flex;align-items:center;gap:1rem;
          background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;
          padding:0.85rem 1.25rem;cursor:pointer;
          transition:all 0.15s;animation:fadeUp 0.2s ease both;
        }
        .dir-list-row:hover { box-shadow:var(--shadow-sm);border-color:#C5D9F1;background:var(--bg-hover); }
        .dir-list-info { flex:1;min-width:0;display:flex;align-items:center;gap:1.25rem; }
        .dir-list-name { font-size:0.9rem;font-weight:700;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:160px; }
        .dir-list-role-badge { display:inline-flex;align-items:center;font-size:0.65rem;font-weight:700;padding:0.15rem 0.55rem;border-radius:999px;text-transform:capitalize;flex-shrink:0; }
        .dir-list-dept { font-size:0.78rem;color:var(--text-faint);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .dir-list-status { display:flex;align-items:center;gap:0.35rem;font-size:0.72rem;color:var(--text-faint);flex-shrink:0;min-width:70px; }
        .dir-list-dot { width:8px;height:8px;border-radius:50%;flex-shrink:0; }
        .dir-list-actions { display:flex;gap:0.4rem;flex-shrink:0; }
        .dir-list-action { padding:0.35rem 0.75rem;border-radius:7px;font-size:0.75rem;font-weight:700;cursor:pointer;transition:all 0.12s;font-family:inherit;border:none; }
        .dir-list-action.msg { background:#EEF4FB;color:#365F91; }
        .dir-list-action.msg:hover { background:#C5D9F1; }
        .dir-list-action.profile { background:var(--bg-page);color:var(--text-muted);border:1px solid var(--border); }
        .dir-list-action.profile:hover { background:var(--bg-hover);color:var(--text-primary); }

        /* ── Detail drawer ── */
        .dir-drawer-overlay { position:fixed;inset:0;z-index:400;background:rgba(0,0,0,0.35);backdrop-filter:blur(4px);animation:fadeIn 0.15s ease; }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        .dir-drawer {
          position:fixed;top:0;right:0;bottom:0;width:380px;max-width:100vw;
          background:var(--bg-surface);border-left:1px solid var(--border);
          display:flex;flex-direction:column;overflow:hidden;
          animation:slideIn 0.25s cubic-bezier(0.34,1,0.64,1);
          box-shadow:-8px 0 40px rgba(0,0,0,0.12);
        }
        .dir-drawer-header { padding:1.25rem 1.5rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0; }
        .dir-drawer-title { font-size:0.88rem;font-weight:800;color:var(--text-primary); }
        .dir-drawer-close { width:30px;height:30px;border-radius:8px;background:var(--bg-hover);border:none;color:var(--text-muted);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:0.85rem;transition:all 0.12s; }
        .dir-drawer-close:hover { background:var(--bg-active);color:var(--text-primary); }
        .dir-drawer-body { flex:1;overflow-y:auto;padding:1.5rem; }
        .dir-drawer-body::-webkit-scrollbar { width:4px; }
        .dir-drawer-body::-webkit-scrollbar-thumb { background:var(--border);border-radius:999px; }

        .dir-drawer-avatar-section { text-align:center;margin-bottom:1.5rem; }
        .dir-drawer-name { font-size:1.35rem;font-weight:900;color:var(--text-primary);margin-top:0.85rem;margin-bottom:0.25rem;letter-spacing:-0.02em; }
        .dir-drawer-role { display:inline-flex;font-size:0.72rem;font-weight:700;padding:0.2rem 0.65rem;border-radius:999px;text-transform:capitalize;margin-bottom:0.5rem; }
        .dir-drawer-status { display:flex;align-items:center;justify-content:center;gap:0.4rem;font-size:0.78rem;color:var(--text-faint); }

        .dir-drawer-section { margin-bottom:1.25rem; }
        .dir-drawer-section-label { font-size:0.65rem;font-weight:800;color:var(--text-faint);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:0.65rem;display:block; }
        .dir-drawer-detail-row { display:flex;align-items:center;gap:0.65rem;padding:0.5rem 0;border-bottom:1px solid var(--border-light); }
        .dir-drawer-detail-row:last-child { border-bottom:none; }
        .dir-drawer-detail-icon { font-size:0.9rem;flex-shrink:0;width:20px;text-align:center; }
        .dir-drawer-detail-label { font-size:0.72rem;color:var(--text-faint);min-width:80px;flex-shrink:0; }
        .dir-drawer-detail-value { font-size:0.82rem;font-weight:600;color:var(--text-primary); }

        .dir-drawer-bio { font-size:0.85rem;color:var(--text-secondary);line-height:1.65;background:var(--bg-subtle);border-radius:10px;padding:0.85rem 1rem;border:1px solid var(--border-light);font-style:italic; }

        .dir-drawer-actions { display:grid;grid-template-columns:1fr 1fr;gap:0.65rem;margin-top:0.75rem; }
        .dir-drawer-action { padding:0.75rem;border-radius:10px;font-size:0.85rem;font-weight:700;cursor:pointer;font-family:inherit;border:none;display:flex;align-items:center;justify-content:center;gap:0.45rem;transition:all 0.15s; }
        .dir-drawer-action.primary { background:#243F60;color:white; }
        .dir-drawer-action.primary:hover { background:#365F91; }
        .dir-drawer-action.secondary { background:var(--bg-page);color:var(--text-secondary);border:1.5px solid var(--border); }
        .dir-drawer-action.secondary:hover { border-color:#4BACC6;color:var(--text-primary); }

        /* Empty */
        .dir-empty { text-align:center;padding:4rem 2rem;color:var(--text-faint); }
        .dir-empty-icon { font-size:3rem;opacity:0.3;margin-bottom:0.75rem; }
        .dir-empty-title { font-size:1.05rem;font-weight:700;color:var(--text-primary);margin-bottom:0.35rem; }
        .dir-empty-sub { font-size:0.85rem;line-height:1.6; }

        /* Skeleton */
        .dir-skel { background:var(--bg-surface);border:1px solid var(--border);border-radius:16px;padding:1.5rem;display:flex;flex-direction:column;align-items:center;gap:0.65rem; }
        .dir-skel-circle { width:64px;height:64px;border-radius:50%;background:linear-gradient(90deg,var(--bg-hover) 25%,var(--bg-subtle) 50%,var(--bg-hover) 75%);background-size:400px 100%;animation:shimmer 1.4s ease-in-out infinite; }
        .dir-skel-line { border-radius:6px;background:linear-gradient(90deg,var(--bg-hover) 25%,var(--bg-subtle) 50%,var(--bg-hover) 75%);background-size:400px 100%;animation:shimmer 1.4s ease-in-out infinite; }

        @media(max-width:768px) {
          .dir-controls { padding:0.75rem 1rem; }
          .dir-content { padding:1.25rem 1rem 4rem; }
          .dir-hero { padding:1.75rem 1rem 0; }
          .dir-grid { grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); }
          .dir-drawer { width:100vw; }
          .dir-stats { flex-wrap:wrap; }
          .dir-stat { min-width:50%; }
        }
      `}</style>

      <div className="dir-page">
        <Navbar fullName={myProfile?.full_name ?? null} role={myProfile?.role ?? 'employee'} />

        {/* ── Hero ── */}
        <div className="dir-hero">
          <div className="dir-hero-bg">
            <div className="dir-hero-orb dir-hero-orb1" />
            <div className="dir-hero-orb dir-hero-orb2" />
          </div>
          <div className="dir-hero-inner">
            <div className="dir-hero-top">
              <div>
                <div className="dir-hero-title">Employee Directory</div>
                <div className="dir-hero-sub">Find and connect with anyone across the organisation</div>
              </div>
            </div>

            {/* Stats */}
            <div className="dir-stats">
              <div className="dir-stat">
                <div className="dir-stat-val">{profiles.length}</div>
                <div className="dir-stat-label">Total Staff</div>
              </div>
              <div className="dir-stat">
                <div className="dir-stat-val green">{onlineCount}</div>
                <div className="dir-stat-label">Online Now</div>
              </div>
              <div className="dir-stat">
                <div className="dir-stat-val teal">{departments.length}</div>
                <div className="dir-stat-label">Departments</div>
              </div>
              {roleBreakdown.map(r => (
                <div key={r.role} className="dir-stat">
                  <div className="dir-stat-val purple">{r.count}</div>
                  <div className="dir-stat-label" style={{ textTransform: 'capitalize' }}>{r.role}s</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Controls ── */}
        <div className="dir-controls">
          {/* Search */}
          <div className="dir-search-wrap">
            <span style={{ color: 'var(--text-faint)', fontSize: '0.9rem' }}>🔍</span>
            <input
              placeholder="Search by name or role…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: '0.8rem' }}>✕</button>
            )}
          </div>

          {/* Dept filter */}
          <select className="dir-select" value={filterDept} onChange={e => setFilterDept(e.target.value)}>
            <option value="all">All Departments</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>

          {/* Role filter */}
          <select className="dir-select" value={filterRole} onChange={e => setFilterRole(e.target.value)}>
            <option value="all">All Roles</option>
            {allRoles.map(r => <option key={r} value={r} style={{ textTransform: 'capitalize' }}>{r}</option>)}
          </select>

          {/* Sort */}
          <select className="dir-select" value={sortBy} onChange={e => setSortBy(e.target.value as SortBy)}>
            <option value="name">Sort: Name A–Z</option>
            <option value="role">Sort: Role</option>
            <option value="department">Sort: Department</option>
            <option value="joined">Sort: Newest first</option>
          </select>

          {/* Online only */}
          <button
            className={`dir-ctrl-btn${filterOnline ? ' active' : ''}`}
            onClick={() => setFilterOnline(p => !p)}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: filterOnline ? '#22c55e' : 'var(--text-ghost)', display: 'inline-block' }} />
            Online only
          </button>

          {/* Group by dept */}
          <button
            className={`dir-ctrl-btn${groupByDept ? ' active' : ''}`}
            onClick={() => setGroupByDept(p => !p)}
          >
            🏢 Group
          </button>

          {/* View toggle */}
          <div className="dir-view-toggle">
            <button className={`dir-view-btn${viewMode === 'grid' ? ' active' : ''}`} onClick={() => setViewMode('grid')} title="Grid view">⊞</button>
            <button className={`dir-view-btn${viewMode === 'list' ? ' active' : ''}`} onClick={() => setViewMode('list')} title="List view">≡</button>
          </div>

          <div className="dir-results-count">
            {filtered.length} of {profiles.length} employee{profiles.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* ── Content ── */}
        <div className="dir-content">

          {loading ? (
            <div className="dir-grid">
              {Array.from({ length: 12 }, (_, i) => (
                <div key={i} className="dir-skel" style={{ animationDelay: `${i * 0.05}s` }}>
                  <div className="dir-skel-circle" />
                  <div className="dir-skel-line" style={{ width: '70%', height: 14 }} />
                  <div className="dir-skel-line" style={{ width: '45%', height: 10 }} />
                  <div className="dir-skel-line" style={{ width: '55%', height: 10 }} />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="dir-empty">
              <div className="dir-empty-icon">🔍</div>
              <div className="dir-empty-title">No employees found</div>
              <div className="dir-empty-sub">
                Try adjusting your search or filters.<br />
                {filterOnline && 'Nobody is currently online with those filters.'}
              </div>
            </div>
          ) : (
            grouped.map(group => (
              <div key={group.label} className="dir-group">
                {groupByDept && (
                  <div className="dir-group-header">
                    <div className="dir-group-label">🏢 {group.label}</div>
                    <div className="dir-group-line" />
                    <div className="dir-group-count">{group.members.length} member{group.members.length !== 1 ? 's' : ''}</div>
                  </div>
                )}

                {viewMode === 'grid' ? (
                  <div className="dir-grid">
                    {group.members.map((p, i) => {
                      const status = getPresenceStatus(p.id)
                      const dept = departments.find(d => d.id === p.department_id)
                      const isMe = p.id === myProfile?.id
                      return (
                        <div
                          key={p.id}
                          className="dir-card"
                          style={{ animationDelay: `${Math.min(i * 0.03, 0.4)}s` }}
                          onClick={() => setSelectedProfile(p)}
                        >
                          <Avatar name={p.full_name} role={p.role} size={64} statusKey={status} />
                          <div className="dir-card-name">{p.full_name ?? '—'}{isMe ? ' (you)' : ''}</div>
                          {dept && <div className="dir-card-dept">{dept.name}</div>}
                          <div
                            className="dir-card-role"
                            style={{ background: ROLE_BG[p.role] ?? '#f3f4f6', color: ROLE_COLORS[p.role] ?? '#374151' }}
                          >
                            {p.role}
                          </div>
                          {status !== 'offline' && (
                            <div className="dir-card-status">
                              <div className="dir-card-status-dot" style={{ background: STATUS_COLOR[status] }} />
                              {STATUS_LABEL[status]}
                            </div>
                          )}
                          <div className="dir-card-actions" onClick={e => e.stopPropagation()}>
                            {!isMe && (
                              <button
                                className="dir-card-action msg"
                                onClick={() => navigate(`/messages/${p.id}`)}
                              >
                                ✉ Message
                              </button>
                            )}
                            <button
                              className="dir-card-action profile"
                              onClick={() => navigate(`/profile/${p.id}`)}
                            >
                              👤 Profile
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="dir-list">
                    {group.members.map((p, i) => {
                      const status = getPresenceStatus(p.id)
                      const dept = departments.find(d => d.id === p.department_id)
                      const isMe = p.id === myProfile?.id
                      return (
                        <div
                          key={p.id}
                          className="dir-list-row"
                          style={{ animationDelay: `${Math.min(i * 0.02, 0.3)}s` }}
                          onClick={() => setSelectedProfile(p)}
                        >
                          <Avatar name={p.full_name} role={p.role} size={40} statusKey={status} />
                          <div className="dir-list-info">
                            <div className="dir-list-name">
                              {p.full_name ?? '—'}{isMe ? ' (you)' : ''}
                            </div>
                            <div
                              className="dir-list-role-badge"
                              style={{ background: ROLE_BG[p.role] ?? '#f3f4f6', color: ROLE_COLORS[p.role] ?? '#374151' }}
                            >
                              {p.role}
                            </div>
                            <div className="dir-list-dept">{dept?.name ?? '—'}</div>
                          </div>
                          <div className="dir-list-status">
                            <div className="dir-list-dot" style={{ background: STATUS_COLOR[status] ?? '#9ca3af' }} />
                            {STATUS_LABEL[status]}
                          </div>
                          <div className="dir-list-actions" onClick={e => e.stopPropagation()}>
                            {!isMe && (
                              <button className="dir-list-action msg" onClick={() => navigate(`/messages/${p.id}`)}>✉</button>
                            )}
                            <button className="dir-list-action profile" onClick={() => navigate(`/profile/${p.id}`)}>👤</button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* ── Profile Drawer ── */}
        {selectedProfile && (() => {
          const status = getPresenceStatus(selectedProfile.id)
          const dept = departments.find(d => d.id === selectedProfile.department_id)
          const isMe = selectedProfile.id === myProfile?.id
          return (
            <>
              <div className="dir-drawer-overlay" onClick={() => setSelectedProfile(null)} />
              <div className="dir-drawer">
                <div className="dir-drawer-header">
                  <div className="dir-drawer-title">Employee Profile</div>
                  <button className="dir-drawer-close" onClick={() => setSelectedProfile(null)}>✕</button>
                </div>

                <div className="dir-drawer-body">
                  {/* Avatar + name */}
                  <div className="dir-drawer-avatar-section">
                    <Avatar name={selectedProfile.full_name} role={selectedProfile.role} size={80} statusKey={status} />
                    <div className="dir-drawer-name">{selectedProfile.full_name ?? '—'}</div>
                    <div
                      className="dir-drawer-role"
                      style={{ background: ROLE_BG[selectedProfile.role] ?? '#f3f4f6', color: ROLE_COLORS[selectedProfile.role] ?? '#374151' }}
                    >
                      {selectedProfile.role}
                    </div>
                    <div className="dir-drawer-status">
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[status], flexShrink: 0 }} />
                      {STATUS_LABEL[status]}
                    </div>
                  </div>

                  {/* Quick actions */}
                  {!isMe && (
                    <div className="dir-drawer-actions" style={{ marginBottom: '1.5rem' }}>
                      <button
                        className="dir-drawer-action primary"
                        onClick={() => { setSelectedProfile(null); navigate(`/messages/${selectedProfile.id}`) }}
                      >
                        ✉ Send message
                      </button>
                      <button
                        className="dir-drawer-action secondary"
                        onClick={() => { setSelectedProfile(null); navigate(`/profile/${selectedProfile.id}`) }}
                      >
                        👤 Full profile
                      </button>
                    </div>
                  )}
                  {isMe && (
                    <div style={{ marginBottom: '1.5rem' }}>
                      <button
                        className="dir-drawer-action secondary"
                        style={{ width: '100%' }}
                        onClick={() => { setSelectedProfile(null); navigate(`/profile/${selectedProfile.id}`) }}
                      >
                        👤 View my profile
                      </button>
                    </div>
                  )}

                  {/* Details */}
                  <div className="dir-drawer-section">
                    <span className="dir-drawer-section-label">Details</span>
                    <div className="dir-drawer-detail-row">
                      <span className="dir-drawer-detail-icon">🏢</span>
                      <span className="dir-drawer-detail-label">Department</span>
                      <span className="dir-drawer-detail-value">{dept?.name ?? 'Unassigned'}</span>
                    </div>
                    <div className="dir-drawer-detail-row">
                      <span className="dir-drawer-detail-icon">🎭</span>
                      <span className="dir-drawer-detail-label">Role</span>
                      <span className="dir-drawer-detail-value" style={{ textTransform: 'capitalize' }}>{selectedProfile.role}</span>
                    </div>
                    {selectedProfile.email && (
                      <div className="dir-drawer-detail-row">
                        <span className="dir-drawer-detail-icon">✉</span>
                        <span className="dir-drawer-detail-label">Email</span>
                        <span className="dir-drawer-detail-value" style={{ fontSize: '0.78rem', wordBreak: 'break-all' }}>{selectedProfile.email}</span>
                      </div>
                    )}
                    {selectedProfile.joined_at && (
                      <div className="dir-drawer-detail-row">
                        <span className="dir-drawer-detail-icon">📅</span>
                        <span className="dir-drawer-detail-label">Joined</span>
                        <span className="dir-drawer-detail-value">{fmtJoined(selectedProfile.joined_at)}</span>
                      </div>
                    )}
                    <div className="dir-drawer-detail-row">
                      <span className="dir-drawer-detail-icon">🟢</span>
                      <span className="dir-drawer-detail-label">Status</span>
                      <span className="dir-drawer-detail-value" style={{ color: STATUS_COLOR[status] }}>{STATUS_LABEL[status]}</span>
                    </div>
                  </div>

                  {/* Bio */}
                  {selectedProfile.bio && (
                    <div className="dir-drawer-section">
                      <span className="dir-drawer-section-label">About</span>
                      <div className="dir-drawer-bio">"{selectedProfile.bio}"</div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )
        })()}
      </div>
    </>
  )
}
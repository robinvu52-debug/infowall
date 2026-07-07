import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Navbar from '../components/Navbar'

interface Profile {
  id: string; full_name: string | null; role: string
  department_id: string | null; kiosk_pin: string | null
}
interface Department { id: string; name: string }
interface AttendanceRow {
  id: string; clock_in_at: string; clock_out_at: string | null
  profile: { full_name: string | null; department_id: string | null } | null
}
interface Schedule {
  id: string; user_id: string; scheduled_date: string
  start_time: string; end_time: string; note: string | null
  profile: { full_name: string | null; department_id: string | null } | null
}
interface AuditRow {
  id: string; action: string; target: string | null
  details: Record<string, unknown> | null; created_at: string
  profiles: { full_name: string | null } | null
}
interface PostRow {
  id: string; title: string; content: string | null
  post_type: string; must_read: boolean; created_at: string
  department_id: string | null; recipient_id: string | null
  author: { full_name: string | null } | null
}

const ACTION_LABELS: Record<string, string> = {
  role_changed: 'Role changed', department_changed: 'Department changed',
  department_created: 'Department created', department_updated: 'Department updated',
  department_deleted: 'Department deleted',
}

const QUICK_QUERIES = [
  { label: 'All profiles', sql: 'select id, full_name, role, department_id, kiosk_pin from profiles order by full_name' },
  { label: 'All posts', sql: 'select id, title, post_type, must_read, created_at from posts order by created_at desc' },
  { label: 'Departments', sql: 'select * from departments order by name' },
  { label: 'Attendance today', sql: `select * from attendance where clock_in_at >= current_date order by clock_in_at desc` },
  { label: 'Schedules', sql: 'select * from schedules order by scheduled_date, start_time limit 30' },
  { label: 'Auth users', sql: 'select id, email, created_at from auth.users order by created_at desc' },
]

const DEPT_PALETTE = [
  { accent: '#1d4ed8', light: '#dbeafe', border: '#bfdbfe' },
  { accent: '#16a34a', light: '#dcfce7', border: '#bbf7d0' },
  { accent: '#7c3aed', light: '#f3e8ff', border: '#e9d5ff' },
  { accent: '#c2410c', light: '#ffedd5', border: '#fed7aa' },
  { accent: '#0f766e', light: '#ccfbf1', border: '#99f6e4' },
  { accent: '#9333ea', light: '#fae8ff', border: '#f5d0fe' },
]

type Tab = 'overview' | 'users' | 'departments' | 'posts' | 'attendance' | 'timetable' | 'audit' | 'sql'

const TABS: { id: Tab; label: string; icon: string; group: 'main' | 'data' | 'dev' }[] = [
  { id: 'overview',     label: 'Overview',     icon: '📊', group: 'main' },
  { id: 'users',        label: 'Users',        icon: '👥', group: 'main' },
  { id: 'departments',  label: 'Departments',  icon: '🏢', group: 'main' },
  { id: 'posts',        label: 'Posts',        icon: '📢', group: 'main' },
  { id: 'attendance',   label: 'Attendance',   icon: '🕐', group: 'data' },
  { id: 'timetable',    label: 'Timetable',    icon: '📆', group: 'data' },
  { id: 'audit',        label: 'Audit Log',    icon: '📋', group: 'dev'  },
  { id: 'sql',          label: 'SQL',          icon: '🛠',  group: 'dev'  },
]

function getMonday(d: Date): Date {
  const date = new Date(d); const day = date.getDay()
  date.setDate(date.getDate() - day + (day === 0 ? -6 : 1))
  date.setHours(0, 0, 0, 0); return date
}
function addDays(d: Date, n: number): Date { const date = new Date(d); date.setDate(date.getDate() + n); return date }
function fmtDate(d: Date): string { return d.toISOString().split('T')[0] }
function fmtDateDisplay(s: string): string {
  return new Date(s + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
}
function fmtTime(t: string): string { return t?.slice(0, 5) ?? '' }
function fmtDatetime(s: string): string {
  return new Date(s).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true })
}
function timeAgo(d: string): string {
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

function RoleBadge({ role }: { role: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    admin:    { bg: '#fef2f2', color: '#dc2626' },
    hr:       { bg: '#faf5ff', color: '#7c3aed' },
    manager:  { bg: '#eff6ff', color: '#1d4ed8' },
    employee: { bg: '#f0fdf4', color: '#16a34a' },
  }
  const c = map[role] ?? { bg: '#f3f4f6', color: '#374151' }
  return <span style={{ background: c.bg, color: c.color, fontSize: '0.68rem', fontWeight: 700, padding: '0.18rem 0.55rem', borderRadius: 999, textTransform: 'capitalize' }}>{role}</span>
}

function Avatar({ name, size = 28 }: { name: string | null; size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'linear-gradient(135deg,#4F81BD,#243F60)', color: 'white', fontSize: size * 0.32, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {(name ?? '?').charAt(0).toUpperCase()}
    </div>
  )
}

export default function AdminPage() {
  const navigate = useNavigate()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [attendance, setAttendance] = useState<AttendanceRow[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [auditLog, setAuditLog] = useState<AuditRow[]>([])
  const [allPosts, setAllPosts] = useState<PostRow[]>([])
  const [loading, setLoading] = useState(true)

  // Users
  const [userSearch, setUserSearch] = useState('')
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set())
  const [showAddUser, setShowAddUser] = useState(false)
  const [newUser, setNewUser] = useState({ email: '', password: '', full_name: '', role: 'employee', department_id: '' })
  const [addingUser, setAddingUser] = useState(false)
  const [addUserError, setAddUserError] = useState<string | null>(null)
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null)
  const [editingPin, setEditingPin] = useState<Record<string, string>>({})
  const [savingPin, setSavingPin] = useState<string | null>(null)

  // Departments
  const [newDeptName, setNewDeptName] = useState('')
  const [editingDept, setEditingDept] = useState<Record<string, string>>({})

  // Posts
  const [postSearch, setPostSearch] = useState('')
  const [postTypeFilter, setPostTypeFilter] = useState<'all' | 'announcement' | 'news_event'>('all')
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null)

  // Attendance
  const todayStr = fmtDate(new Date())
  const [attendanceDate, setAttendanceDate] = useState(todayStr)
  const [showManualAtt, setShowManualAtt] = useState(false)
  const [manualAtt, setManualAtt] = useState({ user_id: '', date: todayStr, clock_in: '09:00', clock_out: '17:00', include_clock_out: true })
  const [addingManualAtt, setAddingManualAtt] = useState(false)
  const [manualAttError, setManualAttError] = useState<string | null>(null)

  // Timetable
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))
  const [showAddSched, setShowAddSched] = useState(false)
  const [newSched, setNewSched] = useState({ user_id: '', date: todayStr, start_time: '09:00', end_time: '17:00', note: '' })
  const [addingSched, setAddingSched] = useState(false)
  const [deletingSchedId, setDeletingSchedId] = useState<string | null>(null)
  const [schedError, setSchedError] = useState<string | null>(null)

  // SQL
  const [sqlQuery, setSqlQuery] = useState('select id, full_name, role from profiles order by full_name')
  const [sqlResults, setSqlResults] = useState<unknown[] | null>(null)
  const [sqlStatus, setSqlStatus] = useState<string | null>(null)
  const [sqlError, setSqlError] = useState<string | null>(null)
  const [sqlRunning, setSqlRunning] = useState(false)

  async function loadAttendance(date: string) {
    const { data } = await supabase.from('attendance')
      .select('*, profile:profiles!user_id(full_name, department_id)')
      .gte('clock_in_at', `${date}T00:00:00`).lte('clock_in_at', `${date}T23:59:59`)
      .order('clock_in_at', { ascending: true })
    setAttendance((data ?? []) as AttendanceRow[])
  }

  async function loadSchedules(start: Date) {
    const { data } = await supabase.from('schedules')
      .select('*, profile:profiles!user_id(full_name, department_id)')
      .gte('scheduled_date', fmtDate(start)).lte('scheduled_date', fmtDate(addDays(start, 6)))
      .order('scheduled_date').order('start_time')
    setSchedules((data ?? []) as Schedule[])
  }

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { navigate('/login'); return }
      const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      if (!p || p.role !== 'admin') { navigate('/dashboard'); return }
      setProfile(p)
      const [{ data: ps }, { data: ds }, { data: al }, { data: pts }] = await Promise.all([
        supabase.from('profiles').select('*').order('full_name'),
        supabase.from('departments').select('*').order('name'),
        supabase.from('audit_log').select('*, profiles(full_name)').order('created_at', { ascending: false }).limit(50),
        supabase.from('posts').select('*, author:profiles!author_id(full_name)').order('created_at', { ascending: false }),
      ])
      setProfiles(ps ?? [])
      setDepartments(ds ?? [])
      setAuditLog((al ?? []) as AuditRow[])
      setAllPosts((pts ?? []) as PostRow[])
      setExpandedDepts(new Set((ds ?? []).map((d: Department) => d.id)))
      await loadAttendance(todayStr)
      await loadSchedules(getMonday(new Date()))
      setLoading(false)
    }
    load()
  }, [navigate])

  useEffect(() => { if (!loading) loadAttendance(attendanceDate) }, [attendanceDate])
  useEffect(() => { if (!loading) loadSchedules(weekStart) }, [weekStart])

  // ── User handlers ──
  async function handleAddUser() {
    if (!newUser.email || !newUser.password || !newUser.full_name) { setAddUserError('Name, email and password are required.'); return }
    if (newUser.password.length < 8) { setAddUserError('Password must be at least 8 characters.'); return }
    setAddingUser(true); setAddUserError(null)
    const { error } = await supabase.rpc('add_user', {
      p_email: newUser.email.trim(), p_password: newUser.password,
      p_full_name: newUser.full_name.trim(), p_role: newUser.role,
      p_department_id: newUser.department_id || null,
    })
    if (error) { setAddUserError(error.message); setAddingUser(false); return }
    const { data: ps } = await supabase.from('profiles').select('*').order('full_name')
    setProfiles(ps ?? [])
    setNewUser({ email: '', password: '', full_name: '', role: 'employee', department_id: '' })
    setShowAddUser(false); setAddingUser(false)
  }

  async function handleDeleteUser(userId: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This permanently removes their account.`)) return
    setDeletingUserId(userId)
    const { error } = await supabase.rpc('delete_user', { p_user_id: userId })
    if (!error) setProfiles(prev => prev.filter(p => p.id !== userId))
    else alert('Error: ' + error.message)
    setDeletingUserId(null)
  }

  async function updateProfile(id: string, field: string, value: string) {
    await supabase.from('profiles').update({ [field]: value }).eq('id', id)
    setProfiles(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p))
  }

  async function savePin(userId: string) {
    const raw = (editingPin[userId] ?? '').replace(/\D/g, '').slice(0, 4)
    if (raw && raw.length !== 4) { alert('PIN must be exactly 4 digits.'); return }
    setSavingPin(userId)
    await supabase.from('profiles').update({ kiosk_pin: raw || null }).eq('id', userId)
    setProfiles(prev => prev.map(p => p.id === userId ? { ...p, kiosk_pin: raw || null } : p))
    setEditingPin(prev => { const n = { ...prev }; delete n[userId]; return n })
    setSavingPin(null)
  }

  function toggleDept(id: string) {
    setExpandedDepts(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  // ── Dept handlers ──
  async function addDepartment() {
    if (!newDeptName.trim()) return
    const { data } = await supabase.from('departments').insert({ name: newDeptName.trim() }).select().single()
    if (data) { setDepartments(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name))); setExpandedDepts(prev => new Set(prev).add(data.id)) }
    setNewDeptName('')
  }

  async function saveDeptName(id: string) {
    const name = editingDept[id]; if (!name?.trim()) return
    await supabase.from('departments').update({ name: name.trim() }).eq('id', id)
    setDepartments(prev => prev.map(d => d.id === id ? { ...d, name: name.trim() } : d))
  }

  async function deleteDepartment(id: string, name: string) {
    const count = profiles.filter(p => p.department_id === id).length
    if (!window.confirm(count > 0 ? `"${name}" has ${count} member(s) who will be unassigned. Delete?` : `Delete "${name}"?`)) return
    await supabase.from('departments').delete().eq('id', id)
    setDepartments(prev => prev.filter(d => d.id !== id))
  }

  // ── Post handlers ──
  async function handleDeletePost(postId: string) {
    if (!window.confirm('Delete this post? This cannot be undone.')) return
    setDeletingPostId(postId)
    await supabase.from('posts').delete().eq('id', postId)
    setAllPosts(prev => prev.filter(p => p.id !== postId))
    setDeletingPostId(null)
  }

  // ── Attendance handlers ──
  async function handleAddManualAttendance() {
    if (!manualAtt.user_id || !manualAtt.date) { setManualAttError('Please select a user and date.'); return }
    setAddingManualAtt(true); setManualAttError(null)
    const clockInAt = `${manualAtt.date}T${manualAtt.clock_in}:00`
    const clockOutAt = manualAtt.include_clock_out ? `${manualAtt.date}T${manualAtt.clock_out}:00` : null
    const { data: existing } = await supabase.from('attendance').select('id')
      .eq('user_id', manualAtt.user_id).gte('clock_in_at', `${manualAtt.date}T00:00:00`).lte('clock_in_at', `${manualAtt.date}T23:59:59`).maybeSingle()
    const { error } = existing
      ? await supabase.from('attendance').update({ clock_in_at: clockInAt, clock_out_at: clockOutAt }).eq('id', existing.id)
      : await supabase.from('attendance').insert({ user_id: manualAtt.user_id, clock_in_at: clockInAt, clock_out_at: clockOutAt })
    if (error) { setManualAttError(error.message) }
    else { await loadAttendance(attendanceDate); setShowManualAtt(false); setManualAtt({ user_id: '', date: todayStr, clock_in: '09:00', clock_out: '17:00', include_clock_out: true }) }
    setAddingManualAtt(false)
  }

  // ── Schedule handlers ──
  async function handleAddSchedule() {
    if (!newSched.user_id || !newSched.date) { setSchedError('Please select a user and date.'); return }
    setAddingSched(true); setSchedError(null)
    const { error } = await supabase.from('schedules').insert({
      user_id: newSched.user_id, scheduled_date: newSched.date,
      start_time: newSched.start_time, end_time: newSched.end_time,
      note: newSched.note || null, created_by: profile?.id,
    })
    if (error) { setSchedError(error.message) }
    else { await loadSchedules(weekStart); setShowAddSched(false); setNewSched({ user_id: '', date: todayStr, start_time: '09:00', end_time: '17:00', note: '' }) }
    setAddingSched(false)
  }

  async function handleDeleteSchedule(id: string) {
    setDeletingSchedId(id)
    await supabase.from('schedules').delete().eq('id', id)
    setSchedules(prev => prev.filter(s => s.id !== id))
    setDeletingSchedId(null)
  }

  // ── SQL ──
  async function runSql() {
    if (!sqlQuery.trim()) return
    setSqlRunning(true); setSqlResults(null); setSqlStatus(null); setSqlError(null)
    const { data, error } = await supabase.rpc('exec_sql', { query: sqlQuery.trim() })
    setSqlRunning(false)
    if (error) { setSqlError(error.message); return }
    if (Array.isArray(data)) { setSqlResults(data); setSqlStatus(`${data.length} row${data.length !== 1 ? 's' : ''} returned`) }
    else { setSqlStatus('Query executed successfully'); setSqlResults([]) }
  }

  // ── Derived ──
  const searchedProfiles = profiles.filter(p => !userSearch || p.full_name?.toLowerCase().includes(userSearch.toLowerCase()))
  const profilesByDept = departments.map((dept, i) => ({
    dept, palette: DEPT_PALETTE[i % DEPT_PALETTE.length],
    members: searchedProfiles.filter(p => p.department_id === dept.id),
  }))
  const unassigned = searchedProfiles.filter(p => !p.department_id)
  const attendanceByDept = departments.map((dept, i) => ({
    dept, palette: DEPT_PALETTE[i % DEPT_PALETTE.length],
    rows: attendance.filter(a => a.profile?.department_id === dept.id),
    total: profiles.filter(p => p.department_id === dept.id).length,
  })).filter(g => g.rows.length > 0)
  const unassignedAtt = attendance.filter(a => !a.profile?.department_id)
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const resultColumns = sqlResults && sqlResults.length > 0 ? Object.keys(sqlResults[0] as object) : []

  const filteredPosts = allPosts.filter(p => {
    const matchSearch = !postSearch || p.title.toLowerCase().includes(postSearch.toLowerCase()) || (p.content ?? '').toLowerCase().includes(postSearch.toLowerCase())
    const matchType = postTypeFilter === 'all' || p.post_type === postTypeFilter
    return matchSearch && matchType
  })

  // Overview stats
  const pinsSet = profiles.filter(p => p.kiosk_pin).length
  const todayAtt = attendance.length
  const _weekShifts = schedules.length
  const mustReadPosts = allPosts.filter(p => p.must_read).length
  const roleCount = ['admin', 'hr', 'manager', 'employee'].map(r => ({ role: r, count: profiles.filter(p => p.role === r).length }))

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: '#6b7280', fontFamily: 'Nunito, sans-serif' }}>
      Loading…
    </div>
  )

  function renderUserTable(members: Profile[]) {
    return (
      <table className="al-table">
        <thead>
          <tr>
            <th>Name</th><th>Role</th><th>Department</th><th>Kiosk PIN</th><th style={{ width: 50 }}></th>
          </tr>
        </thead>
        <tbody>
          {members.length === 0 ? (
            <tr className="empty-row"><td colSpan={5}>No members in this department.</td></tr>
          ) : members.map(p => (
            <tr key={p.id}>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <Avatar name={p.full_name} />
                  <span style={{ fontWeight: 500 }}>{p.full_name ?? '—'}</span>
                </div>
              </td>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <RoleBadge role={p.role} />
                  <select className="al-select" value={p.role} onChange={e => updateProfile(p.id, 'role', e.target.value)}>
                    {['employee', 'manager', 'hr', 'admin'].map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </td>
              <td>
                <select className="al-select" value={p.department_id ?? ''} onChange={e => updateProfile(p.id, 'department_id', e.target.value)}>
                  <option value="">No department</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </td>
              <td>
                {p.id in editingPin ? (
                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                    <input
                      type="text" inputMode="numeric" maxLength={4} placeholder="4 digits"
                      value={editingPin[p.id] ?? ''}
                      onChange={e => setEditingPin(prev => ({ ...prev, [p.id]: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                      autoFocus
                      style={{ width: 72, padding: '0.3rem 0.5rem', border: '1px solid #4BACC6', borderRadius: 6, fontSize: '0.82rem', fontFamily: 'monospace', letterSpacing: '0.2em', textAlign: 'center' }}
                    />
                    <button className="btn-primary" style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem' }} onClick={() => savePin(p.id)} disabled={savingPin === p.id}>
                      {savingPin === p.id ? '…' : 'Save'}
                    </button>
                    <button className="btn-secondary" style={{ padding: '0.3rem 0.55rem', fontSize: '0.75rem' }} onClick={() => setEditingPin(prev => { const n = { ...prev }; delete n[p.id]; return n })}>✕</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: p.kiosk_pin ? '#243F60' : '#d1d5db', letterSpacing: '0.12em' }}>
                      {p.kiosk_pin ? '● ● ● ●' : 'No PIN'}
                    </span>
                    <button className="btn-secondary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.72rem' }} onClick={() => setEditingPin(prev => ({ ...prev, [p.id]: '' }))}>
                      {p.kiosk_pin ? 'Change' : 'Set PIN'}
                    </button>
                  </div>
                )}
              </td>
              <td>
                <button className="btn-icon" onClick={() => handleDeleteUser(p.id, p.full_name ?? 'this user')} disabled={deletingUserId === p.id} title="Delete user">
                  {deletingUserId === p.id ? '…' : '🗑'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  const tabGroups = [
    { label: 'Management', tabs: TABS.filter(t => t.group === 'main') },
    { label: 'Operations',  tabs: TABS.filter(t => t.group === 'data') },
    { label: 'Developer',   tabs: TABS.filter(t => t.group === 'dev') },
  ]

  return (
    <>
      <style>{`
        .al { min-height:100vh; background:#F2F4F7; font-family:'Nunito','Segoe UI',system-ui,sans-serif; }

        /* ── Top nav ── */
        .al-topnav {
          background:white; border-bottom:1px solid #e5e7eb;
          position:sticky; top:58px; z-index:200;
          display:flex; align-items:stretch;
          padding:0 1.5rem; gap:0;
          box-shadow:0 1px 3px rgba(0,0,0,0.05);
          overflow-x:auto;
        }
        .al-topnav::-webkit-scrollbar { display:none; }

        .al-nav-group {
          display:flex; align-items:center; gap:0;
          position:relative;
        }
        .al-nav-group:not(:last-child)::after {
          content:''; width:1px; height:20px; background:#e5e7eb;
          margin:0 0.35rem; flex-shrink:0;
        }

        .al-nav-group-label {
          font-size:0.6rem; font-weight:700; color:#c4c9d4;
          text-transform:uppercase; letter-spacing:0.1em;
          padding:0 0.5rem; white-space:nowrap; flex-shrink:0;
        }

        .al-nav-btn {
          display:flex; align-items:center; gap:0.4rem;
          padding:0.85rem 0.9rem; border:none; background:transparent;
          font-size:0.82rem; font-weight:500; color:#6b7280;
          cursor:pointer; transition:all 0.12s; white-space:nowrap;
          position:relative; border-bottom:2px solid transparent;
          font-family:inherit;
        }
        .al-nav-btn:hover { color:#243F60; background:#f8f9fb; }
        .al-nav-btn.active { color:#243F60; font-weight:700; border-bottom-color:#4BACC6; }
        .al-nav-btn-icon { font-size:0.88rem; }

        /* ── Body ── */
        .al-body { max-width:1320px; margin:0 auto; padding:1.75rem 1.5rem 3rem; }

        /* Cards */
        .al-card { background:white; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; margin-bottom:1rem; }

        .al-panel-header { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:1.25rem; gap:1rem; flex-wrap:wrap; }
        .al-panel-title { font-size:1.15rem; font-weight:800; color:#1A2B3C; margin:0; letter-spacing:-0.01em; }
        .al-panel-sub { font-size:0.82rem; color:#9ca3af; margin:0.15rem 0 0; }

        /* Overview stats */
        .overview-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:1rem; margin-bottom:1.25rem; }
        .stat-card { background:white; border:1px solid #e5e7eb; border-radius:14px; padding:1.25rem 1.35rem; display:flex; flex-direction:column; gap:0.5rem; }
        .stat-card-icon { font-size:1.4rem; }
        .stat-card-val { font-size:2rem; font-weight:800; color:#1A2B3C; line-height:1; letter-spacing:-0.02em; }
        .stat-card-label { font-size:0.75rem; font-weight:600; color:#9ca3af; text-transform:uppercase; letter-spacing:0.05em; }
        .stat-card-sub { font-size:0.78rem; color:#4BACC6; font-weight:600; }

        .overview-row { display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin-bottom:1rem; }

        .al-section-title { font-size:0.72rem; font-weight:700; color:#9ca3af; text-transform:uppercase; letter-spacing:0.08em; padding:0.85rem 1.1rem; border-bottom:1px solid #f3f4f6; display:flex; align-items:center; justify-content:space-between; }
        .al-section-title a { font-size:0.72rem; color:#4BACC6; font-weight:600; cursor:pointer; text-decoration:none; }
        .al-section-title a:hover { text-decoration:underline; }

        .role-bar-row { padding:0.55rem 1.1rem; display:flex; align-items:center; gap:0.75rem; border-bottom:1px solid #f9fafb; }
        .role-bar-row:last-child { border-bottom:none; }
        .role-bar-label { font-size:0.82rem; font-weight:600; color:#374151; width:80px; flex-shrink:0; text-transform:capitalize; }
        .role-bar-track { flex:1; height:7px; background:#f3f4f6; border-radius:999px; overflow:hidden; }
        .role-bar-fill { height:100%; border-radius:999px; transition:width 0.5s ease; }
        .role-bar-count { font-size:0.78rem; font-weight:700; color:#6b7280; width:28px; text-align:right; flex-shrink:0; }

        /* Tables */
        .al-table-wrap { overflow-x:auto; }
        .al-table { width:100%; border-collapse:collapse; font-size:0.85rem; }
        .al-table th { text-align:left; padding:0.65rem 1.1rem; background:#f9fafb; border-bottom:1px solid #e5e7eb; font-size:0.7rem; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:0.05em; white-space:nowrap; }
        .al-table td { padding:0.75rem 1.1rem; border-bottom:1px solid #f3f4f6; vertical-align:middle; color:#374151; }
        .al-table tr:last-child td { border-bottom:none; }
        .al-table tr:hover td { background:#fafafa; }

        /* Inputs */
        .al-select { padding:0.32rem 0.6rem; border:1px solid #e5e7eb; border-radius:7px; font-size:0.8rem; background:white; color:#374151; cursor:pointer; font-family:inherit; }
        .al-select:focus { outline:none; border-color:#4BACC6; }
        .al-input { padding:0.5rem 0.85rem; border:1px solid #e5e7eb; border-radius:8px; font-size:0.85rem; background:white; color:#374151; width:100%; box-sizing:border-box; font-family:inherit; }
        .al-input:focus { outline:none; border-color:#4BACC6; box-shadow:0 0 0 3px rgba(75,172,198,0.1); }
        .al-input-sm { padding:0.32rem 0.6rem; border:1px solid #e5e7eb; border-radius:7px; font-size:0.82rem; background:white; width:200px; font-family:inherit; }
        .al-input-sm:focus { outline:none; border-color:#4BACC6; }

        /* Buttons */
        .btn-primary { padding:0.5rem 1.1rem; background:#243F60; color:white; border:none; border-radius:8px; font-size:0.85rem; font-weight:600; cursor:pointer; transition:background 0.15s; white-space:nowrap; font-family:inherit; }
        .btn-primary:hover { background:#365F91; }
        .btn-primary:disabled { opacity:0.55; cursor:not-allowed; }
        .btn-secondary { padding:0.5rem 1rem; background:white; color:#374151; border:1px solid #e5e7eb; border-radius:8px; font-size:0.85rem; font-weight:600; cursor:pointer; transition:all 0.12s; white-space:nowrap; font-family:inherit; }
        .btn-secondary:hover { background:#f9fafb; }
        .btn-danger { padding:0.28rem 0.65rem; background:transparent; color:#dc2626; border:1px solid #fecaca; border-radius:6px; font-size:0.73rem; font-weight:600; cursor:pointer; transition:all 0.12s; font-family:inherit; }
        .btn-danger:hover { background:#fef2f2; }
        .btn-icon { background:none; border:none; cursor:pointer; padding:0.25rem; border-radius:5px; color:#9ca3af; font-size:0.85rem; transition:all 0.12s; }
        .btn-icon:hover { background:#fef2f2; color:#dc2626; }
        .btn-icon:disabled { opacity:0.4; cursor:not-allowed; }

        /* Search */
        .al-search { display:flex; align-items:center; gap:0.6rem; padding:0.75rem 1.1rem; border-bottom:1px solid #f3f4f6; background:#f9fafb; }
        .al-search input { flex:1; padding:0.45rem 0.75rem; border:1px solid #e5e7eb; border-radius:8px; font-size:0.85rem; background:white; font-family:inherit; }
        .al-search input:focus { outline:none; border-color:#4BACC6; }

        /* Dept sections */
        .dept-header { display:flex; align-items:center; gap:0.75rem; padding:0.9rem 1.1rem; cursor:pointer; transition:background 0.12s; border-bottom:1px solid #f3f4f6; user-select:none; }
        .dept-header:hover { background:#f9fafb; }
        .dept-dot { width:9px; height:9px; border-radius:50%; flex-shrink:0; }
        .dept-name-text { font-size:0.9rem; font-weight:700; color:#111827; flex:1; }
        .dept-badge { font-size:0.72rem; font-weight:700; padding:0.18rem 0.55rem; border-radius:999px; }
        .dept-chevron { font-size:0.7rem; color:#9ca3af; transition:transform 0.18s; }

        /* Add user form */
        .add-user-panel { border-bottom:1px solid #e5e7eb; background:#f8faff; padding:1.25rem 1.4rem; }
        .add-user-grid { display:grid; grid-template-columns:1fr 1fr; gap:0.75rem; margin-bottom:0.75rem; }
        .form-label { font-size:0.72rem; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:0.04em; display:block; margin-bottom:0.3rem; }
        .form-error { background:#fef2f2; color:#dc2626; border:1px solid #fecaca; border-radius:8px; padding:0.6rem 0.9rem; font-size:0.82rem; font-weight:500; margin-bottom:0.75rem; }
        .form-actions { display:flex; justify-content:flex-end; gap:0.6rem; }

        .pin-info-bar { display:flex; align-items:center; gap:0.6rem; padding:0.65rem 1.1rem; background:#EEF4FB; border-bottom:1px solid #C5D9F1; font-size:0.78rem; color:#365F91; font-weight:500; }

        /* Posts */
        .post-filter-bar { display:flex; align-items:center; gap:0.6rem; padding:0.75rem 1.1rem; border-bottom:1px solid #f3f4f6; background:#f9fafb; flex-wrap:wrap; }
        .filter-chip { padding:0.3rem 0.75rem; border:1px solid #e5e7eb; border-radius:999px; font-size:0.78rem; font-weight:600; color:#6b7280; background:white; cursor:pointer; transition:all 0.12s; font-family:inherit; }
        .filter-chip:hover { border-color:#4BACC6; color:#243F60; }
        .filter-chip.active { background:#EEF4FB; border-color:#4BACC6; color:#243F60; }
        .post-type-badge { font-size:0.65rem; font-weight:700; padding:0.15rem 0.5rem; border-radius:4px; text-transform:uppercase; letter-spacing:0.05em; }
        .post-type-ann { background:#EEF4FB; color:#365F91; border:1px solid #C5D9F1; }
        .post-type-event { background:#F3EEF9; color:#8064A2; border:1px solid #D9CCF0; }
        .post-must-read { background:#FEF2F2; color:#C0504D; border:1px solid #F4BDBB; font-size:0.65rem; font-weight:700; padding:0.15rem 0.5rem; border-radius:4px; text-transform:uppercase; letter-spacing:0.05em; }

        /* Attendance */
        .att-date-bar { display:flex; align-items:center; gap:0.75rem; padding:0.9rem 1.1rem; border-bottom:1px solid #f3f4f6; background:#f9fafb; flex-wrap:wrap; }
        .att-nav-btn { width:32px; height:32px; display:flex; align-items:center; justify-content:center; background:white; border:1px solid #e5e7eb; border-radius:7px; cursor:pointer; font-size:0.85rem; transition:all 0.12s; }
        .att-nav-btn:hover { border-color:#4BACC6; color:#4BACC6; }
        .att-date-display { font-size:0.9rem; font-weight:700; color:#1A2B3C; min-width:130px; text-align:center; }
        .att-today-btn { padding:0.3rem 0.75rem; background:#EEF4FB; border:1px solid #C5D9F1; border-radius:7px; color:#365F91; font-size:0.78rem; font-weight:600; cursor:pointer; font-family:inherit; }
        .att-summary-cards { display:grid; grid-template-columns:repeat(3,1fr); gap:0.75rem; padding:1rem 1.1rem; border-bottom:1px solid #f3f4f6; }
        .att-summary-card { background:#f9fafb; border:1px solid #f3f4f6; border-radius:10px; padding:0.85rem 1rem; }
        .att-summary-value { font-size:1.5rem; font-weight:800; color:#1A2B3C; line-height:1; }
        .att-summary-label { font-size:0.7rem; color:#9ca3af; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; margin-top:0.25rem; }
        .att-dept-header { display:flex; align-items:center; gap:0.75rem; padding:0.7rem 1.1rem; background:#f9fafb; border-bottom:1px solid #f3f4f6; }
        .att-dept-name { font-size:0.82rem; font-weight:700; color:#374151; flex:1; }
        .att-dept-badge { font-size:0.7rem; font-weight:600; padding:0.18rem 0.55rem; border-radius:999px; background:#EEF4FB; color:#365F91; border:1px solid #C5D9F1; }
        .att-bar { width:80px; height:5px; background:#f3f4f6; border-radius:999px; overflow:hidden; flex-shrink:0; }
        .att-bar-fill { height:100%; border-radius:999px; }
        .status-in { background:#f0fdf4; color:#16a34a; border:1px solid #bbf7d0; font-size:0.68rem; font-weight:700; padding:0.18rem 0.5rem; border-radius:999px; white-space:nowrap; }
        .status-out { background:#EEF4FB; color:#365F91; border:1px solid #C5D9F1; font-size:0.68rem; font-weight:700; padding:0.18rem 0.5rem; border-radius:999px; white-space:nowrap; }
        .manual-att-panel { padding:1.1rem 1.4rem; border-bottom:1px solid #e5e7eb; background:#f8faff; }
        .manual-att-grid { display:grid; grid-template-columns:2fr 1fr 1fr 1fr; gap:0.75rem; align-items:end; margin-bottom:0.75rem; }
        .checkbox-row { display:flex; align-items:center; gap:0.5rem; font-size:0.82rem; color:#374151; }
        .checkbox-row input { width:16px; height:16px; cursor:pointer; accent-color:#4BACC6; }

        /* Timetable */
        .tt-week-bar { display:flex; align-items:center; gap:0.75rem; padding:0.9rem 1.1rem; border-bottom:1px solid #f3f4f6; background:#f9fafb; }
        .tt-week-label { font-size:0.9rem; font-weight:700; color:#1A2B3C; flex:1; }
        .tt-grid { display:grid; grid-template-columns:repeat(7,1fr); }
        .tt-day-col { border-right:1px solid #f3f4f6; }
        .tt-day-col:last-child { border-right:none; }
        .tt-day-header { padding:0.6rem 0.5rem; text-align:center; border-bottom:1px solid #f3f4f6; background:#f9fafb; }
        .tt-day-name { font-size:0.68rem; font-weight:700; color:#9ca3af; text-transform:uppercase; letter-spacing:0.04em; }
        .tt-day-date { font-size:0.82rem; font-weight:700; color:#374151; margin-top:0.15rem; }
        .tt-day-date.today { color:#4BACC6; }
        .tt-day-body { padding:0.5rem; min-height:80px; }
        .tt-slot { border-radius:7px; padding:0.35rem 0.5rem; margin-bottom:0.35rem; font-size:0.72rem; position:relative; }
        .tt-slot-name { font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .tt-slot-time { color:#6b7280; margin-top:0.1rem; }
        .tt-slot-note { color:#9ca3af; font-style:italic; margin-top:0.1rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .tt-slot-del { position:absolute; top:3px; right:4px; background:none; border:none; cursor:pointer; color:#d1d5db; font-size:0.62rem; padding:0; line-height:1; }
        .tt-slot-del:hover { color:#dc2626; }
        .tt-empty-day { color:#d1d5db; font-size:0.72rem; text-align:center; padding:1.25rem 0; }
        .add-sched-panel { padding:1.1rem 1.4rem; border-top:1px solid #e5e7eb; background:#f8faff; }
        .add-sched-grid { display:grid; grid-template-columns:2fr 1fr 1fr 1fr 2fr; gap:0.75rem; align-items:end; margin-bottom:0.75rem; }
        .dept-add-row { display:flex; gap:0.6rem; padding:1rem 1.1rem; border-bottom:1px solid #f3f4f6; background:#f9fafb; }

        /* SQL */
        .sql-panel { padding:1.25rem; display:flex; flex-direction:column; gap:1rem; }
        .sql-chips { display:flex; gap:0.4rem; flex-wrap:wrap; }
        .sql-chip { padding:0.28rem 0.65rem; background:#f3f4f6; border:1px solid #e5e7eb; border-radius:6px; font-size:0.75rem; font-weight:600; color:#374151; cursor:pointer; transition:all 0.12s; font-family:inherit; }
        .sql-chip:hover { background:#243F60; color:white; border-color:#243F60; }
        .sql-textarea { width:100%; min-height:110px; padding:0.85rem 1rem; border:1px solid #e5e7eb; border-radius:10px; font-family:'Courier New',monospace; font-size:0.85rem; resize:vertical; box-sizing:border-box; background:#0d1117; color:#c9d1d9; line-height:1.6; }
        .sql-textarea:focus { outline:none; border-color:#4BACC6; }
        .sql-actions { display:flex; align-items:center; gap:1rem; }
        .sql-hint { font-size:0.75rem; color:#9ca3af; }
        .sql-status { font-size:0.82rem; color:#16a34a; font-weight:600; margin-left:auto; }
        .sql-error { background:#fef2f2; color:#dc2626; border:1px solid #fecaca; border-radius:8px; padding:0.75rem 1rem; font-size:0.82rem; font-family:monospace; white-space:pre-wrap; }
        .sql-results-wrap { overflow-x:auto; border:1px solid #e5e7eb; border-radius:10px; }
        .sql-results-wrap .al-table td { font-family:monospace; font-size:0.78rem; max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

        .empty-row td { text-align:center; color:#9ca3af; padding:2.5rem !important; }

        @media(max-width:960px) {
          .overview-grid { grid-template-columns:1fr 1fr; }
          .overview-row { grid-template-columns:1fr; }
          .add-user-grid,.manual-att-grid { grid-template-columns:1fr 1fr; }
          .add-sched-grid { grid-template-columns:1fr 1fr 1fr; }
          .tt-grid { grid-template-columns:repeat(4,1fr); }
        }
        @media(max-width:640px) {
          .al-body { padding:1rem; }
          .overview-grid { grid-template-columns:1fr 1fr; }
          .att-summary-cards { grid-template-columns:1fr 1fr; }
          .add-user-grid,.manual-att-grid,.add-sched-grid { grid-template-columns:1fr; }
          .tt-grid { grid-template-columns:repeat(2,1fr); }
        }
      `}</style>

      <div className="al">
        <Navbar fullName={profile?.full_name ?? null} role="admin" />

        {/* Top nav */}
        <div className="al-topnav">
          {tabGroups.map((group, gi) => (
            <div key={gi} className="al-nav-group">
              <span className="al-nav-group-label">{group.label}</span>
              {group.tabs.map(t => (
                <button
                  key={t.id}
                  className={`al-nav-btn${tab === t.id ? ' active' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  <span className="al-nav-btn-icon">{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="al-body">

          {/* ════ OVERVIEW ════ */}
          {tab === 'overview' && (
            <>
              <div className="al-panel-header">
                <div>
                  <h1 className="al-panel-title">Admin Overview</h1>
                  <p className="al-panel-sub">System snapshot — InfoWall Enterprise Communication Platform</p>
                </div>
              </div>

              <div className="overview-grid">
                <div className="stat-card">
                  <div className="stat-card-icon">👥</div>
                  <div className="stat-card-val">{profiles.length}</div>
                  <div className="stat-card-label">Total users</div>
                  <div className="stat-card-sub">{departments.length} departments</div>
                </div>
                <div className="stat-card">
                  <div className="stat-card-icon">🔐</div>
                  <div className="stat-card-val">{pinsSet}</div>
                  <div className="stat-card-label">Kiosk PINs set</div>
                  <div className="stat-card-sub">{profiles.length - pinsSet} still needed</div>
                </div>
                <div className="stat-card">
                  <div className="stat-card-icon">🕐</div>
                  <div className="stat-card-val">{todayAtt}</div>
                  <div className="stat-card-label">Clocked in today</div>
                  <div className="stat-card-sub">{attendance.filter(a => !a.clock_out_at).length} still in</div>
                </div>
                <div className="stat-card">
                  <div className="stat-card-icon">📢</div>
                  <div className="stat-card-val">{allPosts.length}</div>
                  <div className="stat-card-label">Total posts</div>
                  <div className="stat-card-sub">{mustReadPosts} must-read</div>
                </div>
              </div>

              <div className="overview-row">
                {/* Role breakdown */}
                <div className="al-card">
                  <div className="al-section-title">
                    Staff by role
                    <a onClick={() => setTab('users')}>Manage users →</a>
                  </div>
                  {roleCount.map(({ role, count }) => {
                    const colors: Record<string, string> = { admin: '#dc2626', hr: '#7c3aed', manager: '#1d4ed8', employee: '#16a34a' }
                    const pct = profiles.length > 0 ? (count / profiles.length) * 100 : 0
                    return (
                      <div key={role} className="role-bar-row">
                        <span className="role-bar-label">{role}</span>
                        <div className="role-bar-track">
                          <div className="role-bar-fill" style={{ width: `${pct}%`, background: colors[role] ?? '#9ca3af' }} />
                        </div>
                        <span className="role-bar-count">{count}</span>
                      </div>
                    )
                  })}
                </div>

                {/* Department breakdown */}
                <div className="al-card">
                  <div className="al-section-title">
                    Staff by department
                    <a onClick={() => setTab('departments')}>Manage →</a>
                  </div>
                  {departments.map((dept, i) => {
                    const count = profiles.filter(p => p.department_id === dept.id).length
                    const pal = DEPT_PALETTE[i % DEPT_PALETTE.length]
                    const pct = profiles.length > 0 ? (count / profiles.length) * 100 : 0
                    return (
                      <div key={dept.id} className="role-bar-row">
                        <span className="role-bar-label" style={{ fontSize: '0.78rem' }}>{dept.name}</span>
                        <div className="role-bar-track">
                          <div className="role-bar-fill" style={{ width: `${pct}%`, background: pal.accent }} />
                        </div>
                        <span className="role-bar-count">{count}</span>
                      </div>
                    )
                  })}
                  {departments.length === 0 && (
                    <div style={{ padding: '1.5rem', color: '#9ca3af', fontSize: '0.85rem', textAlign: 'center' }}>No departments yet.</div>
                  )}
                </div>
              </div>

              {/* Quick actions */}
              <div className="al-card">
                <div className="al-section-title">Quick actions</div>
                <div style={{ display: 'flex', gap: '0.75rem', padding: '1rem 1.1rem', flexWrap: 'wrap' }}>
                  {[
                    { icon: '👤', label: 'Add new user', action: () => { setTab('users'); setShowAddUser(true) } },
                    { icon: '🏢', label: 'Add department', action: () => setTab('departments') },
                    { icon: '📆', label: 'Add shift', action: () => { setTab('timetable'); setShowAddSched(true) } },
                    { icon: '🕐', label: 'Manual attendance', action: () => { setTab('attendance'); setShowManualAtt(true) } },
                    { icon: '🛠', label: 'SQL Console', action: () => setTab('sql') },
                    { icon: '🖥️', label: 'View kiosk', action: () => navigate('/kiosk') },
                  ].map(qa => (
                    <button key={qa.label} onClick={qa.action} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 1.1rem', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '10px', font: 'inherit', fontSize: '0.85rem', fontWeight: 600, color: '#374151', cursor: 'pointer', transition: 'all 0.12s' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#4BACC6'; (e.currentTarget as HTMLElement).style.color = '#243F60' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#e5e7eb'; (e.currentTarget as HTMLElement).style.color = '#374151' }}
                    >
                      <span>{qa.icon}</span>{qa.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Recent audit */}
              <div className="al-card">
                <div className="al-section-title">
                  Recent activity
                  <a onClick={() => setTab('audit')}>View all →</a>
                </div>
                <table className="al-table">
                  <thead><tr><th>Action</th><th>Performed by</th><th>When</th></tr></thead>
                  <tbody>
                    {auditLog.slice(0, 6).map(a => (
                      <tr key={a.id}>
                        <td><span style={{ fontWeight: 600, color: '#1A2B3C' }}>{ACTION_LABELS[a.action] ?? a.action}</span></td>
                        <td style={{ fontWeight: 500 }}>{a.profiles?.full_name ?? '—'}</td>
                        <td style={{ color: '#9ca3af', fontSize: '0.78rem' }}>{timeAgo(a.created_at)}</td>
                      </tr>
                    ))}
                    {auditLog.length === 0 && <tr className="empty-row"><td colSpan={3}>No activity yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ════ USERS ════ */}
          {tab === 'users' && (
            <>
              <div className="al-panel-header">
                <div><h1 className="al-panel-title">User Management</h1><p className="al-panel-sub">{profiles.length} users · {pinsSet} kiosk PINs assigned</p></div>
                <button className="btn-primary" onClick={() => { setShowAddUser(o => !o); setAddUserError(null) }}>
                  {showAddUser ? '✕ Cancel' : '+ Add user'}
                </button>
              </div>

              <div className="al-card">
                {showAddUser && (
                  <div className="add-user-panel">
                    <p style={{ fontWeight: 700, fontSize: '0.88rem', color: '#1A2B3C', margin: '0 0 1rem' }}>New user details</p>
                    {addUserError && <div className="form-error">⚠ {addUserError}</div>}
                    <div className="add-user-grid">
                      <div><label className="form-label">Full name *</label><input className="al-input" placeholder="Jane Smith" value={newUser.full_name} onChange={e => setNewUser(p => ({ ...p, full_name: e.target.value }))} /></div>
                      <div><label className="form-label">Email *</label><input className="al-input" placeholder="jane@infowall.test" value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} /></div>
                      <div><label className="form-label">Password *</label><input className="al-input" type="password" placeholder="Min. 8 characters" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} /></div>
                      <div><label className="form-label">Role</label><select className="al-input" value={newUser.role} onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))}>{['employee', 'manager', 'hr', 'admin'].map(r => <option key={r} value={r}>{r}</option>)}</select></div>
                      <div><label className="form-label">Department</label><select className="al-input" value={newUser.department_id} onChange={e => setNewUser(p => ({ ...p, department_id: e.target.value }))}><option value="">No department</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
                    </div>
                    <div className="form-actions">
                      <button className="btn-secondary" onClick={() => setShowAddUser(false)}>Cancel</button>
                      <button className="btn-primary" onClick={handleAddUser} disabled={addingUser}>{addingUser ? 'Creating…' : 'Create user'}</button>
                    </div>
                  </div>
                )}

                <div className="pin-info-bar">
                  🔐 Kiosk PINs allow staff to clock in at <strong>/kiosk</strong> without logging in. Set a 4-digit PIN per employee.
                </div>

                <div className="al-search">
                  <input placeholder="Search users by name…" value={userSearch} onChange={e => setUserSearch(e.target.value)} />
                  {userSearch && <button style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer' }} onClick={() => setUserSearch('')}>✕</button>}
                </div>

                {profilesByDept.map(({ dept, palette, members }, idx) => {
                  const open = expandedDepts.has(dept.id)
                  return (
                    <div key={dept.id} style={{ borderBottom: idx < profilesByDept.length - 1 || unassigned.length > 0 ? '1px solid #f3f4f6' : 'none' }}>
                      <div className="dept-header" onClick={() => toggleDept(dept.id)}>
                        <div className="dept-dot" style={{ background: palette.accent }} />
                        <span className="dept-name-text">{dept.name}</span>
                        <span className="dept-badge" style={{ background: palette.light, color: palette.accent }}>{members.length} members</span>
                        <span className="dept-chevron" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>▶</span>
                      </div>
                      {open && renderUserTable(members)}
                    </div>
                  )
                })}

                {unassigned.length > 0 && (
                  <div>
                    <div className="dept-header" onClick={() => toggleDept('__unassigned__')}>
                      <div className="dept-dot" style={{ background: '#9ca3af' }} />
                      <span className="dept-name-text">Unassigned</span>
                      <span className="dept-badge" style={{ background: '#f3f4f6', color: '#6b7280' }}>{unassigned.length} members</span>
                      <span className="dept-chevron" style={{ transform: expandedDepts.has('__unassigned__') ? 'rotate(90deg)' : 'none' }}>▶</span>
                    </div>
                    {expandedDepts.has('__unassigned__') && renderUserTable(unassigned)}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ════ DEPARTMENTS ════ */}
          {tab === 'departments' && (
            <>
              <div className="al-panel-header">
                <div><h1 className="al-panel-title">Departments</h1><p className="al-panel-sub">{departments.length} departments configured</p></div>
              </div>
              <div className="al-card">
                <div className="dept-add-row">
                  <input className="al-input" style={{ flex: 1 }} placeholder="New department name…" value={newDeptName} onChange={e => setNewDeptName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addDepartment()} />
                  <button className="btn-primary" onClick={addDepartment}>Add department</button>
                </div>
                <div className="al-table-wrap">
                  <table className="al-table">
                    <thead><tr><th>Department name</th><th>Members</th><th style={{ width: 100 }}></th></tr></thead>
                    <tbody>
                      {departments.map(d => {
                        const count = profiles.filter(p => p.department_id === d.id).length
                        return (
                          <tr key={d.id}>
                            <td><input className="al-input-sm" value={editingDept[d.id] ?? d.name} onChange={e => setEditingDept(prev => ({ ...prev, [d.id]: e.target.value }))} onBlur={() => saveDeptName(d.id)} /></td>
                            <td><span style={{ fontWeight: 600 }}>{count}</span> <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>{count === 1 ? 'member' : 'members'}</span></td>
                            <td><button className="btn-danger" onClick={() => deleteDepartment(d.id, d.name)}>Delete</button></td>
                          </tr>
                        )
                      })}
                      {departments.length === 0 && <tr className="empty-row"><td colSpan={3}>No departments yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* ════ POSTS ════ */}
          {tab === 'posts' && (
            <>
              <div className="al-panel-header">
                <div><h1 className="al-panel-title">Post Management</h1><p className="al-panel-sub">{allPosts.length} total posts · {mustReadPosts} must-read</p></div>
                <button className="btn-primary" onClick={() => navigate('/create-post')}>✏️ Create post</button>
              </div>

              <div className="al-card">
                <div className="post-filter-bar">
                  <input className="al-input" style={{ maxWidth: 280, flex: 1 }} placeholder="🔍 Search posts…" value={postSearch} onChange={e => setPostSearch(e.target.value)} />
                  {(['all', 'announcement', 'news_event'] as const).map(f => (
                    <button key={f} className={`filter-chip${postTypeFilter === f ? ' active' : ''}`} onClick={() => setPostTypeFilter(f)}>
                      {f === 'all' ? 'All' : f === 'announcement' ? '📢 Announcements' : '📅 Events'}
                    </button>
                  ))}
                  {(postSearch || postTypeFilter !== 'all') && (
                    <span style={{ fontSize: '0.78rem', color: '#9ca3af', marginLeft: 'auto' }}>{filteredPosts.length} result{filteredPosts.length !== 1 ? 's' : ''}</span>
                  )}
                </div>

                <div className="al-table-wrap">
                  <table className="al-table">
                    <thead>
                      <tr><th>Title</th><th>Author</th><th>Type</th><th>Audience</th><th>Created</th><th style={{ width: 60 }}></th></tr>
                    </thead>
                    <tbody>
                      {filteredPosts.length === 0 ? (
                        <tr className="empty-row"><td colSpan={6}>No posts found.</td></tr>
                      ) : filteredPosts.map(post => (
                        <tr key={post.id}>
                          <td>
                            <div style={{ fontWeight: 600, color: '#1A2B3C', marginBottom: '0.2rem', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {post.title}
                            </div>
                            <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                              <span className={post.post_type === 'announcement' ? 'post-type-badge post-type-ann' : 'post-type-badge post-type-event'}>
                                {post.post_type === 'announcement' ? 'Announcement' : 'Event'}
                              </span>
                              {post.must_read && <span className="post-must-read">Must-read</span>}
                            </div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <Avatar name={post.author?.full_name ?? null} size={24} />
                              <span style={{ fontSize: '0.82rem' }}>{post.author?.full_name ?? '—'}</span>
                            </div>
                          </td>
                          <td><span className={post.post_type === 'announcement' ? 'post-type-badge post-type-ann' : 'post-type-badge post-type-event'}>{post.post_type === 'announcement' ? 'Announcement' : 'Event'}</span></td>
                          <td style={{ fontSize: '0.78rem', color: '#6b7280' }}>
                            {post.recipient_id ? 'Personal' : post.department_id ? departments.find(d => d.id === post.department_id)?.name ?? 'Dept' : 'Global'}
                          </td>
                          <td style={{ fontSize: '0.78rem', color: '#9ca3af', whiteSpace: 'nowrap' }}>{timeAgo(post.created_at)}</td>
                          <td>
                            <button className="btn-icon" onClick={() => handleDeletePost(post.id)} disabled={deletingPostId === post.id} title="Delete post">
                              {deletingPostId === post.id ? '…' : '🗑'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* ════ ATTENDANCE ════ */}
          {tab === 'attendance' && (
            <>
              <div className="al-panel-header">
                <div><h1 className="al-panel-title">Attendance</h1><p className="al-panel-sub">Clock-in and clock-out records by date</p></div>
                <button className="btn-primary" onClick={() => { setShowManualAtt(o => !o); setManualAttError(null) }}>
                  {showManualAtt ? '✕ Cancel' : '+ Manual entry'}
                </button>
              </div>
              <div className="al-card">
                <div className="att-date-bar">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <button className="att-nav-btn" onClick={() => setAttendanceDate(fmtDate(addDays(new Date(attendanceDate + 'T12:00:00'), -1)))}>←</button>
                    <span className="att-date-display">{fmtDateDisplay(attendanceDate)}</span>
                    <button className="att-nav-btn" onClick={() => setAttendanceDate(fmtDate(addDays(new Date(attendanceDate + 'T12:00:00'), 1)))}>→</button>
                  </div>
                  <input type="date" value={attendanceDate} onChange={e => setAttendanceDate(e.target.value)} style={{ padding: '0.35rem 0.6rem', border: '1px solid #e5e7eb', borderRadius: '7px', fontSize: '0.82rem', fontFamily: 'inherit' }} />
                  <button className="att-today-btn" onClick={() => setAttendanceDate(todayStr)}>Today</button>
                </div>

                <div className="att-summary-cards">
                  <div className="att-summary-card"><div className="att-summary-value" style={{ color: '#4BACC6' }}>{attendance.length}</div><div className="att-summary-label">Clocked in</div></div>
                  <div className="att-summary-card"><div className="att-summary-value" style={{ color: '#16a34a' }}>{attendance.filter(a => a.clock_out_at).length}</div><div className="att-summary-label">Clocked out</div></div>
                  <div className="att-summary-card"><div className="att-summary-value" style={{ color: '#f59e0b' }}>{attendance.filter(a => !a.clock_out_at).length}</div><div className="att-summary-label">Still in</div></div>
                </div>

                {showManualAtt && (
                  <div className="manual-att-panel">
                    <p style={{ fontWeight: 700, fontSize: '0.88rem', color: '#1A2B3C', margin: '0 0 0.85rem' }}>Manual attendance entry</p>
                    {manualAttError && <div className="form-error">⚠ {manualAttError}</div>}
                    <div className="manual-att-grid">
                      <div><label className="form-label">Employee *</label><select className="al-input" value={manualAtt.user_id} onChange={e => setManualAtt(p => ({ ...p, user_id: e.target.value }))}><option value="">Select employee…</option>{profiles.map(p => <option key={p.id} value={p.id}>{p.full_name ?? p.id}</option>)}</select></div>
                      <div><label className="form-label">Date *</label><input type="date" className="al-input" value={manualAtt.date} onChange={e => setManualAtt(p => ({ ...p, date: e.target.value }))} /></div>
                      <div><label className="form-label">Clock in</label><input type="time" className="al-input" value={manualAtt.clock_in} onChange={e => setManualAtt(p => ({ ...p, clock_in: e.target.value }))} /></div>
                      <div>
                        <label className="form-label">Clock out</label>
                        <input type="time" className="al-input" value={manualAtt.clock_out} onChange={e => setManualAtt(p => ({ ...p, clock_out: e.target.value }))} disabled={!manualAtt.include_clock_out} style={{ opacity: manualAtt.include_clock_out ? 1 : 0.4 }} />
                        <label className="checkbox-row" style={{ marginTop: '0.4rem' }}>
                          <input type="checkbox" checked={manualAtt.include_clock_out} onChange={e => setManualAtt(p => ({ ...p, include_clock_out: e.target.checked }))} />
                          Include clock out
                        </label>
                      </div>
                    </div>
                    <div className="form-actions">
                      <button className="btn-secondary" onClick={() => setShowManualAtt(false)}>Cancel</button>
                      <button className="btn-primary" onClick={handleAddManualAttendance} disabled={addingManualAtt}>{addingManualAtt ? 'Saving…' : 'Save record'}</button>
                    </div>
                  </div>
                )}

                {attendance.length === 0 && !showManualAtt ? (
                  <div style={{ padding: '2.5rem', textAlign: 'center', color: '#9ca3af' }}>No attendance records for {fmtDateDisplay(attendanceDate)}.</div>
                ) : (
                  <>
                    {attendanceByDept.map(({ dept, palette, rows, total }) => (
                      <div key={dept.id}>
                        <div className="att-dept-header">
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: palette.accent, flexShrink: 0 }} />
                          <span className="att-dept-name">{dept.name}</span>
                          <span className="att-dept-badge">{rows.length} / {total}</span>
                          <div className="att-bar"><div className="att-bar-fill" style={{ width: `${total > 0 ? (rows.length / total) * 100 : 0}%`, background: palette.accent }} /></div>
                        </div>
                        <table className="al-table">
                          <thead><tr><th>Employee</th><th>Clock in</th><th>Clock out</th><th>Status</th></tr></thead>
                          <tbody>
                            {rows.map(a => (
                              <tr key={a.id}>
                                <td><div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}><Avatar name={a.profile?.full_name ?? null} size={26} /><span style={{ fontWeight: 500 }}>{a.profile?.full_name ?? '—'}</span></div></td>
                                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtDatetime(a.clock_in_at)}</td>
                                <td style={{ color: a.clock_out_at ? '#374151' : '#d1d5db' }}>{a.clock_out_at ? fmtDatetime(a.clock_out_at) : '—'}</td>
                                <td>{a.clock_out_at ? <span className="status-out">✓ Clocked out</span> : <span className="status-in">● Still in</span>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                    {unassignedAtt.length > 0 && (
                      <div>
                        <div className="att-dept-header">
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#9ca3af', flexShrink: 0 }} />
                          <span className="att-dept-name">Unassigned</span>
                          <span className="att-dept-badge">{unassignedAtt.length} records</span>
                        </div>
                        <table className="al-table">
                          <thead><tr><th>Employee</th><th>Clock in</th><th>Clock out</th><th>Status</th></tr></thead>
                          <tbody>
                            {unassignedAtt.map(a => (
                              <tr key={a.id}>
                                <td><div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}><Avatar name={a.profile?.full_name ?? null} size={26} /><span style={{ fontWeight: 500 }}>{a.profile?.full_name ?? '—'}</span></div></td>
                                <td>{fmtDatetime(a.clock_in_at)}</td>
                                <td style={{ color: a.clock_out_at ? '#374151' : '#d1d5db' }}>{a.clock_out_at ? fmtDatetime(a.clock_out_at) : '—'}</td>
                                <td>{a.clock_out_at ? <span className="status-out">✓ Clocked out</span> : <span className="status-in">● Still in</span>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          {/* ════ TIMETABLE ════ */}
          {tab === 'timetable' && (
            <>
              <div className="al-panel-header">
                <div><h1 className="al-panel-title">Timetable</h1><p className="al-panel-sub">Weekly schedule — {schedules.length} shifts this week</p></div>
                <button className="btn-primary" onClick={() => { setShowAddSched(o => !o); setSchedError(null) }}>
                  {showAddSched ? '✕ Cancel' : '+ Add shift'}
                </button>
              </div>
              <div className="al-card">
                <div className="tt-week-bar">
                  <button className="att-nav-btn" onClick={() => setWeekStart(w => addDays(w, -7))}>←</button>
                  <span className="tt-week-label">{fmtDateDisplay(fmtDate(weekStart))} — {fmtDateDisplay(fmtDate(addDays(weekStart, 6)))}</span>
                  <button className="att-nav-btn" onClick={() => setWeekStart(w => addDays(w, 7))}>→</button>
                  <button className="att-today-btn" onClick={() => setWeekStart(getMonday(new Date()))}>This week</button>
                </div>

                {showAddSched && (
                  <div className="add-sched-panel">
                    <p style={{ fontWeight: 700, fontSize: '0.88rem', color: '#1A2B3C', margin: '0 0 0.85rem' }}>Add scheduled shift</p>
                    {schedError && <div className="form-error">⚠ {schedError}</div>}
                    <div className="add-sched-grid">
                      <div><label className="form-label">Employee *</label><select className="al-input" value={newSched.user_id} onChange={e => setNewSched(p => ({ ...p, user_id: e.target.value }))}><option value="">Select employee…</option>{profiles.map(p => <option key={p.id} value={p.id}>{p.full_name ?? p.id}</option>)}</select></div>
                      <div><label className="form-label">Date *</label><input type="date" className="al-input" value={newSched.date} onChange={e => setNewSched(p => ({ ...p, date: e.target.value }))} /></div>
                      <div><label className="form-label">Start</label><input type="time" className="al-input" value={newSched.start_time} onChange={e => setNewSched(p => ({ ...p, start_time: e.target.value }))} /></div>
                      <div><label className="form-label">End</label><input type="time" className="al-input" value={newSched.end_time} onChange={e => setNewSched(p => ({ ...p, end_time: e.target.value }))} /></div>
                      <div><label className="form-label">Note</label><input className="al-input" placeholder="Optional…" value={newSched.note} onChange={e => setNewSched(p => ({ ...p, note: e.target.value }))} /></div>
                    </div>
                    <div className="form-actions">
                      <button className="btn-secondary" onClick={() => setShowAddSched(false)}>Cancel</button>
                      <button className="btn-primary" onClick={handleAddSchedule} disabled={addingSched}>{addingSched ? 'Saving…' : 'Save shift'}</button>
                    </div>
                  </div>
                )}

                <div className="tt-grid">
                  {weekDays.map((day, i) => {
                    const dayStr = fmtDate(day)
                    const isToday = dayStr === todayStr
                    const daySchedules = schedules.filter(s => s.scheduled_date === dayStr)
                    return (
                      <div key={dayStr} className="tt-day-col">
                        <div className="tt-day-header">
                          <div className="tt-day-name">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i]}</div>
                          <div className={`tt-day-date${isToday ? ' today' : ''}`}>{day.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</div>
                        </div>
                        <div className="tt-day-body">
                          {daySchedules.length === 0 ? <div className="tt-empty-day">—</div> : daySchedules.map(s => {
                            const deptIdx = departments.findIndex(d => d.id === s.profile?.department_id)
                            const pal = deptIdx >= 0 ? DEPT_PALETTE[deptIdx % DEPT_PALETTE.length] : DEPT_PALETTE[i % DEPT_PALETTE.length]
                            return (
                              <div key={s.id} className="tt-slot" style={{ background: pal.light, border: `1px solid ${pal.border}` }}>
                                <button className="tt-slot-del" onClick={() => handleDeleteSchedule(s.id)} disabled={deletingSchedId === s.id}>{deletingSchedId === s.id ? '…' : '✕'}</button>
                                <div className="tt-slot-name" style={{ color: pal.accent }}>{s.profile?.full_name ?? '—'}</div>
                                <div className="tt-slot-time">{fmtTime(s.start_time)} – {fmtTime(s.end_time)}</div>
                                {s.note && <div className="tt-slot-note">{s.note}</div>}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}

          {/* ════ AUDIT ════ */}
          {tab === 'audit' && (
            <>
              <div className="al-panel-header"><div><h1 className="al-panel-title">Audit Log</h1><p className="al-panel-sub">Last 50 system events</p></div></div>
              <div className="al-card">
                <div className="al-table-wrap">
                  <table className="al-table">
                    <thead><tr><th>Action</th><th>Target</th><th>Performed by</th><th>When</th></tr></thead>
                    <tbody>
                      {auditLog.map(a => (
                        <tr key={a.id}>
                          <td><span style={{ fontWeight: 600, color: '#1A2B3C' }}>{ACTION_LABELS[a.action] ?? a.action}</span></td>
                          <td style={{ color: '#6b7280', fontFamily: 'monospace', fontSize: '0.78rem' }}>{a.target ?? '—'}</td>
                          <td style={{ fontWeight: 500 }}>{a.profiles?.full_name ?? '—'}</td>
                          <td style={{ color: '#9ca3af', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{new Date(a.created_at).toLocaleString('en-AU')}</td>
                        </tr>
                      ))}
                      {auditLog.length === 0 && <tr className="empty-row"><td colSpan={4}>No audit events yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* ════ SQL ════ */}
          {tab === 'sql' && (
            <>
              <div className="al-panel-header"><div><h1 className="al-panel-title">SQL Console</h1><p className="al-panel-sub">Admin-only — direct database access</p></div></div>
              <div className="al-card">
                <div className="sql-panel">
                  <div className="sql-chips">{QUICK_QUERIES.map(q => <button key={q.label} className="sql-chip" onClick={() => setSqlQuery(q.sql)}>{q.label}</button>)}</div>
                  <textarea className="sql-textarea" value={sqlQuery} onChange={e => setSqlQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runSql() }} spellCheck={false} />
                  <div className="sql-actions">
                    <button className="btn-primary" onClick={runSql} disabled={sqlRunning}>{sqlRunning ? '⏳ Running…' : '▶ Run query'}</button>
                    <span className="sql-hint">Ctrl + Enter to run</span>
                    {sqlStatus && <span className="sql-status">{sqlStatus}</span>}
                  </div>
                  {sqlError && <div className="sql-error">{sqlError}</div>}
                  {sqlResults && sqlResults.length > 0 && (
                    <div className="sql-results-wrap">
                      <table className="al-table">
                        <thead><tr>{resultColumns.map(col => <th key={col}>{col}</th>)}</tr></thead>
                        <tbody>{sqlResults.map((row, i) => (<tr key={i}>{resultColumns.map(col => <td key={col} title={String((row as Record<string, unknown>)[col] ?? '')}>{String((row as Record<string, unknown>)[col] ?? '—')}</td>)}</tr>))}</tbody>
                      </table>
                    </div>
                  )}
                  {sqlResults && sqlResults.length === 0 && !sqlError && <p style={{ color: '#9ca3af', fontSize: '0.85rem', margin: 0 }}>No rows returned.</p>}
                </div>
              </div>
            </>
          )}

        </div>
      </div>
    </>
  )
}
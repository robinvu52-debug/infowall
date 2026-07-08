import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Navbar from '../components/Navbar'

interface Profile {
  id: string
  full_name: string | null
  role: string
  department_id: string | null
  bio: string | null
  created_at: string
}
interface Department { id: string; name: string }
interface FeedPost {
  id: string; content: string; mood: string | null
  image_url: string | null; created_at: string; likes?: number
}
interface Post {
  id: string; title: string; post_type: string; must_read: boolean; created_at: string
}

const MOODS = [
  { emoji: '😊', label: 'Feeling great' }, { emoji: '🎉', label: 'Celebrating' },
  { emoji: '💪', label: 'Motivated' }, { emoji: '🤔', label: 'Thinking' },
  { emoji: '☕', label: 'Getting started' }, { emoji: '🚀', label: 'In the zone' },
]

const ROLE_CONFIG: Record<string, { bg: string; color: string; border: string; label: string }> = {
  admin:    { bg: '#fef2f2', color: '#dc2626', border: '#fecaca', label: 'Administrator' },
  hr:       { bg: '#faf5ff', color: '#7c3aed', border: '#e9d5ff', label: 'HR' },
  manager:  { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe', label: 'Manager' },
  employee: { bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0', label: 'Employee' },
}

const HERO_GRADIENTS = [
  ['#1A2B3C', '#365F91'], ['#1e1b4b', '#4F81BD'], ['#064e3b', '#4BACC6'],
  ['#1c1917', '#8064A2'], ['#4a1942', '#C0504D'], ['#172554', '#243F60'],
  ['#1a1a2e', '#4BACC6'],
]

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(dateStr).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function initials(name: string | null): string {
  if (!name) return '?'
  return name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase()
}

export default function ProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [currentUserProfile, setCurrentUserProfile] = useState<Profile | null>(null)
  const [viewedProfile, setViewedProfile] = useState<Profile | null>(null)
  const [department, setDepartment] = useState<Department | null>(null)
  const [feedPosts, setFeedPosts] = useState<FeedPost[]>([])
  const [announcements, setAnnouncements] = useState<Post[]>([])
  const [totalLikes, setTotalLikes] = useState(0)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'posts' | 'announcements' | 'about'>('posts')
  const [editingBio, setEditingBio] = useState(false)
  const [bioValue, setBioValue] = useState('')
  const [savingBio, setSavingBio] = useState(false)
  const [notFound, setNotFound] = useState(false)

  const isOwnProfile = currentUserId === id

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { navigate('/login'); return }
      setCurrentUserId(user.id)

      const [
        { data: currentProfile },
        { data: viewedProfileData },
        { data: postsData },
        { data: announcementsData },
      ] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('profiles').select('*').eq('id', id).single(),
        supabase.from('feed_posts').select('*').eq('author_id', id).order('created_at', { ascending: false }).limit(20),
        supabase.from('posts').select('id, title, post_type, must_read, created_at').eq('author_id', id).order('created_at', { ascending: false }).limit(10),
      ])

      setCurrentUserProfile(currentProfile)

      if (!viewedProfileData) { setNotFound(true); setLoading(false); return }
      setViewedProfile(viewedProfileData)
      setBioValue(viewedProfileData.bio ?? '')

      if (viewedProfileData.department_id) {
        const { data: dept } = await supabase.from('departments').select('*').eq('id', viewedProfileData.department_id).single()
        setDepartment(dept)
      }

      const posts = (postsData ?? []) as FeedPost[]
      setFeedPosts(posts)
      setAnnouncements((announcementsData ?? []) as Post[])

      if (posts.length > 0) {
        const { count } = await supabase
          .from('feed_likes').select('id', { count: 'exact', head: true })
          .in('post_id', posts.map(p => p.id))
        setTotalLikes(count ?? 0)
      }

      setLoading(false)
    }
    load()
  }, [id, navigate])

  async function saveBio() {
    if (!isOwnProfile) return
    setSavingBio(true)
    const trimmed = bioValue.trim()
    await supabase.from('profiles').update({ bio: trimmed || null }).eq('id', id!)
    setViewedProfile(prev => prev ? { ...prev, bio: trimmed || null } : prev)
    setEditingBio(false)
    setSavingBio(false)
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: '#6b7280', fontFamily: 'Nunito, sans-serif' }}>
      Loading…
    </div>
  )

  if (notFound || !viewedProfile) return (
    <>
      <Navbar fullName={currentUserProfile?.full_name ?? null} role={currentUserProfile?.role ?? 'employee'} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', color: '#9ca3af', gap: '0.75rem', fontFamily: 'Nunito, sans-serif' }}>
        <span style={{ fontSize: '3rem' }}>👤</span>
        <p style={{ fontWeight: 700, color: '#374151', margin: 0, fontSize: '1.1rem' }}>User not found</p>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: '#4F81BD', fontWeight: 700, cursor: 'pointer', fontSize: '0.88rem' }}>← Go back</button>
      </div>
    </>
  )

  const userInitials = initials(viewedProfile.full_name)
  const roleConfig = ROLE_CONFIG[viewedProfile.role] ?? { bg: '#f3f4f6', color: '#374151', border: '#e5e7eb', label: viewedProfile.role }
  const gradIdx = (viewedProfile.full_name?.charCodeAt(0) ?? 0) % HERO_GRADIENTS.length
  const [gradFrom, gradTo] = HERO_GRADIENTS[gradIdx]
  const memberSince = new Date(viewedProfile.created_at).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })

  return (
    <>
      <style>{`
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes slideUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes countUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }

        .pp { min-height:100vh; background:#F2F4F7; font-family:'Nunito','Segoe UI',system-ui,sans-serif; }
        .pp-body { max-width:900px; margin:0 auto; padding:0 1.25rem 4rem; }

        .pp-hero { position:relative; margin-bottom:0; }
        .pp-banner { height:220px; position:relative; overflow:hidden; }
        .pp-banner-bg { position:absolute; inset:0; transition:opacity 0.5s ease; }
        .pp-banner-shapes { position:absolute; inset:0; pointer-events:none; overflow:hidden; }
        .pp-banner-overlay { position:absolute; inset:0; background:linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.3)); }

        .pp-avatar-section {
          position:relative; padding:0 1.5rem;
          display:flex; align-items:flex-end; justify-content:space-between;
          gap:1rem; flex-wrap:wrap;
          margin-top:-52px; z-index:2;
          padding-bottom:1.25rem;
          background:white;
          border-left:1px solid #e5e7eb;
          border-right:1px solid #e5e7eb;
          border-bottom:1px solid #e5e7eb;
        }

        .pp-avatar {
          width:104px; height:104px; border-radius:50%;
          border:4px solid white;
          display:flex; align-items:center; justify-content:center;
          font-size:2.2rem; font-weight:800; color:white;
          box-shadow:0 4px 16px rgba(0,0,0,0.18);
          flex-shrink:0; position:relative; z-index:3;
          letter-spacing:-0.02em; margin-top:-4px;
        }
        .pp-avatar-online { position:absolute; bottom:6px; right:6px; width:14px; height:14px; border-radius:50%; background:#22c55e; border:3px solid white; }

        .pp-identity { flex:1; padding-top:60px; min-width:0; }
        .pp-name { font-size:1.65rem; font-weight:800; color:#1A2B3C; margin:0 0 0.45rem; line-height:1.15; letter-spacing:-0.025em; }
        .pp-badges { display:flex; align-items:center; gap:0.45rem; flex-wrap:wrap; }
        .pp-role-badge { font-size:0.72rem; font-weight:700; padding:0.22rem 0.7rem; border-radius:999px; text-transform:capitalize; letter-spacing:0.02em; border:1px solid; }
        .pp-dept-badge { display:flex; align-items:center; gap:0.3rem; font-size:0.72rem; font-weight:600; padding:0.22rem 0.7rem; border-radius:999px; background:#f3f4f6; color:#6b7280; border:1px solid #e5e7eb; }
        .pp-member-since { font-size:0.72rem; color:#c4c9d4; font-weight:500; display:flex; align-items:center; gap:0.3rem; }

        .pp-header-actions { display:flex; gap:0.5rem; align-items:center; padding-top:56px; flex-shrink:0; }

        .btn-msg-pp { display:flex; align-items:center; gap:0.5rem; padding:0.55rem 1.25rem; background:#243F60; color:white; border:none; border-radius:10px; font-size:0.85rem; font-weight:700; cursor:pointer; transition:all 0.15s; white-space:nowrap; font-family:inherit; box-shadow:0 2px 8px rgba(36,63,96,0.2); }
        .btn-msg-pp:hover { background:#365F91; transform:translateY(-1px); box-shadow:0 4px 12px rgba(36,63,96,0.3); }
        .btn-outline-pp { display:flex; align-items:center; gap:0.45rem; padding:0.55rem 1.1rem; background:white; color:#374151; border:1.5px solid #e5e7eb; border-radius:10px; font-size:0.85rem; font-weight:600; cursor:pointer; transition:all 0.15s; white-space:nowrap; font-family:inherit; }
        .btn-outline-pp:hover { border-color:#4BACC6; color:#243F60; background:#EEF4FB; }

        .pp-stats { background:white; border:1px solid #e5e7eb; border-top:none; display:grid; grid-template-columns:repeat(4,1fr); border-radius:0 0 16px 16px; overflow:hidden; margin-bottom:1.25rem; }
        .pp-stat { padding:1.1rem 0.75rem; text-align:center; border-right:1px solid #f3f4f6; cursor:default; transition:background 0.12s; }
        .pp-stat:last-child { border-right:none; }
        .pp-stat:hover { background:#fafafa; }
        .pp-stat-val { display:block; font-size:1.6rem; font-weight:800; color:#1A2B3C; line-height:1; margin-bottom:0.3rem; letter-spacing:-0.02em; animation:countUp 0.4s ease both; }
        .pp-stat-label { font-size:0.67rem; font-weight:700; color:#9ca3af; text-transform:uppercase; letter-spacing:0.07em; }

        .pp-layout { display:grid; grid-template-columns:1fr 288px; gap:1.25rem; align-items:start; }

        .pp-tabs { display:flex; background:white; border:1px solid #e5e7eb; border-radius:12px 12px 0 0; overflow:hidden; border-bottom:none; }
        .pp-tab { flex:1; padding:0.85rem 1rem; text-align:center; font-size:0.82rem; font-weight:600; color:#9ca3af; cursor:pointer; transition:all 0.12s; border:none; background:transparent; font-family:inherit; border-bottom:2px solid transparent; }
        .pp-tab:hover { color:#243F60; background:#f9fafb; }
        .pp-tab.active { color:#243F60; font-weight:700; border-bottom-color:#4BACC6; background:white; }
        .pp-tab-count { font-size:0.68rem; background:#f3f4f6; color:#9ca3af; border-radius:999px; padding:0.1rem 0.45rem; margin-left:0.4rem; }
        .pp-tab.active .pp-tab-count { background:#EEF4FB; color:#4BACC6; }

        .pp-card { background:white; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; margin-bottom:1rem; }
        .pp-card-first { border-radius:0 0 14px 14px; }
        .pp-card-header { display:flex; align-items:center; justify-content:space-between; padding:1rem 1.35rem; border-bottom:1px solid #f3f4f6; }
        .pp-card-title { font-size:0.72rem; font-weight:700; color:#374151; text-transform:uppercase; letter-spacing:0.07em; margin:0; }

        .pp-bio-empty { font-size:0.88rem; color:#c4c9d4; margin:0; font-style:italic; }
        .pp-bio-text { font-size:0.92rem; color:#374151; line-height:1.75; margin:0; white-space:pre-wrap; font-family:'Source Serif 4','Cambria','Georgia',serif; }

        .btn-edit-sm { display:flex; align-items:center; gap:0.3rem; background:none; border:1px solid #e5e7eb; border-radius:7px; padding:0.25rem 0.65rem; font-size:0.73rem; font-weight:600; color:#6b7280; cursor:pointer; transition:all 0.12s; font-family:inherit; }
        .btn-edit-sm:hover { border-color:#4BACC6; color:#243F60; background:#EEF4FB; }

        .pp-bio-textarea { width:100%; min-height:100px; border:1.5px solid #4BACC6; border-radius:10px; padding:0.75rem; font-size:0.9rem; color:#374151; line-height:1.65; font-family:inherit; resize:vertical; box-sizing:border-box; outline:none; box-shadow:0 0 0 3px rgba(75,172,198,0.1); }
        .pp-bio-actions { display:flex; gap:0.5rem; justify-content:flex-end; margin-top:0.6rem; }
        .btn-save-sm { padding:0.42rem 1rem; background:#243F60; color:white; border:none; border-radius:8px; font-size:0.82rem; font-weight:700; cursor:pointer; transition:background 0.15s; font-family:inherit; }
        .btn-save-sm:hover:not(:disabled) { background:#365F91; }
        .btn-save-sm:disabled { opacity:0.55; cursor:not-allowed; }
        .btn-cancel-sm { padding:0.42rem 0.85rem; background:white; color:#6b7280; border:1px solid #e5e7eb; border-radius:8px; font-size:0.82rem; font-weight:600; cursor:pointer; transition:all 0.12s; font-family:inherit; }
        .btn-cancel-sm:hover { background:#f9fafb; }

        .pp-feed-post { padding:1.25rem 1.35rem; border-bottom:1px solid #f3f4f6; transition:background 0.12s; animation:slideUp 0.25s ease both; }
        .pp-feed-post:last-child { border-bottom:none; }
        .pp-feed-post:hover { background:#fafafa; }
        .pp-mood-chip { display:inline-flex; align-items:center; gap:0.3rem; background:#EEF4FB; border:1px solid #C5D9F1; border-radius:999px; padding:0.18rem 0.6rem; font-size:0.72rem; color:#365F91; font-weight:600; margin-bottom:0.55rem; }
        .pp-post-content { font-size:0.9rem; color:#374151; line-height:1.68; margin:0 0 0.65rem; white-space:pre-wrap; word-break:break-word; font-family:'Source Serif 4','Cambria','Georgia',serif; display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden; }
        .pp-post-img { width:100%; max-height:260px; object-fit:cover; border-radius:10px; display:block; margin-bottom:0.65rem; }
        .pp-post-footer { display:flex; align-items:center; gap:1rem; }
        .pp-post-likes { display:flex; align-items:center; gap:0.35rem; font-size:0.78rem; color:#9ca3af; font-weight:600; }
        .pp-post-time { font-size:0.72rem; color:#c4c9d4; margin-left:auto; }

        .pp-ann-item { display:flex; align-items:center; gap:0.75rem; padding:0.85rem 1.35rem; border-bottom:1px solid #f3f4f6; transition:background 0.1s; cursor:pointer; }
        .pp-ann-item:last-child { border-bottom:none; }
        .pp-ann-item:hover { background:#f9fafb; }
        .pp-ann-icon { width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:0.85rem; flex-shrink:0; }
        .pp-ann-title { font-size:0.85rem; font-weight:600; color:#1A2B3C; line-height:1.3; flex:1; }
        .pp-ann-badge { font-size:0.62rem; font-weight:700; padding:0.15rem 0.5rem; border-radius:4px; letter-spacing:0.05em; text-transform:uppercase; flex-shrink:0; }
        .pp-ann-badge.must { background:#FEF2F2; color:#C0504D; border:1px solid #F4BDBB; }
        .pp-ann-badge.event { background:#F3EEF9; color:#8064A2; border:1px solid #D9CCF0; }
        .pp-ann-time { font-size:0.7rem; color:#c4c9d4; flex-shrink:0; }

        .pp-details-grid { display:grid; grid-template-columns:1fr 1fr; gap:1.1rem; padding:1.25rem 1.35rem; }
        .pp-detail-label { font-size:0.68rem; font-weight:700; color:#9ca3af; text-transform:uppercase; letter-spacing:0.06em; display:block; margin-bottom:0.3rem; }
        .pp-detail-value { font-size:0.9rem; font-weight:600; color:#374151; display:flex; align-items:center; gap:0.4rem; }

        .pp-sidebar { display:flex; flex-direction:column; gap:1rem; position:sticky; top:72px; }
        .pp-sidebar-section { padding:1rem 1.1rem; border-bottom:1px solid #f3f4f6; }
        .pp-sidebar-section:last-child { border-bottom:none; }
        .pp-sidebar-label { font-size:0.65rem; font-weight:700; color:#9ca3af; text-transform:uppercase; letter-spacing:0.08em; display:block; margin-bottom:0.75rem; }

        .pp-contact-btn { display:flex; align-items:center; gap:0.65rem; width:100%; padding:0.65rem 0.85rem; border:1px solid #e5e7eb; border-radius:10px; background:white; font-size:0.85rem; font-weight:600; color:#374151; cursor:pointer; transition:all 0.15s; font-family:inherit; margin-bottom:0.45rem; text-align:left; }
        .pp-contact-btn:hover { border-color:#4BACC6; color:#243F60; background:#EEF4FB; }
        .pp-contact-btn:last-child { margin-bottom:0; }
        .pp-contact-icon { width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:0.9rem; flex-shrink:0; }

        .pp-empty { padding:2.5rem 1.35rem; text-align:center; color:#9ca3af; }
        .pp-empty-icon { font-size:2rem; opacity:0.5; margin-bottom:0.5rem; }
        .pp-empty-text { font-size:0.85rem; }

        @media(max-width:768px) {
          .pp-layout { grid-template-columns:1fr; }
          .pp-sidebar { position:static; }
          .pp-stats { grid-template-columns:repeat(2,1fr); }
          .pp-avatar-section { flex-direction:column; align-items:flex-start; gap:0.75rem; }
          .pp-header-actions { padding-top:0; }
          .pp-details-grid { grid-template-columns:1fr; }
          .pp-body { padding:0 0 3rem; }
          .pp-banner { height:160px; }
        }
      `}</style>

      <div className="pp">
        <Navbar fullName={currentUserProfile?.full_name ?? null} role={currentUserProfile?.role ?? 'employee'} />

        <div className="pp-body">
          <div className="pp-hero">
            <div className="pp-banner">
              <div className="pp-banner-bg" style={{ background: `linear-gradient(135deg, ${gradFrom} 0%, ${gradTo} 100%)` }} />
              <div className="pp-banner-shapes">
                <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} xmlns="http://www.w3.org/2000/svg">
                  <circle cx="88%" cy="-20%" r="140" fill="rgba(255,255,255,0.06)" />
                  <circle cx="4%"  cy="120%" r="100" fill="rgba(255,255,255,0.05)" />
                  <circle cx="55%" cy="60%"  r="70"  fill="rgba(255,255,255,0.04)" />
                  <circle cx="75%" cy="85%"  r="45"  fill="rgba(255,255,255,0.05)" />
                  <circle cx="20%" cy="20%"  r="30"  fill="rgba(255,255,255,0.06)" />
                </svg>
              </div>
              <div className="pp-banner-overlay" />
            </div>

            <div className="pp-avatar-section">
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1.1rem', flex: 1, minWidth: 0 }}>
                <div className="pp-avatar" style={{ background: `linear-gradient(135deg, ${gradFrom}, ${gradTo})` }}>
                  {userInitials}
                  <div className="pp-avatar-online" />
                </div>
                <div className="pp-identity" style={{ paddingTop: 0, paddingBottom: '0.25rem' }}>
                  <h1 className="pp-name">{viewedProfile.full_name ?? 'Unknown User'}</h1>
                  <div className="pp-badges">
                    <span className="pp-role-badge" style={{ background: roleConfig.bg, color: roleConfig.color, borderColor: roleConfig.border }}>
                      {roleConfig.label}
                    </span>
                    {department && <span className="pp-dept-badge">🏢 {department.name}</span>}
                    <span className="pp-member-since">📅 Since {memberSince}</span>
                  </div>
                </div>
              </div>

              <div className="pp-header-actions">
                {isOwnProfile ? (
                  <>
                    <button className="btn-outline-pp" onClick={() => navigate('/feed')}>📰 My feed</button>
                    <button className="btn-outline-pp" onClick={() => { setActiveTab('about'); setEditingBio(true) }}>✎ Edit profile</button>
                  </>
                ) : (
                  <>
                    <button className="btn-msg-pp" onClick={() => navigate(`/messages/${viewedProfile.id}`)}>💬 Message</button>
                    <button className="btn-outline-pp" onClick={() => navigate('/feed')}>📰 Feed</button>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="pp-stats">
            {[
              { val: feedPosts.length,      label: 'Feed posts',     delay: '0s' },
              { val: totalLikes,            label: 'Likes received', delay: '0.08s' },
              { val: announcements.length,  label: 'Announcements',  delay: '0.16s' },
              { val: Math.floor((Date.now() - new Date(viewedProfile.created_at).getTime()) / (1000 * 60 * 60 * 24)), label: 'Days member', delay: '0.24s' },
            ].map((stat, i) => (
              <div key={i} className="pp-stat">
                <span className="pp-stat-val" style={{ animationDelay: stat.delay }}>{stat.val.toLocaleString()}</span>
                <span className="pp-stat-label">{stat.label}</span>
              </div>
            ))}
          </div>

          <div className="pp-layout">
            <div>
              <div className="pp-tabs">
                {([
                  { id: 'posts',         label: 'Feed posts',    count: feedPosts.length },
                  { id: 'announcements', label: 'Announcements', count: announcements.length },
                  { id: 'about',         label: 'About',         count: null },
                ] as const).map(t => (
                  <button key={t.id} className={`pp-tab${activeTab === t.id ? ' active' : ''}`} onClick={() => setActiveTab(t.id)}>
                    {t.label}
                    {t.count !== null && <span className="pp-tab-count">{t.count}</span>}
                  </button>
                ))}
              </div>

              {activeTab === 'posts' && (
                <div className="pp-card pp-card-first">
                  {feedPosts.length === 0 ? (
                    <div className="pp-empty">
                      <div className="pp-empty-icon">📝</div>
                      <div className="pp-empty-text">{isOwnProfile ? "You haven't posted anything yet." : "No feed posts yet."}</div>
                    </div>
                  ) : feedPosts.map((post, i) => {
                    const moodData = MOODS.find(m => m.emoji === post.mood)
                    return (
                      <div key={post.id} className="pp-feed-post" style={{ animationDelay: `${i * 0.05}s` }}>
                        {moodData && (
                          <div className="pp-mood-chip"><span>{moodData.emoji}</span><span>{moodData.label}</span></div>
                        )}
                        <p className="pp-post-content">{post.content}</p>
                        {post.image_url && (
                          <img className="pp-post-img" src={post.image_url} alt="" loading="lazy" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                        )}
                        <div className="pp-post-footer">
                          <span className="pp-post-likes">❤️ likes</span>
                          <span className="pp-post-time">{timeAgo(post.created_at)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {activeTab === 'announcements' && (
                <div className="pp-card pp-card-first">
                  {announcements.length === 0 ? (
                    <div className="pp-empty">
                      <div className="pp-empty-icon">📢</div>
                      <div className="pp-empty-text">No posts published yet.</div>
                    </div>
                  ) : announcements.map((post, i) => (
                    <div key={post.id} className="pp-ann-item" onClick={() => navigate('/dashboard')} style={{ animationDelay: `${i * 0.04}s` }}>
                      <div className="pp-ann-icon" style={{ background: post.post_type === 'news_event' ? '#F3EEF9' : '#EEF4FB', color: post.post_type === 'news_event' ? '#8064A2' : '#365F91' }}>
                        {post.post_type === 'news_event' ? '📅' : '📢'}
                      </div>
                      <div className="pp-ann-title">{post.title}</div>
                      {post.must_read && <span className="pp-ann-badge must">Must-read</span>}
                      {post.post_type === 'news_event' && !post.must_read && <span className="pp-ann-badge event">Event</span>}
                      <span className="pp-ann-time">{timeAgo(post.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'about' && (
                <div>
                  <div className="pp-card pp-card-first">
                    <div className="pp-card-header">
                      <h2 className="pp-card-title">Bio</h2>
                      {isOwnProfile && !editingBio && (
                        <button className="btn-edit-sm" onClick={() => setEditingBio(true)}>✎ {viewedProfile.bio ? 'Edit' : 'Add bio'}</button>
                      )}
                    </div>
                    <div style={{ padding: '1.1rem 1.35rem' }}>
                      {editingBio ? (
                        <>
                          <textarea className="pp-bio-textarea" value={bioValue} onChange={e => setBioValue(e.target.value.slice(0, 400))} placeholder="Tell your colleagues a bit about yourself…" autoFocus />
                          <p style={{ fontSize: '0.72rem', color: '#c4c9d4', textAlign: 'right', margin: '0.3rem 0 0' }}>{400 - bioValue.length} characters left</p>
                          <div className="pp-bio-actions">
                            <button className="btn-cancel-sm" onClick={() => { setEditingBio(false); setBioValue(viewedProfile.bio ?? '') }}>Cancel</button>
                            <button className="btn-save-sm" onClick={saveBio} disabled={savingBio}>{savingBio ? 'Saving…' : 'Save bio'}</button>
                          </div>
                        </>
                      ) : viewedProfile.bio ? (
                        <p className="pp-bio-text">{viewedProfile.bio}</p>
                      ) : (
                        <p className="pp-bio-empty">{isOwnProfile ? 'Add a bio to let colleagues know who you are.' : "This person hasn't added a bio yet."}</p>
                      )}
                    </div>
                  </div>

                  <div className="pp-card">
                    <div className="pp-card-header"><h2 className="pp-card-title">Details</h2></div>
                    <div className="pp-details-grid">
                      <div><span className="pp-detail-label">Full name</span><span className="pp-detail-value">{viewedProfile.full_name ?? '—'}</span></div>
                      <div><span className="pp-detail-label">Role</span><span className="pp-detail-value" style={{ color: roleConfig.color }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: roleConfig.color, display: 'inline-block', flexShrink: 0 }} />{roleConfig.label}</span></div>
                      <div><span className="pp-detail-label">Department</span><span className="pp-detail-value">{department?.name ?? '—'}</span></div>
                      <div><span className="pp-detail-label">Member since</span><span className="pp-detail-value">{memberSince}</span></div>
                      <div><span className="pp-detail-label">Feed posts</span><span className="pp-detail-value">{feedPosts.length}</span></div>
                      <div><span className="pp-detail-label">Likes received</span><span className="pp-detail-value">❤️ {totalLikes}</span></div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="pp-sidebar">
              {!isOwnProfile && (
                <div className="pp-card">
                  <div className="pp-card-header"><h2 className="pp-card-title">Connect</h2></div>
                  <div style={{ padding: '1rem 1.1rem' }}>
                    <button className="pp-contact-btn" onClick={() => navigate(`/messages/${viewedProfile.id}`)}>
                      <div className="pp-contact-icon" style={{ background: '#EEF4FB', color: '#365F91' }}>💬</div>
                      Send a direct message
                    </button>
                    <button className="pp-contact-btn" onClick={() => navigate('/feed')}>
                      <div className="pp-contact-icon" style={{ background: '#f0fdf4', color: '#16a34a' }}>📰</div>
                      View their feed posts
                    </button>
                    {['hr', 'manager', 'admin'].includes(currentUserProfile?.role ?? '') && (
                      <button className="pp-contact-btn" onClick={() => navigate('/create-post')}>
                        <div className="pp-contact-icon" style={{ background: '#faf5ff', color: '#7c3aed' }}>✏️</div>
                        Post to their team
                      </button>
                    )}
                  </div>
                </div>
              )}

              {isOwnProfile && (
                <div className="pp-card">
                  <div className="pp-card-header"><h2 className="pp-card-title">Quick links</h2></div>
                  <div style={{ padding: '1rem 1.1rem' }}>
                    <button className="pp-contact-btn" onClick={() => navigate('/dashboard')}>
                      <div className="pp-contact-icon" style={{ background: '#EEF4FB', color: '#365F91' }}>🏠</div>Dashboard
                    </button>
                    <button className="pp-contact-btn" onClick={() => navigate('/messages')}>
                      <div className="pp-contact-icon" style={{ background: '#f0fdf4', color: '#16a34a' }}>💬</div>Direct messages
                    </button>
                    <button className="pp-contact-btn" onClick={() => navigate('/feed')}>
                      <div className="pp-contact-icon" style={{ background: '#faf5ff', color: '#7c3aed' }}>📰</div>News feed
                    </button>
                    {['hr', 'manager', 'admin'].includes(viewedProfile.role) && (
                      <button className="pp-contact-btn" onClick={() => navigate('/create-post')}>
                        <div className="pp-contact-icon" style={{ background: '#fff7ed', color: '#c2410c' }}>✏️</div>Create a post
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="pp-card">
                <div className="pp-card-header"><h2 className="pp-card-title">About</h2></div>
                <div style={{ padding: '1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  <div>
                    <span className="pp-sidebar-label">Role</span>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: roleConfig.color, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: roleConfig.color, display: 'inline-block' }} />{roleConfig.label}
                    </span>
                  </div>
                  <div>
                    <span className="pp-sidebar-label">Department</span>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#374151' }}>{department?.name ?? '—'}</span>
                  </div>
                  <div>
                    <span className="pp-sidebar-label">Member since</span>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#374151' }}>{memberSince}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

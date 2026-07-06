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

interface Department {
  id: string
  name: string
}

interface FeedPost {
  id: string
  content: string
  mood: string | null
  image_url: string | null
  created_at: string
}

const MOODS = [
  { emoji: '😊', label: 'Feeling great' },
  { emoji: '🎉', label: 'Celebrating' },
  { emoji: '💪', label: 'Motivated' },
  { emoji: '🤔', label: 'Thinking' },
  { emoji: '☕', label: 'Getting started' },
  { emoji: '🚀', label: 'In the zone' },
]

const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  admin:    { bg: '#fef2f2', color: '#dc2626' },
  hr:       { bg: '#faf5ff', color: '#7c3aed' },
  manager:  { bg: '#eff6ff', color: '#1d4ed8' },
  employee: { bg: '#f0fdf4', color: '#16a34a' },
}

const HERO_GRADIENTS = [
  ['#0d2d3a', '#00b8b8'],
  ['#1e1b4b', '#6366f1'],
  ['#064e3b', '#10b981'],
  ['#1c1917', '#f59e0b'],
  ['#4a1942', '#ec4899'],
  ['#172554', '#3b82f6'],
]

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(dateStr).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

function ProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [currentUserProfile, setCurrentUserProfile] = useState<Profile | null>(null)
  const [viewedProfile, setViewedProfile] = useState<Profile | null>(null)
  const [department, setDepartment] = useState<Department | null>(null)
  const [feedPosts, setFeedPosts] = useState<FeedPost[]>([])
  const [totalLikes, setTotalLikes] = useState(0)
  const [loading, setLoading] = useState(true)
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
      ] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('profiles').select('*').eq('id', id).single(),
        supabase.from('feed_posts').select('*').eq('author_id', id).order('created_at', { ascending: false }).limit(20),
      ])

      setCurrentUserProfile(currentProfile)

      if (!viewedProfileData) { setNotFound(true); setLoading(false); return }
      setViewedProfile(viewedProfileData)
      setBioValue(viewedProfileData.bio ?? '')

      if (viewedProfileData.department_id) {
        const { data: dept } = await supabase
          .from('departments').select('*').eq('id', viewedProfileData.department_id).single()
        setDepartment(dept)
      }

      const posts = (postsData ?? []) as FeedPost[]
      setFeedPosts(posts)

      if (posts.length > 0) {
        const { count } = await supabase
          .from('feed_likes')
          .select('id', { count: 'exact', head: true })
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
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: '#6b7280' }}>
      Loading…
    </div>
  )

  if (notFound || !viewedProfile) return (
    <>
      <Navbar fullName={currentUserProfile?.full_name ?? null} role={currentUserProfile?.role ?? 'employee'} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', color: '#9ca3af', gap: '0.5rem' }}>
        <span style={{ fontSize: '2.5rem' }}>👤</span>
        <p style={{ fontWeight: 600, color: '#374151', margin: 0 }}>User not found</p>
        <button onClick={() => navigate(-1)} style={{ marginTop: '0.5rem', background: 'none', border: 'none', color: '#00b8b8', fontWeight: 600, cursor: 'pointer', fontSize: '0.88rem' }}>← Go back</button>
      </div>
    </>
  )

  const initials = (viewedProfile.full_name ?? '?')
    .split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase()

  const roleStyle = ROLE_COLORS[viewedProfile.role] ?? { bg: '#f3f4f6', color: '#374151' }

  const gradIdx = (viewedProfile.full_name?.charCodeAt(0) ?? 0) % HERO_GRADIENTS.length
  const [gradFrom, gradTo] = HERO_GRADIENTS[gradIdx]

  const memberSince = new Date(viewedProfile.created_at)
    .toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })

  return (
    <>
      <style>{`
        .pp { min-height: 100vh; background: #f0f2f5; }

        .pp-body {
          max-width: 720px;
          margin: 0 auto;
          padding: 2rem 1.25rem 4rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .pp-back {
          display: inline-flex; align-items: center; gap: 0.4rem;
          background: none; border: none; color: #6b7280;
          font-size: 0.82rem; font-weight: 500; cursor: pointer;
          padding: 0; margin-bottom: 0.25rem; transition: color 0.12s;
        }
        .pp-back:hover { color: #0d2d3a; }

        /* ── Hero card ── */
        .pp-hero {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 18px;
          overflow: hidden;
        }

        .pp-banner {
          height: 170px;
          position: relative;
          overflow: hidden;
        }

        .pp-banner-bg {
          position: absolute; inset: 0;
        }

        .pp-banner-circles {
          position: absolute; inset: 0; overflow: hidden;
        }

        .pp-avatar-wrap {
          position: absolute;
          bottom: -44px; left: 1.5rem;
          z-index: 2;
        }

        .pp-avatar {
          width: 88px; height: 88px;
          border-radius: 50%;
          border: 4px solid white;
          display: flex; align-items: center; justify-content: center;
          font-size: 1.9rem; font-weight: 800; color: white;
          box-shadow: 0 6px 20px rgba(0,0,0,0.2);
          letter-spacing: -0.02em;
        }

        .pp-hero-body {
          padding: 3.75rem 1.5rem 1.4rem;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 1rem;
          flex-wrap: wrap;
        }

        .pp-name {
          font-size: 1.55rem;
          font-weight: 800;
          color: #0d2d3a;
          margin: 0 0 0.5rem;
          line-height: 1.15;
          letter-spacing: -0.02em;
        }

        .pp-badges { display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap; }

        .pp-role-badge {
          font-size: 0.71rem; font-weight: 700;
          padding: 0.22rem 0.65rem; border-radius: 999px;
          text-transform: capitalize; letter-spacing: 0.02em;
        }

        .pp-dept-badge {
          display: flex; align-items: center; gap: 0.3rem;
          font-size: 0.71rem; font-weight: 600;
          padding: 0.22rem 0.65rem; border-radius: 999px;
          background: #f3f4f6; color: #6b7280;
          border: 1px solid #e5e7eb;
        }

        .pp-actions { display: flex; gap: 0.5rem; align-items: center; flex-shrink: 0; }

        .btn-msg {
          display: flex; align-items: center; gap: 0.45rem;
          padding: 0.52rem 1.15rem;
          background: #0d2d3a; color: white;
          border: none; border-radius: 9px;
          font-size: 0.85rem; font-weight: 700;
          cursor: pointer; transition: background 0.15s; white-space: nowrap;
        }
        .btn-msg:hover { background: #00b8b8; }

        .btn-feed-link {
          display: flex; align-items: center; gap: 0.4rem;
          padding: 0.52rem 1.1rem;
          background: white; color: #374151;
          border: 1px solid #e5e7eb; border-radius: 9px;
          font-size: 0.85rem; font-weight: 600;
          cursor: pointer; transition: all 0.15s; white-space: nowrap;
        }
        .btn-feed-link:hover { border-color: #00b8b8; color: #0f766e; }

        /* Stats strip */
        .pp-stats {
          display: flex;
          border-top: 1px solid #f3f4f6;
        }

        .pp-stat {
          flex: 1; padding: 1.1rem 0.5rem;
          text-align: center;
          border-right: 1px solid #f3f4f6;
        }
        .pp-stat:last-child { border-right: none; }

        .pp-stat-val {
          display: block;
          font-size: 1.5rem; font-weight: 800;
          color: #0d2d3a; line-height: 1; margin-bottom: 0.3rem;
        }

        .pp-stat-label {
          font-size: 0.68rem; font-weight: 700;
          color: #9ca3af; text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        /* Cards */
        .pp-card {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          overflow: hidden;
        }

        .pp-card-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 1rem 1.25rem;
          border-bottom: 1px solid #f3f4f6;
        }

        .pp-card-title {
          font-size: 0.78rem; font-weight: 700;
          color: #374151; text-transform: uppercase;
          letter-spacing: 0.07em; margin: 0;
        }

        .pp-card-body { padding: 1.25rem; }

        /* Bio */
        .btn-edit {
          background: none; border: 1px solid #e5e7eb;
          border-radius: 7px; padding: 0.26rem 0.65rem;
          font-size: 0.73rem; font-weight: 600;
          color: #6b7280; cursor: pointer; transition: all 0.12s;
        }
        .btn-edit:hover { border-color: #00b8b8; color: #0f766e; background: #f0fdfa; }

        .bio-text { font-size: 0.9rem; color: #374151; line-height: 1.72; margin: 0; white-space: pre-wrap; }
        .bio-empty { font-size: 0.88rem; color: #c4c9d4; margin: 0; font-style: italic; }

        .bio-textarea {
          width: 100%; min-height: 100px;
          border: 1px solid #e5e7eb; border-radius: 9px;
          padding: 0.75rem; font-size: 0.9rem;
          color: #374151; line-height: 1.65;
          font-family: inherit; resize: vertical;
          box-sizing: border-box; outline: none;
        }
        .bio-textarea:focus { border-color: #00b8b8; box-shadow: 0 0 0 3px rgba(0,184,184,0.08); }
        .bio-char { font-size: 0.72rem; color: #d1d5db; text-align: right; margin-top: 0.35rem; }

        .bio-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 0.6rem; }

        .btn-save {
          padding: 0.42rem 1rem;
          background: #0d2d3a; color: white;
          border: none; border-radius: 8px;
          font-size: 0.82rem; font-weight: 700;
          cursor: pointer; transition: background 0.15s;
        }
        .btn-save:hover:not(:disabled) { background: #00b8b8; }
        .btn-save:disabled { opacity: 0.55; cursor: not-allowed; }

        .btn-cancel-sm {
          padding: 0.42rem 0.85rem;
          background: white; color: #6b7280;
          border: 1px solid #e5e7eb; border-radius: 8px;
          font-size: 0.82rem; font-weight: 600;
          cursor: pointer; transition: all 0.12s;
        }
        .btn-cancel-sm:hover { background: #f9fafb; }

        /* Details grid */
        .details-grid {
          display: grid; grid-template-columns: 1fr 1fr; gap: 1.1rem;
        }

        .detail-label {
          font-size: 0.68rem; font-weight: 700;
          color: #9ca3af; text-transform: uppercase;
          letter-spacing: 0.06em; display: block; margin-bottom: 0.25rem;
        }

        .detail-value {
          font-size: 0.88rem; font-weight: 600; color: #374151;
        }

        /* Posts list */
        .pp-posts-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 1rem 1.25rem; border-bottom: 1px solid #f3f4f6;
        }

        .pp-post-count {
          font-size: 0.72rem; font-weight: 600;
          background: #f0fdfa; color: #0f766e;
          border: 1px solid #ccfbf1;
          padding: 0.18rem 0.55rem; border-radius: 999px;
        }

        .pp-post-item {
          padding: 1.1rem 1.25rem;
          border-bottom: 1px solid #f3f4f6;
          transition: background 0.12s;
          cursor: default;
        }
        .pp-post-item:last-child { border-bottom: none; }
        .pp-post-item:hover { background: #fafafa; }

        .pp-post-mood {
          display: inline-flex; align-items: center; gap: 0.3rem;
          background: #f0fdfa; border: 1px solid #ccfbf1;
          border-radius: 999px; padding: 0.15rem 0.5rem;
          font-size: 0.7rem; color: #0f766e; font-weight: 600;
          margin-bottom: 0.45rem;
        }

        .pp-post-content {
          font-size: 0.88rem; color: #374151;
          line-height: 1.65; margin: 0 0 0.6rem;
          white-space: pre-wrap; word-break: break-word;
        }

        .pp-post-img {
          width: 100%; max-height: 280px;
          object-fit: cover; border-radius: 10px;
          display: block; margin-bottom: 0.65rem;
        }

        .pp-post-footer {
          display: flex; align-items: center; gap: 1rem;
        }

        .pp-post-likes {
          display: flex; align-items: center; gap: 0.35rem;
          font-size: 0.78rem; color: #9ca3af; font-weight: 600;
        }

        .pp-post-time { font-size: 0.72rem; color: #d1d5db; }

        .pp-posts-empty {
          padding: 3rem 1.25rem; text-align: center;
          color: #9ca3af; font-size: 0.88rem;
        }

        @media (max-width: 640px) {
          .pp-body { padding: 1rem 0.85rem 3rem; }
          .pp-hero-body { padding: 3.75rem 1rem 1rem; flex-direction: column; }
          .pp-actions { width: 100%; }
          .btn-msg, .btn-feed-link { flex: 1; justify-content: center; }
          .details-grid { grid-template-columns: 1fr; }
          .pp-stat-val { font-size: 1.2rem; }
        }
      `}</style>

      <div className="pp">
        <Navbar fullName={currentUserProfile?.full_name ?? null} role={currentUserProfile?.role ?? 'employee'} />

        <div className="pp-body">
          <button className="pp-back" onClick={() => navigate(-1)}>← Back</button>

          {/* ── Hero ── */}
          <div className="pp-hero">
            <div className="pp-banner">
              {/* Gradient background */}
              <div className="pp-banner-bg" style={{
                background: `linear-gradient(135deg, ${gradFrom} 0%, ${gradTo} 100%)`
              }} />

              {/* Decorative circles */}
              <svg className="pp-banner-circles" xmlns="http://www.w3.org/2000/svg" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.07 }}>
                <circle cx="85%" cy="-10%" r="120" fill="white" />
                <circle cx="5%"  cy="110%" r="80"  fill="white" />
                <circle cx="55%" cy="50%"  r="55"  fill="white" />
                <circle cx="72%" cy="80%"  r="35"  fill="white" />
              </svg>

              <div className="pp-avatar-wrap">
                <div className="pp-avatar" style={{ background: `linear-gradient(135deg, ${gradFrom}, ${gradTo})` }}>
                  {initials}
                </div>
              </div>
            </div>

            <div className="pp-hero-body">
              <div>
                <h1 className="pp-name">{viewedProfile.full_name ?? 'Unknown User'}</h1>
                <div className="pp-badges">
                  <span className="pp-role-badge" style={{ background: roleStyle.bg, color: roleStyle.color }}>
                    {viewedProfile.role}
                  </span>
                  <span className="pp-dept-badge">
                    {department ? `🏢 ${department.name}` : 'No department'}
                  </span>
                </div>
              </div>

              <div className="pp-actions">
                {isOwnProfile ? (
                  <button className="btn-feed-link" onClick={() => navigate('/feed')}>
                    ✦ Your feed posts
                  </button>
                ) : (
                  <button
                    className="btn-msg"
                    onClick={() => navigate('/create-post', {
                      state: { recipientId: viewedProfile.id, recipientName: viewedProfile.full_name }
                    })}
                  >
                    ✉ Send message
                  </button>
                )}
              </div>
            </div>

            <div className="pp-stats">
              <div className="pp-stat">
                <span className="pp-stat-val">{feedPosts.length}</span>
                <span className="pp-stat-label">Posts</span>
              </div>
              <div className="pp-stat">
                <span className="pp-stat-val">{totalLikes}</span>
                <span className="pp-stat-label">Likes received</span>
              </div>
              <div className="pp-stat">
                <span className="pp-stat-val" style={{ fontSize: feedPosts.length > 9 ? '0.9rem' : '1rem', paddingTop: '0.3rem' }}>
                  {memberSince}
                </span>
                <span className="pp-stat-label">Member since</span>
              </div>
            </div>
          </div>

          {/* ── About / Bio ── */}
          <div className="pp-card">
            <div className="pp-card-header">
              <h2 className="pp-card-title">About</h2>
              {isOwnProfile && !editingBio && (
                <button className="btn-edit" onClick={() => setEditingBio(true)}>
                  {viewedProfile.bio ? '✎ Edit bio' : '+ Add bio'}
                </button>
              )}
            </div>
            <div className="pp-card-body">
              {editingBio ? (
                <>
                  <textarea
                    className="bio-textarea"
                    value={bioValue}
                    onChange={e => setBioValue(e.target.value.slice(0, 400))}
                    placeholder="Tell your colleagues a bit about yourself — your role, background, what you're working on…"
                    autoFocus
                  />
                  <p className="bio-char">{400 - bioValue.length} characters left</p>
                  <div className="bio-actions">
                    <button className="btn-cancel-sm" onClick={() => { setEditingBio(false); setBioValue(viewedProfile.bio ?? '') }}>
                      Cancel
                    </button>
                    <button className="btn-save" onClick={saveBio} disabled={savingBio}>
                      {savingBio ? 'Saving…' : 'Save bio'}
                    </button>
                  </div>
                </>
              ) : viewedProfile.bio ? (
                <p className="bio-text">{viewedProfile.bio}</p>
              ) : (
                <p className="bio-empty">
                  {isOwnProfile
                    ? 'Click "Add bio" to introduce yourself to your colleagues.'
                    : 'This person hasn\'t added a bio yet.'}
                </p>
              )}
            </div>
          </div>

          {/* ── Details ── */}
          <div className="pp-card">
            <div className="pp-card-header">
              <h2 className="pp-card-title">Details</h2>
            </div>
            <div className="pp-card-body">
              <div className="details-grid">
                <div>
                  <span className="detail-label">Role</span>
                  <span className="detail-value" style={{ color: roleStyle.color, textTransform: 'capitalize' }}>
                    {viewedProfile.role}
                  </span>
                </div>
                <div>
                  <span className="detail-label">Department</span>
                  <span className="detail-value">{department?.name ?? '—'}</span>
                </div>
                <div>
                  <span className="detail-label">Member since</span>
                  <span className="detail-value">{memberSince}</span>
                </div>
                <div>
                  <span className="detail-label">Posts shared</span>
                  <span className="detail-value">{feedPosts.length}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Feed posts ── */}
          <div className="pp-card">
            <div className="pp-posts-header">
              <h2 className="pp-card-title">Recent posts</h2>
              <span className="pp-post-count">{feedPosts.length}</span>
            </div>

            {feedPosts.length === 0 ? (
              <div className="pp-posts-empty">
                {isOwnProfile ? "You haven't posted anything yet. Head to the News Feed to share something." : "Nothing posted yet."}
              </div>
            ) : feedPosts.map(post => {
              const moodData = MOODS.find(m => m.emoji === post.mood)
              return (
                <div key={post.id} className="pp-post-item">
                  {moodData && (
                    <div className="pp-post-mood">
                      <span>{moodData.emoji}</span>
                      <span>{moodData.label}</span>
                    </div>
                  )}
                  <p className="pp-post-content">{post.content}</p>
                  {post.image_url && (
                    <img
                      className="pp-post-img"
                      src={post.image_url}
                      alt=""
                      loading="lazy"
                      onError={e => { e.currentTarget.style.display = 'none' }}
                    />
                  )}
                  <div className="pp-post-footer">
                    <span className="pp-post-likes">❤️ {feedPosts.length > 0 ? '' : '0'} likes</span>
                    <span className="pp-post-time">{timeAgo(post.created_at)}</span>
                  </div>
                </div>
              )
            })}
          </div>

        </div>
      </div>
    </>
  )
}

export default ProfilePage
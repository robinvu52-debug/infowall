import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { generateSummary } from '../lib/summarize'
import Navbar from '../components/Navbar'

interface Profile {
  id: string
  full_name: string | null
  role: string
  department_id: string | null
}

interface Post {
  id: string
  title: string
  content: string | null
  department_id: string | null
  recipient_id: string | null
  post_type: string
  must_read: boolean
  created_at: string
  author_id: string
  author: { full_name: string | null } | null
}

const PREVIEW_LIMIT = 3

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(dateStr).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

function Avatar({ name, size = 32 }: { name: string | null; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'linear-gradient(135deg, #00b8b8, #0d2d3a)',
      color: 'white', fontSize: size * 0.36, fontWeight: 700,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      {(name ?? '?').charAt(0).toUpperCase()}
    </div>
  )
}

function DashboardPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(new Set())
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [justAcked, setJustAcked] = useState<string | null>(null)
  const navigate = useNavigate()

  async function loadPosts() {
    const { data: postsData, error: postsError } = await supabase
      .from('posts')
      .select('*, author:profiles!author_id(full_name)')
      .order('created_at', { ascending: false })
    if (postsError) console.error('Posts fetch error:', postsError)
    setPosts(postsData ?? [])
  }

  useEffect(() => {
    async function loadDashboard() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { navigate('/login'); return }
      setUserId(user.id)

      const { data: profileData } = await supabase
        .from('profiles').select('*').eq('id', user.id).single()
      setProfile(profileData)

      await loadPosts()

      const { data: ackData } = await supabase
        .from('acknowledgements').select('post_id').eq('user_id', user.id)
      setAcknowledgedIds(new Set((ackData ?? []).map((a) => a.post_id)))

      setLoading(false)
    }
    loadDashboard()
  }, [navigate])

  useEffect(() => {
    function close() { setOpenMenuId(null) }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  async function handleAcknowledge(postId: string) {
    if (!userId) return
    const { error } = await supabase
      .from('acknowledgements').insert({ post_id: postId, user_id: userId })
    if (!error) {
      setAcknowledgedIds((prev) => new Set(prev).add(postId))
      setJustAcked(postId)
      setTimeout(() => setJustAcked(null), 900)
    }
  }

  function startEdit(post: Post) {
    setEditingId(post.id)
    setEditTitle(post.title)
    setEditContent(post.content ?? '')
    setOpenMenuId(null)
  }

  async function saveEdit(postId: string) {
    if (!editTitle.trim() || !editContent.trim()) return
    setSavingEdit(true)
    const { error } = await supabase
      .from('posts')
      .update({ title: editTitle.trim(), content: editContent.trim() })
      .eq('id', postId)
    if (!error) {
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, title: editTitle.trim(), content: editContent.trim() } : p))
      setEditingId(null)
    }
    setSavingEdit(false)
  }

  async function handleDelete(postId: string) {
    if (!window.confirm('Delete this post permanently? This cannot be undone.')) return
    setDeletingId(postId)
    const { error } = await supabase.from('posts').delete().eq('id', postId)
    if (!error) setPosts(prev => prev.filter(p => p.id !== postId))
    setDeletingId(null)
    setOpenMenuId(null)
  }

  function toggleExpand(key: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const searchLower = search.trim().toLowerCase()
  const matchesSearch = (p: Post) =>
    !searchLower ||
    p.title.toLowerCase().includes(searchLower) ||
    (p.content ?? '').toLowerCase().includes(searchLower)

  const personalPosts   = useMemo(() => posts.filter(p => p.recipient_id === userId && matchesSearch(p)), [posts, userId, searchLower])
  const globalPosts     = useMemo(() => posts.filter(p => p.recipient_id === null && p.department_id === null && p.post_type === 'announcement' && matchesSearch(p)), [posts, searchLower])
  const departmentPosts = useMemo(() => posts.filter(p => p.recipient_id === null && p.department_id !== null && p.department_id === profile?.department_id && matchesSearch(p)), [posts, profile, searchLower])
  const eventPosts      = useMemo(() => posts.filter(p => p.recipient_id === null && p.post_type === 'news_event' && matchesSearch(p)), [posts, searchLower])

  const pendingMustRead = posts.filter(p => p.must_read && !acknowledgedIds.has(p.id)).length
  const todayCount = posts.filter(p => new Date(p.created_at).toDateString() === new Date().toDateString()).length

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: '#6b7280' }}>
        Loading…
      </div>
    )
  }

  function renderPost(post: Post) {
    const isAcknowledged = acknowledgedIds.has(post.id)
    const isOwn = post.author_id === userId
    const canManage = isOwn || profile?.role === 'admin'
    const summary = generateSummary(post.content)
    const isEditing = editingId === post.id
    const isMenuOpen = openMenuId === post.id

    return (
      <article key={post.id} className={`post-card${justAcked === post.id ? ' just-acked' : ''}`}>
        <div className="post-card-header">
          <div className="post-card-meta">
            <Avatar name={post.author?.full_name ?? null} />
            <div>
              <span className="post-author-name">{post.author?.full_name ?? 'InfoWall'}</span>
              <span className="post-time">{timeAgo(post.created_at)}</span>
            </div>
          </div>

          <div className="post-header-right">
            <div className="post-badges">
              {post.post_type === 'news_event' && <span className="badge badge-event">Event</span>}
              {post.must_read && !isAcknowledged && <span className="badge badge-must">Must-read</span>}
              {post.must_read && isAcknowledged && <span className="badge badge-acked">✓ Read</span>}
            </div>

            {canManage && (
              <div className="post-menu-wrap" onClick={e => e.stopPropagation()}>
                <button className="post-menu-btn" onClick={() => setOpenMenuId(isMenuOpen ? null : post.id)}>⋯</button>
                {isMenuOpen && (
                  <div className="post-menu-dropdown">
                    <button onClick={() => startEdit(post)}>✎ Edit post</button>
                    <button className="danger" onClick={() => handleDelete(post.id)} disabled={deletingId === post.id}>
                      {deletingId === post.id ? 'Deleting…' : '🗑 Delete post'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {isEditing ? (
          <div className="post-edit-form">
            <input className="edit-title-input" value={editTitle} onChange={e => setEditTitle(e.target.value)} placeholder="Title" />
            <textarea className="edit-content-textarea" value={editContent} onChange={e => setEditContent(e.target.value)} placeholder="Content" />
            <div className="edit-actions">
              <button className="edit-cancel" onClick={() => setEditingId(null)}>Cancel</button>
              <button className="edit-save" onClick={() => saveEdit(post.id)} disabled={savingEdit}>
                {savingEdit ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <h3 className="post-title">{post.title}</h3>

            {summary && (
              <div className="ai-summary">
                <span className="ai-icon">✦</span>
                <span><span className="ai-label">AI Summary — </span>{summary}</span>
              </div>
            )}

            <p className="post-body">{post.content}</p>

            {post.must_read && !isAcknowledged && (
              <div className="post-footer">
                <button className="acknowledge-btn" onClick={() => handleAcknowledge(post.id)}>
                  Mark as read
                </button>
                <span className="must-read-notice">Requires acknowledgement</span>
              </div>
            )}
          </>
        )}
      </article>
    )
  }

  function Section({ title, icon, posts, sectionKey }: { title: string; icon: string; posts: Post[]; sectionKey: string }) {
    const isExpanded = expanded.has(sectionKey)
    const visiblePosts = isExpanded ? posts : posts.slice(0, PREVIEW_LIMIT)
    const hiddenCount = posts.length - PREVIEW_LIMIT

    return (
      <section className="feed-section">
        <div className="section-header">
          <span className="section-icon">{icon}</span>
          <h2 className="section-title">{title}</h2>
          {posts.length > 0 && <span className="section-count">{posts.length}</span>}
        </div>

        {posts.length === 0 ? (
          <div className="empty-state"><p className="empty-text">Nothing here yet.</p></div>
        ) : (
          <>
            <div className="post-stack">
              {visiblePosts.map((p, i) => (
                <div key={p.id} className="post-anim-wrap" style={{ animationDelay: `${i * 0.05}s` }}>
                  {renderPost(p)}
                </div>
              ))}
            </div>

            {hiddenCount > 0 && (
              <button className="show-more-btn" onClick={() => toggleExpand(sectionKey)}>
                {isExpanded ? '↑ Show less' : `Show ${hiddenCount} more →`}
              </button>
            )}
          </>
        )}
      </section>
    )
  }

  return (
    <>
      <style>{`
        @keyframes cardIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes ackFlash {
          0% { box-shadow: 0 0 0 0 rgba(0,184,184,0.3); }
          100% { box-shadow: 0 0 0 10px rgba(0,184,184,0); }
        }

        .dashboard { min-height: 100vh; background: #f0f2f5; }

        .dashboard-content {
          padding: 2rem 1.5rem 4rem;
          max-width: 1300px;
          margin: 0 auto;
        }

        /* Stats */
        .stats-bar { display: flex; gap: 0.85rem; margin-bottom: 1.5rem; flex-wrap: wrap; }

        .stat-pill {
          flex: 1; min-width: 150px;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 1rem 1.25rem;
        }

        .stat-pill-value { font-size: 1.7rem; font-weight: 800; color: #0d2d3a; line-height: 1; }
        .stat-pill-value.alert { color: #dc2626; }
        .stat-pill-label { font-size: 0.72rem; color: #9ca3af; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 0.3rem; }

        /* Search */
        .search-bar {
          display: flex; align-items: center; gap: 0.6rem;
          background: white; border: 1px solid #e5e7eb;
          border-radius: 10px; padding: 0.6rem 1rem; margin-bottom: 1.75rem;
          transition: border-color 0.15s;
        }
        .search-bar:focus-within { border-color: #00b8b8; box-shadow: 0 0 0 3px rgba(0,184,184,0.08); }
        .search-bar input { flex: 1; background: transparent; border: none; outline: none; color: #374151; font-size: 0.88rem; }
        .search-bar input::placeholder { color: #9ca3af; }
        .search-icon { color: #9ca3af; font-size: 0.9rem; }
        .search-clear { background: none; border: none; color: #9ca3af; cursor: pointer; font-size: 0.8rem; }
        .search-clear:hover { color: #374151; }

        /* Grid */
        .dashboard-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }

        .feed-section {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          padding: 1.4rem;
          display: flex; flex-direction: column; gap: 0.85rem;
        }

        .section-header {
          display: flex; align-items: center; gap: 0.6rem;
          margin-bottom: 0.2rem; padding-bottom: 0.85rem;
          border-bottom: 1px solid #f3f4f6;
        }

        .section-icon { font-size: 1rem; }

        .section-title {
          font-size: 0.82rem; font-weight: 700; color: #111827;
          margin: 0; text-transform: uppercase; letter-spacing: 0.05em; flex: 1;
        }

        .section-count {
          background: #f0fdfa; color: #00b8b8;
          font-size: 0.72rem; font-weight: 700;
          padding: 0.15rem 0.55rem; border-radius: 999px;
          border: 1px solid #ccfbf1;
        }

        .empty-state { padding: 1.75rem 0; text-align: center; }
        .empty-text { color: #9ca3af; font-size: 0.85rem; margin: 0; }

        .post-stack { display: flex; flex-direction: column; gap: 0.7rem; }
        .post-anim-wrap { animation: cardIn 0.3s ease both; }

        /* Post card */
        .post-card {
          position: relative;
          border: 1px solid #f3f4f6;
          border-radius: 10px;
          padding: 1rem 1.1rem;
          background: #fafafa;
          transition: border-color 0.15s, transform 0.15s;
        }
        .post-card:hover { border-color: #d1d5db; transform: translateY(-1px); }
        .post-card.just-acked { animation: ackFlash 0.7s ease-out; }

        .post-card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.6rem; }
        .post-card-meta { display: flex; align-items: center; gap: 0.6rem; }
        .post-author-name { display: block; font-size: 0.8rem; font-weight: 600; color: #374151; }
        .post-time { display: block; font-size: 0.71rem; color: #9ca3af; }

        .post-header-right { display: flex; align-items: flex-start; gap: 0.4rem; }
        .post-badges { display: flex; gap: 0.35rem; flex-wrap: wrap; justify-content: flex-end; }

        .badge { display: inline-block; font-size: 0.66rem; font-weight: 700; padding: 0.17rem 0.5rem; border-radius: 999px; white-space: nowrap; }
        .badge-must  { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
        .badge-acked { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
        .badge-event { background: #faf5ff; color: #7c3aed; border: 1px solid #e9d5ff; }

        .post-menu-wrap { position: relative; }
        .post-menu-btn {
          background: transparent; border: none; color: #9ca3af;
          font-size: 1.1rem; font-weight: 700; cursor: pointer;
          padding: 0.1rem 0.4rem; border-radius: 6px; line-height: 1;
          transition: all 0.15s;
        }
        .post-menu-btn:hover { background: #f3f4f6; color: #374151; }

        .post-menu-dropdown {
          position: absolute; top: calc(100% + 4px); right: 0;
          background: white; border: 1px solid #e5e7eb;
          border-radius: 10px; overflow: hidden; z-index: 20; min-width: 150px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.1);
          animation: cardIn 0.15s ease both;
        }
        .post-menu-dropdown button {
          display: block; width: 100%; text-align: left;
          padding: 0.6rem 0.9rem; background: none; border: none;
          color: #374151; font-size: 0.8rem; font-weight: 500; cursor: pointer;
          transition: background 0.12s;
        }
        .post-menu-dropdown button:hover { background: #f9fafb; }
        .post-menu-dropdown button.danger { color: #dc2626; }
        .post-menu-dropdown button.danger:hover { background: #fef2f2; }
        .post-menu-dropdown button:disabled { opacity: 0.5; cursor: not-allowed; }

        .post-title { font-size: 0.95rem; font-weight: 600; color: #111827; margin: 0 0 0.55rem; line-height: 1.35; }

        .ai-summary {
          display: flex; align-items: flex-start; gap: 0.45rem;
          background: #f0fdfa; border: 1px solid #ccfbf1;
          border-radius: 7px; padding: 0.5rem 0.75rem; margin-bottom: 0.6rem;
          font-size: 0.78rem; color: #0f766e; line-height: 1.5;
        }
        .ai-icon { color: #00b8b8; margin-top: 1px; font-size: 0.7rem; flex-shrink: 0; }
        .ai-label { font-weight: 700; }

        .post-body { font-size: 0.85rem; color: #6b7280; margin: 0; line-height: 1.6; }

        .post-footer { display: flex; align-items: center; gap: 0.85rem; margin-top: 0.85rem; padding-top: 0.75rem; border-top: 1px solid #f3f4f6; }

        .acknowledge-btn {
          padding: 0.4rem 0.9rem; background: #0d2d3a;
          color: white; font-weight: 600; font-size: 0.78rem;
          border: none; border-radius: 6px; cursor: pointer; transition: background 0.15s;
        }
        .acknowledge-btn:hover { background: #00b8b8; }
        .must-read-notice { font-size: 0.73rem; color: #9ca3af; }

        /* Edit form */
        .post-edit-form { display: flex; flex-direction: column; gap: 0.6rem; }
        .edit-title-input, .edit-content-textarea {
          width: 100%; box-sizing: border-box;
          background: white; border: 1px solid #e5e7eb;
          border-radius: 8px; padding: 0.6rem 0.75rem;
          color: #374151; font-size: 0.85rem; font-family: inherit; outline: none;
        }
        .edit-title-input { font-weight: 600; }
        .edit-content-textarea { min-height: 90px; resize: vertical; line-height: 1.55; }
        .edit-title-input:focus, .edit-content-textarea:focus { border-color: #00b8b8; }

        .edit-actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
        .edit-cancel {
          padding: 0.4rem 0.85rem; background: white;
          border: 1px solid #e5e7eb; border-radius: 7px;
          color: #6b7280; font-size: 0.78rem; font-weight: 600; cursor: pointer; transition: all 0.15s;
        }
        .edit-cancel:hover { background: #f9fafb; }
        .edit-save {
          padding: 0.4rem 0.95rem; background: #0d2d3a; border: none; border-radius: 7px; color: white;
          font-size: 0.78rem; font-weight: 700; cursor: pointer; transition: background 0.15s;
        }
        .edit-save:hover:not(:disabled) { background: #00b8b8; }
        .edit-save:disabled { opacity: 0.6; cursor: not-allowed; }

        /* Show more */
        .show-more-btn {
          align-self: center; margin-top: 0.2rem;
          padding: 0.42rem 1.1rem; background: #f0fdfa;
          border: 1px solid #ccfbf1; border-radius: 999px;
          color: #0f766e; font-size: 0.78rem; font-weight: 600; cursor: pointer; transition: all 0.15s;
        }
        .show-more-btn:hover { background: #ccfbf1; }

        @media (max-width: 900px) {
          .dashboard-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 640px) {
          .dashboard-content { padding: 1.25rem 1rem 3rem; }
          .stats-bar { gap: 0.6rem; }
          .stat-pill { min-width: 100px; padding: 0.8rem 1rem; }
          .stat-pill-value { font-size: 1.35rem; }
        }
      `}</style>

      <div className="dashboard">
        <Navbar fullName={profile?.full_name ?? null} role={profile?.role ?? 'employee'} />
        <main className="dashboard-content">

          <div className="stats-bar">
            <div className="stat-pill">
              <div className={`stat-pill-value${pendingMustRead > 0 ? ' alert' : ''}`}>{pendingMustRead}</div>
              <div className="stat-pill-label">Pending must-read</div>
            </div>
            <div className="stat-pill">
              <div className="stat-pill-value">{posts.length}</div>
              <div className="stat-pill-label">Total posts</div>
            </div>
            <div className="stat-pill">
              <div className="stat-pill-value">{todayCount}</div>
              <div className="stat-pill-label">Posted today</div>
            </div>
          </div>

          <div className="search-bar">
            <span className="search-icon">🔍</span>
            <input placeholder="Search posts by title or content…" value={search} onChange={e => setSearch(e.target.value)} />
            {search && <button className="search-clear" onClick={() => setSearch('')}>✕</button>}
          </div>

          <div className="dashboard-grid">
            <Section title="Personal Messages"    icon="💬" posts={personalPosts}   sectionKey="personal" />
            <Section title="Global Announcements" icon="📢" posts={globalPosts}     sectionKey="global" />
            <Section title="Department Updates"   icon="🏢" posts={departmentPosts} sectionKey="department" />
            <Section title="News & Events"        icon="📅" posts={eventPosts}      sectionKey="events" />
          </div>

        </main>
      </div>
    </>
  )
}

export default DashboardPage
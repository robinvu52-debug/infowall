import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Navbar from '../components/Navbar'

interface Profile {
  id: string; full_name: string | null; role: string; department_id: string | null
}
interface FeedPost {
  id: string; author_id: string; content: string
  mood: string | null; image_url: string | null; created_at: string
  author: { full_name: string | null; role: string } | null
  likes_count: number; comments_count: number; i_liked: boolean
}
interface FeedComment {
  id: string; post_id: string; author_id: string; content: string; created_at: string
  author: { full_name: string | null; role: string } | null
}

const MOODS = [
  { emoji: '😊', label: 'Feeling great' },
  { emoji: '🎉', label: 'Celebrating' },
  { emoji: '💪', label: 'Motivated' },
  { emoji: '🤔', label: 'Thinking' },
  { emoji: '☕', label: 'Getting started' },
  { emoji: '🚀', label: 'In the zone' },
  { emoji: '😴', label: 'Need coffee' },
  { emoji: '🙏', label: 'Grateful' },
]

const ROLE_COLORS: Record<string, string> = {
  admin: '#dc2626', hr: '#7c3aed', manager: '#1d4ed8', employee: '#16a34a'
}

const PAGE_SIZE = 8

function timeAgo(d: string): string {
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

function initials(name: string | null): string {
  if (!name) return '?'
  return name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase()
}

function Avatar({ name, role, size = 38 }: { name: string | null; role?: string; size?: number }) {
  const bg = role ? (ROLE_COLORS[role] ?? '#243F60') : '#4F81BD'
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg, ${bg}cc, #1A2B3C)`,
      color: 'white', fontSize: size * 0.34, fontWeight: 800,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
    }}>
      {initials(name)}
    </div>
  )
}

// ── Single post card ──────────────────────────────────────────
function PostCard({
  post, currentUserId, onLike, onDelete, onCommentCountChange
}: {
  post: FeedPost
  currentUserId: string | null
  onLike: (id: string, liked: boolean) => void
  onDelete: (id: string) => void
  onCommentCountChange: (id: string, delta: number) => void
}) {
  const navigate = useNavigate()
  const [showComments, setShowComments] = useState(false)
  const [comments, setComments] = useState<FeedComment[]>([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [sendingComment, setSendingComment] = useState(false)
  const [imgError, setImgError] = useState(false)
  const [liking, setLiking] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const commentInputRef = useRef<HTMLInputElement>(null)
  const moodData = MOODS.find(m => m.emoji === post.mood)
  const isOwn = post.author_id === currentUserId

  async function loadComments() {
    setLoadingComments(true)
    const { data } = await supabase
      .from('feed_comments')
      .select('*, author:profiles!author_id(full_name, role)')
      .eq('post_id', post.id)
      .order('created_at', { ascending: true })
    setComments((data ?? []) as FeedComment[])
    setLoadingComments(false)
  }

  function handleToggleComments() {
    if (!showComments) {
      setShowComments(true)
      loadComments()
      setTimeout(() => commentInputRef.current?.focus(), 200)
    } else {
      setShowComments(false)
    }
  }

  async function handleLike() {
    if (!currentUserId || liking) return
    setLiking(true)
    onLike(post.id, post.i_liked)
    if (post.i_liked) {
      await supabase.from('feed_likes').delete().eq('post_id', post.id).eq('user_id', currentUserId)
    } else {
      await supabase.from('feed_likes').insert({ post_id: post.id, user_id: currentUserId })
    }
    setLiking(false)
  }

  async function handleComment(e: React.FormEvent) {
    e.preventDefault()
    if (!commentText.trim() || !currentUserId || sendingComment) return
    setSendingComment(true)
    const { data } = await supabase
      .from('feed_comments')
      .insert({ post_id: post.id, author_id: currentUserId, content: commentText.trim() })
      .select('*, author:profiles!author_id(full_name, role)')
      .single()
    if (data) {
      setComments(prev => [...prev, data as FeedComment])
      onCommentCountChange(post.id, 1)
    }
    setCommentText('')
    setSendingComment(false)
  }

  async function handleDeleteComment(commentId: string) {
    await supabase.from('feed_comments').delete().eq('id', commentId)
    setComments(prev => prev.filter(c => c.id !== commentId))
    onCommentCountChange(post.id, -1)
  }

  async function handleDeletePost() {
    await supabase.from('feed_posts').delete().eq('id', post.id)
    onDelete(post.id)
  }

  return (
    <div className="fp-card">
      {/* Header */}
      <div className="fp-card-header">
        <div
          className="fp-card-avatar-wrap"
          onClick={() => navigate(`/profile/${post.author_id}`)}
          style={{ cursor: 'pointer' }}
        >
          <Avatar name={post.author?.full_name ?? null} role={post.author?.role} size={42} />
        </div>
        <div className="fp-card-meta">
          <div
            className="fp-card-name"
            onClick={() => navigate(`/profile/${post.author_id}`)}
          >
            {post.author?.full_name ?? 'Unknown'}
          </div>
          <div className="fp-card-sub-row">
            {moodData && (
              <span className="fp-mood-inline">
                {moodData.emoji} {moodData.label}
              </span>
            )}
            {moodData && <span className="fp-card-dot">·</span>}
            <span className="fp-card-time">{timeAgo(post.created_at)}</span>
          </div>
        </div>
        {isOwn && (
          <div style={{ marginLeft: 'auto', position: 'relative' }}>
            {showDeleteConfirm ? (
              <div className="fp-delete-confirm">
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Delete post?</span>
                <button className="fp-delete-yes" onClick={handleDeletePost}>Yes</button>
                <button className="fp-delete-no" onClick={() => setShowDeleteConfirm(false)}>No</button>
              </div>
            ) : (
              <button className="fp-card-menu" onClick={() => setShowDeleteConfirm(true)} title="Delete post">
                ···
              </button>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      {post.content && (
        <div className="fp-card-content">{post.content}</div>
      )}

      {/* Image */}
      {post.image_url && !imgError && (
        <div className="fp-card-img-wrap">
          <img
            className="fp-card-img"
            src={post.image_url}
            alt=""
            loading="lazy"
            onError={() => setImgError(true)}
          />
        </div>
      )}

      {/* Actions bar */}
      <div className="fp-card-actions">
        <button
          className={`fp-action-btn${post.i_liked ? ' liked' : ''}`}
          onClick={handleLike}
          disabled={liking}
        >
          <span className="fp-action-icon">{post.i_liked ? '❤️' : '🤍'}</span>
          <span className="fp-action-label">
            {post.likes_count > 0 ? post.likes_count : ''} {post.likes_count === 1 ? 'Like' : 'Like'}
          </span>
        </button>

        <button className="fp-action-btn" onClick={handleToggleComments}>
          <span className="fp-action-icon">💬</span>
          <span className="fp-action-label">
            {post.comments_count > 0 ? post.comments_count : ''} {post.comments_count === 1 ? 'Comment' : 'Comment'}
          </span>
        </button>

        <button
          className="fp-action-btn"
          onClick={() => navigate(`/profile/${post.author_id}`)}
        >
          <span className="fp-action-icon">👤</span>
          <span className="fp-action-label">Profile</span>
        </button>
      </div>

      {/* Like count detail */}
      {post.likes_count > 0 && (
        <div className="fp-likes-summary">
          ❤️ {post.likes_count} {post.likes_count === 1 ? 'person liked this' : 'people liked this'}
        </div>
      )}

      {/* Comments section */}
      {showComments && (
        <div className="fp-comments-section">
          <div className="fp-comments-divider" />

          {loadingComments ? (
            <div className="fp-comments-loading">Loading comments…</div>
          ) : comments.length === 0 ? (
            <div className="fp-comments-empty">No comments yet — be the first!</div>
          ) : (
            <div className="fp-comments-list">
              {comments.map(c => (
                <div key={c.id} className="fp-comment">
                  <Avatar name={c.author?.full_name ?? null} role={c.author?.role} size={28} />
                  <div className="fp-comment-body">
                    <div className="fp-comment-bubble">
                      <span
                        className="fp-comment-name"
                        onClick={() => navigate(`/profile/${c.author_id}`)}
                      >
                        {c.author?.full_name ?? 'Unknown'}
                      </span>
                      <span className="fp-comment-text">{c.content}</span>
                    </div>
                    <div className="fp-comment-meta">
                      {timeAgo(c.created_at)}
                      {c.author_id === currentUserId && (
                        <>
                          <span className="fp-comment-dot">·</span>
                          <button className="fp-comment-delete" onClick={() => handleDeleteComment(c.id)}>Delete</button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Comment input */}
          <form className="fp-comment-form" onSubmit={handleComment}>
            <Avatar name={null} size={28} />
            <div className="fp-comment-input-wrap">
              <input
                ref={commentInputRef}
                className="fp-comment-input"
                placeholder="Write a comment…"
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                maxLength={500}
              />
              {commentText.trim() && (
                <button type="submit" className="fp-comment-send" disabled={sendingComment}>
                  {sendingComment ? '…' : '➤'}
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

// ── Compose box ───────────────────────────────────────────────
function ComposeBox({
  profile,
  onPost,
}: {
  profile: Profile | null
  onPost: (post: FeedPost) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [content, setContent] = useState('')
  const [selectedMood, setSelectedMood] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState('')
  const [showImageInput, setShowImageInput] = useState(false)
  const [imgPreviewOk, setImgPreviewOk] = useState(false)
  const [posting, setPosting] = useState(false)
  const [charCount, setCharCount] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const MAX = 1000

  function handleExpand() {
    setExpanded(true)
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  function handleReset() {
    setExpanded(false); setContent(''); setSelectedMood(null)
    setImageUrl(''); setShowImageInput(false); setImgPreviewOk(false)
    setCharCount(0)
  }

  async function handlePost() {
    if (!content.trim() || !profile || posting) return
    setPosting(true)
    const { data } = await supabase
      .from('feed_posts')
      .insert({
        author_id: profile.id,
        content: content.trim(),
        mood: selectedMood,
        image_url: imageUrl.trim() || null,
      })
      .select('*, author:profiles!author_id(full_name, role)')
      .single()

    if (data) {
      onPost({ ...data as FeedPost, likes_count: 0, comments_count: 0, i_liked: false })
    }
    setPosting(false)
    handleReset()
  }

  return (
    <div className={`fp-compose${expanded ? ' expanded' : ''}`}>
      <div className="fp-compose-top" onClick={!expanded ? handleExpand : undefined}>
        <Avatar name={profile?.full_name ?? null} role={profile?.role} size={40} />
        {!expanded ? (
          <div className="fp-compose-placeholder">
            What's on your mind, {profile?.full_name?.split(' ')[0] ?? 'there'}?
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            className="fp-compose-textarea"
            placeholder={`What's on your mind, ${profile?.full_name?.split(' ')[0] ?? 'there'}?`}
            value={content}
            onChange={e => { setContent(e.target.value.slice(0, MAX)); setCharCount(e.target.value.length) }}
            rows={3}
            onClick={e => e.stopPropagation()}
          />
        )}
      </div>

      {expanded && (
        <>
          {/* Mood selector */}
          <div className="fp-compose-moods">
            {MOODS.map(m => (
              <button
                key={m.emoji}
                className={`fp-mood-chip${selectedMood === m.emoji ? ' selected' : ''}`}
                onClick={() => setSelectedMood(selectedMood === m.emoji ? null : m.emoji)}
                title={m.label}
              >
                {m.emoji} <span>{m.label}</span>
              </button>
            ))}
          </div>

          {/* Image URL */}
          {showImageInput && (
            <div className="fp-compose-img-row">
              <span style={{ fontSize: '0.85rem', color: 'var(--text-faint)', flexShrink: 0 }}>🖼</span>
              <input
                className="fp-compose-img-input"
                placeholder="Paste image URL…"
                value={imageUrl}
                onChange={e => { setImageUrl(e.target.value); setImgPreviewOk(false) }}
              />
              {imageUrl && (
                <img
                  src={imageUrl} alt="" style={{ display: 'none' }}
                  onLoad={() => setImgPreviewOk(true)}
                  onError={() => setImgPreviewOk(false)}
                />
              )}
              {imgPreviewOk && (
                <img src={imageUrl} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
              )}
              <button onClick={() => { setImageUrl(''); setShowImageInput(false); setImgPreviewOk(false) }}
                style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: '0.85rem' }}>✕</button>
            </div>
          )}

          {/* Footer */}
          <div className="fp-compose-footer">
            <div className="fp-compose-tools">
              <button
                className={`fp-compose-tool${showImageInput ? ' active' : ''}`}
                onClick={() => setShowImageInput(p => !p)}
                title="Add image"
              >
                🖼 Photo
              </button>
              <div className="fp-compose-char" style={{ color: charCount > MAX * 0.9 ? '#C0504D' : charCount > MAX * 0.75 ? '#F79646' : 'var(--text-faint)' }}>
                {MAX - charCount}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="fp-compose-cancel" onClick={handleReset}>Cancel</button>
              <button
                className="fp-compose-post"
                onClick={handlePost}
                disabled={!content.trim() || posting}
              >
                {posting ? 'Posting…' : 'Post'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function NewsFeedPage() {
  const navigate = useNavigate()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [posts, setPosts] = useState<FeedPost[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(0)
  const [filterMood, setFilterMood] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<'all' | 'mine' | 'liked'>('all')
  const [topProfiles, setTopProfiles] = useState<{ id: string; full_name: string | null; role: string; post_count: number }[]>([])

  const loaderRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { navigate('/login'); return }
      const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      setProfile(p)
      await loadPosts(0, null, 'all', p?.id)
      await loadTopProfiles()
      setLoading(false)
    }
    load()
  }, [navigate])

  async function loadTopProfiles() {
    const { data } = await supabase
      .from('feed_posts')
      .select('author_id, author:profiles!author_id(full_name, role)')
      .order('created_at', { ascending: false })
      .limit(50)
    if (!data) return
    const counts: Record<string, { id: string; full_name: string | null; role: string; count: number }> = {}
    data.forEach((p: any) => {
      const id = p.author_id
      if (!counts[id]) counts[id] = { id, full_name: p.author?.full_name, role: p.author?.role, count: 0 }
      counts[id].count++
    })
    const sorted = Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 5)
    setTopProfiles(sorted.map(s => ({ id: s.id, full_name: s.full_name, role: s.role, post_count: s.count })))
  }

  async function loadPosts(pageNum: number, mood: string | null, type: string, userId?: string) {
    const uid = userId ?? profile?.id
    let query = supabase
      .from('feed_posts')
      .select('*, author:profiles!author_id(full_name, role)')
      .order('created_at', { ascending: false })
      .range(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE - 1)

    if (mood) query = query.eq('mood', mood)
    if (type === 'mine' && uid) query = query.eq('author_id', uid)

    const { data: postsData } = await query
    if (!postsData) return

    if (postsData.length < PAGE_SIZE) setHasMore(false)
    else setHasMore(true)

    if (!uid || postsData.length === 0) {
      const enriched = (postsData as FeedPost[]).map(p => ({ ...p, likes_count: 0, comments_count: 0, i_liked: false }))
      if (pageNum === 0) setPosts(enriched); else setPosts(prev => [...prev, ...enriched])
      return
    }

    const ids = postsData.map(p => p.id)
    const [{ data: likesData }, { data: commentsData }, { data: myLikesData }] = await Promise.all([
      supabase.from('feed_likes').select('post_id').in('post_id', ids),
      supabase.from('feed_comments').select('post_id').in('post_id', ids),
      supabase.from('feed_likes').select('post_id').in('post_id', ids).eq('user_id', uid),
    ])

    const likeCounts: Record<string, number> = {}
    const commentCounts: Record<string, number> = {}
    const myLikedSet = new Set((myLikesData ?? []).map((l: any) => l.post_id))
    ;(likesData ?? []).forEach((l: any) => { likeCounts[l.post_id] = (likeCounts[l.post_id] ?? 0) + 1 })
    ;(commentsData ?? []).forEach((c: any) => { commentCounts[c.post_id] = (commentCounts[c.post_id] ?? 0) + 1 })

    let enriched = (postsData as FeedPost[]).map(p => ({
      ...p,
      likes_count: likeCounts[p.id] ?? 0,
      comments_count: commentCounts[p.id] ?? 0,
      i_liked: myLikedSet.has(p.id),
    }))

    if (type === 'liked') enriched = enriched.filter(p => p.i_liked)

    if (pageNum === 0) setPosts(enriched)
    else setPosts(prev => [...prev, ...enriched])
  }

  async function handleLoadMore() {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    const nextPage = page + 1
    setPage(nextPage)
    await loadPosts(nextPage, filterMood, filterType)
    setLoadingMore(false)
  }

  async function handleFilterChange(mood: string | null, type: 'all' | 'mine' | 'liked') {
    setFilterMood(mood); setFilterType(type)
    setPage(0); setHasMore(true); setLoading(true)
    await loadPosts(0, mood, type)
    setLoading(false)
  }

  // Intersection observer for infinite scroll
  useEffect(() => {
    if (!loaderRef.current) return
    const observer = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) handleLoadMore() },
      { threshold: 0.1 }
    )
    observer.observe(loaderRef.current)
    return () => observer.disconnect()
  }, [page, hasMore, loadingMore, filterMood, filterType])

  function handleNewPost(post: FeedPost) {
    setPosts(prev => [post, ...prev])
  }

  function handleLike(postId: string, wasLiked: boolean) {
    setPosts(prev => prev.map(p => p.id === postId ? {
      ...p,
      i_liked: !wasLiked,
      likes_count: wasLiked ? p.likes_count - 1 : p.likes_count + 1,
    } : p))
  }

  function handleDelete(postId: string) {
    setPosts(prev => prev.filter(p => p.id !== postId))
  }

  function handleCommentCountChange(postId: string, delta: number) {
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, comments_count: p.comments_count + delta } : p))
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Nunito, sans-serif', color: 'var(--text-faint)' }}>
      Loading feed…
    </div>
  )

  return (
    <>
      <style>{`
        @keyframes fadeUp   { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes shimmer  { 0%{background-position:-400px 0} 100%{background-position:400px 0} }
        @keyframes heartPop { 0%{transform:scale(1)} 30%{transform:scale(1.35)} 100%{transform:scale(1)} }

        *, *::before, *::after { box-sizing:border-box; }

        .fp-page { min-height:100vh;background:var(--bg-page);font-family:'Nunito','Segoe UI',system-ui,sans-serif; }
        .fp-layout { max-width:1080px;margin:0 auto;padding:1.75rem 1.25rem 4rem;display:grid;grid-template-columns:1fr 300px;gap:1.5rem;align-items:start; }

        /* ── Left: Feed ── */
        .fp-feed { display:flex;flex-direction:column;gap:1rem; }

        /* ── Compose ── */
        .fp-compose {
          background:var(--bg-surface);border:1px solid var(--border);border-radius:16px;
          overflow:hidden;transition:box-shadow 0.15s;
        }
        .fp-compose:hover { box-shadow:var(--shadow-sm); }
        .fp-compose.expanded { box-shadow:var(--shadow-md); }
        .fp-compose-top { display:flex;align-items:center;gap:0.85rem;padding:1rem 1.25rem;cursor:pointer; }
        .fp-compose.expanded .fp-compose-top { cursor:default;align-items:flex-start;padding-bottom:0.5rem; }
        .fp-compose-placeholder { flex:1;padding:0.65rem 1rem;background:var(--bg-page);border:1px solid var(--border);border-radius:999px;font-size:0.9rem;color:var(--text-faint);cursor:pointer;transition:background 0.12s; }
        .fp-compose-placeholder:hover { background:var(--bg-hover); }
        .fp-compose-textarea { flex:1;border:none;outline:none;font-size:0.95rem;color:var(--text-primary);background:transparent;resize:none;font-family:inherit;line-height:1.65;min-height:80px; }
        .fp-compose-textarea::placeholder { color:var(--text-faint); }

        .fp-compose-moods { display:flex;flex-wrap:wrap;gap:0.4rem;padding:0.5rem 1.25rem 0.75rem; }
        .fp-mood-chip { display:flex;align-items:center;gap:0.3rem;padding:0.3rem 0.7rem;border:1.5px solid var(--border);border-radius:999px;background:var(--bg-surface);font-size:0.75rem;font-weight:600;color:var(--text-muted);cursor:pointer;transition:all 0.12s;font-family:inherit; }
        .fp-mood-chip span { display:none; }
        .fp-mood-chip:hover span { display:inline; }
        .fp-mood-chip:hover { border-color:#4BACC6;color:#243F60;background:#EEF4FB; }
        .fp-mood-chip.selected { background:#EEF4FB;border-color:#4BACC6;color:#243F60; }
        .fp-mood-chip.selected span { display:inline; }

        .fp-compose-img-row { display:flex;align-items:center;gap:0.65rem;padding:0.5rem 1.25rem;border-top:1px solid var(--border-light); }
        .fp-compose-img-input { flex:1;padding:0.45rem 0.75rem;border:1px solid var(--border);border-radius:8px;font-size:0.82rem;color:var(--text-primary);background:var(--bg-page);font-family:inherit;outline:none; }
        .fp-compose-img-input:focus { border-color:#4BACC6; }

        .fp-compose-footer { display:flex;align-items:center;justify-content:space-between;padding:0.75rem 1.25rem;border-top:1px solid var(--border-light);gap:0.75rem; }
        .fp-compose-tools { display:flex;align-items:center;gap:0.75rem;flex:1; }
        .fp-compose-tool { display:flex;align-items:center;gap:0.35rem;padding:0.35rem 0.75rem;border:1px solid var(--border);border-radius:7px;background:transparent;font-size:0.78rem;font-weight:600;color:var(--text-muted);cursor:pointer;transition:all 0.12s;font-family:inherit; }
        .fp-compose-tool:hover,.fp-compose-tool.active { border-color:#4BACC6;color:#243F60;background:#EEF4FB; }
        .fp-compose-char { font-size:0.72rem;color:var(--text-faint);font-weight:600;margin-left:auto; }
        .fp-compose-cancel { padding:0.5rem 1rem;background:transparent;border:1px solid var(--border);border-radius:9px;font-size:0.85rem;font-weight:600;color:var(--text-muted);cursor:pointer;font-family:inherit;transition:all 0.12s; }
        .fp-compose-cancel:hover { background:var(--bg-hover); }
        .fp-compose-post { padding:0.5rem 1.35rem;background:#243F60;color:white;border:none;border-radius:9px;font-size:0.85rem;font-weight:700;cursor:pointer;font-family:inherit;transition:background 0.15s; }
        .fp-compose-post:hover:not(:disabled) { background:#365F91; }
        .fp-compose-post:disabled { opacity:0.4;cursor:not-allowed; }

        /* ── Filter bar ── */
        .fp-filters { display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap; }
        .fp-filter-btn { padding:0.35rem 0.85rem;border:1.5px solid var(--border);border-radius:999px;background:var(--bg-surface);font-size:0.78rem;font-weight:600;color:var(--text-muted);cursor:pointer;transition:all 0.12s;font-family:inherit; }
        .fp-filter-btn:hover { border-color:#4BACC6;color:var(--text-primary); }
        .fp-filter-btn.active { background:#EEF4FB;border-color:#4BACC6;color:#243F60; }
        .fp-filter-sep { width:1px;height:16px;background:var(--border);margin:0 0.1rem; }

        /* ── Post card ── */
        .fp-card {
          background:var(--bg-surface);border:1px solid var(--border);border-radius:16px;
          overflow:hidden;animation:fadeUp 0.25s ease both;
          transition:box-shadow 0.15s;
        }
        .fp-card:hover { box-shadow:var(--shadow-md); }

        .fp-card-header { display:flex;align-items:flex-start;gap:0.75rem;padding:1.1rem 1.25rem 0.6rem; }
        .fp-card-avatar-wrap { flex-shrink:0; }
        .fp-card-meta { flex:1;min-width:0; }
        .fp-card-name { font-size:0.9rem;font-weight:800;color:var(--text-primary);cursor:pointer;display:inline; }
        .fp-card-name:hover { color:#4BACC6; }
        .fp-card-sub-row { display:flex;align-items:center;gap:0.35rem;margin-top:0.2rem;flex-wrap:wrap; }
        .fp-mood-inline { font-size:0.75rem;color:var(--text-muted);display:flex;align-items:center;gap:0.2rem; }
        .fp-card-dot { color:var(--text-ghost);font-size:0.6rem; }
        .fp-card-time { font-size:0.75rem;color:var(--text-faint); }
        .fp-card-menu { background:none;border:none;color:var(--text-faint);cursor:pointer;font-size:1.1rem;padding:0.2rem 0.4rem;border-radius:5px;transition:all 0.12s;letter-spacing:0.1em;line-height:1; }
        .fp-card-menu:hover { background:var(--bg-hover);color:var(--text-primary); }

        .fp-card-content { padding:0.25rem 1.25rem 0.85rem;font-size:0.92rem;color:var(--text-secondary);line-height:1.72;white-space:pre-wrap;word-break:break-word;font-family:'Source Serif 4','Georgia',serif; }

        .fp-card-img-wrap { overflow:hidden;background:var(--bg-subtle); }
        .fp-card-img { width:100%;max-height:480px;object-fit:cover;display:block;transition:transform 0.3s; }
        .fp-card-img:hover { transform:scale(1.01); }

        /* Actions */
        .fp-card-actions { display:flex;align-items:center;padding:0.25rem 0.5rem;border-top:1px solid var(--border-light); }
        .fp-action-btn { display:flex;align-items:center;gap:0.45rem;flex:1;padding:0.65rem 0.5rem;background:transparent;border:none;border-radius:9px;font-size:0.82rem;font-weight:600;color:var(--text-muted);cursor:pointer;transition:all 0.12s;font-family:inherit;justify-content:center; }
        .fp-action-btn:hover { background:var(--bg-hover);color:var(--text-primary); }
        .fp-action-btn.liked { color:#C0504D; }
        .fp-action-btn.liked:hover { background:#FEF2F2; }
        .fp-action-icon { font-size:1rem;transition:transform 0.15s; }
        .fp-action-btn.liked .fp-action-icon { animation:heartPop 0.3s ease; }
        .fp-action-label { font-size:0.8rem; }

        .fp-likes-summary { padding:0.25rem 1.25rem 0.65rem;font-size:0.78rem;color:var(--text-faint); }

        /* Comments */
        .fp-comments-section { padding:0 1.25rem 1rem; }
        .fp-comments-divider { height:1px;background:var(--border-light);margin-bottom:0.85rem; }
        .fp-comments-loading { font-size:0.82rem;color:var(--text-faint);padding:0.5rem 0; }
        .fp-comments-empty { font-size:0.82rem;color:var(--text-faint);padding:0.5rem 0;text-align:center; }
        .fp-comments-list { display:flex;flex-direction:column;gap:0.7rem;margin-bottom:0.85rem; }
        .fp-comment { display:flex;gap:0.6rem;align-items:flex-start; }
        .fp-comment-body { flex:1;min-width:0; }
        .fp-comment-bubble { background:var(--bg-page);border-radius:12px;padding:0.55rem 0.85rem;display:inline-block;max-width:100%; }
        .fp-comment-name { font-size:0.78rem;font-weight:800;color:var(--text-primary);margin-right:0.4rem;cursor:pointer; }
        .fp-comment-name:hover { color:#4BACC6; }
        .fp-comment-text { font-size:0.82rem;color:var(--text-secondary);word-break:break-word; }
        .fp-comment-meta { display:flex;align-items:center;gap:0.35rem;margin-top:0.2rem;padding-left:0.1rem; }
        .fp-comment-dot { color:var(--text-ghost);font-size:0.55rem; }
        .fp-comment-delete { background:none;border:none;font-size:0.72rem;color:var(--text-faint);cursor:pointer;font-family:inherit;padding:0;transition:color 0.12s; }
        .fp-comment-delete:hover { color:#dc2626; }
        .fp-comment-meta > span:first-child { font-size:0.72rem;color:var(--text-faint); }

        .fp-comment-form { display:flex;align-items:center;gap:0.65rem;margin-top:0.5rem; }
        .fp-comment-input-wrap { flex:1;display:flex;align-items:center;background:var(--bg-page);border:1.5px solid var(--border);border-radius:999px;padding:0.4rem 0.75rem;transition:border-color 0.15s; }
        .fp-comment-input-wrap:focus-within { border-color:#4BACC6; }
        .fp-comment-input { flex:1;border:none;background:transparent;outline:none;font-size:0.85rem;color:var(--text-primary);font-family:inherit; }
        .fp-comment-input::placeholder { color:var(--text-faint); }
        .fp-comment-send { background:none;border:none;color:#4BACC6;cursor:pointer;font-size:0.85rem;font-weight:700;padding:0 0.25rem;flex-shrink:0;transition:color 0.12s; }
        .fp-comment-send:hover { color:#243F60; }

        /* Delete confirm */
        .fp-delete-confirm { display:flex;align-items:center;gap:0.4rem;background:var(--bg-page);border:1px solid var(--border);border-radius:9px;padding:0.35rem 0.65rem;white-space:nowrap; }
        .fp-delete-yes { padding:0.2rem 0.55rem;background:#C0504D;color:white;border:none;border-radius:5px;font-size:0.72rem;font-weight:700;cursor:pointer;font-family:inherit; }
        .fp-delete-no { padding:0.2rem 0.55rem;background:transparent;color:var(--text-muted);border:none;font-size:0.72rem;font-weight:600;cursor:pointer;font-family:inherit; }

        /* Load more */
        .fp-load-more { text-align:center;padding:1rem; }
        .fp-load-more-btn { padding:0.65rem 2rem;background:var(--bg-surface);border:1.5px solid var(--border);border-radius:10px;font-size:0.85rem;font-weight:700;color:var(--text-primary);cursor:pointer;font-family:inherit;transition:all 0.15s; }
        .fp-load-more-btn:hover { border-color:#4BACC6;color:#243F60;background:#EEF4FB; }
        .fp-no-more { font-size:0.78rem;color:var(--text-ghost);padding:0.75rem;text-align:center; }

        /* Loading skeleton */
        .fp-skeleton { background:var(--bg-surface);border:1px solid var(--border);border-radius:16px;padding:1.25rem;margin-bottom:1rem; }
        .fp-skel-line { height:14px;border-radius:7px;background:linear-gradient(90deg,var(--bg-hover) 25%,var(--bg-subtle) 50%,var(--bg-hover) 75%);background-size:400px 100%;animation:shimmer 1.4s ease-in-out infinite;margin-bottom:0.65rem; }

        /* Empty feed */
        .fp-empty { background:var(--bg-surface);border:1px solid var(--border);border-radius:16px;padding:3rem;text-align:center; }
        .fp-empty-icon { font-size:2.5rem;margin-bottom:0.75rem;opacity:0.4; }
        .fp-empty-title { font-size:1rem;font-weight:700;color:var(--text-primary);margin-bottom:0.35rem; }
        .fp-empty-sub { font-size:0.85rem;color:var(--text-faint);line-height:1.6; }

        /* ── Right sidebar ── */
        .fp-sidebar { display:flex;flex-direction:column;gap:1rem;position:sticky;top:76px; }

        .fp-sidebar-card { background:var(--bg-surface);border:1px solid var(--border);border-radius:14px;overflow:hidden; }
        .fp-sidebar-title { font-size:0.68rem;font-weight:800;color:var(--text-faint);text-transform:uppercase;letter-spacing:0.09em;padding:0.85rem 1.1rem;border-bottom:1px solid var(--border-light); }

        /* Top contributors */
        .fp-contrib-row { display:flex;align-items:center;gap:0.65rem;padding:0.65rem 1.1rem;border-bottom:1px solid var(--border-light);cursor:pointer;transition:background 0.1s; }
        .fp-contrib-row:last-child { border-bottom:none; }
        .fp-contrib-row:hover { background:var(--bg-hover); }
        .fp-contrib-name { font-size:0.82rem;font-weight:600;color:var(--text-primary);flex:1; }
        .fp-contrib-count { font-size:0.72rem;color:var(--text-faint);font-weight:600; }

        /* Mood summary */
        .fp-mood-summary { padding:0.75rem 1.1rem;display:flex;flex-direction:column;gap:0.4rem; }
        .fp-mood-row { display:flex;align-items:center;gap:0.55rem;font-size:0.78rem; }
        .fp-mood-emoji-big { font-size:1rem;flex-shrink:0; }
        .fp-mood-bar-track { flex:1;height:5px;background:var(--bg-page);border-radius:999px;overflow:hidden; }
        .fp-mood-bar-fill { height:100%;background:linear-gradient(90deg,#4BACC6,#8064A2);border-radius:999px;transition:width 0.5s ease; }
        .fp-mood-bar-count { font-size:0.7rem;color:var(--text-faint);font-weight:600;min-width:18px;text-align:right; }

        /* Profile card */
        .fp-profile-card { padding:1.25rem 1.1rem;display:flex;flex-direction:column;align-items:center;text-align:center;gap:0.5rem; }
        .fp-profile-name { font-size:0.92rem;font-weight:800;color:var(--text-primary); }
        .fp-profile-role { font-size:0.72rem;color:var(--text-faint);text-transform:capitalize; }
        .fp-profile-stats { display:flex;gap:1.25rem;margin-top:0.25rem; }
        .fp-profile-stat-val { font-size:1.1rem;font-weight:800;color:var(--text-primary);line-height:1; }
        .fp-profile-stat-label { font-size:0.62rem;color:var(--text-faint);text-transform:uppercase;letter-spacing:0.05em;margin-top:0.15rem; }
        .fp-profile-btn { width:100%;padding:0.5rem;background:#243F60;color:white;border:none;border-radius:8px;font-size:0.82rem;font-weight:700;cursor:pointer;font-family:inherit;transition:background 0.15s;margin-top:0.25rem; }
        .fp-profile-btn:hover { background:#365F91; }

        @media(max-width:768px) { .fp-layout{grid-template-columns:1fr} .fp-sidebar{display:none} }
      `}</style>

      <div className="fp-page">
        <Navbar fullName={profile?.full_name ?? null} role={profile?.role ?? 'employee'} />

        <div className="fp-layout">
          {/* ── Feed ── */}
          <div className="fp-feed">

            {/* Compose */}
            <ComposeBox profile={profile} onPost={handleNewPost} />

            {/* Filters */}
            <div className="fp-filters">
              <button
                className={`fp-filter-btn${filterType === 'all' && !filterMood ? ' active' : ''}`}
                onClick={() => handleFilterChange(null, 'all')}
              >
                🌐 All posts
              </button>
              <button
                className={`fp-filter-btn${filterType === 'mine' ? ' active' : ''}`}
                onClick={() => handleFilterChange(null, 'mine')}
              >
                👤 My posts
              </button>
              <button
                className={`fp-filter-btn${filterType === 'liked' ? ' active' : ''}`}
                onClick={() => handleFilterChange(null, 'liked')}
              >
                ❤️ Liked
              </button>
              <div className="fp-filter-sep" />
              {MOODS.slice(0, 5).map(m => (
                <button
                  key={m.emoji}
                  className={`fp-filter-btn${filterMood === m.emoji ? ' active' : ''}`}
                  onClick={() => handleFilterChange(filterMood === m.emoji ? null : m.emoji, 'all')}
                  title={m.label}
                >
                  {m.emoji}
                </button>
              ))}
            </div>

            {/* Posts */}
            {loading ? (
              [1, 2, 3].map(i => (
                <div key={i} className="fp-skeleton" style={{ animationDelay: `${i * 0.1}s` }}>
                  <div className="fp-skel-line" style={{ width: '40%' }} />
                  <div className="fp-skel-line" style={{ width: '80%' }} />
                  <div className="fp-skel-line" style={{ width: '65%' }} />
                </div>
              ))
            ) : posts.length === 0 ? (
              <div className="fp-empty">
                <div className="fp-empty-icon">
                  {filterType === 'mine' ? '✏️' : filterType === 'liked' ? '❤️' : filterMood ?? '📰'}
                </div>
                <div className="fp-empty-title">
                  {filterType === 'mine' ? "You haven't posted yet"
                   : filterType === 'liked' ? "No liked posts yet"
                   : filterMood ? `No ${MOODS.find(m => m.emoji === filterMood)?.label} posts yet`
                   : "The feed is empty"}
                </div>
                <div className="fp-empty-sub">
                  {filterType === 'mine' ? "Share something with your team using the compose box above."
                   : filterType === 'liked' ? "Like posts to find them here later."
                   : "Be the first to post something for your team."}
                </div>
              </div>
            ) : (
              posts.map((post, i) => (
                <PostCard
                  key={post.id}
                  post={post}
                  currentUserId={profile?.id ?? null}
                  onLike={handleLike}
                  onDelete={handleDelete}
                  onCommentCountChange={handleCommentCountChange}
                />
              ))
            )}

            {/* Infinite scroll sentinel */}
            <div ref={loaderRef} className="fp-load-more">
              {loadingMore && <div style={{ color: 'var(--text-faint)', fontSize: '0.82rem' }}>Loading more…</div>}
              {!hasMore && posts.length > 0 && <div className="fp-no-more">You've seen all posts ✓</div>}
            </div>
          </div>

          {/* ── Sidebar ── */}
          <div className="fp-sidebar">

            {/* Your profile card */}
            <div className="fp-sidebar-card">
              <div className="fp-profile-card">
                <Avatar name={profile?.full_name ?? null} role={profile?.role} size={52} />
                <div className="fp-profile-name">{profile?.full_name ?? 'You'}</div>
                <div className="fp-profile-role">{profile?.role}</div>
                <div className="fp-profile-stats">
                  <div>
                    <div className="fp-profile-stat-val">{posts.filter(p => p.author_id === profile?.id).length}</div>
                    <div className="fp-profile-stat-label">Posts</div>
                  </div>
                  <div>
                    <div className="fp-profile-stat-val">{posts.filter(p => p.i_liked).length}</div>
                    <div className="fp-profile-stat-label">Liked</div>
                  </div>
                </div>
                <button
                  className="fp-profile-btn"
                  onClick={() => profile && navigate(`/profile/${profile.id}`)}
                >
                  View profile
                </button>
              </div>
            </div>

            {/* Mood breakdown */}
            {posts.length > 0 && (() => {
              const moodCounts: Record<string, number> = {}
              posts.forEach(p => { if (p.mood) moodCounts[p.mood] = (moodCounts[p.mood] ?? 0) + 1 })
              const sorted = Object.entries(moodCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
              const max = sorted[0]?.[1] ?? 1
              if (sorted.length === 0) return null
              return (
                <div className="fp-sidebar-card">
                  <div className="fp-sidebar-title">Team Mood</div>
                  <div className="fp-mood-summary">
                    {sorted.map(([emoji, count]) => (
                      <div key={emoji} className="fp-mood-row">
                        <span className="fp-mood-emoji-big">{emoji}</span>
                        <div className="fp-mood-bar-track">
                          <div className="fp-mood-bar-fill" style={{ width: `${(count / max) * 100}%` }} />
                        </div>
                        <span className="fp-mood-bar-count">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* Top contributors */}
            {topProfiles.length > 0 && (
              <div className="fp-sidebar-card">
                <div className="fp-sidebar-title">Top Contributors</div>
                {topProfiles.map((p, i) => (
                  <div key={p.id} className="fp-contrib-row" onClick={() => navigate(`/profile/${p.id}`)}>
                    <div style={{ width: 18, textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-faint)', flexShrink: 0 }}>
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`}
                    </div>
                    <Avatar name={p.full_name} role={p.role} size={30} />
                    <div className="fp-contrib-name">{p.full_name?.split(' ')[0] ?? 'Unknown'}</div>
                    <div className="fp-contrib-count">{p.post_count} posts</div>
                  </div>
                ))}
              </div>
            )}

            {/* Quick mood post */}
            <div className="fp-sidebar-card">
              <div className="fp-sidebar-title">Quick Mood</div>
              <div style={{ padding: '0.75rem 1.1rem', display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {MOODS.map(m => (
                  <button
                    key={m.emoji}
                    style={{ padding: '0.4rem 0.6rem', background: 'var(--bg-page)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '1rem', cursor: 'pointer', transition: 'all 0.12s' }}
                    title={m.label}
                    onClick={async () => {
                      if (!profile) return
                      const { data } = await supabase
                        .from('feed_posts')
                        .insert({ author_id: profile.id, content: `${m.label} today!`, mood: m.emoji })
                        .select('*, author:profiles!author_id(full_name, role)')
                        .single()
                      if (data) handleNewPost({ ...data as FeedPost, likes_count: 0, comments_count: 0, i_liked: false })
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#EEF4FB'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#4BACC6' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-page)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)' }}
                  >
                    {m.emoji}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
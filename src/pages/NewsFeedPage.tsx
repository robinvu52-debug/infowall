import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Navbar from '../components/Navbar'

interface Profile {
  id: string
  full_name: string | null
  role: string
}

interface FeedPost {
  id: string
  content: string
  mood: string | null
  image_url: string | null
  created_at: string
  author_id: string
  author: { full_name: string | null; role: string } | null
}

interface FeedLike {
  post_id: string
  user_id: string
}

const MOODS = [
  { emoji: '😊', label: 'Feeling great' },
  { emoji: '🎉', label: 'Celebrating' },
  { emoji: '💪', label: 'Motivated' },
  { emoji: '🤔', label: 'Thinking' },
  { emoji: '☕', label: 'Getting started' },
  { emoji: '🚀', label: 'In the zone' },
]

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(dateStr).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

function Avatar({ name, size = 36 }: { name: string | null; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'linear-gradient(135deg, #00b8b8, #0d2d3a)',
      color: 'white', fontSize: size * 0.33, fontWeight: 700,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, userSelect: 'none' as const,
    }}>
      {(name ?? '?').charAt(0).toUpperCase()}
    </div>
  )
}

function NewsFeedPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [posts, setPosts] = useState<FeedPost[]>([])
  const [likes, setLikes] = useState<FeedLike[]>([])
  const [loading, setLoading] = useState(true)
  const [content, setContent] = useState('')
  const [mood, setMood] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState('')
  const [showImageInput, setShowImageInput] = useState(false)
  const [imagePreviewOk, setImagePreviewOk] = useState(false)
  const [posting, setPosting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [togglingLike, setTogglingLike] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const navigate = useNavigate()
  const MAX_CHARS = 500

  async function loadFeed() {
    const { data: postsData } = await supabase
      .from('feed_posts')
      .select('*, author:profiles!author_id(full_name, role)')
      .order('created_at', { ascending: false })
      .limit(60)
    const { data: likesData } = await supabase
      .from('feed_likes').select('post_id, user_id')
    setPosts((postsData ?? []) as FeedPost[])
    setLikes(likesData ?? [])
  }

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { navigate('/login'); return }
      setUserId(user.id)
      const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      setProfile(p)
      await loadFeed()
      setLoading(false)
    }
    init()
    const interval = setInterval(loadFeed, 30000)
    return () => clearInterval(interval)
  }, [navigate])

  function handleContentChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    if (e.target.value.length > MAX_CHARS) return
    setContent(e.target.value)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'
    }
  }

  async function handlePost() {
    if (!content.trim() || !userId) return
    setPosting(true)
    const { error } = await supabase.from('feed_posts').insert({
      author_id: userId,
      content: content.trim(),
      mood: mood ?? null,
      image_url: imageUrl.trim() || null,
    })
    if (!error) {
      setContent(''); setMood(null); setImageUrl(''); setShowImageInput(false)
      setImagePreviewOk(false)
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      await loadFeed()
    }
    setPosting(false)
  }

  async function handleDelete(postId: string) {
    if (!window.confirm('Delete this post?')) return
    setDeletingId(postId)
    await supabase.from('feed_posts').delete().eq('id', postId)
    setPosts(prev => prev.filter(p => p.id !== postId))
    setDeletingId(null)
  }

  async function handleLike(postId: string) {
    if (!userId || togglingLike) return
    setTogglingLike(postId)
    const alreadyLiked = likes.some(l => l.post_id === postId && l.user_id === userId)
    if (alreadyLiked) {
      await supabase.from('feed_likes').delete().eq('post_id', postId).eq('user_id', userId)
      setLikes(prev => prev.filter(l => !(l.post_id === postId && l.user_id === userId)))
    } else {
      await supabase.from('feed_likes').insert({ post_id: postId, user_id: userId })
      setLikes(prev => [...prev, { post_id: postId, user_id: userId }])
    }
    setTogglingLike(null)
  }

  const charsLeft = MAX_CHARS - content.length

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: '#6b7280' }}>
      Loading…
    </div>
  )

  return (
    <>
      <style>{`
        .fp { min-height: 100vh; background: #f0f2f5; }

        .fp-body {
          max-width: 640px;
          margin: 0 auto;
          padding: 2rem 1.25rem 4rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        /* Header */
        .fp-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 0.25rem; }
        .fp-title { font-size: 1.4rem; font-weight: 800; color: #0d2d3a; margin: 0 0 0.2rem; }
        .fp-sub { font-size: 0.82rem; color: #9ca3af; margin: 0; }
        .fp-refresh {
          padding: 0.4rem 0.85rem;
          background: white; border: 1px solid #e5e7eb;
          border-radius: 8px; font-size: 0.8rem; font-weight: 600;
          color: #6b7280; cursor: pointer; transition: all 0.12s;
          white-space: nowrap; margin-top: 0.2rem;
        }
        .fp-refresh:hover { background: #f9fafb; color: #374151; }

        /* Composer */
        .composer {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 16px;
          overflow: hidden;
        }

        .composer-top {
          display: flex;
          gap: 0.85rem;
          padding: 1.25rem 1.25rem 0;
          align-items: flex-start;
        }

        .composer-textarea {
          flex: 1; border: none; outline: none;
          font-size: 0.95rem; color: #374151;
          resize: none; line-height: 1.6;
          font-family: inherit; background: transparent;
          min-height: 68px; overflow: hidden;
        }
        .composer-textarea::placeholder { color: #c4c9d4; }

        /* Mood */
        .composer-moods {
          display: flex; align-items: center; gap: 0.35rem;
          padding: 0.65rem 1.25rem 0; flex-wrap: wrap;
        }
        .mood-label { font-size: 0.68rem; font-weight: 700; color: #c4c9d4; text-transform: uppercase; letter-spacing: 0.06em; margin-right: 0.15rem; }
        .mood-chip {
          display: flex; align-items: center; gap: 0.3rem;
          padding: 0.22rem 0.55rem; border-radius: 999px;
          border: 1.5px solid #f3f4f6; background: white;
          font-size: 0.75rem; cursor: pointer;
          transition: all 0.12s; color: #6b7280; white-space: nowrap;
        }
        .mood-chip:hover { border-color: #00b8b8; color: #0f766e; }
        .mood-chip.selected { border-color: #00b8b8; background: #f0fdfa; color: #0f766e; font-weight: 600; }

        /* Image input */
        .composer-image-row {
          padding: 0 1.25rem;
          margin-top: 0.75rem;
        }

        .image-toggle-btn {
          display: flex; align-items: center; gap: 0.4rem;
          background: none; border: 1.5px dashed #e5e7eb;
          border-radius: 9px; padding: 0.5rem 0.85rem;
          font-size: 0.8rem; font-weight: 600; color: #9ca3af;
          cursor: pointer; transition: all 0.15s; width: 100%;
        }
        .image-toggle-btn:hover { border-color: #00b8b8; color: #0f766e; }
        .image-toggle-btn.has-image { border-color: #00b8b8; color: #0f766e; background: #f0fdfa; }

        .image-input-wrap {
          display: flex; align-items: center; gap: 0.5rem;
          border: 1.5px solid #00b8b8; border-radius: 9px;
          padding: 0.5rem 0.75rem; background: #f0fdfa;
        }

        .image-input-wrap input {
          flex: 1; border: none; background: transparent;
          font-size: 0.82rem; color: #374151; outline: none;
        }

        .image-input-wrap input::placeholder { color: #9ca3af; }

        .image-clear-btn {
          background: none; border: none; color: #9ca3af;
          cursor: pointer; font-size: 0.8rem; padding: 0;
          transition: color 0.12s; flex-shrink: 0;
        }
        .image-clear-btn:hover { color: #dc2626; }

        /* Preview */
        .composer-preview {
          margin: 0.65rem 1.25rem 0;
          border-radius: 10px;
          overflow: hidden;
          border: 1px solid #e5e7eb;
          position: relative;
          background: #f9fafb;
        }

        .composer-preview img {
          width: 100%; max-height: 220px;
          object-fit: cover; display: block;
        }

        .preview-badge {
          position: absolute; top: 8px; left: 8px;
          background: rgba(0,0,0,0.55); color: white;
          font-size: 0.68rem; font-weight: 700;
          padding: 0.2rem 0.5rem; border-radius: 6px;
          letter-spacing: 0.04em;
        }

        /* Footer */
        .composer-footer {
          display: flex; align-items: center; justify-content: space-between;
          padding: 0.85rem 1.25rem;
          border-top: 1px solid #f3f4f6; margin-top: 0.75rem;
        }

        .char-count { font-size: 0.75rem; font-weight: 600; color: #d1d5db; }
        .char-count.warn { color: #f59e0b; }
        .char-count.danger { color: #dc2626; }

        .btn-post {
          padding: 0.48rem 1.3rem; background: #0d2d3a;
          color: white; border: none; border-radius: 9px;
          font-size: 0.85rem; font-weight: 700; cursor: pointer;
          transition: background 0.15s;
        }
        .btn-post:hover:not(:disabled) { background: #00b8b8; }
        .btn-post:disabled { opacity: 0.4; cursor: not-allowed; }

        /* Post card */
        .post-card {
          background: white; border: 1px solid #e5e7eb;
          border-radius: 16px; overflow: hidden;
          transition: border-color 0.15s;
        }
        .post-card:hover { border-color: #d1d5db; }

        .post-card-header {
          display: flex; align-items: flex-start;
          justify-content: space-between; gap: 0.75rem;
          padding: 1.1rem 1.2rem 0;
        }

        .post-author { display: flex; align-items: center; gap: 0.7rem; }

        .post-author-name {
          font-size: 0.9rem; font-weight: 700;
          color: #111827; display: block; line-height: 1.2;
        }

        .post-author-meta { display: flex; align-items: center; gap: 0.4rem; margin-top: 0.12rem; }
        .post-author-role { font-size: 0.7rem; font-weight: 600; color: #9ca3af; text-transform: capitalize; }
        .meta-dot { width: 3px; height: 3px; border-radius: 50%; background: #e5e7eb; flex-shrink: 0; }
        .post-time { font-size: 0.7rem; color: #9ca3af; }

        .post-delete {
          background: none; border: none; color: #e5e7eb;
          cursor: pointer; font-size: 0.75rem; padding: 0.3rem;
          border-radius: 6px; transition: all 0.12s; line-height: 1;
          flex-shrink: 0;
        }
        .post-delete:hover { color: #dc2626; background: #fef2f2; }

        /* Mood badge */
        .mood-badge {
          display: inline-flex; align-items: center; gap: 0.3rem;
          background: #f0fdfa; border: 1px solid #ccfbf1;
          border-radius: 999px; padding: 0.18rem 0.6rem;
          font-size: 0.72rem; color: #0f766e; font-weight: 600;
          margin: 0.6rem 1.2rem 0;
        }

        /* Content */
        .post-content {
          padding: 0.65rem 1.2rem 0;
          font-size: 0.9rem; color: #374151;
          line-height: 1.65; white-space: pre-wrap; word-break: break-word;
          margin: 0;
        }

        /* Post image */
        .post-image-wrap {
          margin: 0.85rem 0 0;
          overflow: hidden;
          background: #f0f2f5;
          max-height: 420px;
          display: flex; align-items: center; justify-content: center;
        }

        .post-image-wrap img {
          width: 100%; max-height: 420px;
          object-fit: cover; display: block;
          transition: transform 0.3s;
        }

        .post-image-wrap:hover img { transform: scale(1.01); }

        /* Footer */
        .post-footer {
          display: flex; align-items: center; gap: 0.75rem;
          padding: 0.75rem 1.2rem;
          border-top: 1px solid #f9fafb; margin-top: 0.75rem;
        }

        .like-btn {
          display: flex; align-items: center; gap: 0.4rem;
          background: none; border: 1px solid #f3f4f6;
          border-radius: 9px; padding: 0.35rem 0.8rem;
          font-size: 0.8rem; font-weight: 600; color: #9ca3af;
          cursor: pointer; transition: all 0.15s;
        }
        .like-btn:hover { border-color: #fda4af; color: #e11d48; background: #fff1f2; }
        .like-btn.liked { border-color: #fda4af; color: #e11d48; background: #fff1f2; }
        .like-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .like-heart { font-size: 0.85rem; transition: transform 0.15s; }
        .like-btn.liked .like-heart { transform: scale(1.25); }
        .like-count-text { font-size: 0.78rem; color: #9ca3af; }

        /* Empty */
        .fp-empty {
          background: white; border: 1px solid #e5e7eb;
          border-radius: 16px; padding: 3.5rem 2rem;
          text-align: center;
        }
        .fp-empty-icon { font-size: 2.5rem; margin-bottom: 0.75rem; }
        .fp-empty-title { font-size: 1rem; font-weight: 600; color: #374151; margin: 0 0 0.4rem; }
        .fp-empty-sub { font-size: 0.85rem; color: #9ca3af; margin: 0; }

        @media (max-width: 640px) {
          .fp-body { padding: 1rem 0.85rem 3rem; }
          .mood-chip span.mood-text { display: none; }
        }
      `}</style>

      <div className="fp">
        <Navbar fullName={profile?.full_name ?? null} role={profile?.role ?? 'employee'} />

        <div className="fp-body">

          {/* Header */}
          <div className="fp-header">
            <div>
              <h1 className="fp-title">News Feed</h1>
              <p className="fp-sub">Share updates, photos and moments with the team.</p>
            </div>
            <button className="fp-refresh" onClick={loadFeed}>↻ Refresh</button>
          </div>

          {/* Composer */}
          <div className="composer">
            <div className="composer-top">
              <Avatar name={profile?.full_name ?? null} size={38} />
              <textarea
                ref={textareaRef}
                className="composer-textarea"
                placeholder={`What's on your mind, ${profile?.full_name?.split(' ')[0] ?? 'there'}?`}
                value={content}
                onChange={handleContentChange}
                onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handlePost() }}
              />
            </div>

            {/* Mood chips */}
            <div className="composer-moods">
              <span className="mood-label">Mood</span>
              {MOODS.map(m => (
                <button
                  key={m.emoji}
                  className={`mood-chip${mood === m.emoji ? ' selected' : ''}`}
                  onClick={() => setMood(prev => prev === m.emoji ? null : m.emoji)}
                >
                  <span>{m.emoji}</span>
                  <span className="mood-text">{m.label}</span>
                </button>
              ))}
            </div>

            {/* Image input */}
            <div className="composer-image-row">
              {!showImageInput ? (
                <button
                  className={`image-toggle-btn${imageUrl ? ' has-image' : ''}`}
                  onClick={() => setShowImageInput(true)}
                >
                  <span>📷</span>
                  <span>{imageUrl ? 'Photo added' : 'Add a photo'}</span>
                </button>
              ) : (
                <div className="image-input-wrap">
                  <span style={{ fontSize: '0.85rem', flexShrink: 0 }}>🔗</span>
                  <input
                    placeholder="Paste an image URL (https://…)"
                    value={imageUrl}
                    onChange={e => { setImageUrl(e.target.value); setImagePreviewOk(false) }}
                    autoFocus
                  />
                  <button
                    className="image-clear-btn"
                    onClick={() => { setImageUrl(''); setShowImageInput(false); setImagePreviewOk(false) }}
                  >✕</button>
                </div>
              )}
            </div>

            {/* Live preview */}
            {imageUrl.trim() && (
              <div className="composer-preview">
                <img
                  src={imageUrl.trim()}
                  alt="Preview"
                  onLoad={() => setImagePreviewOk(true)}
                  onError={() => setImagePreviewOk(false)}
                  style={{ display: imagePreviewOk ? 'block' : 'none' }}
                />
                {!imagePreviewOk && (
                  <div style={{ padding: '1rem', fontSize: '0.8rem', color: '#9ca3af', textAlign: 'center' }}>
                    ⏳ Loading preview…
                  </div>
                )}
                {imagePreviewOk && <span className="preview-badge">PREVIEW</span>}
              </div>
            )}

            <div className="composer-footer">
              <span className={`char-count${charsLeft <= 20 ? ' danger' : charsLeft <= 80 ? ' warn' : ''}`}>
                {charsLeft} left
              </span>
              <button
                className="btn-post"
                onClick={handlePost}
                disabled={!content.trim() || posting}
              >
                {posting ? '⏳ Posting…' : '✦ Post'}
              </button>
            </div>
          </div>

          {/* Feed */}
          {posts.length === 0 ? (
            <div className="fp-empty">
              <div className="fp-empty-icon">📭</div>
              <p className="fp-empty-title">Nothing posted yet</p>
              <p className="fp-empty-sub">Be the first to share something with the team.</p>
            </div>
          ) : posts.map(post => {
            const postLikes = likes.filter(l => l.post_id === post.id)
            const userLiked = postLikes.some(l => l.user_id === userId)
            const isOwn = post.author_id === userId
            const moodData = MOODS.find(m => m.emoji === post.mood)
            const likeLabel = postLikes.length === 0
              ? 'Like'
              : postLikes.length === 1 ? '1 Like'
              : `${postLikes.length} Likes`

            return (
              <div key={post.id} className="post-card">
                <div className="post-card-header">
                  <div className="post-author" onClick={() => navigate('/profile/' + post.author_id)} style={{ cursor: 'pointer' }}>
                    <Avatar name={post.author?.full_name ?? null} size={38} />
                    <div>
                      <span className="post-author-name">{post.author?.full_name ?? 'InfoWall User'}</span>
                      <div className="post-author-meta">
                        <span className="post-author-role">{post.author?.role ?? ''}</span>
                        <div className="meta-dot" />
                        <span className="post-time">{timeAgo(post.created_at)}</span>
                      </div>
                    </div>
                  </div>
                  {isOwn && (
                    <button
                      className="post-delete"
                      onClick={() => handleDelete(post.id)}
                      disabled={deletingId === post.id}
                      title="Delete post"
                    >
                      {deletingId === post.id ? '…' : '✕'}
                    </button>
                  )}
                </div>

                {moodData && (
                  <div className="mood-badge">
                    <span>{moodData.emoji}</span>
                    <span>{moodData.label}</span>
                  </div>
                )}

                <p className="post-content">{post.content}</p>

                {post.image_url && (
                  <div className="post-image-wrap">
                    <img
                      src={post.image_url}
                      alt=""
                      loading="lazy"
                      onError={e => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none' }}
                    />
                  </div>
                )}

                <div className="post-footer">
                  <button
                    className={`like-btn${userLiked ? ' liked' : ''}`}
                    onClick={() => handleLike(post.id)}
                    disabled={togglingLike === post.id}
                  >
                    <span className="like-heart">{userLiked ? '❤️' : '🤍'}</span>
                    <span>{likeLabel}</span>
                  </button>
                </div>
              </div>
            )
          })}

        </div>
      </div>
    </>
  )
}

export default NewsFeedPage
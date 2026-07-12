import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

interface SearchResult {
  id: string
  type: 'post' | 'message' | 'feed_post' | 'comment'
  title: string
  preview: string
  meta: string
  navigateTo: string
  icon: string
}

interface Props {
  open: boolean
  onClose: () => void
  currentUserId: string | null
}

function highlight(text: string, query: string): string {
  if (!query.trim()) return text
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(`(${escaped})`, 'gi'), '«$1»')
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === query.toLowerCase()
          ? <mark key={i} style={{ background: 'rgba(75,172,198,0.25)', color: '#243F60', borderRadius: '2px', padding: '0 1px' }}>{p}</mark>
          : <span key={i}>{p}</span>
      )}
    </>
  )
}

function timeAgo(d: string): string {
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

export default function GlobalSearch({ open, onClose, currentUserId }: Props) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [activeFilter, setActiveFilter] = useState<'all' | 'posts' | 'messages' | 'feed' | 'comments'>('all')
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Focus input on open
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
      setQuery(''); setResults([]); setSelectedIdx(0); setActiveFilter('all')
    }
  }, [open])

  // Keyboard shortcut Cmd+K / Ctrl+K to close
  useEffect(() => {
    function h(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); if (open) onClose() }
      if (e.key === 'Escape' && open) onClose()
      if (e.key === 'ArrowDown' && open) { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, filteredResults.length - 1)) }
      if (e.key === 'ArrowUp' && open) { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)) }
      if (e.key === 'Enter' && open && filteredResults.length > 0) {
        e.preventDefault()
        handleSelect(filteredResults[selectedIdx])
      }
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [open, selectedIdx, results, activeFilter])

  const search = useCallback(async (q: string) => {
    if (!q.trim() || q.trim().length < 2) { setResults([]); setLoading(false); return }
    setLoading(true)

    const term = `%${q.trim()}%`

    const [
      { data: posts },
      { data: messages },
      { data: feedPosts },
      { data: comments },
    ] = await Promise.all([
      supabase.from('posts')
        .select('id, title, content, post_type, created_at, author:profiles!author_id(full_name)')
        .or(`title.ilike.${term},content.ilike.${term}`)
        .order('created_at', { ascending: false })
        .limit(8),

      currentUserId
        ? supabase.from('messages')
            .select(`id, content, created_at, conversation_id,
              conversation:conversations!conversation_id(
                user1:profiles!conversations_user1_id_fkey(full_name),
                user2:profiles!conversations_user2_id_fkey(full_name)
              )`)
            .ilike('content', term)
            .or(`conversation.user1_id.eq.${currentUserId},conversation.user2_id.eq.${currentUserId}`)
            .order('created_at', { ascending: false })
            .limit(6)
        : Promise.resolve({ data: [] }),

      supabase.from('feed_posts')
        .select('id, content, mood, created_at, author:profiles!author_id(full_name)')
        .ilike('content', term)
        .order('created_at', { ascending: false })
        .limit(6),

      supabase.from('post_comments')
        .select('id, content, created_at, post_id, post:posts!post_id(title), author:profiles!author_id(full_name)')
        .ilike('content', term)
        .order('created_at', { ascending: false })
        .limit(6),
    ])

    const r: SearchResult[] = []

    ;(posts ?? []).forEach((p: any) => {
      r.push({
        id: p.id, type: 'post',
        icon: p.post_type === 'news_event' ? '📅' : '📢',
        title: p.title,
        preview: p.content?.slice(0, 120) ?? '',
        meta: `${p.author?.full_name ?? 'Unknown'} · ${timeAgo(p.created_at)}`,
        navigateTo: '/dashboard',
      })
    })

    ;(messages ?? []).forEach((m: any) => {
      const conv = m.conversation
      const other = conv?.user1?.full_name === null ? conv?.user2?.full_name : conv?.user1?.full_name
      r.push({
        id: m.id, type: 'message',
        icon: '💬',
        title: `Message with ${other ?? 'someone'}`,
        preview: m.content,
        meta: timeAgo(m.created_at),
        navigateTo: `/messages`,
      })
    })

    ;(feedPosts ?? []).forEach((fp: any) => {
      r.push({
        id: fp.id, type: 'feed_post',
        icon: fp.mood ?? '📰',
        title: `Post by ${fp.author?.full_name ?? 'Unknown'}`,
        preview: fp.content?.slice(0, 120) ?? '',
        meta: timeAgo(fp.created_at),
        navigateTo: '/feed',
      })
    })

    ;(comments ?? []).forEach((c: any) => {
      r.push({
        id: c.id, type: 'comment',
        icon: '💬',
        title: `Reply in "${c.post?.title ?? 'a post'}"`,
        preview: c.content?.slice(0, 120) ?? '',
        meta: `${c.author?.full_name ?? 'Unknown'} · ${timeAgo(c.created_at)}`,
        navigateTo: '/dashboard',
      })
    })

    setResults(r)
    setSelectedIdx(0)
    setLoading(false)
  }, [currentUserId])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) { setResults([]); setLoading(false); return }
    setLoading(true)
    debounceRef.current = setTimeout(() => search(query), 280)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, search])

  function handleSelect(result: SearchResult) {
    navigate(result.navigateTo)
    onClose()
  }

  const filteredResults = results.filter(r => {
    if (activeFilter === 'all') return true
    if (activeFilter === 'posts') return r.type === 'post'
    if (activeFilter === 'messages') return r.type === 'message'
    if (activeFilter === 'feed') return r.type === 'feed_post'
    if (activeFilter === 'comments') return r.type === 'comment'
    return true
  })

  const typeLabels: Record<string, string> = {
    post: 'Announcement', message: 'Message', feed_post: 'Feed post', comment: 'Thread reply'
  }
  const typeBadgeColors: Record<string, { bg: string; color: string }> = {
    post: { bg: '#EEF4FB', color: '#365F91' },
    message: { bg: '#f0fdf4', color: '#16a34a' },
    feed_post: { bg: '#faf5ff', color: '#7c3aed' },
    comment: { bg: '#fff7ed', color: '#c2410c' },
  }

  const grouped: Record<string, SearchResult[]> = {}
  filteredResults.forEach(r => {
    if (!grouped[r.type]) grouped[r.type] = []
    grouped[r.type].push(r)
  })

  if (!open) return null

  return (
    <>
      <style>{`
        @keyframes gsOverlayIn { from{opacity:0} to{opacity:1} }
        @keyframes gsModalIn   { from{opacity:0;transform:translateY(-16px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }

        .gs-overlay {
          position:fixed;inset:0;z-index:600;
          background:rgba(0,0,0,0.45);backdrop-filter:blur(6px);
          display:flex;align-items:flex-start;justify-content:center;
          padding-top:clamp(60px,8vh,120px);
          animation:gsOverlayIn 0.15s ease;
        }

        .gs-modal {
          width:100%;max-width:660px;
          background:white;border-radius:18px;
          box-shadow:0 24px 64px rgba(0,0,0,0.2),0 0 0 1px rgba(0,0,0,0.06);
          overflow:hidden;
          animation:gsModalIn 0.2s cubic-bezier(0.34,1.1,0.64,1);
          display:flex;flex-direction:column;
          max-height:calc(100vh - clamp(80px,12vh,160px));
        }

        /* Search bar */
        .gs-input-row {
          display:flex;align-items:center;gap:0.75rem;
          padding:1rem 1.25rem;
          border-bottom:1px solid #f3f4f6;
          flex-shrink:0;
        }
        .gs-search-icon { font-size:1.05rem;color:#9CA3AF;flex-shrink:0; }
        .gs-input {
          flex:1;border:none;outline:none;font-size:1rem;
          color:#1A2B3C;font-family:inherit;background:transparent;
        }
        .gs-input::placeholder { color:#c4c9d4; }
        .gs-kbd {
          font-size:0.65rem;color:#9CA3AF;background:#f3f4f6;
          border:1px solid #e5e7eb;border-radius:5px;
          padding:0.18rem 0.45rem;font-family:monospace;flex-shrink:0;
        }
        .gs-clear { background:none;border:none;color:#c4c9d4;cursor:pointer;font-size:0.85rem;padding:0.2rem;border-radius:5px;flex-shrink:0;transition:all 0.12s; }
        .gs-clear:hover { background:#f3f4f6;color:#6b7280; }

        /* Filters */
        .gs-filters {
          display:flex;gap:0.35rem;padding:0.6rem 1.25rem;
          border-bottom:1px solid #f3f4f6;flex-shrink:0;
          overflow-x:auto;
        }
        .gs-filters::-webkit-scrollbar { display:none; }
        .gs-filter-btn {
          padding:0.28rem 0.75rem;border-radius:999px;
          border:1px solid #e5e7eb;background:white;
          font-size:0.75rem;font-weight:600;color:#6b7280;
          cursor:pointer;transition:all 0.12s;white-space:nowrap;font-family:inherit;
        }
        .gs-filter-btn:hover { border-color:#4BACC6;color:#243F60; }
        .gs-filter-btn.active { background:#EEF4FB;border-color:#4BACC6;color:#243F60; }

        /* Results */
        .gs-results { overflow-y:auto;flex:1; }
        .gs-results::-webkit-scrollbar { width:4px; }
        .gs-results::-webkit-scrollbar-thumb { background:#e5e7eb;border-radius:999px; }

        .gs-group-label {
          font-size:0.62rem;font-weight:800;color:#9CA3AF;
          text-transform:uppercase;letter-spacing:0.1em;
          padding:0.85rem 1.25rem 0.35rem;
          display:flex;align-items:center;gap:0.5rem;
        }
        .gs-group-label::after { content:'';flex:1;height:1px;background:#f3f4f6; }

        .gs-result-item {
          display:flex;align-items:flex-start;gap:0.75rem;
          padding:0.75rem 1.25rem;cursor:pointer;transition:background 0.1s;
          border-bottom:1px solid #fafafa;
        }
        .gs-result-item:last-child { border-bottom:none; }
        .gs-result-item:hover,.gs-result-item.selected { background:#EEF4FB; }

        .gs-result-icon {
          width:36px;height:36px;border-radius:9px;
          background:#f3f4f6;border:1px solid #e5e7eb;
          display:flex;align-items:center;justify-content:center;
          font-size:1rem;flex-shrink:0;margin-top:1px;
        }
        .gs-result-item.selected .gs-result-icon { background:#EEF4FB;border-color:#C5D9F1; }

        .gs-result-body { flex:1;min-width:0; }
        .gs-result-title { font-size:0.88rem;font-weight:700;color:#1A2B3C;line-height:1.3;margin-bottom:0.2rem; }
        .gs-result-preview { font-size:0.78rem;color:#6b7280;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:0.2rem; }
        .gs-result-meta { display:flex;align-items:center;gap:0.45rem; }
        .gs-type-badge { font-size:0.62rem;font-weight:700;padding:0.12rem 0.45rem;border-radius:4px;letter-spacing:0.04em;text-transform:uppercase; }
        .gs-result-time { font-size:0.68rem;color:#c4c9d4; }

        .gs-result-arrow { color:#c4c9d4;font-size:0.75rem;flex-shrink:0;align-self:center;transition:transform 0.12s; }
        .gs-result-item:hover .gs-result-arrow,.gs-result-item.selected .gs-result-arrow { transform:translateX(3px);color:#4BACC6; }

        /* Empty & loading states */
        .gs-empty { padding:2.5rem 1.25rem;text-align:center;color:#9CA3AF; }
        .gs-empty-icon { font-size:2.5rem;opacity:0.35;margin-bottom:0.5rem; }
        .gs-empty-title { font-size:0.95rem;font-weight:700;color:#374151;margin-bottom:0.25rem; }
        .gs-empty-sub { font-size:0.8rem; }

        .gs-loading { display:flex;align-items:center;justify-content:center;gap:0.6rem;padding:2rem;color:#9CA3AF;font-size:0.85rem; }
        @keyframes gsSpin { to{transform:rotate(360deg)} }
        .gs-spinner { width:16px;height:16px;border-radius:50%;border:2px solid #e5e7eb;border-top-color:#4BACC6;animation:gsSpin 0.8s linear infinite; }

        /* Footer */
        .gs-footer {
          display:flex;align-items:center;justify-content:space-between;
          padding:0.6rem 1.25rem;border-top:1px solid #f3f4f6;
          background:#fafafa;flex-shrink:0;
        }
        .gs-footer-keys { display:flex;align-items:center;gap:0.85rem; }
        .gs-footer-key { display:flex;align-items:center;gap:0.3rem;font-size:0.68rem;color:#9CA3AF; }
        .gs-footer-kbd { background:white;border:1px solid #e5e7eb;border-radius:4px;padding:0.12rem 0.4rem;font-family:monospace;font-size:0.65rem;color:#6b7280; }
        .gs-footer-count { font-size:0.72rem;color:#c4c9d4; }

        @media(max-width:700px) {
          .gs-overlay { padding-top:0;align-items:flex-end; }
          .gs-modal { border-radius:18px 18px 0 0;max-height:85vh; }
        }
      `}</style>

      <div className="gs-overlay" onClick={onClose}>
        <div className="gs-modal" onClick={e => e.stopPropagation()}>

          {/* Search input */}
          <div className="gs-input-row">
            <span className="gs-search-icon">🔍</span>
            <input
              ref={inputRef}
              className="gs-input"
              placeholder="Search posts, messages, feed, threads…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoComplete="off"
            />
            {query && <button className="gs-clear" onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus() }}>✕</button>}
            <kbd className="gs-kbd">Esc</kbd>
          </div>

          {/* Filters */}
          {(results.length > 0 || query) && (
            <div className="gs-filters">
              {([
                { id: 'all', label: 'All results' },
                { id: 'posts', label: '📢 Announcements' },
                { id: 'messages', label: '💬 Messages' },
                { id: 'feed', label: '📰 Feed' },
                { id: 'comments', label: '🧵 Threads' },
              ] as const).map(f => {
                const count = f.id === 'all' ? results.length
                  : f.id === 'posts' ? results.filter(r => r.type === 'post').length
                  : f.id === 'messages' ? results.filter(r => r.type === 'message').length
                  : f.id === 'feed' ? results.filter(r => r.type === 'feed_post').length
                  : results.filter(r => r.type === 'comment').length
                if (f.id !== 'all' && count === 0) return null
                return (
                  <button
                    key={f.id}
                    className={`gs-filter-btn${activeFilter === f.id ? ' active' : ''}`}
                    onClick={() => { setActiveFilter(f.id); setSelectedIdx(0) }}
                  >
                    {f.label} {count > 0 && `(${count})`}
                  </button>
                )
              })}
            </div>
          )}

          {/* Results */}
          <div className="gs-results" ref={listRef}>
            {!query.trim() ? (
              <div className="gs-empty">
                <div className="gs-empty-icon">🔍</div>
                <div className="gs-empty-title">Search InfoWall</div>
                <div className="gs-empty-sub">Find posts, messages, feed posts and thread replies</div>
              </div>
            ) : loading ? (
              <div className="gs-loading">
                <div className="gs-spinner" />
                Searching…
              </div>
            ) : filteredResults.length === 0 ? (
              <div className="gs-empty">
                <div className="gs-empty-icon">😶</div>
                <div className="gs-empty-title">No results for "{query}"</div>
                <div className="gs-empty-sub">Try different keywords or check your spelling</div>
              </div>
            ) : (
              Object.entries(grouped).map(([type, items]) => (
                <div key={type}>
                  <div className="gs-group-label">
                    {type === 'post' ? 'Announcements'
                      : type === 'message' ? 'Messages'
                      : type === 'feed_post' ? 'Feed posts'
                      : 'Thread replies'}
                  </div>
                  {items.map(result => {
                    const globalIdx = filteredResults.indexOf(result)
                    const colors = typeBadgeColors[result.type]
                    return (
                      <div
                        key={result.id}
                        className={`gs-result-item${globalIdx === selectedIdx ? ' selected' : ''}`}
                        onClick={() => handleSelect(result)}
                        onMouseEnter={() => setSelectedIdx(globalIdx)}
                      >
                        <div className="gs-result-icon">{result.icon}</div>
                        <div className="gs-result-body">
                          <div className="gs-result-title">
                            <HighlightedText text={result.title} query={query} />
                          </div>
                          {result.preview && (
                            <div className="gs-result-preview">
                              <HighlightedText text={result.preview} query={query} />
                            </div>
                          )}
                          <div className="gs-result-meta">
                            <span className="gs-type-badge" style={{ background: colors.bg, color: colors.color }}>
                              {typeLabels[result.type]}
                            </span>
                            <span className="gs-result-time">{result.meta}</span>
                          </div>
                        </div>
                        <span className="gs-result-arrow">›</span>
                      </div>
                    )
                  })}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="gs-footer">
            <div className="gs-footer-keys">
              <span className="gs-footer-key"><kbd className="gs-footer-kbd">↑↓</kbd> Navigate</span>
              <span className="gs-footer-key"><kbd className="gs-footer-kbd">↵</kbd> Open</span>
              <span className="gs-footer-key"><kbd className="gs-footer-kbd">Esc</kbd> Close</span>
            </div>
            {filteredResults.length > 0 && (
              <span className="gs-footer-count">{filteredResults.length} result{filteredResults.length !== 1 ? 's' : ''}</span>
            )}
          </div>

        </div>
      </div>
    </>
  )
}
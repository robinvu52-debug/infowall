import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { generateSummary } from '../lib/summarize'

interface Profile {
  id: string
  full_name: string | null
  role: string
  department_id: string | null
  department_name?: string | null
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

interface PostReaction {
  post_id: string
  emoji: string
  user_id: string
}

type SectionId = 'global' | 'department' | 'events'

const QUICK_EMOJIS = ['👍', '❤️', '😂', '👀', '✅', '🎉']

function timeAgo(d: string): string {
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

function formatDate(d: string): string {
  const date = new Date(d)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
  if (date >= today) return 'Today'
  if (date >= yesterday) return 'Yesterday'
  return date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
}

function initials(name: string | null): string {
  if (!name) return '?'
  return name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase()
}

function Avatar({ name, size = 32 }: { name: string | null; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'linear-gradient(135deg, #4F81BD, #243F60)',
      color: 'white', fontSize: size * 0.33, fontWeight: 700,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>{initials(name)}</div>
  )
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [reactions, setReactions] = useState<PostReaction[]>([])
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState<SectionId>('global')
  const [activePostId, setActivePostId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [emojiPickerFor, setEmojiPickerFor] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { navigate('/login'); return }
      setUserId(user.id)

      const [{ data: p }, { data: pp }, { data: acks }, { data: rxns }] = await Promise.all([
        supabase.from('profiles').select('*, department:departments(name)').eq('id', user.id).single(),
        supabase.from('posts').select('*, author:profiles!author_id(full_name)').order('created_at', { ascending: false }),
        supabase.from('acknowledgements').select('post_id').eq('user_id', user.id),
        supabase.from('post_reactions').select('post_id, emoji, user_id'),
      ])

      setProfile(p ? { ...p, department_name: (p as any).department?.name } : null)
      setPosts(pp ?? [])
      setAcknowledgedIds(new Set((acks ?? []).map(a => a.post_id)))
      setReactions(rxns ?? [])
      setLoading(false)
    }
    load()

    function closeEmoji(e: MouseEvent) {
      if (!(e.target as Element).closest('.emoji-picker-wrap')) setEmojiPickerFor(null)
    }
    document.addEventListener('click', closeEmoji)
    return () => document.removeEventListener('click', closeEmoji)
  }, [navigate])

  const q = search.toLowerCase()
  const match = (p: Post) => !q || p.title.toLowerCase().includes(q) || (p.content ?? '').toLowerCase().includes(q)

  const globalPosts     = useMemo(() => posts.filter(p => p.recipient_id === null && p.department_id === null && p.post_type === 'announcement' && match(p)), [posts, q])
  const departmentPosts = useMemo(() => posts.filter(p => p.recipient_id === null && p.department_id !== null && p.department_id === profile?.department_id && match(p)), [posts, profile, q])
  const eventPosts      = useMemo(() => posts.filter(p => p.recipient_id === null && p.post_type === 'news_event' && match(p)), [posts, q])

  const sectionPosts: Record<SectionId, Post[]> = {
    global: globalPosts,
    department: departmentPosts,
    events: eventPosts,
  }

  const unreadCount = (pp: Post[]) => pp.filter(p => p.must_read && !acknowledgedIds.has(p.id)).length

  const sections: { id: SectionId; icon: string; label: string }[] = [
    { id: 'global',     icon: '📢', label: 'Global Announcements' },
    { id: 'department', icon: '🏢', label: profile?.department_name ?? 'Department' },
    { id: 'events',     icon: '📅', label: 'News & Events' },
  ]

  const currentPosts = sectionPosts[activeSection]
  const activePost = activePostId ? posts.find(p => p.id === activePostId) ?? null : null

  function getReactions(postId: string) {
    const r = reactions.filter(r => r.post_id === postId)
    return QUICK_EMOJIS.map(emoji => ({
      emoji, count: r.filter(x => x.emoji === emoji).length,
      reacted: r.some(x => x.emoji === emoji && x.user_id === userId),
    })).filter(g => g.count > 0)
  }

  async function toggleReaction(postId: string, emoji: string) {
    if (!userId) return
    const already = reactions.some(r => r.post_id === postId && r.user_id === userId && r.emoji === emoji)
    if (already) {
      await supabase.from('post_reactions').delete().eq('post_id', postId).eq('user_id', userId).eq('emoji', emoji)
      setReactions(prev => prev.filter(r => !(r.post_id === postId && r.user_id === userId && r.emoji === emoji)))
    } else {
      await supabase.from('post_reactions').insert({ post_id: postId, user_id: userId, emoji })
      setReactions(prev => [...prev, { post_id: postId, user_id: userId, emoji }])
    }
    setEmojiPickerFor(null)
  }

  async function handleAcknowledge(postId: string) {
    if (!userId) return
    const { error } = await supabase.from('acknowledgements').insert({ post_id: postId, user_id: userId })
    if (!error) setAcknowledgedIds(prev => new Set(prev).add(postId))
  }

  async function saveEdit(postId: string) {
    if (!editTitle.trim()) return
    setSavingEdit(true)
    const { error } = await supabase.from('posts').update({ title: editTitle.trim(), content: editContent.trim() }).eq('id', postId)
    if (!error) {
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, title: editTitle.trim(), content: editContent.trim() } : p))
      setEditingId(null)
    }
    setSavingEdit(false)
  }

  async function handleDelete(postId: string) {
    if (!window.confirm('Delete this post?')) return
    setDeletingId(postId)
    await supabase.from('posts').delete().eq('id', postId)
    setPosts(prev => prev.filter(p => p.id !== postId))
    if (activePostId === postId) setActivePostId(null)
    setDeletingId(null)
  }

  async function handleSignOut() {
    await supabase.auth.signOut(); navigate('/login')
  }

  function groupByDate(pp: Post[]): { label: string; posts: Post[] }[] {
    const groups: Record<string, Post[]> = {}
    pp.forEach(p => {
      const label = formatDate(p.created_at)
      if (!groups[label]) groups[label] = []
      groups[label].push(p)
    })
    return Object.entries(groups).map(([label, posts]) => ({ label, posts }))
  }

  const pendingMustRead = posts.filter(p => p.must_read && !acknowledgedIds.has(p.id)).length
  const todayCount = posts.filter(p => new Date(p.created_at).toDateString() === new Date().toDateString()).length
  const canManagePost = (post: Post) => post.author_id === userId || profile?.role === 'admin'

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#F2F4F7', color: '#7A8899', fontFamily: 'Nunito, sans-serif' }}>
      Loading…
    </div>
  )

  return (
    <>
      <style>{`
        @keyframes slideInLeft { from{opacity:0;transform:translateX(-12px)} to{opacity:1;transform:translateX(0)} }
        @keyframes slideInRight { from{opacity:0;transform:translateX(12px)} to{opacity:1;transform:translateX(0)} }
        @keyframes fadeInUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes emojiPop { from{opacity:0;transform:translateY(6px) scale(0.9)} to{opacity:1;transform:translateY(0) scale(1)} }

        .app-shell { display:flex; height:100vh; overflow:hidden; font-family:'Nunito','Segoe UI',system-ui,sans-serif; background:#F2F4F7; }

        /* Sidebar */
        .sidebar { width:${sidebarOpen ? '260px' : '0px'}; min-width:${sidebarOpen ? '260px' : '0px'}; height:100vh; display:flex; flex-direction:column; background:#1B2B3A; color:white; transition:all 0.25s ease; overflow:hidden; flex-shrink:0; }

        .sidebar-header { padding:1rem 1.1rem 0.75rem; border-bottom:1px solid rgba(255,255,255,0.06); flex-shrink:0; }
        .sidebar-workspace { display:flex; align-items:center; gap:0.6rem; margin-bottom:0.6rem; }
        .sidebar-logo { width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#4BACC6,#365F91);display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:900;color:white;flex-shrink:0; }
        .sidebar-workspace-name { font-size:0.95rem;font-weight:800;color:white;letter-spacing:-0.01em;flex:1; }

        .sidebar-search { display:flex;align-items:center;gap:0.5rem;background:rgba(255,255,255,0.08);border-radius:8px;padding:0.45rem 0.75rem;cursor:pointer;transition:background 0.15s; }
        .sidebar-search:hover { background:rgba(255,255,255,0.12); }
        .sidebar-search input { background:transparent;border:none;outline:none;color:rgba(255,255,255,0.7);font-size:0.82rem;font-family:inherit;width:100%; }
        .sidebar-search input::placeholder { color:rgba(255,255,255,0.4); }

        .sidebar-body { flex:1;overflow-y:auto;padding:0.75rem 0; }
        .sidebar-body::-webkit-scrollbar{width:3px}
        .sidebar-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:999px}

        .sidebar-section-label { font-size:0.65rem;font-weight:800;letter-spacing:0.12em;color:rgba(255,255,255,0.4);text-transform:uppercase;padding:0.6rem 1.1rem 0.3rem; }

        .sidebar-item { display:flex;align-items:center;gap:0.65rem;padding:0.42rem 1.1rem;cursor:pointer;transition:background 0.12s;border-radius:6px;margin:0 0.4rem;position:relative; }
        .sidebar-item:hover { background:rgba(255,255,255,0.08); }
        .sidebar-item.active { background:rgba(79,129,189,0.25); }
        .sidebar-item-icon { font-size:0.9rem;width:20px;text-align:center;flex-shrink:0; }
        .sidebar-item-label { font-size:0.88rem;font-weight:500;color:rgba(255,255,255,0.75);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .sidebar-item.active .sidebar-item-label { color:white;font-weight:700; }
        .sidebar-badge { background:#C0504D;color:white;font-size:0.65rem;font-weight:800;min-width:18px;height:18px;border-radius:999px;display:flex;align-items:center;justify-content:center;padding:0 4px;flex-shrink:0; }

        .sidebar-divider { height:1px;background:rgba(255,255,255,0.06);margin:0.5rem 1.1rem; }

        .sidebar-nav-item { display:flex;align-items:center;gap:0.65rem;padding:0.42rem 1.1rem;cursor:pointer;transition:background 0.12s;border-radius:6px;margin:0 0.4rem;background:none;border:none;font-family:inherit;width:calc(100% - 0.8rem);text-align:left; }
        .sidebar-nav-item:hover { background:rgba(255,255,255,0.08); }
        .sidebar-nav-icon { font-size:0.9rem;width:20px;text-align:center;color:rgba(255,255,255,0.55); }
        .sidebar-nav-label { font-size:0.85rem;font-weight:500;color:rgba(255,255,255,0.6); }

        .sidebar-footer { padding:0.75rem 1.1rem;border-top:1px solid rgba(255,255,255,0.06);flex-shrink:0;display:flex;align-items:center;gap:0.65rem; }
        .sidebar-user-name { font-size:0.82rem;font-weight:700;color:rgba(255,255,255,0.85);display:block; }
        .sidebar-user-role { font-size:0.7rem;color:rgba(255,255,255,0.4);text-transform:capitalize;display:block; }
        .sidebar-signout { margin-left:auto;background:none;border:none;color:rgba(255,255,255,0.3);font-size:0.75rem;cursor:pointer;padding:0.25rem 0.5rem;border-radius:5px;transition:all 0.12s;font-family:inherit; }
        .sidebar-signout:hover { background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.7); }

        /* Main */
        .main-area { flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden; }

        .section-header { display:flex;align-items:center;gap:0.75rem;padding:0.85rem 1.5rem;background:white;border-bottom:1px solid #e2e6ea;flex-shrink:0;box-shadow:0 1px 3px rgba(0,0,0,0.05); }
        .section-header-toggle { background:none;border:none;cursor:pointer;color:#7A8899;font-size:1.1rem;padding:0.2rem;border-radius:5px;transition:all 0.12s; }
        .section-header-toggle:hover { background:#f0f2f5;color:#365F91; }
        .section-header-icon { font-size:1.1rem; }
        .section-header-title { font-size:1.05rem;font-weight:800;color:#1B2B3A;flex:1; }
        .section-header-sub { font-size:0.78rem;color:#7A8899; }
        .section-header-actions { display:flex;align-items:center;gap:0.5rem; }
        .header-action-btn { display:flex;align-items:center;gap:0.35rem;padding:0.35rem 0.75rem;background:#f2f4f7;border:1px solid #e2e6ea;border-radius:7px;font-size:0.78rem;font-weight:600;color:#4A5568;cursor:pointer;transition:all 0.12s;font-family:inherit; }
        .header-action-btn:hover { background:#e8ecf0;border-color:#cdd2d8; }

        /* Stats bar */
        .stats-bar { display:flex;gap:0.75rem;padding:0.85rem 1.5rem;background:#f8f9fb;border-bottom:1px solid #e2e6ea;flex-shrink:0; }
        .stat-chip { display:flex;align-items:center;gap:0.4rem;background:white;border:1px solid #e2e6ea;border-radius:8px;padding:0.4rem 0.85rem;font-size:0.78rem;font-weight:600;color:#4A5568; }
        .stat-chip.alert { background:#FEF2F2;border-color:#F4BDBB;color:#C0504D; }

        .posts-area { flex:1;overflow-y:auto; }
        .posts-area::-webkit-scrollbar{width:5px}
        .posts-area::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:999px}

        /* Search results */
        .search-results-bar { padding:0.5rem 1.5rem;background:#EEF4FB;border-bottom:1px solid #C5D9F1;font-size:0.78rem;color:#365F91;font-weight:600;display:flex;align-items:center;justify-content:space-between;flex-shrink:0; }
        .search-clear-btn { background:none;border:none;color:#4F81BD;font-size:0.75rem;font-weight:600;cursor:pointer;font-family:inherit; }
        .search-clear-btn:hover { text-decoration:underline; }

        /* Date divider */
        .date-divider { display:flex;align-items:center;gap:0.75rem;padding:1rem 1.5rem 0.5rem; }
        .date-divider-line { flex:1;height:1px;background:#e2e6ea; }
        .date-divider-label { font-size:0.72rem;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.07em;white-space:nowrap; }

        /* Post row */
        .post-row { display:flex;gap:0.85rem;padding:0.6rem 1.5rem;cursor:pointer;transition:background 0.1s;position:relative;animation:fadeInUp 0.25s ease both; }
        .post-row:hover { background:rgba(27,43,58,0.04); }
        .post-row.active-post { background:#EEF4FB; }
        .post-row.unread { border-left:3px solid #4BACC6; }
        .post-row:not(.unread) { border-left:3px solid transparent; }
        .post-row-left { padding-top:0.1rem; }
        .post-row-body { flex:1;min-width:0; }
        .post-row-top { display:flex;align-items:baseline;gap:0.5rem;margin-bottom:0.25rem; }
        .post-row-author { font-size:0.88rem;font-weight:800;color:#1B2B3A; }
        .post-row-time { font-size:0.72rem;color:#9CA3AF; }
        .post-row-badges { display:flex;gap:0.3rem;margin-bottom:0.3rem;flex-wrap:wrap; }
        .post-badge { font-size:0.62rem;font-weight:800;padding:0.18rem 0.55rem;border-radius:4px;letter-spacing:0.06em;text-transform:uppercase; }
        .post-badge-must { background:#FEF2F2;color:#C0504D;border:1px solid #F4BDBB; }
        .post-badge-acked { background:#EEF4E4;color:#4B6B1A;border:1px solid #C6DCA0; }
        .post-badge-event { background:#F3EEF9;color:#8064A2;border:1px solid #D9CCF0; }
        .post-row-title { font-size:0.9rem;font-weight:700;color:#1B2B3A;margin-bottom:0.2rem;line-height:1.3; }
        .post-row-preview { font-size:0.82rem;color:#7A8899;line-height:1.5;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden; }

        /* Reactions */
        .post-row-reactions { display:flex;gap:0.3rem;margin-top:0.4rem;flex-wrap:wrap; }
        .reaction-chip { display:flex;align-items:center;gap:0.3rem;background:#F2F4F7;border:1px solid #E2E6EA;border-radius:999px;padding:0.18rem 0.55rem;font-size:0.78rem;font-weight:600;color:#4A5568;cursor:pointer;transition:all 0.12s; }
        .reaction-chip:hover { background:#EEF4FB;border-color:#C5D9F1; }
        .reaction-chip.mine { background:#EEF4FB;border-color:#4F81BD;color:#365F91; }

        /* Hover actions */
        .post-row-hover-actions { position:absolute;right:1.5rem;top:50%;transform:translateY(-50%);display:none;background:white;border:1px solid #e2e6ea;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.1);padding:0.2rem;gap:0.2rem;flex-direction:row; }
        .post-row:hover .post-row-hover-actions { display:flex; }
        .hover-action-btn { background:none;border:none;cursor:pointer;padding:0.35rem 0.4rem;border-radius:6px;font-size:0.85rem;transition:background 0.1s;color:#7A8899; }
        .hover-action-btn:hover { background:#f2f4f7;color:#365F91; }

        /* Post detail */
        .post-detail { height:100%;display:flex;flex-direction:column;animation:slideInRight 0.22s ease; }
        .post-detail-header { display:flex;align-items:flex-start;gap:0.75rem;padding:1.25rem 1.75rem;background:white;border-bottom:1px solid #e2e6ea;flex-shrink:0; }
        .post-detail-back { background:none;border:none;cursor:pointer;color:#7A8899;font-size:0.82rem;font-weight:600;padding:0.35rem 0.7rem;border-radius:7px;transition:all 0.12s;font-family:inherit;white-space:nowrap; }
        .post-detail-back:hover { background:#f2f4f7;color:#365F91; }
        .post-detail-author-row { display:flex;align-items:center;gap:0.65rem;margin-bottom:0.35rem; }
        .post-detail-author-name { font-size:0.9rem;font-weight:800;color:#1B2B3A; }
        .post-detail-time { font-size:0.75rem;color:#9CA3AF; }
        .post-detail-actions { display:flex;gap:0.4rem;flex-shrink:0; }
        .detail-action-btn { background:#f2f4f7;border:1px solid #e2e6ea;border-radius:7px;padding:0.38rem 0.75rem;font-size:0.78rem;font-weight:600;color:#4A5568;cursor:pointer;transition:all 0.12s;font-family:inherit; }
        .detail-action-btn:hover { background:#e8ecf0; }
        .detail-action-btn.danger { color:#C0504D; }
        .detail-action-btn.danger:hover { background:#FEF2F2;border-color:#F4BDBB; }
        .detail-action-btn.primary { background:#365F91;color:white;border-color:#365F91; }
        .detail-action-btn.primary:hover { background:#243F60; }

        .post-detail-body { flex:1;overflow-y:auto;padding:1.75rem; }
        .post-detail-body::-webkit-scrollbar{width:4px}
        .post-detail-body::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:999px}
        .post-detail-badges { display:flex;gap:0.4rem;margin-bottom:1rem;flex-wrap:wrap; }
        .post-detail-title { font-size:1.4rem;font-weight:800;color:#1B2B3A;margin-bottom:0.85rem;line-height:1.25;letter-spacing:-0.01em; }

        .post-detail-ai { display:flex;align-items:flex-start;gap:0.5rem;background:#EEF4FB;border:1px solid #C5D9F1;border-radius:9px;padding:0.7rem 0.9rem;margin-bottom:1rem;font-size:0.82rem;color:#365F91;line-height:1.55; }
        .post-detail-ai-icon { color:#4BACC6;flex-shrink:0;margin-top:1px; }
        .post-detail-ai-label { font-weight:800;margin-right:0.3rem; }
        .post-detail-content { font-size:0.95rem;color:#374151;line-height:1.8;white-space:pre-wrap;word-break:break-word;margin-bottom:1.5rem; }

        .must-read-cta { background:#FEF2F2;border:1px solid #F4BDBB;border-radius:11px;padding:1rem 1.25rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:1.25rem;flex-wrap:wrap; }
        .must-read-cta-text strong { font-size:0.9rem;color:#C0504D;display:block;margin-bottom:0.15rem; }
        .must-read-cta-text span { font-size:0.78rem;color:rgba(192,80,77,0.75); }

        .edit-form { display:flex;flex-direction:column;gap:0.75rem;margin-bottom:1.5rem; }
        .edit-input { width:100%;padding:0.65rem 0.85rem;border:1.5px solid #4F81BD;border-radius:9px;color:#1B2B3A;font-size:0.95rem;font-family:inherit;background:white;outline:none;box-sizing:border-box; }
        .edit-textarea { width:100%;min-height:140px;padding:0.65rem 0.85rem;border:1.5px solid #4F81BD;border-radius:9px;color:#1B2B3A;font-size:0.88rem;font-family:inherit;line-height:1.65;resize:vertical;background:white;outline:none;box-sizing:border-box; }
        .edit-actions { display:flex;justify-content:flex-end;gap:0.5rem; }

        .reactions-section { border-top:1px solid #f0f2f5;padding-top:1rem; }
        .reactions-label { font-size:0.72rem;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:0.6rem; }
        .reactions-row { display:flex;gap:0.4rem;flex-wrap:wrap;align-items:center; }
        .reaction-btn { display:flex;align-items:center;gap:0.35rem;background:#F2F4F7;border:1px solid #E2E6EA;border-radius:999px;padding:0.28rem 0.75rem;font-size:0.85rem;font-weight:700;color:#4A5568;cursor:pointer;transition:all 0.15s; }
        .reaction-btn:hover { background:#EEF4FB;border-color:#4F81BD;color:#365F91; }
        .reaction-btn.mine { background:#EEF4FB;border-color:#4F81BD;color:#365F91;font-weight:800; }
        .r-count { font-size:0.78rem; }

        .emoji-picker-wrap { position:relative;display:inline-block; }
        .add-reaction-btn { display:flex;align-items:center;gap:0.3rem;background:#F2F4F7;border:1px dashed #D1D5DB;border-radius:999px;padding:0.28rem 0.75rem;font-size:0.82rem;font-weight:600;color:#9CA3AF;cursor:pointer;transition:all 0.12s; }
        .add-reaction-btn:hover { background:#EEF4FB;border-color:#4F81BD;color:#365F91; }
        .emoji-picker { position:absolute;bottom:calc(100% + 8px);left:0;background:white;border:1px solid #e2e6ea;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.12);padding:0.5rem;display:flex;gap:0.25rem;flex-wrap:wrap;z-index:50;animation:emojiPop 0.18s ease; }
        .emoji-opt { width:36px;height:36px;border-radius:8px;border:none;background:transparent;font-size:1.15rem;cursor:pointer;transition:background 0.1s;display:flex;align-items:center;justify-content:center; }
        .emoji-opt:hover { background:#f2f4f7; }

        /* Empty */
        .empty-state { display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:0.75rem;color:#9CA3AF;padding:3rem;text-align:center; }
        .empty-state-icon { font-size:2.5rem;opacity:0.5; }
        .empty-state-title { font-size:1rem;font-weight:700;color:#374151; }
        .empty-state-sub { font-size:0.85rem; }

        @media(max-width:768px) {
          .sidebar { position:fixed;z-index:100;height:100vh; }
          .section-header { padding:0.75rem 1rem; }
          .post-row { padding:0.6rem 1rem; }
          .post-detail-body { padding:1rem; }
          .stats-bar { padding:0.6rem 1rem; }
        }
      `}</style>

      <div className="app-shell">

        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-header">
            <div className="sidebar-workspace">
              <div className="sidebar-logo">IW</div>
              <span className="sidebar-workspace-name">InfoWall</span>
            </div>
            <div className="sidebar-search">
              <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)' }}>🔍</span>
              <input
                placeholder="Search posts…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <span onClick={() => setSearch('')} style={{ cursor: 'pointer', fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)' }}>✕</span>
              )}
            </div>
          </div>

          <div className="sidebar-body">
            <div className="sidebar-section-label">Channels</div>
            {sections.map(sec => {
              const unread = unreadCount(sectionPosts[sec.id])
              const count = sectionPosts[sec.id].length
              return (
                <div
                  key={sec.id}
                  className={`sidebar-item${activeSection === sec.id ? ' active' : ''}`}
                  onClick={() => { setActiveSection(sec.id); setActivePostId(null) }}
                >
                  <span className="sidebar-item-icon">{sec.icon}</span>
                  <span className="sidebar-item-label">{sec.label}</span>
                  {unread > 0 && <span className="sidebar-badge">{unread}</span>}
                  {unread === 0 && count > 0 && (
                    <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', fontWeight: 600 }}>{count}</span>
                  )}
                </div>
              )
            })}

            <div className="sidebar-divider" />
            <div className="sidebar-section-label">Navigate</div>

            <button className="sidebar-nav-item" onClick={() => navigate('/messages')}>
              <span className="sidebar-nav-icon">💬</span>
              <span className="sidebar-nav-label">Direct Messages</span>
            </button>

            <button className="sidebar-nav-item" onClick={() => navigate('/feed')}>
              <span className="sidebar-nav-icon">📰</span>
              <span className="sidebar-nav-label">News Feed</span>
            </button>

            {['hr', 'manager', 'admin'].includes(profile?.role ?? '') && (
              <button className="sidebar-nav-item" onClick={() => navigate('/create-post')}>
                <span className="sidebar-nav-icon">✏️</span>
                <span className="sidebar-nav-label">Create Post</span>
              </button>
            )}

            {profile?.role === 'admin' && (
              <button className="sidebar-nav-item" onClick={() => navigate('/admin')}>
                <span className="sidebar-nav-icon">⚙️</span>
                <span className="sidebar-nav-label">Admin Panel</span>
              </button>
            )}

            <button className="sidebar-nav-item" onClick={() => navigate(`/profile/${userId}`)}>
              <span className="sidebar-nav-icon">👤</span>
              <span className="sidebar-nav-label">My Profile</span>
            </button>
          </div>

          <div className="sidebar-footer">
            <Avatar name={profile?.full_name ?? null} size={30} />
            <div>
              <span className="sidebar-user-name">{profile?.full_name ?? '—'}</span>
              <span className="sidebar-user-role">{profile?.role}</span>
            </div>
            <button className="sidebar-signout" onClick={handleSignOut} title="Sign out">⏻</button>
          </div>
        </aside>

        {/* Main */}
        <div className="main-area">
          <div className="section-header">
            <button className="section-header-toggle" onClick={() => setSidebarOpen(o => !o)}>☰</button>
            <span className="section-header-icon">{sections.find(s => s.id === activeSection)?.icon}</span>
            <div style={{ flex: 1 }}>
              <div className="section-header-title">
                {activeSection === 'department' && profile?.department_name
                  ? profile.department_name
                  : sections.find(s => s.id === activeSection)?.label}
              </div>
              <div className="section-header-sub">
                {currentPosts.length} {currentPosts.length === 1 ? 'post' : 'posts'}
              </div>
            </div>
            <div className="section-header-actions">
              {activePost && (
                <button className="header-action-btn" onClick={() => setActivePostId(null)}>← Back to list</button>
              )}
              {['hr', 'manager', 'admin'].includes(profile?.role ?? '') && (
                <button className="header-action-btn" onClick={() => navigate('/create-post')}>✏️ New post</button>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="stats-bar">
            <div className={`stat-chip${pendingMustRead > 0 ? ' alert' : ''}`}>
              ⚠ {pendingMustRead} pending must-read
            </div>
            <div className="stat-chip">📋 {posts.length} total posts</div>
            <div className="stat-chip">📅 {todayCount} today</div>
          </div>

          {search && (
            <div className="search-results-bar">
              <span>Results for "<strong>{search}</strong>"</span>
              <button className="search-clear-btn" onClick={() => setSearch('')}>Clear</button>
            </div>
          )}

          <div className="posts-area">
            {activePost ? (
              <div className="post-detail">
                <div className="post-detail-header">
                  <button className="post-detail-back" onClick={() => setActivePostId(null)}>← Back</button>
                  <div style={{ flex: 1 }}>
                    <div className="post-detail-author-row">
                      <Avatar name={activePost.author?.full_name ?? null} size={28} />
                      <span className="post-detail-author-name">{activePost.author?.full_name ?? 'InfoWall'}</span>
                      <span className="post-detail-time">{timeAgo(activePost.created_at)}</span>
                    </div>
                  </div>
                  {canManagePost(activePost) && !editingId && (
                    <div className="post-detail-actions">
                      <button className="detail-action-btn" onClick={() => { setEditingId(activePost.id); setEditTitle(activePost.title); setEditContent(activePost.content ?? '') }}>✎ Edit</button>
                      <button className="detail-action-btn danger" onClick={() => handleDelete(activePost.id)} disabled={deletingId === activePost.id}>
                        {deletingId === activePost.id ? '…' : '🗑 Delete'}
                      </button>
                    </div>
                  )}
                </div>

                <div className="post-detail-body">
                  <div className="post-detail-badges">
                    {activePost.must_read && !acknowledgedIds.has(activePost.id) && <span className="post-badge post-badge-must">Must-read</span>}
                    {activePost.must_read && acknowledgedIds.has(activePost.id) && <span className="post-badge post-badge-acked">✓ Acknowledged</span>}
                    {activePost.post_type === 'news_event' && <span className="post-badge post-badge-event">Event</span>}
                  </div>

                  {editingId === activePost.id ? (
                    <div className="edit-form">
                      <input className="edit-input" value={editTitle} onChange={e => setEditTitle(e.target.value)} placeholder="Title" />
                      <textarea className="edit-textarea" value={editContent} onChange={e => setEditContent(e.target.value)} placeholder="Content" />
                      <div className="edit-actions">
                        <button className="detail-action-btn" onClick={() => setEditingId(null)}>Cancel</button>
                        <button className="detail-action-btn primary" onClick={() => saveEdit(activePost.id)} disabled={savingEdit}>
                          {savingEdit ? 'Saving…' : 'Save changes'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <h2 className="post-detail-title">{activePost.title}</h2>
                      {generateSummary(activePost.content) && (
                        <div className="post-detail-ai">
                          <span className="post-detail-ai-icon">✦</span>
                          <span><span className="post-detail-ai-label">AI Summary — </span>{generateSummary(activePost.content)}</span>
                        </div>
                      )}
                      <p className="post-detail-content">{activePost.content}</p>
                    </>
                  )}

                  {activePost.must_read && !acknowledgedIds.has(activePost.id) && (
                    <div className="must-read-cta">
                      <div className="must-read-cta-text">
                        <strong>⚠ Acknowledgement required</strong>
                        <span>You must mark this post as read to confirm you have seen it.</span>
                      </div>
                      <button className="detail-action-btn primary" onClick={() => handleAcknowledge(activePost.id)}>✓ Mark as read</button>
                    </div>
                  )}

                  <div className="reactions-section">
                    <div className="reactions-label">Reactions</div>
                    <div className="reactions-row">
                      {getReactions(activePost.id).map(r => (
                        <button key={r.emoji} className={`reaction-btn${r.reacted ? ' mine' : ''}`} onClick={() => toggleReaction(activePost.id, r.emoji)}>
                          <span>{r.emoji}</span><span className="r-count">{r.count}</span>
                        </button>
                      ))}
                      <div className="emoji-picker-wrap">
                        <button className="add-reaction-btn" onClick={e => { e.stopPropagation(); setEmojiPickerFor(emojiPickerFor === activePost.id ? null : activePost.id) }}>
                          😊 Add reaction
                        </button>
                        {emojiPickerFor === activePost.id && (
                          <div className="emoji-picker">
                            {QUICK_EMOJIS.map(e => (
                              <button key={e} className="emoji-opt" onClick={() => toggleReaction(activePost.id, e)}>{e}</button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              currentPosts.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">{sections.find(s => s.id === activeSection)?.icon ?? '📭'}</div>
                  <div className="empty-state-title">{search ? 'No results found' : 'Nothing here yet'}</div>
                  <div className="empty-state-sub">{search ? `No posts match "${search}"` : 'Posts will appear here when published.'}</div>
                </div>
              ) : (
                groupByDate(currentPosts).map(group => (
                  <div key={group.label}>
                    <div className="date-divider">
                      <div className="date-divider-line" />
                      <div className="date-divider-label">{group.label}</div>
                      <div className="date-divider-line" />
                    </div>
                    {group.posts.map((post, i) => {
                      const postReactions = getReactions(post.id)
                      const isUnread = post.must_read && !acknowledgedIds.has(post.id)
                      return (
                        <div
                          key={post.id}
                          className={`post-row${activePostId === post.id ? ' active-post' : ''}${isUnread ? ' unread' : ''}`}
                          style={{ animationDelay: `${i * 0.04}s` }}
                          onClick={() => setActivePostId(post.id)}
                        >
                          <div className="post-row-left">
                            <Avatar name={post.author?.full_name ?? null} size={34} />
                          </div>
                          <div className="post-row-body">
                            <div className="post-row-top">
                              <span className="post-row-author">{post.author?.full_name ?? 'InfoWall'}</span>
                              <span className="post-row-time">{timeAgo(post.created_at)}</span>
                            </div>
                            <div className="post-row-badges">
                              {isUnread && <span className="post-badge post-badge-must">Must-read</span>}
                              {post.must_read && acknowledgedIds.has(post.id) && <span className="post-badge post-badge-acked">✓ Done</span>}
                              {post.post_type === 'news_event' && <span className="post-badge post-badge-event">Event</span>}
                            </div>
                            <div className="post-row-title">{post.title}</div>
                            <div className="post-row-preview">{post.content}</div>
                            {postReactions.length > 0 && (
                              <div className="post-row-reactions">
                                {postReactions.map(r => (
                                  <div key={r.emoji} className={`reaction-chip${r.reacted ? ' mine' : ''}`} onClick={e => { e.stopPropagation(); toggleReaction(post.id, r.emoji) }}>
                                    {r.emoji} <span>{r.count}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="post-row-hover-actions" onClick={e => e.stopPropagation()}>
                            <div className="emoji-picker-wrap">
                              <button className="hover-action-btn" onClick={e => { e.stopPropagation(); setEmojiPickerFor(emojiPickerFor === post.id ? null : post.id) }}>😊</button>
                              {emojiPickerFor === post.id && (
                                <div className="emoji-picker" style={{ bottom: 'auto', top: 'calc(100% + 4px)' }}>
                                  {QUICK_EMOJIS.map(e => <button key={e} className="emoji-opt" onClick={() => toggleReaction(post.id, e)}>{e}</button>)}
                                </div>
                              )}
                            </div>
                            {post.must_read && !acknowledgedIds.has(post.id) && (
                              <button className="hover-action-btn" title="Mark as read" onClick={() => handleAcknowledge(post.id)}>✓</button>
                            )}
                            {canManagePost(post) && (
                              <>
                                <button className="hover-action-btn" onClick={() => { setActivePostId(post.id); setEditingId(post.id); setEditTitle(post.title); setEditContent(post.content ?? '') }}>✎</button>
                                <button className="hover-action-btn" style={{ color: '#C0504D' }} onClick={() => handleDelete(post.id)}>🗑</button>
                              </>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))
              )
            )}
          </div>
        </div>
      </div>
    </>
  )
}
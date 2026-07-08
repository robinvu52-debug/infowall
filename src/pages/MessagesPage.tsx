import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Navbar from '../components/Navbar'

interface Profile {
  id: string; full_name: string | null; role: string; department_id: string | null
}
interface Conversation {
  id: string; user1_id: string; user2_id: string; created_at: string
  otherUser: Profile | null; lastMessage: Message | null; unreadCount: number
}
interface Message {
  id: string; conversation_id: string; sender_id: string
  content: string; read_at: string | null; created_at: string
}

function initials(name: string | null): string {
  if (!name) return '?'
  return name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase()
}
function timeAgo(d: string): string {
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  if (diff < 60) return 'now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}
function formatMsgTime(d: string): string {
  return new Date(d).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true })
}
function formatMsgDate(d: string): string {
  const date = new Date(d)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
  if (date >= today) return 'Today'
  if (date >= yesterday) return 'Yesterday'
  return date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
}
function Avatar({ name, size = 36 }: { name: string | null; size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'linear-gradient(135deg,#4F81BD,#243F60)', color: 'white', fontSize: size * 0.33, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {initials(name)}
    </div>
  )
}

export default function MessagesPage() {
  const navigate = useNavigate()
  const { userId: targetUserId } = useParams<{ userId?: string }>()

  const [profile, setProfile] = useState<Profile | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [inputText, setInputText] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [showNewChat, setShowNewChat] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [allProfiles, setAllProfiles] = useState<Profile[]>([])
  const [convSearch, setConvSearch] = useState('')

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const activeConvChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const globalChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const conversationsRef = useRef<Conversation[]>([])
  const activeConvIdRef = useRef<string | null>(null)
  const userIdRef = useRef<string | null>(null)

  useEffect(() => { conversationsRef.current = conversations }, [conversations])
  useEffect(() => { activeConvIdRef.current = activeConvId }, [activeConvId])
  useEffect(() => { userIdRef.current = userId }, [userId])

  const activeConv = conversations.find(c => c.id === activeConvId) ?? null

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { navigate('/login'); return }
      setUserId(user.id)
      userIdRef.current = user.id

      const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      setProfile(p)

      await loadConversations(user.id)

      const { data: ps } = await supabase.from('profiles').select('*').order('full_name')
      setAllProfiles((ps ?? []).filter(pr => pr.id !== user.id))
      setLoading(false)

      if (targetUserId) await openConversationWith(user.id, targetUserId)
    }
    load()

    return () => {
      if (activeConvChannelRef.current) supabase.removeChannel(activeConvChannelRef.current)
      if (globalChannelRef.current) supabase.removeChannel(globalChannelRef.current)
    }
  }, [navigate, targetUserId])

  useEffect(() => {
    if (!userId) return
    if (globalChannelRef.current) supabase.removeChannel(globalChannelRef.current)

    globalChannelRef.current = supabase
      .channel('global-messages')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
      }, (payload) => {
        const newMsg = payload.new as Message
        const uid = userIdRef.current
        const convs = conversationsRef.current
        const activeId = activeConvIdRef.current

        const conv = convs.find(c => c.id === newMsg.conversation_id)
        if (!conv) return

        const isMine = newMsg.sender_id === uid
        const isActive = newMsg.conversation_id === activeId

        setConversations(prev => {
          const updated = prev.map(c => {
            if (c.id !== newMsg.conversation_id) return c
            return {
              ...c,
              lastMessage: newMsg,
              unreadCount: isActive || isMine ? c.unreadCount : c.unreadCount + 1,
            }
          })
          return updated.sort((a, b) => {
            const aTime = a.lastMessage?.created_at ?? a.created_at
            const bTime = b.lastMessage?.created_at ?? b.created_at
            return new Date(bTime).getTime() - new Date(aTime).getTime()
          })
        })

        if (!isMine && isActive) {
          setMessages(prev => prev.find(m => m.id === newMsg.id) ? prev : [...prev, newMsg])
          supabase.from('messages').update({ read_at: new Date().toISOString() }).eq('id', newMsg.id).then(() => {})
        }
      })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'conversations',
      }, async (payload) => {
        const uid = userIdRef.current
        if (!uid) return
        const conv = payload.new as { id: string; user1_id: string; user2_id: string; created_at: string }
        if (conv.user1_id !== uid && conv.user2_id !== uid) return

        const otherUserId = conv.user1_id === uid ? conv.user2_id : conv.user1_id
        const { data: otherUser } = await supabase.from('profiles').select('*').eq('id', otherUserId).single()

        const newConv: Conversation = {
          id: conv.id, user1_id: conv.user1_id, user2_id: conv.user2_id,
          created_at: conv.created_at, otherUser: otherUser as Profile,
          lastMessage: null, unreadCount: 0,
        }

        setConversations(prev => {
          if (prev.find(c => c.id === conv.id)) return prev
          return [newConv, ...prev]
        })
      })
      .subscribe()

    return () => { if (globalChannelRef.current) supabase.removeChannel(globalChannelRef.current) }
  }, [userId])

  useEffect(() => {
    if (!activeConvId) return
    if (activeConvChannelRef.current) supabase.removeChannel(activeConvChannelRef.current)

    activeConvChannelRef.current = supabase
      .channel(`conv:${activeConvId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `conversation_id=eq.${activeConvId}`,
      }, (payload) => {
        const newMsg = payload.new as Message
        const uid = userIdRef.current
        if (newMsg.sender_id === uid) return
        setMessages(prev => prev.find(m => m.id === newMsg.id) ? prev : [...prev, newMsg])
      })
      .subscribe()

    return () => { if (activeConvChannelRef.current) supabase.removeChannel(activeConvChannelRef.current) }
  }, [activeConvId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function loadConversations(uid: string): Promise<Conversation[]> {
    const { data: convs } = await supabase
      .from('conversations')
      .select(`*,
        user1:profiles!conversations_user1_id_fkey(id,full_name,role,department_id),
        user2:profiles!conversations_user2_id_fkey(id,full_name,role,department_id)`)
      .or(`user1_id.eq.${uid},user2_id.eq.${uid}`)
      .order('created_at', { ascending: false })

    if (!convs) return []

    const enriched = await Promise.all(convs.map(async (c) => {
      const otherUser = c.user1_id === uid ? c.user2 : c.user1
      const { data: lastMsgs } = await supabase.from('messages').select('*').eq('conversation_id', c.id).order('created_at', { ascending: false }).limit(1)
      const { count: unread } = await supabase.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', c.id).neq('sender_id', uid).is('read_at', null)
      return {
        id: c.id, user1_id: c.user1_id, user2_id: c.user2_id, created_at: c.created_at,
        otherUser: otherUser as Profile, lastMessage: lastMsgs?.[0] ?? null, unreadCount: unread ?? 0,
      }
    }))

    const sorted = enriched.sort((a, b) => {
      const aTime = a.lastMessage?.created_at ?? a.created_at
      const bTime = b.lastMessage?.created_at ?? b.created_at
      return new Date(bTime).getTime() - new Date(aTime).getTime()
    })

    setConversations(sorted)
    conversationsRef.current = sorted
    return sorted
  }

  async function openConversation(convId: string) {
    setActiveConvId(convId)
    activeConvIdRef.current = convId
    setLoadingMessages(true)

    const { data: msgs } = await supabase.from('messages').select('*').eq('conversation_id', convId).order('created_at', { ascending: true })
    setMessages(msgs ?? [])
    setLoadingMessages(false)

    await supabase.from('messages').update({ read_at: new Date().toISOString() }).eq('conversation_id', convId).neq('sender_id', userId!).is('read_at', null)
    setConversations(prev => prev.map(c => c.id === convId ? { ...c, unreadCount: 0 } : c))
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  async function openConversationWith(currentUserId: string, otherUserId: string) {
    const sorted = [currentUserId, otherUserId].sort()
    const user1_id = sorted[0]; const user2_id = sorted[1]

    let { data: existing } = await supabase.from('conversations').select('id').eq('user1_id', user1_id).eq('user2_id', user2_id).maybeSingle()

    if (!existing) {
      const { data: created } = await supabase.from('conversations').insert({ user1_id, user2_id }).select('id').single()
      existing = created
      await loadConversations(currentUserId)
    }

    if (existing) await openConversation(existing.id)
  }

  async function handleNewChat(other: Profile) {
    if (!userId) return
    setShowNewChat(false); setUserSearch('')
    await openConversationWith(userId, other.id)
  }

  async function sendMessage() {
    if (!inputText.trim() || !activeConvId || !userId || sending) return
    setSending(true)
    const content = inputText.trim()
    setInputText('')
    if (inputRef.current) { inputRef.current.style.height = 'auto' }

    const { data: msg } = await supabase.from('messages').insert({ conversation_id: activeConvId, sender_id: userId, content }).select().single()

    if (msg) {
      setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg])
      setConversations(prev => prev.map(c => c.id === activeConvId ? { ...c, lastMessage: msg } : c)
        .sort((a, b) => {
          const aTime = a.lastMessage?.created_at ?? a.created_at
          const bTime = b.lastMessage?.created_at ?? b.created_at
          return new Date(bTime).getTime() - new Date(aTime).getTime()
        })
      )
    }
    setSending(false)
    inputRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  function groupByDate(msgs: Message[]) {
    const groups: { label: string; messages: Message[] }[] = []
    msgs.forEach(msg => {
      const label = formatMsgDate(msg.created_at)
      const g = groups.find(x => x.label === label)
      if (g) g.messages.push(msg)
      else groups.push({ label, messages: [msg] })
    })
    return groups
  }

  const filteredConvs = conversations.filter(c => !convSearch || c.otherUser?.full_name?.toLowerCase().includes(convSearch.toLowerCase()))
  const filteredUsers = allProfiles.filter(p => !userSearch || p.full_name?.toLowerCase().includes(userSearch.toLowerCase()))
  const totalUnread = conversations.reduce((s, c) => s + c.unreadCount, 0)

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#7A8899', fontFamily: 'Nunito, sans-serif' }}>Loading…</div>
  )

  return (
    <>
      <style>{`
        @keyframes msgIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes slideUp { from{opacity:0;transform:translateY(20px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }

        .msg-page { display:flex;flex-direction:column;height:100vh;font-family:'Nunito','Segoe UI',system-ui,sans-serif;overflow:hidden; }
        .msg-shell { display:flex;flex:1;min-height:0;overflow:hidden; }

        .conv-panel { width:300px;flex-shrink:0;display:flex;flex-direction:column;background:white;border-right:1px solid #E2E6EA;height:100%;overflow:hidden; }
        .conv-header { padding:1rem 1.1rem 0.75rem;border-bottom:1px solid #E2E6EA;flex-shrink:0; }
        .conv-header-top { display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem; }
        .conv-title { font-size:1rem;font-weight:800;color:#1A2B3C;display:flex;align-items:center;gap:0.4rem; }
        .conv-unread-total { background:#365F91;color:white;border-radius:999px;font-size:0.65rem;font-weight:800;padding:0.12rem 0.45rem; }
        .conv-new-btn { width:28px;height:28px;border-radius:7px;background:#EEF4FB;border:1px solid #C5D9F1;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.12s;color:#365F91;font-size:1.1rem;font-weight:700;line-height:1; }
        .conv-new-btn:hover { background:#C5D9F1; }
        .conv-search-wrap { display:flex;align-items:center;gap:0.4rem;background:#F2F4F7;border-radius:8px;padding:0.4rem 0.65rem; }
        .conv-search-wrap input { background:transparent;border:none;outline:none;flex:1;font-size:0.82rem;color:#1A2B3C;font-family:inherit; }
        .conv-search-wrap input::placeholder { color:#9CA3AF; }

        .conv-list { flex:1;overflow-y:auto; }
        .conv-list::-webkit-scrollbar{width:3px}
        .conv-list::-webkit-scrollbar-thumb{background:#E2E6EA;border-radius:999px}

        .conv-item { display:flex;align-items:center;gap:0.7rem;padding:0.75rem 1.1rem;cursor:pointer;transition:background 0.1s;position:relative;border-bottom:1px solid #F0F2F5; }
        .conv-item:hover { background:#F8F9FA; }
        .conv-item.active { background:#EEF4FB; }
        .conv-item.has-unread .conv-item-name { font-weight:800; }
        .conv-item.has-unread .conv-item-preview { color:#374151;font-weight:600; }
        .conv-item-info { flex:1;min-width:0; }
        .conv-item-top { display:flex;align-items:center;justify-content:space-between;margin-bottom:0.15rem; }
        .conv-item-name { font-size:0.88rem;font-weight:600;color:#1A2B3C;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .conv-item-time { font-size:0.68rem;color:#9CA3AF;flex-shrink:0;margin-left:0.4rem; }
        .conv-item-preview { font-size:0.78rem;color:#7A8899;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .conv-unread-badge { min-width:18px;height:18px;border-radius:9px;background:#365F91;color:white;font-size:0.62rem;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 4px;flex-shrink:0; }
        .conv-empty { flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#9CA3AF;font-size:0.85rem;gap:0.5rem;padding:2rem;text-align:center; }

        .chat-area { flex:1;display:flex;flex-direction:column;min-width:0;background:#F8F9FA;overflow:hidden; }
        .chat-header { display:flex;align-items:center;gap:0.85rem;padding:0.85rem 1.5rem;background:white;border-bottom:1px solid #E2E6EA;flex-shrink:0;box-shadow:0 1px 3px rgba(0,0,0,0.04); }
        .chat-header-name { font-size:1rem;font-weight:800;color:#1A2B3C; }
        .chat-header-sub { font-size:0.75rem;color:#9CA3AF;text-transform:capitalize; }
        .chat-header-actions { margin-left:auto;display:flex;gap:0.4rem; }
        .chat-header-btn { background:#F2F4F7;border:1px solid #E2E6EA;border-radius:7px;padding:0.38rem 0.75rem;font-size:0.78rem;font-weight:600;color:#4A5568;cursor:pointer;transition:all 0.12s;font-family:inherit; }
        .chat-header-btn:hover { background:#EEF4FB;border-color:#C5D9F1;color:#365F91; }

        .chat-messages { flex:1;overflow-y:auto;padding:1.25rem 1.5rem;display:flex;flex-direction:column; }
        .chat-messages::-webkit-scrollbar{width:5px}
        .chat-messages::-webkit-scrollbar-thumb{background:#D1D5DB;border-radius:999px}

        .msg-date-divider { display:flex;align-items:center;gap:0.75rem;margin:1.25rem 0 0.75rem; }
        .msg-date-line { flex:1;height:1px;background:#E2E6EA; }
        .msg-date-label { font-size:0.7rem;font-weight:700;color:#9CA3AF;white-space:nowrap;letter-spacing:0.06em;text-transform:uppercase; }

        .msg-row { display:flex;gap:0.6rem;padding:0.15rem 0;animation:msgIn 0.2s ease both; }
        .msg-row.mine { flex-direction:row-reverse; }
        .msg-avatar-col { width:30px;flex-shrink:0;display:flex;align-items:flex-end;padding-bottom:1.5rem; }
        .msg-avatar-spacer { width:30px;flex-shrink:0; }
        .msg-content-col { display:flex;flex-direction:column;max-width:68%; }
        .msg-row.mine .msg-content-col { align-items:flex-end; }
        .msg-sender-name { font-size:0.72rem;font-weight:700;color:#4A5568;margin-bottom:0.18rem;padding:0 0.5rem; }
        .msg-bubble { padding:0.6rem 0.95rem;font-size:0.9rem;line-height:1.55;word-break:break-word;white-space:pre-wrap;border-radius:4px 18px 18px 18px;background:white;color:#1A2B3C;border:1px solid #E2E6EA;box-shadow:0 1px 2px rgba(0,0,0,0.05); }
        .msg-row.mine .msg-bubble { background:#365F91;color:white;border:none;border-radius:18px 4px 18px 18px;box-shadow:0 2px 6px rgba(54,95,145,0.3); }
        .msg-time { font-size:0.65rem;color:#9CA3AF;margin-top:0.2rem;padding:0 0.5rem; }

        .chat-input-area { padding:0.85rem 1.5rem;background:white;border-top:1px solid #E2E6EA;flex-shrink:0; }
        .chat-input-wrap { display:flex;align-items:flex-end;gap:0.65rem;background:#F2F4F7;border:1.5px solid #E2E6EA;border-radius:12px;padding:0.5rem 0.65rem;transition:border-color 0.15s; }
        .chat-input-wrap:focus-within { border-color:#4F81BD;background:white;box-shadow:0 0 0 3px rgba(79,129,189,0.08); }
        .chat-input-wrap textarea { flex:1;background:transparent;border:none;outline:none;font-size:0.9rem;color:#1A2B3C;font-family:inherit;resize:none;max-height:120px;min-height:22px;line-height:1.5;padding:0.2rem 0; }
        .chat-input-wrap textarea::placeholder { color:#9CA3AF; }
        .send-btn { width:34px;height:34px;border-radius:8px;flex-shrink:0;background:#365F91;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s;color:white;font-size:0.9rem; }
        .send-btn:hover:not(:disabled) { background:#243F60; }
        .send-btn:disabled { opacity:0.35;cursor:not-allowed; }
        .chat-input-hint { font-size:0.68rem;color:#B0BCCB;margin-top:0.35rem;padding:0 0.2rem; }

        .chat-empty { flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#9CA3AF;gap:0.75rem;padding:3rem;text-align:center; }
        .chat-empty-icon { font-size:3rem;opacity:0.35; }
        .chat-empty-title { font-size:1.1rem;font-weight:700;color:#374151; }
        .chat-empty-sub { font-size:0.85rem;max-width:300px;line-height:1.6; }
        .chat-empty-btn { padding:0.65rem 1.5rem;background:#365F91;color:white;border:none;border-radius:9px;font-size:0.88rem;font-weight:700;cursor:pointer;transition:background 0.15s;font-family:inherit;margin-top:0.5rem; }
        .chat-empty-btn:hover { background:#243F60; }

        .new-chat-overlay { position:fixed;inset:0;z-index:500;background:rgba(0,0,0,0.3);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;animation:fadeIn 0.15s ease; }
        .new-chat-modal { background:white;border-radius:16px;width:460px;max-width:calc(100vw - 2rem);box-shadow:0 20px 60px rgba(0,0,0,0.15);animation:slideUp 0.25s cubic-bezier(0.34,1.56,0.64,1);overflow:hidden;display:flex;flex-direction:column;max-height:80vh; }
        .new-chat-header { display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;border-bottom:1px solid #E2E6EA;flex-shrink:0; }
        .new-chat-title { font-size:1rem;font-weight:800;color:#1A2B3C; }
        .new-chat-close { background:none;border:none;color:#9CA3AF;font-size:1.1rem;cursor:pointer;padding:0.2rem;border-radius:5px;transition:all 0.12s;line-height:1; }
        .new-chat-close:hover { background:#F2F4F7;color:#374151; }
        .new-chat-search-wrap { padding:0.85rem 1.25rem;border-bottom:1px solid #F0F2F5;flex-shrink:0; }
        .new-chat-search { width:100%;padding:0.6rem 0.85rem;background:#F2F4F7;border:1px solid #E2E6EA;border-radius:9px;font-size:0.88rem;color:#1A2B3C;font-family:inherit;outline:none;box-sizing:border-box; }
        .new-chat-search:focus { border-color:#4F81BD;background:white; }
        .new-chat-list { overflow-y:auto;flex:1; }
        .new-chat-list::-webkit-scrollbar{width:3px}
        .new-chat-list::-webkit-scrollbar-thumb{background:#E2E6EA;border-radius:999px}
        .new-chat-user { display:flex;align-items:center;gap:0.75rem;padding:0.75rem 1.25rem;cursor:pointer;transition:background 0.1s;border-bottom:1px solid #F8F9FA; }
        .new-chat-user:hover { background:#F2F4F7; }
        .new-chat-user:last-child { border-bottom:none; }
        .new-chat-user-name { font-size:0.88rem;font-weight:600;color:#1A2B3C;display:block; }
        .new-chat-user-role { font-size:0.72rem;color:#9CA3AF;display:block;margin-top:0.1rem;text-transform:capitalize; }

        @media(max-width:768px){
          .conv-panel { width:260px; }
          .chat-header { padding:0.75rem 1rem; }
          .chat-messages { padding:1rem; }
          .chat-input-area { padding:0.75rem 1rem; }
        }
      `}</style>

      <div className="msg-page">
        <Navbar fullName={profile?.full_name ?? null} role={profile?.role ?? 'employee'} />

        <div className="msg-shell">
          <div className="conv-panel">
            <div className="conv-header">
              <div className="conv-header-top">
                <span className="conv-title">
                  Messages
                  {totalUnread > 0 && <span className="conv-unread-total">{totalUnread}</span>}
                </span>
                <button className="conv-new-btn" onClick={() => setShowNewChat(true)} title="New message">+</button>
              </div>
              <div className="conv-search-wrap">
                <span style={{ fontSize: '0.8rem', color: '#9CA3AF' }}>🔍</span>
                <input placeholder="Search conversations…" value={convSearch} onChange={e => setConvSearch(e.target.value)} />
              </div>
            </div>

            <div className="conv-list">
              {filteredConvs.length === 0 ? (
                <div className="conv-empty">
                  <div style={{ fontSize: '2rem', opacity: 0.5 }}>💬</div>
                  <div style={{ fontWeight: 600, color: '#374151' }}>No conversations yet</div>
                  <div style={{ fontSize: '0.78rem' }}>Click + to start a new message</div>
                </div>
              ) : filteredConvs.map(conv => (
                <div
                  key={conv.id}
                  className={`conv-item${activeConvId === conv.id ? ' active' : ''}${conv.unreadCount > 0 ? ' has-unread' : ''}`}
                  onClick={() => openConversation(conv.id)}
                >
                  <Avatar name={conv.otherUser?.full_name ?? null} size={38} />
                  <div className="conv-item-info">
                    <div className="conv-item-top">
                      <span className="conv-item-name">{conv.otherUser?.full_name ?? 'Unknown'}</span>
                      {conv.lastMessage && <span className="conv-item-time">{timeAgo(conv.lastMessage.created_at)}</span>}
                    </div>
                    <div className="conv-item-preview">
                      {conv.lastMessage
                        ? (conv.lastMessage.sender_id === userId ? 'You: ' : '') + conv.lastMessage.content
                        : 'No messages yet'}
                    </div>
                  </div>
                  {conv.unreadCount > 0 && <div className="conv-unread-badge">{conv.unreadCount}</div>}
                </div>
              ))}
            </div>
          </div>

          <div className="chat-area">
            {activeConv ? (
              <>
                <div className="chat-header">
                  <Avatar name={activeConv.otherUser?.full_name ?? null} size={36} />
                  <div>
                    <div className="chat-header-name">{activeConv.otherUser?.full_name ?? 'Unknown'}</div>
                    <div className="chat-header-sub">{activeConv.otherUser?.role}</div>
                  </div>
                  <div className="chat-header-actions">
                    <button className="chat-header-btn" onClick={() => navigate(`/profile/${activeConv.otherUser?.id}`)}>
                      👤 Profile
                    </button>
                  </div>
                </div>

                <div className="chat-messages">
                  {loadingMessages ? (
                    <div style={{ textAlign: 'center', color: '#9CA3AF', padding: '2rem', fontSize: '0.88rem' }}>Loading messages…</div>
                  ) : messages.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#9CA3AF', padding: '3rem 1rem' }}>
                      <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>👋</div>
                      <div style={{ fontWeight: 700, color: '#374151', marginBottom: '0.3rem', fontSize: '1rem' }}>Start the conversation</div>
                      <div style={{ fontSize: '0.85rem' }}>Say hello to {activeConv.otherUser?.full_name?.split(' ')[0]}!</div>
                    </div>
                  ) : (
                    groupByDate(messages).map(group => (
                      <div key={group.label}>
                        <div className="msg-date-divider">
                          <div className="msg-date-line" />
                          <div className="msg-date-label">{group.label}</div>
                          <div className="msg-date-line" />
                        </div>
                        {group.messages.map((msg, i) => {
                          const isMine = msg.sender_id === userId
                          const prevMsg = group.messages[i - 1]
                          const showAvatar = !isMine && (!prevMsg || prevMsg.sender_id !== msg.sender_id)
                          return (
                            <div key={msg.id} className={`msg-row${isMine ? ' mine' : ''}`}>
                              {!isMine
                                ? (showAvatar
                                  ? <div className="msg-avatar-col"><Avatar name={activeConv.otherUser?.full_name ?? null} size={28} /></div>
                                  : <div className="msg-avatar-spacer" />)
                                : null}
                              <div className="msg-content-col">
                                {showAvatar && <div className="msg-sender-name">{activeConv.otherUser?.full_name}</div>}
                                <div className="msg-bubble">{msg.content}</div>
                                <div className="msg-time">{formatMsgTime(msg.created_at)}</div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <div className="chat-input-area">
                  <div className="chat-input-wrap">
                    <textarea
                      ref={inputRef}
                      rows={1}
                      placeholder={`Message ${activeConv.otherUser?.full_name?.split(' ')[0] ?? ''}…`}
                      value={inputText}
                      onChange={e => {
                        setInputText(e.target.value)
                        e.target.style.height = 'auto'
                        e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
                      }}
                      onKeyDown={handleKeyDown}
                    />
                    <button className="send-btn" onClick={sendMessage} disabled={!inputText.trim() || sending}>➤</button>
                  </div>
                  <div className="chat-input-hint">Enter to send · Shift+Enter for new line</div>
                </div>
              </>
            ) : (
              <div className="chat-empty">
                <div className="chat-empty-icon">💬</div>
                <div className="chat-empty-title">Direct Messages</div>
                <div className="chat-empty-sub">Send private real-time messages to your colleagues. Select a conversation or start a new one.</div>
                <button className="chat-empty-btn" onClick={() => setShowNewChat(true)}>✉ New message</button>
              </div>
            )}
          </div>
        </div>

        {showNewChat && (
          <div className="new-chat-overlay" onClick={() => setShowNewChat(false)}>
            <div className="new-chat-modal" onClick={e => e.stopPropagation()}>
              <div className="new-chat-header">
                <span className="new-chat-title">New message</span>
                <button className="new-chat-close" onClick={() => setShowNewChat(false)}>✕</button>
              </div>
              <div className="new-chat-search-wrap">
                <input className="new-chat-search" placeholder="🔍  Search for a person…" value={userSearch} onChange={e => setUserSearch(e.target.value)} autoFocus />
              </div>
              <div className="new-chat-list">
                {filteredUsers.length === 0 ? (
                  <div style={{ padding: '2rem', textAlign: 'center', color: '#9CA3AF', fontSize: '0.85rem' }}>No users found</div>
                ) : filteredUsers.map(u => (
                  <div key={u.id} className="new-chat-user" onClick={() => handleNewChat(u)}>
                    <Avatar name={u.full_name} size={36} />
                    <div>
                      <span className="new-chat-user-name">{u.full_name}</span>
                      <span className="new-chat-user-role">{u.role}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

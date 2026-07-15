import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Navbar from '../components/Navbar'
import { usePresence } from '../contexts/PresenceContext'

// ─── Types ────────────────────────────────────────────────────
interface Profile {
  id: string; full_name: string | null; role: string; department_id: string | null
}
interface Channel {
  id: string; name: string; description: string | null
  type: 'public' | 'private' | 'announcement' | 'department'
  department_id: string | null; created_by: string | null
  created_at: string; is_archived: boolean
  memberRole?: string; is_muted?: boolean; last_read_at?: string
}
interface ChannelMessage {
  id: string; channel_id: string; sender_id: string
  content: string; is_pinned: boolean; parent_id: string | null
  attachment_url: string | null; attachment_name: string | null; attachment_type: string | null
  edited_at: string | null; created_at: string
  sender?: Profile | null
  reply_count?: number
}
interface Reaction { id: string; message_id: string; user_id: string; emoji: string }

// ─── Constants ────────────────────────────────────────────────
const QUICK_EMOJIS = ['👍','❤️','😂','😮','🎉','🔥','✅','💯']
const IMAGE_TYPES = ['image/jpeg','image/png','image/gif','image/webp','image/svg+xml']
const MAX_FILE_MB = 10

const TYPE_ICON: Record<string, string> = {
  public: '#', private: '🔒', announcement: '📢', department: '🏢'
}
const STATUS_COLOR: Record<string, string> = {
  online: '#22c55e', away: '#f59e0b', busy: '#ef4444', offline: '#374151'
}

// ─── Helpers ──────────────────────────────────────────────────
function timeAgo(d: string): string {
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}
function formatTime(d: string): string {
  return new Date(d).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true })
}
function formatDate(d: string): string {
  const date = new Date(d)
  const today = new Date(); today.setHours(0,0,0,0)
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate()-1)
  if (date >= today) return 'Today'
  if (date >= yesterday) return 'Yesterday'
  return date.toLocaleDateString('en-AU', { weekday:'long', day:'numeric', month:'long' })
}
function initials(name: string | null): string {
  if (!name) return '?'
  return name.split(' ').filter(Boolean).slice(0,2).map(n=>n[0]).join('').toUpperCase()
}
function avatarColor(name: string | null): string {
  const colors = ['#4BACC6','#8064A2','#C0504D','#9BBB59','#F79646','#4F81BD','#243F60','#365F91']
  if (!name) return colors[0]
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h<<5)-h)
  return colors[Math.abs(h) % colors.length]
}
function fmtSize(b: number) {
  if (b < 1024) return `${b}B`
  if (b < 1024*1024) return `${(b/1024).toFixed(1)}KB`
  return `${(b/1024/1024).toFixed(1)}MB`
}
function fileIcon(type?: string | null) {
  if (!type) return '📎'
  if (IMAGE_TYPES.includes(type)) return '🖼'
  if (type === 'application/pdf') return '📄'
  if (type.includes('word')) return '📝'
  if (type.includes('sheet') || type.includes('excel')) return '📊'
  return '📎'
}

// ─── Avatar ───────────────────────────────────────────────────
function Avatar({ name, size=32, statusKey }: { name:string|null; size?:number; statusKey?:string }) {
  return (
    <div style={{ position:'relative', flexShrink:0 }}>
      <div style={{ width:size, height:size, borderRadius:'50%', background:`linear-gradient(135deg,${avatarColor(name)},#1A2B3C)`, color:'white', fontSize:size*0.34, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center' }}>
        {initials(name)}
      </div>
      {statusKey && statusKey !== 'offline' && (
        <div style={{ position:'absolute', bottom:0, right:0, width:size*0.28, height:size*0.28, borderRadius:'50%', background:STATUS_COLOR[statusKey]??'#9ca3af', border:'1.5px solid var(--bg-surface)' }} />
      )}
    </div>
  )
}

// ─── Message content renderer ─────────────────────────────────
function RenderContent({ content, profiles, navigate }: { content:string; profiles:Profile[]; navigate:(p:string)=>void }) {
  const parts = content.split(/(```[\s\S]*?```|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|@\S+(?:\s\S+)?|https?:\/\/[^\s]+)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          return <pre key={i} className="ch-code-block"><code>{part.slice(3,-3).trim()}</code></pre>
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
          return <code key={i} className="ch-inline-code">{part.slice(1,-1)}</code>
        }
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2,-2)}</strong>
        }
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
          return <em key={i}>{part.slice(1,-1)}</em>
        }
        if (part.startsWith('@')) {
          const name = part.slice(1)
          const found = profiles.find(p => p.full_name === name)
          if (found) return <span key={i} className="ch-mention" onClick={()=>navigate(`/profile/${found.id}`)}>@{name}</span>
        }
        if (part.match(/^https?:\/\//)) {
          return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="ch-link">{part}</a>
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}

// ─── Main Page ────────────────────────────────────────────────
export default function ChannelsPage() {
  const navigate = useNavigate()
  const { channelId: paramChannelId } = useParams<{ channelId?: string }>()
  const { presenceUsers, onlineUserIds } = usePresence()

  const [myProfile, setMyProfile] = useState<Profile | null>(null)
  const [allProfiles, setAllProfiles] = useState<Profile[]>([])
  const [myChannels, setMyChannels] = useState<Channel[]>([])
  const [allChannels, setAllChannels] = useState<Channel[]>([])
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChannelMessage[]>([])
  const [threadMessages, setThreadMessages] = useState<ChannelMessage[]>([])
  const [selectedThread, setSelectedThread] = useState<ChannelMessage | null>(null)
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({})
  const [channelMembers, setChannelMembers] = useState<Profile[]>([])
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [typers, setTypers] = useState<string[]>([])

  // Panels
  const [showInfo, setShowInfo] = useState(false)
  const [showBrowse, setShowBrowse] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [showPinnedList, setShowPinnedList] = useState(false)

  // Input
  const [inputText, setInputText] = useState('')
  const [threadInput, setThreadInput] = useState('')
  const [sending, setSending] = useState(false)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionSuggestions, setMentionSuggestions] = useState<Profile[]>([])
  const [mentionStart, setMentionStart] = useState(0)
  const [hoveredMsgId, setHoveredMsgId] = useState<string | null>(null)
  const [showEmojiFor, setShowEmojiFor] = useState<string | null>(null)
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')

  // File upload
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingPreview, setPendingPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)

  // Browse / Create
  const [browseSearch, setBrowseSearch] = useState('')
  const [newChannelName, setNewChannelName] = useState('')
  const [newChannelDesc, setNewChannelDesc] = useState('')
  const [newChannelType, setNewChannelType] = useState<'public'|'private'>('public')
  const [creating, setCreating] = useState(false)

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const threadEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const threadInputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const realtimeRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const userIdRef = useRef<string | null>(null)
  const activeChannelRef = useRef<string | null>(null)

  const activeChannel = myChannels.find(c => c.id === activeChannelId) ?? null
  const pinnedMessages = messages.filter(m => m.is_pinned && !m.parent_id)
  const canPost = activeChannel?.type !== 'announcement' || ['admin','hr'].includes(myProfile?.role ?? '')
  const isAnnouncement = activeChannel?.type === 'announcement'

  useEffect(() => { activeChannelRef.current = activeChannelId }, [activeChannelId])

  // ── Scroll ──────────────────────────────────────────────────
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior:'smooth' }) }, [messages, typers])
  useEffect(() => { threadEndRef.current?.scrollIntoView({ behavior:'smooth' }) }, [threadMessages])

  // ── Close popovers on outside click ─────────────────────────
  useEffect(() => {
    if (!showEmojiFor) return
    function h(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest('.ch-emoji-picker') && !(e.target as HTMLElement).closest('.ch-react-btn')) setShowEmojiFor(null)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [showEmojiFor])

  // ── Load everything ──────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const { data:{ user } } = await supabase.auth.getUser()
      if (!user) { navigate('/login'); return }
      userIdRef.current = user.id

      const [{ data: me }, { data: ps }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('profiles').select('*').order('full_name'),
      ])
      setMyProfile(me)
      setAllProfiles(ps ?? [])

      await loadMyChannels(user.id)
      setLoading(false)
    }
    load()
    return () => {
      if (realtimeRef.current) supabase.removeChannel(realtimeRef.current)
      if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current)
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    }
  }, [navigate])

  // Open channel from URL param
  useEffect(() => {
    if (paramChannelId && myChannels.length > 0) {
      openChannel(paramChannelId)
    }
  }, [paramChannelId, myChannels.length])

  // ── Load my channels ─────────────────────────────────────────
  async function loadMyChannels(uid: string) {
    const { data: memberships } = await supabase
      .from('channel_members')
      .select('*, channel:channels(*)')
      .eq('user_id', uid)
      .order('joined_at', { ascending: true })

    if (!memberships) return

    const channels = memberships.map((m: any) => ({
      ...m.channel,
      memberRole: m.role,
      is_muted: m.is_muted,
      last_read_at: m.last_read_at,
    })).filter(Boolean) as Channel[]

    setMyChannels(channels)

    // Calc unread counts
    const counts: Record<string, number> = {}
    await Promise.all(channels.map(async ch => {
      const membership = memberships.find((m: any) => m.channel_id === ch.id)
      const lastRead = membership?.last_read_at ?? new Date(0).toISOString()
      const { count } = await supabase
        .from('channel_messages')
        .select('id', { count:'exact', head:true })
        .eq('channel_id', ch.id)
        .is('parent_id', null)
        .neq('sender_id', uid)
        .gt('created_at', lastRead)
      counts[ch.id] = count ?? 0
    }))
    setUnreadCounts(counts)

    return channels
  }

  // ── Open channel ─────────────────────────────────────────────
  async function openChannel(channelId: string) {
    if (activeChannelId === channelId) return
    setActiveChannelId(channelId)
    setSelectedThread(null); setShowInfo(false); setShowPinnedList(false)
    setMessages([]); setThreadMessages([]); setReactions({})
    setLoadingMessages(true); setInputText('')

    // Load messages
    const { data: msgs } = await supabase
      .from('channel_messages')
      .select('*, sender:profiles!sender_id(*)')
      .eq('channel_id', channelId)
      .is('parent_id', null)
      .order('created_at', { ascending: true })
      .limit(100)

    const msgList = (msgs ?? []) as ChannelMessage[]

    // Load reply counts
    if (msgList.length > 0) {
      const ids = msgList.map(m => m.id)
      const { data: replies } = await supabase
        .from('channel_messages')
        .select('parent_id')
        .in('parent_id', ids)
      const counts: Record<string, number> = {}
      ;(replies ?? []).forEach((r: { parent_id: string }) => {
        counts[r.parent_id] = (counts[r.parent_id] ?? 0) + 1
      })
      msgList.forEach(m => { m.reply_count = counts[m.id] ?? 0 })
    }

    setMessages(msgList)

    // Load reactions
    if (msgList.length > 0) {
      const { data: rxns } = await supabase
        .from('channel_message_reactions')
        .select('*')
        .in('message_id', msgList.map(m => m.id))
      const grouped: Record<string, Reaction[]> = {}
      ;(rxns ?? []).forEach((r: Reaction) => {
        if (!grouped[r.message_id]) grouped[r.message_id] = []
        grouped[r.message_id].push(r)
      })
      setReactions(grouped)
    }

    // Load members
    const { data: mems } = await supabase
      .from('channel_members')
      .select('*, profile:profiles!user_id(*)')
      .eq('channel_id', channelId)
    setChannelMembers((mems ?? []).map((m: any) => m.profile).filter(Boolean) as Profile[])

    // Mark as read
    await supabase.from('channel_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('channel_id', channelId)
      .eq('user_id', userIdRef.current!)
    setUnreadCounts(prev => ({ ...prev, [channelId]: 0 }))

    setLoadingMessages(false)
    setupRealtime(channelId)
    setupTyping(channelId)
    navigate(`/channels/${channelId}`, { replace: true })
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  // ── Realtime ─────────────────────────────────────────────────
  function setupRealtime(channelId: string) {
    if (realtimeRef.current) supabase.removeChannel(realtimeRef.current)
    realtimeRef.current = supabase.channel(`ch:${channelId}`)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'channel_messages', filter:`channel_id=eq.${channelId}` }, async (payload) => {
        const msg = payload.new as ChannelMessage
        if (msg.parent_id) {
          if (selectedThread?.id === msg.parent_id) {
            const { data: s } = await supabase.from('profiles').select('*').eq('id', msg.sender_id).single()
            setThreadMessages(prev => prev.find(m=>m.id===msg.id) ? prev : [...prev, { ...msg, sender:s??null }])
          }
          setMessages(prev => prev.map(m => m.id === msg.parent_id ? { ...m, reply_count:(m.reply_count??0)+1 } : m))
          return
        }
        const { data: s } = await supabase.from('profiles').select('*').eq('id', msg.sender_id).single()
        const fullMsg: ChannelMessage = { ...msg, sender:s??null, reply_count:0 }
        if (msg.sender_id !== userIdRef.current) {
          if (activeChannelRef.current === channelId) {
            setMessages(prev => prev.find(m=>m.id===msg.id) ? prev : [...prev, fullMsg])
            await supabase.from('channel_members').update({ last_read_at: new Date().toISOString() }).eq('channel_id', channelId).eq('user_id', userIdRef.current!)
          } else {
            setUnreadCounts(prev => ({ ...prev, [channelId]: (prev[channelId]??0)+1 }))
          }
        } else {
          setMessages(prev => prev.find(m=>m.id===msg.id) ? prev : [...prev, fullMsg])
        }
      })
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'channel_messages', filter:`channel_id=eq.${channelId}` }, (payload) => {
        const updated = payload.new as ChannelMessage
        setMessages(prev => prev.map(m => m.id===updated.id ? {...m,...updated} : m))
        setThreadMessages(prev => prev.map(m => m.id===updated.id ? {...m,...updated} : m))
      })
      .on('postgres_changes', { event:'DELETE', schema:'public', table:'channel_messages' }, (payload) => {
        const del = payload.old as { id: string; parent_id: string | null }
        if (del.parent_id) {
          setThreadMessages(prev => prev.filter(m=>m.id!==del.id))
          setMessages(prev => prev.map(m => m.id===del.parent_id ? {...m, reply_count:Math.max(0,(m.reply_count??1)-1)} : m))
        } else {
          setMessages(prev => prev.filter(m=>m.id!==del.id))
        }
      })
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'channel_message_reactions' }, (payload) => {
        const r = payload.new as Reaction
        setReactions(prev => ({ ...prev, [r.message_id]: [...(prev[r.message_id]??[]).filter(x=>x.id!==r.id), r] }))
      })
      .on('postgres_changes', { event:'DELETE', schema:'public', table:'channel_message_reactions' }, (payload) => {
        const r = payload.old as { id:string; message_id:string }
        setReactions(prev => ({ ...prev, [r.message_id]: (prev[r.message_id]??[]).filter(x=>x.id!==r.id) }))
      })
      .subscribe()
  }

  function setupTyping(channelId: string) {
    if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current)
    setTypers([])
    const uid = userIdRef.current
    if (!uid) return
    typingChannelRef.current = supabase
      .channel(`typing:ch:${channelId}`, { config:{ presence:{ key:uid } } })
      .on('presence', { event:'sync' }, () => {
        const state = typingChannelRef.current?.presenceState<{ user_id:string; full_name:string|null; typing:boolean }>() ?? {}
        setTypers(Object.values(state).flat().filter(p=>p.user_id!==uid&&p.typing).map(p=>p.full_name?.split(' ')[0]??'Someone'))
      })
      .subscribe()
  }

  function handleTyping() {
    if (!typingChannelRef.current || !userIdRef.current || !myProfile) return
    typingChannelRef.current.track({ user_id:userIdRef.current, full_name:myProfile.full_name, typing:true })
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    typingTimerRef.current = setTimeout(() => typingChannelRef.current?.untrack(), 2500)
  }

  // ── Send message ─────────────────────────────────────────────
  async function sendMessage(isThread = false) {
    const text = isThread ? threadInput.trim() : inputText.trim()
    if ((!text && !pendingFile) || !activeChannelId || !myProfile || sending) return
    setSending(true)
    if (!isThread) { setInputText(''); if (inputRef.current) inputRef.current.style.height='auto' }
    else { setThreadInput('') }
    setMentionQuery(null)
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    typingChannelRef.current?.untrack()

    let attachmentUrl: string|null=null, attachmentName: string|null=null, attachmentType: string|null=null
    if (pendingFile && !isThread) {
      const r = await uploadFile(pendingFile)
      if (r) { attachmentUrl=r.url; attachmentName=r.name; attachmentType=r.type }
      clearPendingFile()
    }

    const { data: msg } = await supabase
      .from('channel_messages')
      .insert({
        channel_id: activeChannelId,
        sender_id: myProfile.id,
        content: text || ' ',
        parent_id: isThread ? selectedThread?.id ?? null : null,
        attachment_url: attachmentUrl,
        attachment_name: attachmentName,
        attachment_type: attachmentType,
      })
      .select('*, sender:profiles!sender_id(*)')
      .single()

    if (msg) {
      const fullMsg = { ...msg as ChannelMessage, reply_count: 0 }
      if (isThread) {
        setThreadMessages(prev => prev.find(m=>m.id===msg.id) ? prev : [...prev, fullMsg])
        setMessages(prev => prev.map(m => m.id===selectedThread?.id ? {...m, reply_count:(m.reply_count??0)+1} : m))
      } else {
        setMessages(prev => prev.find(m=>m.id===msg.id) ? prev : [...prev, fullMsg])
      }

      // @mention notifications
      if (text) {
        const mentioned = allProfiles.filter(p => p.full_name && text.includes(`@${p.full_name}`) && p.id !== myProfile.id)
        for (const mp of mentioned) {
          await supabase.from('notifications').insert({
            user_id: mp.id, type: 'mention_message',
            actor_id: myProfile.id,
            content: text.slice(0, 120),
          })
        }
      }
    }
    setSending(false)
    if (isThread) threadInputRef.current?.focus()
    else inputRef.current?.focus()
  }

  // ── File upload ───────────────────────────────────────────────
  function handleFileSelect(file: File) {
    if (file.size > MAX_FILE_MB*1024*1024) return
    setPendingFile(file)
    if (IMAGE_TYPES.includes(file.type)) setPendingPreview(URL.createObjectURL(file))
    else setPendingPreview(null)
  }
  function clearPendingFile() {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview)
    setPendingFile(null); setPendingPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }
  async function uploadFile(file: File) {
    if (!userIdRef.current) return null
    setUploading(true)
    const ext = file.name.split('.').pop()
    const path = `${userIdRef.current}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('message-attachments').upload(path, file, { contentType:file.type })
    setUploading(false)
    if (error) return null
    const { data:{ publicUrl } } = supabase.storage.from('message-attachments').getPublicUrl(path)
    return { url:publicUrl, name:file.name, type:file.type }
  }

  // ── @Mention ─────────────────────────────────────────────────
  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>, isThread=false) {
    const val = e.target.value
    if (isThread) setThreadInput(val)
    else { setInputText(val); handleTyping() }
    const cursor = e.target.selectionStart ?? val.length
    const upTo = val.slice(0, cursor)
    const atIdx = upTo.lastIndexOf('@')
    if (atIdx !== -1) {
      const after = upTo.slice(atIdx+1)
      if (!after.includes(' ')) {
        setMentionQuery(after); setMentionStart(atIdx)
        const q = after.toLowerCase()
        setMentionSuggestions(allProfiles.filter(p=>!q||p.full_name?.toLowerCase().includes(q)).slice(0,6))
      } else setMentionQuery(null)
    } else setMentionQuery(null)
    if (!isThread) { e.target.style.height='auto'; e.target.style.height=Math.min(e.target.scrollHeight,150)+'px' }
  }

  function selectMention(person: Profile, isThread=false) {
    const text = isThread ? threadInput : inputText
    const before = text.slice(0, mentionStart)
    const after = text.slice(mentionStart+1+(mentionQuery?.length??0))
    const newText = `${before}@${person.full_name} ${after}`
    if (isThread) setThreadInput(newText)
    else setInputText(newText)
    setMentionQuery(null); setMentionSuggestions([])
    setTimeout(() => {
      const ref = isThread ? threadInputRef : inputRef
      ref.current?.focus()
      const pos = mentionStart+(person.full_name?.length??0)+2
      ref.current?.setSelectionRange(pos,pos)
    }, 10)
  }

  // ── Edit ─────────────────────────────────────────────────────
  async function saveEdit(msgId: string) {
    if (!editingText.trim()) return
    await supabase.from('channel_messages').update({ content:editingText.trim(), edited_at:new Date().toISOString() }).eq('id', msgId)
    setMessages(prev => prev.map(m=>m.id===msgId?{...m,content:editingText.trim(),edited_at:new Date().toISOString()}:m))
    setThreadMessages(prev => prev.map(m=>m.id===msgId?{...m,content:editingText.trim()}:m))
    setEditingMsgId(null); setEditingText('')
  }

  // ── Delete ────────────────────────────────────────────────────
  async function deleteMessage(msgId: string) {
    if (!window.confirm('Delete this message?')) return
    await supabase.from('channel_messages').delete().eq('id', msgId)
    setMessages(prev => prev.filter(m=>m.id!==msgId))
    setThreadMessages(prev => prev.filter(m=>m.id!==msgId))
    if (selectedThread?.id === msgId) setSelectedThread(null)
  }

  // ── Pin ───────────────────────────────────────────────────────
  async function togglePin(msg: ChannelMessage) {
    const newVal = !msg.is_pinned
    await supabase.from('channel_messages').update({ is_pinned:newVal }).eq('id', msg.id)
    setMessages(prev => prev.map(m=>m.id===msg.id?{...m,is_pinned:newVal}:m))
    setThreadMessages(prev => prev.map(m=>m.id===msg.id?{...m,is_pinned:newVal}:m))
  }

  // ── Reactions ─────────────────────────────────────────────────
  async function toggleReaction(msgId: string, emoji: string) {
    if (!myProfile) return
    const existing = (reactions[msgId]??[]).find(r=>r.user_id===myProfile.id&&r.emoji===emoji)
    if (existing) {
      await supabase.from('channel_message_reactions').delete().eq('id', existing.id)
      setReactions(prev=>({...prev,[msgId]:(prev[msgId]??[]).filter(r=>r.id!==existing.id)}))
    } else {
      const { data } = await supabase.from('channel_message_reactions').insert({ message_id:msgId, user_id:myProfile.id, emoji }).select().single()
      if (data) setReactions(prev=>({...prev,[msgId]:[...(prev[msgId]??[]),data as Reaction]}))
    }
    setShowEmojiFor(null)
  }

  function groupReactionsByEmoji(msgId: string) {
    const raw = reactions[msgId] ?? []
    const map: Record<string, { count:number; iMine:boolean; names:string[] }> = {}
    raw.forEach(r => {
      if (!map[r.emoji]) map[r.emoji]={ count:0, iMine:false, names:[] }
      map[r.emoji].count++
      if (r.user_id===myProfile?.id) map[r.emoji].iMine=true
      const p = allProfiles.find(x=>x.id===r.user_id)
      if (p) map[r.emoji].names.push(p.full_name?.split(' ')[0]??'?')
    })
    return Object.entries(map).map(([emoji,v])=>({emoji,...v}))
  }

  // ── Open thread ───────────────────────────────────────────────
  async function openThread(msg: ChannelMessage) {
    setSelectedThread(msg); setShowInfo(false); setShowPinnedList(false)
    const { data } = await supabase
      .from('channel_messages')
      .select('*, sender:profiles!sender_id(*)')
      .eq('parent_id', msg.id)
      .order('created_at', { ascending:true })
    setThreadMessages((data??[]) as ChannelMessage[])
    setTimeout(() => threadInputRef.current?.focus(), 100)
  }

  // ── Join / Leave ──────────────────────────────────────────────
  async function joinChannel(channelId: string) {
    if (!myProfile) return
    await supabase.from('channel_members').insert({ channel_id:channelId, user_id:myProfile.id })
    await loadMyChannels(myProfile.id)
    setShowBrowse(false)
    openChannel(channelId)
  }

  async function leaveChannel(channelId: string) {
    if (!myProfile || !window.confirm('Leave this channel?')) return
    await supabase.from('channel_members').delete().eq('channel_id', channelId).eq('user_id', myProfile.id)
    setMyChannels(prev => prev.filter(c=>c.id!==channelId))
    if (activeChannelId === channelId) { setActiveChannelId(null); navigate('/channels', { replace:true }) }
  }

  async function muteChannel(channelId: string, mute: boolean) {
    if (!myProfile) return
    await supabase.from('channel_members').update({ is_muted:mute }).eq('channel_id', channelId).eq('user_id', myProfile.id)
    setMyChannels(prev => prev.map(c=>c.id===channelId?{...c,is_muted:mute}:c))
  }

  // ── Create channel ────────────────────────────────────────────
  async function handleCreateChannel() {
    if (!newChannelName.trim() || !myProfile || creating) return
    setCreating(true)
    const name = newChannelName.trim().toLowerCase().replace(/\s+/g,'-')
    const { data: ch } = await supabase.from('channels').insert({
      name, description:newChannelDesc.trim()||null, type:newChannelType, created_by:myProfile.id
    }).select().single()
    if (ch) {
      await supabase.from('channel_members').insert({ channel_id:ch.id, user_id:myProfile.id, role:'owner' })
      await loadMyChannels(myProfile.id)
      setShowCreate(false); setNewChannelName(''); setNewChannelDesc(''); setNewChannelType('public')
      openChannel(ch.id)
    }
    setCreating(false)
  }

  // ── Load all channels for browse ─────────────────────────────
  async function loadAllChannels() {
    const { data } = await supabase.from('channels').select('*').eq('is_archived', false).order('name')
    setAllChannels((data??[]) as Channel[])
  }

  function groupByDate(msgs: ChannelMessage[]) {
    const groups: { label:string; messages:ChannelMessage[] }[] = []
    msgs.forEach(msg => {
      const label = formatDate(msg.created_at)
      const g = groups.find(x=>x.label===label)
      if (g) g.messages.push(msg); else groups.push({ label, messages:[msg] })
    })
    return groups
  }

  const totalUnread = Object.values(unreadCounts).reduce((s,n)=>s+n,0)
  const typingLabel = typers.length===1 ? `${typers[0]} is typing…` : typers.length>1 ? `${typers.slice(0,-1).join(', ')} and ${typers.slice(-1)} are typing…` : ''
  const isMyChannel = (channelId: string) => myChannels.some(c=>c.id===channelId)

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', fontFamily:'Nunito,sans-serif', color:'var(--text-faint)' }}>
      Loading channels…
    </div>
  )

  return (
    <>
      <style>{`
        @keyframes fadeIn  { from{opacity:0} to{opacity:1} }
        @keyframes slideIn { from{opacity:0;transform:translateX(20px)} to{opacity:1;transform:translateX(0)} }
        @keyframes msgIn   { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes popIn   { from{opacity:0;transform:scale(0.85) translateY(4px)} to{opacity:1;transform:scale(1) translateY(0)} }
        @keyframes reactPop{ from{opacity:0;transform:scale(0.4)} to{opacity:1;transform:scale(1)} }
        @keyframes typeBounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-5px)} }

        *,*::before,*::after { box-sizing:border-box; }

        .ch-page { display:flex;flex-direction:column;height:100vh;font-family:'Nunito','Segoe UI',system-ui,sans-serif;background:var(--bg-page);overflow:hidden; }
        .ch-shell { display:flex;flex:1;min-height:0;overflow:hidden; }

        /* ══════════════════════════════════════
           SIDEBAR
        ══════════════════════════════════════ */
        .ch-sidebar { width:260px;flex-shrink:0;background:#1A2B3C;display:flex;flex-direction:column;overflow:hidden; }

        .ch-sidebar-brand { display:flex;align-items:center;justify-content:space-between;padding:1rem 1rem 0.85rem;border-bottom:1px solid rgba(255,255,255,0.07); }
        .ch-brand-name { font-size:0.95rem;font-weight:800;color:white;letter-spacing:-0.01em; }
        .ch-brand-tag { font-size:0.6rem;color:rgba(255,255,255,0.3);display:block;margin-top:0.1rem; }
        .ch-new-btn { width:26px;height:26px;border-radius:6px;background:rgba(255,255,255,0.08);border:none;color:rgba(255,255,255,0.5);font-size:1.1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.12s;flex-shrink:0; }
        .ch-new-btn:hover { background:rgba(255,255,255,0.14);color:white; }

        /* Jump to */
        .ch-jump-section { padding:0.65rem 0.5rem 0.35rem; }
        .ch-jump-btn { display:flex;align-items:center;gap:0.55rem;width:100%;padding:0.42rem 0.7rem;border:none;background:transparent;border-radius:6px;font-size:0.82rem;color:rgba(255,255,255,0.45);cursor:pointer;font-family:inherit;transition:all 0.12s;text-align:left; }
        .ch-jump-btn:hover { background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.8); }

        /* Channel sections */
        .ch-sidebar-scroll { flex:1;overflow-y:auto; }
        .ch-sidebar-scroll::-webkit-scrollbar { width:0; }
        .ch-section { padding:0.6rem 0 0; }
        .ch-section-header { display:flex;align-items:center;justify-content:space-between;padding:0.25rem 0.65rem 0.35rem;cursor:pointer; }
        .ch-section-header:hover .ch-section-label { color:rgba(255,255,255,0.7); }
        .ch-section-label { font-size:0.65rem;font-weight:800;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.1em; }
        .ch-section-add { width:18px;height:18px;border-radius:4px;background:transparent;border:none;color:rgba(255,255,255,0.25);font-size:0.85rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.12s;font-family:inherit; }
        .ch-section-add:hover { background:rgba(255,255,255,0.08);color:white; }

        .ch-channel-item { display:flex;align-items:center;gap:0.5rem;padding:0.38rem 0.65rem;cursor:pointer;border-radius:6px;margin:0 0.35rem 0.08rem;transition:all 0.12s;border:none;background:transparent;width:calc(100% - 0.7rem);text-align:left;font-family:inherit; }
        .ch-channel-item:hover { background:rgba(255,255,255,0.07); }
        .ch-channel-item.active { background:rgba(75,172,198,0.18); }
        .ch-channel-type-icon { font-size:0.8rem;opacity:0.5;flex-shrink:0;width:14px;text-align:center; }
        .ch-channel-item.active .ch-channel-type-icon { opacity:0.8; }
        .ch-channel-name { font-size:0.83rem;font-weight:500;color:rgba(255,255,255,0.5);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .ch-channel-item.active .ch-channel-name { color:white;font-weight:700; }
        .ch-channel-item.has-unread .ch-channel-name { color:rgba(255,255,255,0.85);font-weight:700; }
        .ch-unread-badge { min-width:18px;height:18px;border-radius:9px;background:#C0504D;color:white;font-size:0.6rem;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 4px;flex-shrink:0; }
        .ch-muted-icon { font-size:0.65rem;color:rgba(255,255,255,0.2);flex-shrink:0; }

        /* Browse button */
        .ch-browse-btn { display:flex;align-items:center;gap:0.55rem;padding:0.42rem 1.05rem;margin:0.35rem 0.35rem 0;border:none;background:transparent;color:rgba(255,255,255,0.3);font-size:0.78rem;cursor:pointer;font-family:inherit;transition:color 0.12s;width:calc(100% - 0.7rem);border-radius:6px; }
        .ch-browse-btn:hover { color:rgba(255,255,255,0.7);background:rgba(255,255,255,0.05); }

        /* Sidebar footer */
        .ch-sidebar-footer { padding:0.75rem;border-top:1px solid rgba(255,255,255,0.07);flex-shrink:0; }
        .ch-sidebar-user { display:flex;align-items:center;gap:0.6rem;padding:0.4rem 0.3rem;border-radius:7px;cursor:pointer;transition:background 0.12s; }
        .ch-sidebar-user:hover { background:rgba(255,255,255,0.06); }
        .ch-sidebar-user-name { font-size:0.8rem;font-weight:700;color:rgba(255,255,255,0.75);display:block;line-height:1.2; }
        .ch-sidebar-user-role { font-size:0.62rem;color:rgba(255,255,255,0.3);display:block;text-transform:capitalize; }

        /* ══════════════════════════════════════
           MAIN AREA
        ══════════════════════════════════════ */
        .ch-main { flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden; }

        /* Header */
        .ch-header { display:flex;align-items:center;gap:0.75rem;padding:0 1.25rem;height:56px;background:var(--bg-surface);border-bottom:1px solid var(--border);flex-shrink:0;box-shadow:var(--shadow-sm); }
        .ch-header-icon { font-size:1rem;color:var(--text-faint);flex-shrink:0; }
        .ch-header-name { font-size:1rem;font-weight:800;color:var(--text-primary);cursor:pointer; }
        .ch-header-name:hover { color:#4BACC6; }
        .ch-header-desc { font-size:0.75rem;color:var(--text-faint);margin-left:0.5rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px; }
        .ch-header-divider { width:1px;height:16px;background:var(--border);flex-shrink:0; }
        .ch-header-btn { display:flex;align-items:center;gap:0.35rem;padding:0.38rem 0.75rem;background:var(--bg-page);border:1px solid var(--border);border-radius:7px;font-size:0.75rem;font-weight:600;color:var(--text-muted);cursor:pointer;transition:all 0.12s;font-family:inherit;white-space:nowrap;flex-shrink:0; }
        .ch-header-btn:hover { border-color:#4BACC6;color:var(--text-primary);background:var(--bg-active); }
        .ch-header-btn.active { background:var(--bg-active);border-color:#4BACC6;color:#243F60; }
        .ch-header-right { margin-left:auto;display:flex;align-items:center;gap:0.4rem; }
        .ch-announcement-badge { display:flex;align-items:center;gap:0.35rem;padding:0.28rem 0.65rem;background:rgba(192,80,77,0.08);border:1px solid rgba(192,80,77,0.2);border-radius:6px;font-size:0.68rem;font-weight:700;color:#C0504D;flex-shrink:0; }

        /* Pinned bar */
        .ch-pinned-bar { display:flex;align-items:center;gap:0.65rem;padding:0.5rem 1.25rem;background:#FFFBEB;border-bottom:1px solid #FDE68A;flex-shrink:0;cursor:pointer;transition:background 0.12s; }
        .ch-pinned-bar:hover { background:#FEF3C7; }
        .ch-pinned-icon { color:#D97706;font-size:0.82rem;flex-shrink:0; }
        .ch-pinned-text { font-size:0.78rem;color:#92400E;font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .ch-pinned-count { font-size:0.68rem;color:#D97706;font-weight:700;flex-shrink:0; }

        /* Messages area */
        .ch-content { display:flex;flex:1;min-height:0;overflow:hidden; }
        .ch-messages-wrap { flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden; }
        .ch-messages { flex:1;overflow-y:auto;padding:1rem 0;display:flex;flex-direction:column; }
        .ch-messages::-webkit-scrollbar { width:5px; }
        .ch-messages::-webkit-scrollbar-thumb { background:var(--border);border-radius:999px; }

        /* Date divider */
        .ch-date-divider { display:flex;align-items:center;gap:0.75rem;padding:0.75rem 1.25rem; }
        .ch-date-line { flex:1;height:1px;background:var(--border); }
        .ch-date-label { font-size:0.68rem;font-weight:700;color:var(--text-faint);white-space:nowrap;letter-spacing:0.06em;background:var(--bg-page);padding:0 0.5rem;border:1px solid var(--border);border-radius:999px; }

        /* Message row */
        .ch-msg { display:flex;gap:0.75rem;padding:0.2rem 1.25rem;animation:msgIn 0.2s ease both;position:relative; }
        .ch-msg:hover { background:var(--bg-hover); }
        .ch-msg.ch-msg-continued { padding-top:0.05rem; }
        .ch-msg-avatar-col { width:36px;flex-shrink:0;margin-top:2px; }
        .ch-msg-avatar-spacer { width:36px;flex-shrink:0; }
        .ch-msg-time-spacer { width:36px;flex-shrink:0;display:flex;align-items:center;justify-content:flex-end;opacity:0; }
        .ch-msg:hover .ch-msg-time-spacer { opacity:1; }
        .ch-msg-time-inline { font-size:0.62rem;color:var(--text-ghost);padding-right:0.35rem;font-variant-numeric:tabular-nums; }
        .ch-msg-body { flex:1;min-width:0; }
        .ch-msg-header { display:flex;align-items:baseline;gap:0.5rem;margin-bottom:0.18rem; }
        .ch-msg-name { font-size:0.88rem;font-weight:800;color:var(--text-primary);cursor:pointer; }
        .ch-msg-name:hover { color:#4BACC6; }
        .ch-msg-timestamp { font-size:0.68rem;color:var(--text-faint); }
        .ch-msg-content { font-size:0.9rem;color:var(--text-secondary);line-height:1.65;word-break:break-word;white-space:pre-wrap; }
        .ch-msg-content.app-only { font-style:italic;color:var(--text-faint); }
        .ch-edited-tag { font-size:0.65rem;color:var(--text-ghost);margin-left:0.3rem; }
        .ch-mention { color:#4BACC6;background:rgba(75,172,198,0.1);border-radius:3px;padding:0 2px;cursor:pointer;font-weight:700; }
        .ch-mention:hover { background:rgba(75,172,198,0.2); }
        .ch-link { color:#4BACC6;text-decoration:underline; }
        .ch-link:hover { color:#243F60; }
        .ch-code-block { background:var(--bg-subtle);border:1px solid var(--border);border-radius:6px;padding:0.6rem 0.85rem;font-size:0.82rem;font-family:'JetBrains Mono','Fira Code',monospace;overflow-x:auto;margin:0.4rem 0;color:var(--text-primary);line-height:1.55;white-space:pre; }
        .ch-inline-code { background:var(--bg-subtle);border:1px solid var(--border);border-radius:3px;padding:0.1em 0.35em;font-size:0.85em;font-family:'JetBrains Mono','Fira Code',monospace;color:#C0504D; }

        /* Attachment */
        .ch-msg-img { max-width:360px;max-height:260px;object-fit:cover;border-radius:8px;display:block;margin-top:0.5rem;cursor:zoom-in;border:1px solid var(--border); }
        .ch-file-card { display:inline-flex;align-items:center;gap:0.6rem;padding:0.55rem 0.85rem;background:var(--bg-page);border:1px solid var(--border);border-radius:10px;margin-top:0.5rem;text-decoration:none;transition:border-color 0.12s;max-width:300px; }
        .ch-file-card:hover { border-color:#4BACC6; }
        .ch-file-icon { font-size:1.35rem;flex-shrink:0; }
        .ch-file-name { font-size:0.82rem;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1; }
        .ch-file-type { font-size:0.65rem;color:var(--text-faint); }

        /* Reactions */
        .ch-reactions { display:flex;flex-wrap:wrap;gap:3px;margin-top:4px; }
        .ch-reaction-pill { display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:999px;border:1px solid var(--border);background:var(--bg-surface);font-size:0.8rem;cursor:pointer;transition:all 0.12s;position:relative;animation:reactPop 0.2s cubic-bezier(0.34,1.56,0.64,1); }
        .ch-reaction-pill:hover { border-color:#4BACC6;background:var(--bg-active); }
        .ch-reaction-pill.mine { border-color:#4BACC6;background:var(--bg-active); }
        .ch-reaction-count { font-size:0.72rem;font-weight:700;color:var(--text-secondary); }
        .ch-reaction-pill.mine .ch-reaction-count { color:#365F91; }
        .ch-reaction-tooltip { position:absolute;bottom:calc(100%+4px);left:50%;transform:translateX(-50%);background:#0f1d2a;color:white;font-size:0.68rem;padding:0.28rem 0.55rem;border-radius:6px;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity 0.15s;z-index:50; }
        .ch-reaction-pill:hover .ch-reaction-tooltip { opacity:1; }

        /* Thread reply count */
        .ch-thread-count { display:inline-flex;align-items:center;gap:0.35rem;margin-top:0.35rem;font-size:0.75rem;font-weight:700;color:#4BACC6;cursor:pointer;padding:0.2rem 0;border-radius:4px;transition:all 0.12s; }
        .ch-thread-count:hover { text-decoration:underline; }
        .ch-thread-count-avatars { display:flex;gap:-2px; }

        /* Hover actions */
        .ch-msg-actions { position:absolute;right:1rem;top:50%;transform:translateY(-50%);display:flex;gap:2px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:2px;box-shadow:var(--shadow-md);opacity:0;pointer-events:none;transition:opacity 0.15s;z-index:20; }
        .ch-msg:hover .ch-msg-actions { opacity:1;pointer-events:auto; }
        .ch-msg-action { width:28px;height:28px;border-radius:6px;border:none;background:transparent;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text-muted);font-size:0.82rem;transition:all 0.12s;font-family:inherit; }
        .ch-msg-action:hover { background:var(--bg-hover);color:var(--text-primary); }
        .ch-msg-action.danger:hover { background:#FEF2F2;color:#dc2626; }
        .ch-msg-action.pinned { color:#D97706; }
        .ch-react-btn { }

        /* Emoji picker */
        .ch-emoji-picker { position:absolute;bottom:calc(100%+6px);right:0;background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:0.4rem;box-shadow:var(--shadow-lg);display:flex;gap:2px;z-index:100;animation:popIn 0.15s cubic-bezier(0.34,1.56,0.64,1); }
        .ch-emoji-btn { width:32px;height:32px;border-radius:7px;border:none;background:transparent;font-size:1.05rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.1s; }
        .ch-emoji-btn:hover { background:var(--bg-hover); }

        /* Edit in place */
        .ch-edit-wrap { margin-top:0.25rem; }
        .ch-edit-textarea { width:100%;padding:0.5rem 0.75rem;border:1.5px solid #4BACC6;border-radius:8px;font-size:0.9rem;color:var(--text-primary);font-family:inherit;resize:none;outline:none;background:var(--bg-surface);line-height:1.6;box-shadow:0 0 0 3px rgba(75,172,198,0.1); }
        .ch-edit-hint { font-size:0.68rem;color:var(--text-faint);margin-top:0.25rem; }
        .ch-edit-actions { display:flex;gap:0.4rem;margin-top:0.4rem; }
        .ch-edit-save { padding:0.32rem 0.85rem;background:#365F91;color:white;border:none;border-radius:7px;font-size:0.75rem;font-weight:700;cursor:pointer;font-family:inherit; }
        .ch-edit-save:hover { background:#243F60; }
        .ch-edit-cancel { padding:0.32rem 0.75rem;background:var(--bg-hover);color:var(--text-muted);border:1px solid var(--border);border-radius:7px;font-size:0.75rem;font-weight:600;cursor:pointer;font-family:inherit; }

        /* Typing */
        .ch-typing-row { display:flex;align-items:center;gap:0.6rem;padding:0.4rem 1.25rem;animation:msgIn 0.2s ease; }
        .ch-typing-dots { display:flex;gap:3px;align-items:center; }
        .ch-typing-dot { width:6px;height:6px;border-radius:50%;background:var(--text-faint);animation:typeBounce 1.1s ease-in-out infinite; }
        .ch-typing-dot:nth-child(2) { animation-delay:0.18s; }
        .ch-typing-dot:nth-child(3) { animation-delay:0.36s; }
        .ch-typing-name { font-size:0.75rem;color:var(--text-faint);font-style:italic; }

        /* Welcome screen */
        .ch-welcome { padding:2rem 1.5rem;flex:1; }
        .ch-welcome-icon { font-size:2.5rem;margin-bottom:0.75rem; }
        .ch-welcome-title { font-size:1.5rem;font-weight:900;color:var(--text-primary);margin-bottom:0.5rem;letter-spacing:-0.02em; }
        .ch-welcome-desc { font-size:0.9rem;color:var(--text-muted);line-height:1.65;max-width:480px; }
        .ch-welcome-announcement { display:flex;align-items:flex-start;gap:0.5rem;background:rgba(192,80,77,0.06);border:1px solid rgba(192,80,77,0.15);border-radius:10px;padding:0.75rem 1rem;margin-top:1rem;max-width:480px;font-size:0.82rem;color:var(--text-secondary);line-height:1.55; }

        /* Input area */
        .ch-input-area { padding:0.75rem 1.25rem 1rem;background:var(--bg-surface);border-top:1px solid var(--border);flex-shrink:0;position:relative; }
        .ch-input-box { background:var(--bg-page);border:1.5px solid var(--border);border-radius:12px;overflow:hidden;transition:border-color 0.15s; }
        .ch-input-box:focus-within { border-color:#4BACC6;box-shadow:0 0 0 3px rgba(75,172,198,0.08); }
        .ch-input-toolbar { display:flex;align-items:center;gap:0.25rem;padding:0.4rem 0.6rem;border-bottom:1px solid var(--border-light); }
        .ch-toolbar-btn { width:26px;height:26px;border-radius:5px;border:none;background:transparent;color:var(--text-faint);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:0.82rem;transition:all 0.12s; }
        .ch-toolbar-btn:hover { background:var(--bg-hover);color:var(--text-primary); }
        .ch-input-row { display:flex;align-items:flex-end;gap:0.5rem;padding:0.5rem 0.65rem; }
        .ch-input-row textarea { flex:1;border:none;outline:none;font-size:0.9rem;color:var(--text-primary);background:transparent;resize:none;min-height:22px;max-height:150px;line-height:1.55;font-family:inherit;padding:0.1rem 0; }
        .ch-input-row textarea::placeholder { color:var(--text-faint); }
        .ch-send-btn { width:32px;height:32px;border-radius:8px;background:#365F91;border:none;color:white;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:0.88rem;transition:all 0.15s;flex-shrink:0; }
        .ch-send-btn:hover:not(:disabled) { background:#243F60; }
        .ch-send-btn:disabled { opacity:0.35;cursor:not-allowed; }
        .ch-input-hint { font-size:0.65rem;color:var(--text-ghost);margin-top:0.3rem; }
        .ch-readonly-notice { text-align:center;padding:0.75rem;font-size:0.82rem;color:var(--text-faint);background:var(--bg-subtle);border-top:1px solid var(--border); }

        /* Pending file */
        .ch-pending-file { display:flex;align-items:center;gap:0.6rem;padding:0.4rem 0.65rem;border-bottom:1px solid var(--border-light);background:rgba(75,172,198,0.05); }
        .ch-pending-preview { width:36px;height:36px;border-radius:5px;object-fit:cover;flex-shrink:0; }
        .ch-pending-name { font-size:0.78rem;font-weight:600;color:var(--text-primary);flex:1; }
        .ch-pending-remove { background:none;border:none;color:var(--text-faint);cursor:pointer;font-size:0.8rem;padding:0.15rem;border-radius:4px;transition:all 0.12s; }
        .ch-pending-remove:hover { color:#dc2626;background:#FEF2F2; }

        /* Drag overlay */
        .ch-drop-overlay { position:absolute;inset:0;background:rgba(75,172,198,0.06);border:3px dashed #4BACC6;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.5rem;pointer-events:none;z-index:50;animation:fadeIn 0.15s; }

        /* Mention suggestions */
        .ch-mention-list { position:absolute;bottom:calc(100%+4px);left:1.25rem;right:1.25rem;background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;box-shadow:var(--shadow-lg);overflow:hidden;z-index:200;animation:popIn 0.15s ease; }
        .ch-mention-header { font-size:0.62rem;font-weight:800;color:var(--text-faint);text-transform:uppercase;letter-spacing:0.09em;padding:0.45rem 0.85rem;background:var(--bg-subtle);border-bottom:1px solid var(--border-light); }
        .ch-mention-item { display:flex;align-items:center;gap:0.6rem;padding:0.55rem 0.85rem;cursor:pointer;transition:background 0.1s;border-bottom:1px solid var(--border-light); }
        .ch-mention-item:last-child { border-bottom:none; }
        .ch-mention-item:hover { background:var(--bg-hover); }
        .ch-mention-name { font-size:0.85rem;font-weight:600;color:var(--text-primary); }
        .ch-mention-role { font-size:0.7rem;color:var(--text-faint);text-transform:capitalize;margin-left:0.3rem; }

        /* ══════════════════════════════════════
           THREAD PANEL
        ══════════════════════════════════════ */
        .ch-thread-panel { width:360px;flex-shrink:0;background:var(--bg-surface);border-left:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;animation:slideIn 0.22s ease; }
        .ch-thread-header { display:flex;align-items:center;justify-content:space-between;padding:0.9rem 1.1rem;border-bottom:1px solid var(--border);flex-shrink:0; }
        .ch-thread-title { font-size:0.95rem;font-weight:800;color:var(--text-primary); }
        .ch-panel-close { width:26px;height:26px;border-radius:6px;background:var(--bg-hover);border:none;color:var(--text-muted);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:0.8rem;transition:all 0.12s; }
        .ch-panel-close:hover { background:var(--bg-active);color:var(--text-primary); }
        .ch-thread-orig { padding:0.85rem 1.1rem;background:var(--bg-subtle);border-bottom:2px solid var(--border);flex-shrink:0; }
        .ch-thread-orig-header { display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem; }
        .ch-thread-orig-name { font-size:0.8rem;font-weight:700;color:var(--text-primary); }
        .ch-thread-orig-time { font-size:0.68rem;color:var(--text-faint); }
        .ch-thread-orig-content { font-size:0.82rem;color:var(--text-secondary);line-height:1.6;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden; }
        .ch-thread-messages { flex:1;overflow-y:auto;padding:0.75rem 1.1rem;display:flex;flex-direction:column;gap:0.75rem; }
        .ch-thread-messages::-webkit-scrollbar { width:3px; }
        .ch-thread-messages::-webkit-scrollbar-thumb { background:var(--border);border-radius:999px; }
        .ch-thread-msg { display:flex;gap:0.6rem; }
        .ch-thread-msg-body { flex:1;min-width:0; }
        .ch-thread-msg-name { font-size:0.8rem;font-weight:700;color:var(--text-primary); }
        .ch-thread-msg-time { font-size:0.67rem;color:var(--text-faint);margin-left:0.4rem; }
        .ch-thread-msg-content { font-size:0.85rem;color:var(--text-secondary);line-height:1.6;margin-top:0.18rem;word-break:break-word;white-space:pre-wrap; }
        .ch-thread-empty { flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-faint);font-size:0.82rem;gap:0.35rem;text-align:center; }
        .ch-thread-input { padding:0.75rem 1.1rem;border-top:1px solid var(--border);flex-shrink:0; }
        .ch-thread-input-wrap { display:flex;align-items:flex-end;gap:0.45rem;background:var(--bg-page);border:1.5px solid var(--border);border-radius:10px;padding:0.45rem 0.6rem;transition:border-color 0.15s; }
        .ch-thread-input-wrap:focus-within { border-color:#4BACC6;background:var(--bg-surface); }
        .ch-thread-input-wrap textarea { flex:1;border:none;outline:none;font-size:0.85rem;color:var(--text-primary);background:transparent;resize:none;min-height:20px;max-height:80px;line-height:1.5;font-family:inherit; }
        .ch-thread-input-wrap textarea::placeholder { color:var(--text-faint); }
        .ch-thread-send { width:28px;height:28px;border-radius:6px;background:#365F91;border:none;color:white;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:0.8rem;flex-shrink:0;transition:background 0.12s; }
        .ch-thread-send:hover:not(:disabled) { background:#243F60; }
        .ch-thread-send:disabled { opacity:0.3;cursor:not-allowed; }
        .ch-thread-hint { font-size:0.64rem;color:var(--text-ghost);margin-top:0.3rem; }

        /* ══════════════════════════════════════
           INFO PANEL
        ══════════════════════════════════════ */
        .ch-info-panel { width:300px;flex-shrink:0;background:var(--bg-surface);border-left:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;animation:slideIn 0.22s ease; }
        .ch-info-body { flex:1;overflow-y:auto;padding:0; }
        .ch-info-body::-webkit-scrollbar { width:3px; }
        .ch-info-section { border-bottom:1px solid var(--border); }
        .ch-info-section-header { display:flex;align-items:center;justify-content:space-between;padding:0.75rem 1rem;cursor:pointer;transition:background 0.1s; }
        .ch-info-section-header:hover { background:var(--bg-hover); }
        .ch-info-section-label { font-size:0.78rem;font-weight:800;color:var(--text-primary); }
        .ch-info-section-body { padding:0 1rem 1rem; }
        .ch-info-member { display:flex;align-items:center;gap:0.6rem;padding:0.45rem 0;border-bottom:1px solid var(--border-light);cursor:pointer;transition:background 0.1s;border-radius:6px; }
        .ch-info-member:last-child { border-bottom:none; }
        .ch-info-member:hover { background:var(--bg-hover);padding-left:0.35rem; }
        .ch-info-member-name { font-size:0.82rem;font-weight:600;color:var(--text-primary);flex:1; }
        .ch-info-member-role { font-size:0.65rem;color:var(--text-faint);text-transform:capitalize; }
        .ch-info-pinned-item { padding:0.5rem 0;border-bottom:1px solid var(--border-light); }
        .ch-info-pinned-item:last-child { border-bottom:none; }
        .ch-info-pinned-text { font-size:0.8rem;color:var(--text-secondary);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden; }
        .ch-info-pinned-meta { font-size:0.68rem;color:var(--text-faint);margin-top:0.2rem; }
        .ch-info-danger-btn { width:100%;padding:0.6rem;border:1.5px solid rgba(192,80,77,0.25);border-radius:8px;background:transparent;color:#C0504D;font-size:0.82rem;font-weight:700;cursor:pointer;font-family:inherit;transition:all 0.15s;margin-top:0.75rem; }
        .ch-info-danger-btn:hover { background:rgba(192,80,77,0.08); }

        /* ══════════════════════════════════════
           MODALS
        ══════════════════════════════════════ */
        .ch-modal-overlay { position:fixed;inset:0;z-index:500;background:rgba(0,0,0,0.4);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;animation:fadeIn 0.15s; }
        .ch-modal { background:var(--bg-surface);border-radius:16px;width:520px;max-width:calc(100vw - 2rem);max-height:80vh;box-shadow:var(--shadow-lg);overflow:hidden;display:flex;flex-direction:column;animation:popIn 0.22s cubic-bezier(0.34,1.2,0.64,1); }
        .ch-modal-header { display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;border-bottom:1px solid var(--border);flex-shrink:0; }
        .ch-modal-title { font-size:1rem;font-weight:800;color:var(--text-primary); }
        .ch-modal-close { background:var(--bg-hover);border:none;width:28px;height:28px;border-radius:7px;color:var(--text-muted);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:0.82rem;transition:all 0.12s; }
        .ch-modal-close:hover { background:var(--bg-active);color:var(--text-primary); }
        .ch-modal-body { flex:1;overflow-y:auto;padding:1.1rem 1.25rem; }
        .ch-modal-body::-webkit-scrollbar { width:3px; }
        .ch-modal-body::-webkit-scrollbar-thumb { background:var(--border);border-radius:999px; }
        .ch-modal-footer { padding:0.85rem 1.25rem;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:0.5rem;flex-shrink:0;background:var(--bg-subtle); }

        /* Browse */
        .ch-browse-search { width:100%;padding:0.6rem 0.85rem;border:1.5px solid var(--border);border-radius:9px;font-size:0.88rem;color:var(--text-primary);background:var(--bg-page);font-family:inherit;outline:none;margin-bottom:1rem; }
        .ch-browse-search:focus { border-color:#4BACC6; }
        .ch-browse-item { display:flex;align-items:center;gap:0.75rem;padding:0.75rem 0;border-bottom:1px solid var(--border-light); }
        .ch-browse-item:last-child { border-bottom:none; }
        .ch-browse-icon { width:36px;height:36px;border-radius:8px;background:var(--bg-page);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:0.88rem;flex-shrink:0; }
        .ch-browse-info { flex:1;min-width:0; }
        .ch-browse-name { font-size:0.88rem;font-weight:700;color:var(--text-primary); }
        .ch-browse-desc { font-size:0.73rem;color:var(--text-faint);margin-top:0.1rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .ch-browse-meta { font-size:0.68rem;color:var(--text-ghost);margin-top:0.15rem; }
        .ch-browse-join { padding:0.38rem 0.85rem;border-radius:7px;font-size:0.78rem;font-weight:700;cursor:pointer;font-family:inherit;transition:all 0.15s;flex-shrink:0;border:none; }
        .ch-browse-join.join { background:#EEF4FB;color:#365F91; }
        .ch-browse-join.join:hover { background:#C5D9F1; }
        .ch-browse-join.open { background:var(--bg-page);color:var(--text-muted);border:1px solid var(--border); }
        .ch-browse-join.open:hover { border-color:#4BACC6;color:var(--text-primary); }

        /* Create */
        .ch-field { margin-bottom:1rem; }
        .ch-label { display:block;font-size:0.78rem;font-weight:700;color:var(--text-secondary);margin-bottom:0.4rem; }
        .ch-input { width:100%;padding:0.65rem 0.9rem;border:1.5px solid var(--border);border-radius:9px;font-size:0.9rem;color:var(--text-primary);background:var(--bg-page);font-family:inherit;outline:none;transition:border-color 0.15s; }
        .ch-input:focus { border-color:#4BACC6;box-shadow:0 0 0 3px rgba(75,172,198,0.1); }
        .ch-type-grid { display:grid;grid-template-columns:1fr 1fr;gap:0.65rem; }
        .ch-type-card { padding:0.85rem 1rem;border:2px solid var(--border);border-radius:10px;cursor:pointer;transition:all 0.15s;background:var(--bg-surface);font-family:inherit;text-align:left; }
        .ch-type-card:hover { border-color:#4BACC6; }
        .ch-type-card.selected { border-color:#4BACC6;background:var(--bg-active); }
        .ch-type-card-icon { font-size:1.1rem;margin-bottom:0.3rem; }
        .ch-type-card-label { font-size:0.82rem;font-weight:700;color:var(--text-primary); }
        .ch-type-card-desc { font-size:0.7rem;color:var(--text-faint);margin-top:0.15rem;line-height:1.4; }

        /* Buttons */
        .ch-btn-primary { padding:0.6rem 1.25rem;background:#243F60;color:white;border:none;border-radius:9px;font-size:0.85rem;font-weight:700;cursor:pointer;font-family:inherit;transition:background 0.15s; }
        .ch-btn-primary:hover:not(:disabled) { background:#365F91; }
        .ch-btn-primary:disabled { opacity:0.4;cursor:not-allowed; }
        .ch-btn-ghost { padding:0.6rem 1.1rem;background:transparent;color:var(--text-muted);border:1px solid var(--border);border-radius:9px;font-size:0.85rem;font-weight:600;cursor:pointer;font-family:inherit;transition:all 0.15s; }
        .ch-btn-ghost:hover { background:var(--bg-hover); }

        /* Empty */
        .ch-empty { flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-faint);gap:0.75rem;padding:3rem;text-align:center; }
        .ch-empty-icon { font-size:3rem;opacity:0.3; }

        @media(max-width:900px) { .ch-sidebar{width:220px} .ch-thread-panel,.ch-info-panel{width:300px} }
        @media(max-width:768px) { .ch-sidebar{display:none} .ch-thread-panel,.ch-info-panel{position:fixed;right:0;top:60px;bottom:0;z-index:300;box-shadow:-4px 0 20px rgba(0,0,0,0.15)} }
      `}</style>

      <div className="ch-page">
        <Navbar fullName={myProfile?.full_name ?? null} role={myProfile?.role ?? 'employee'} />

        <div className="ch-shell">

          {/* ══════════════════════════════════════
              SIDEBAR
          ══════════════════════════════════════ */}
          <div className="ch-sidebar">
            {/* Brand */}
            <div className="ch-sidebar-brand">
              <div>
                <div className="ch-brand-name">InfoWall</div>
                <div className="ch-brand-tag">Channels</div>
              </div>
              <button className="ch-new-btn" onClick={() => setShowCreate(true)} title="New channel">+</button>
            </div>

            {/* Jump to */}
            <div className="ch-jump-section">
              {[
                { icon:'⊞', label:'Dashboard', path:'/dashboard' },
                { icon:'✉', label:'Messages', path:'/messages' },
                { icon:'👥', label:'Directory', path:'/directory' },
              ].map(j => (
                <button key={j.path} className="ch-jump-btn" onClick={() => navigate(j.path)}>
                  <span style={{ fontSize:'0.82rem' }}>{j.icon}</span> {j.label}
                </button>
              ))}
            </div>

            <div className="ch-sidebar-scroll">
              {/* Channels section */}
              <div className="ch-section">
                <div className="ch-section-header" onClick={() => setShowCreate(true)}>
                  <span className="ch-section-label">Channels</span>
                  <button className="ch-section-add" title="Add channel">+</button>
                </div>

                {myChannels.map(ch => {
                  const unread = unreadCounts[ch.id] ?? 0
                  const isActive = activeChannelId === ch.id
                  return (
                    <button
                      key={ch.id}
                      className={`ch-channel-item${isActive ? ' active' : ''}${unread > 0 && !ch.is_muted ? ' has-unread' : ''}`}
                      onClick={() => openChannel(ch.id)}
                    >
                      <span className="ch-channel-type-icon">{TYPE_ICON[ch.type]}</span>
                      <span className="ch-channel-name">{ch.name}</span>
                      {ch.is_muted && <span className="ch-muted-icon">🔕</span>}
                      {unread > 0 && !ch.is_muted && <span className="ch-unread-badge">{unread > 99 ? '99+' : unread}</span>}
                    </button>
                  )
                })}

                <button className="ch-browse-btn" onClick={() => { loadAllChannels(); setShowBrowse(true) }}>
                  <span style={{ fontSize:'0.75rem' }}>⊕</span> Browse all channels
                </button>
              </div>
            </div>

            {/* Footer */}
            <div className="ch-sidebar-footer">
              <div className="ch-sidebar-user" onClick={() => myProfile && navigate(`/profile/${myProfile.id}`)}>
                <Avatar name={myProfile?.full_name ?? null} size={30} />
                <div>
                  <span className="ch-sidebar-user-name">{myProfile?.full_name?.split(' ')[0] ?? 'You'}</span>
                  <span className="ch-sidebar-user-role">{myProfile?.role}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ══════════════════════════════════════
              MAIN CHAT AREA
          ══════════════════════════════════════ */}
          <div className="ch-main">
            {activeChannel ? (
              <>
                {/* Header */}
                <div className="ch-header">
                  <span className="ch-header-icon">{TYPE_ICON[activeChannel.type]}</span>
                  <span className="ch-header-name" onClick={() => { setShowInfo(p=>!p); setSelectedThread(null); setShowPinnedList(false) }}>
                    {activeChannel.name}
                  </span>
                  {activeChannel.description && <span className="ch-header-desc">— {activeChannel.description}</span>}
                  {isAnnouncement && (
                    <div className="ch-announcement-badge">📢 Announcements only</div>
                  )}
                  <div className="ch-header-right">
                    {pinnedMessages.length > 0 && (
                      <button className={`ch-header-btn${showPinnedList?' active':''}`} onClick={() => { setShowPinnedList(p=>!p); setShowInfo(false); setSelectedThread(null) }}>
                        📌 {pinnedMessages.length} pinned
                      </button>
                    )}
                    <button className={`ch-header-btn${showInfo?' active':''}`} onClick={() => { setShowInfo(p=>!p); setSelectedThread(null); setShowPinnedList(false) }}>
                      👥 {channelMembers.length}
                    </button>
                    <button className="ch-header-btn" onClick={() => muteChannel(activeChannel.id, !activeChannel.is_muted)}>
                      {activeChannel.is_muted ? '🔔 Unmute' : '🔕 Mute'}
                    </button>
                    <button className="ch-header-btn" onClick={() => { setShowInfo(p=>!p); setSelectedThread(null) }}>
                      ℹ Info
                    </button>
                  </div>
                </div>

                {/* Pinned bar */}
                {pinnedMessages.length > 0 && !showPinnedList && (
                  <div className="ch-pinned-bar" onClick={() => setShowPinnedList(true)}>
                    <span className="ch-pinned-icon">📌</span>
                    <span className="ch-pinned-text">{pinnedMessages[0].content}</span>
                    <span className="ch-pinned-count">{pinnedMessages.length} pinned</span>
                  </div>
                )}

                <div className="ch-content">
                  <div className="ch-messages-wrap">
                    {/* Messages */}
                    <div className="ch-messages">
                      {/* Channel welcome */}
                      <div className="ch-welcome">
                        <div className="ch-welcome-icon">{TYPE_ICON[activeChannel.type]}</div>
                        <div className="ch-welcome-title">Welcome to #{activeChannel.name}</div>
                        <div className="ch-welcome-desc">
                          {activeChannel.description ?? `This is the beginning of the #${activeChannel.name} channel.`}
                          {` · ${channelMembers.length} member${channelMembers.length!==1?'s':''}`}
                        </div>
                        {isAnnouncement && !canPost && (
                          <div className="ch-welcome-announcement">
                            <span>📢</span>
                            <span>This is a read-only channel. Only admins and HR can post here.</span>
                          </div>
                        )}
                      </div>

                      {loadingMessages ? (
                        <div style={{ textAlign:'center', color:'var(--text-faint)', padding:'1rem', fontSize:'0.85rem' }}>Loading messages…</div>
                      ) : messages.length === 0 ? null : groupByDate(messages).map(group => (
                        <div key={group.label}>
                          <div className="ch-date-divider">
                            <div className="ch-date-line" />
                            <div className="ch-date-label">{group.label}</div>
                            <div className="ch-date-line" />
                          </div>
                          {group.messages.map((msg, i) => {
                            const prevMsg = group.messages[i-1]
                            const isContinued = prevMsg && prevMsg.sender_id === msg.sender_id &&
                              new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime() < 300000
                            const isEditing = editingMsgId === msg.id
                            const isMine = msg.sender_id === myProfile?.id
                            const msgReactions = groupReactionsByEmoji(msg.id)
                            const hasImage = msg.attachment_url && msg.attachment_type && IMAGE_TYPES.includes(msg.attachment_type)
                            const hasFile = msg.attachment_url && !hasImage

                            return (
                              <div
                                key={msg.id}
                                className={`ch-msg${isContinued ? ' ch-msg-continued' : ''}`}
                                onMouseEnter={() => setHoveredMsgId(msg.id)}
                                onMouseLeave={() => { setHoveredMsgId(null); if(showEmojiFor===msg.id) setShowEmojiFor(null) }}
                              >
                                {isContinued ? (
                                  <div className="ch-msg-time-spacer">
                                    {hoveredMsgId === msg.id && (
                                      <span className="ch-msg-time-inline">{formatTime(msg.created_at).replace(' ', '')}</span>
                                    )}
                                  </div>
                                ) : (
                                  <div className="ch-msg-avatar-col">
                                    <Avatar
                                      name={msg.sender?.full_name ?? null}
                                      size={36}
                                      statusKey={presenceUsers.find(u=>u.user_id===msg.sender_id)?.status}
                                    />
                                  </div>
                                )}

                                <div className="ch-msg-body">
                                  {!isContinued && (
                                    <div className="ch-msg-header">
                                      <span className="ch-msg-name" onClick={() => navigate(`/profile/${msg.sender_id}`)}>
                                        {msg.sender?.full_name ?? 'Unknown'}
                                      </span>
                                      <span className="ch-msg-timestamp">{formatTime(msg.created_at)}</span>
                                      {msg.edited_at && <span className="ch-edited-tag">(edited)</span>}
                                    </div>
                                  )}

                                  {isEditing ? (
                                    <div className="ch-edit-wrap">
                                      <textarea
                                        className="ch-edit-textarea"
                                        value={editingText}
                                        autoFocus
                                        onChange={e => { setEditingText(e.target.value); e.target.style.height='auto'; e.target.style.height=e.target.scrollHeight+'px' }}
                                        onKeyDown={e => {
                                          if (e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); saveEdit(msg.id) }
                                          if (e.key==='Escape') { setEditingMsgId(null); setEditingText('') }
                                        }}
                                      />
                                      <div className="ch-edit-actions">
                                        <button className="ch-edit-cancel" onClick={() => { setEditingMsgId(null); setEditingText('') }}>Cancel</button>
                                        <button className="ch-edit-save" onClick={() => saveEdit(msg.id)}>Save</button>
                                      </div>
                                      <div className="ch-edit-hint">Enter to save · Esc to cancel</div>
                                    </div>
                                  ) : (
                                    <>
                                      {msg.content && msg.content.trim() !== ' ' && (
                                        <div className={`ch-msg-content${msg.sender_id==='system'?' app-only':''}`}>
                                          <RenderContent content={msg.content} profiles={allProfiles} navigate={navigate} />
                                        </div>
                                      )}
                                      {hasImage && (
                                        <a href={msg.attachment_url!} target="_blank" rel="noopener noreferrer">
                                          <img className="ch-msg-img" src={msg.attachment_url!} alt={msg.attachment_name??''} loading="lazy" />
                                        </a>
                                      )}
                                      {hasFile && (
                                        <a className="ch-file-card" href={msg.attachment_url!} target="_blank" rel="noopener noreferrer">
                                          <span className="ch-file-icon">{fileIcon(msg.attachment_type)}</span>
                                          <div>
                                            <div className="ch-file-name">{msg.attachment_name ?? 'File'}</div>
                                            <div className="ch-file-type">{msg.attachment_type?.split('/')[1]?.toUpperCase()} · Click to open</div>
                                          </div>
                                        </a>
                                      )}
                                    </>
                                  )}

                                  {/* Reactions */}
                                  {msgReactions.length > 0 && (
                                    <div className="ch-reactions">
                                      {msgReactions.map(r => (
                                        <button key={r.emoji} className={`ch-reaction-pill${r.iMine?' mine':''}`} onClick={() => toggleReaction(msg.id, r.emoji)}>
                                          {r.emoji}
                                          {r.count > 1 && <span className="ch-reaction-count">{r.count}</span>}
                                          <div className="ch-reaction-tooltip">{r.names.slice(0,4).join(', ')}{r.names.length>4?` +${r.names.length-4} more`:''}</div>
                                        </button>
                                      ))}
                                    </div>
                                  )}

                                  {/* Thread reply count */}
                                  {(msg.reply_count ?? 0) > 0 && (
                                    <div className="ch-thread-count" onClick={() => openThread(msg)}>
                                      💬 {msg.reply_count} {msg.reply_count===1?'reply':'replies'}
                                      <span style={{ fontSize:'0.65rem', color:'var(--text-ghost)' }}>Last reply {timeAgo(msg.created_at)}</span>
                                    </div>
                                  )}
                                </div>

                                {/* Hover actions */}
                                <div className="ch-msg-actions" style={{ position:'absolute', right:'1rem', top:'0.25rem', transform:'none' }}>
                                  {/* Emoji react */}
                                  <div style={{ position:'relative' }}>
                                    <button className="ch-msg-action ch-react-btn" title="Add reaction" onClick={() => setShowEmojiFor(showEmojiFor===msg.id?null:msg.id)}>😊</button>
                                    {showEmojiFor === msg.id && (
                                      <div className="ch-emoji-picker">
                                        {QUICK_EMOJIS.map(emoji => (
                                          <button key={emoji} className="ch-emoji-btn" onClick={() => toggleReaction(msg.id, emoji)}>{emoji}</button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  <button className="ch-msg-action" title="Reply in thread" onClick={() => openThread(msg)}>💬</button>
                                  <button className={`ch-msg-action${msg.is_pinned?' pinned':''}`} title={msg.is_pinned?'Unpin':'Pin'} onClick={() => togglePin(msg)}>📌</button>
                                  {isMine && (
                                    <>
                                      <button className="ch-msg-action" title="Edit" onClick={() => { setEditingMsgId(msg.id); setEditingText(msg.content) }}>✎</button>
                                      <button className="ch-msg-action danger" title="Delete" onClick={() => deleteMessage(msg.id)}>🗑</button>
                                    </>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ))}

                      {/* Typing */}
                      {typers.length > 0 && (
                        <div className="ch-typing-row">
                          <div className="ch-typing-dots">
                            <div className="ch-typing-dot" /><div className="ch-typing-dot" /><div className="ch-typing-dot" />
                          </div>
                          <span className="ch-typing-name">{typingLabel}</span>
                        </div>
                      )}

                      <div ref={messagesEndRef} />
                    </div>

                    {/* Pinned list (inline) */}
                    {showPinnedList && (
                      <div style={{ background:'var(--bg-surface)', borderTop:'1px solid var(--border)', padding:'1rem 1.25rem', maxHeight:'200px', overflowY:'auto', flexShrink:0 }}>
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'0.75rem' }}>
                          <span style={{ fontSize:'0.82rem', fontWeight:800, color:'var(--text-primary)' }}>📌 {pinnedMessages.length} Pinned Messages</span>
                          <button onClick={() => setShowPinnedList(false)} style={{ background:'none', border:'none', color:'var(--text-faint)', cursor:'pointer', fontSize:'0.8rem' }}>✕</button>
                        </div>
                        {pinnedMessages.map(msg => (
                          <div key={msg.id} style={{ padding:'0.5rem 0', borderBottom:'1px solid var(--border-light)', display:'flex', gap:'0.6rem', alignItems:'flex-start' }}>
                            <Avatar name={msg.sender?.full_name ?? null} size={22} />
                            <div style={{ flex:1, minWidth:0 }}>
                              <span style={{ fontSize:'0.75rem', fontWeight:700, color:'var(--text-primary)', marginRight:'0.4rem' }}>{msg.sender?.full_name}</span>
                              <span style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>{msg.content?.slice(0,100)}{msg.content && msg.content.length > 100 ? '…' : ''}</span>
                            </div>
                            <button onClick={() => togglePin(msg)} style={{ background:'none', border:'none', color:'#D97706', cursor:'pointer', fontSize:'0.75rem', flexShrink:0 }}>Unpin</button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Input */}
                    {canPost ? (
                      <div
                        className="ch-input-area"
                        onDragEnter={e => { e.preventDefault(); dragCounterRef.current++; if(e.dataTransfer.types.includes('Files')) setIsDragging(true) }}
                        onDragLeave={e => { e.preventDefault(); dragCounterRef.current--; if(dragCounterRef.current===0) setIsDragging(false) }}
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => { e.preventDefault(); dragCounterRef.current=0; setIsDragging(false); const f=e.dataTransfer.files[0]; if(f) handleFileSelect(f) }}
                      >
                        {isDragging && (
                          <div className="ch-drop-overlay">
                            <div style={{ fontSize:'2rem' }}>📎</div>
                            <div style={{ fontSize:'0.88rem', fontWeight:700, color:'#365F91' }}>Drop to share in #{activeChannel.name}</div>
                          </div>
                        )}

                        {/* @Mentions */}
                        {mentionQuery !== null && mentionSuggestions.length > 0 && (
                          <div className="ch-mention-list">
                            <div className="ch-mention-header">Mention someone</div>
                            {mentionSuggestions.map(p => (
                              <div key={p.id} className="ch-mention-item" onMouseDown={e => { e.preventDefault(); selectMention(p) }}>
                                <Avatar name={p.full_name} size={26} statusKey={presenceUsers.find(u=>u.user_id===p.id)?.status} />
                                <span className="ch-mention-name">{p.full_name}</span>
                                <span className="ch-mention-role">{p.role}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="ch-input-box">
                          {/* Pending file */}
                          {pendingFile && (
                            <div className="ch-pending-file">
                              {pendingPreview ? <img className="ch-pending-preview" src={pendingPreview} alt="" /> : <span style={{ fontSize:'1.25rem' }}>{fileIcon(pendingFile.type)}</span>}
                              <span className="ch-pending-name">{pendingFile.name} ({fmtSize(pendingFile.size)})</span>
                              <button className="ch-pending-remove" onClick={clearPendingFile}>✕</button>
                            </div>
                          )}

                          {/* Toolbar */}
                          <div className="ch-input-toolbar">
                            <button className="ch-toolbar-btn" onClick={() => fileInputRef.current?.click()} title="Attach file">📎</button>
                            <button className="ch-toolbar-btn" title="Bold (@mention)" onClick={() => { setInputText(p=>p+'**bold**'); inputRef.current?.focus() }}>B</button>
                            <button className="ch-toolbar-btn" title="Italic" onClick={() => { setInputText(p=>p+'*italic*'); inputRef.current?.focus() }} style={{ fontStyle:'italic' }}>I</button>
                            <button className="ch-toolbar-btn" title="Code block" onClick={() => { setInputText(p=>p+'`code`'); inputRef.current?.focus() }}>{`</>`}</button>
                            <input ref={fileInputRef} type="file" style={{ display:'none' }} accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip" onChange={e => { const f=e.target.files?.[0]; if(f) handleFileSelect(f) }} />
                          </div>

                          {/* Text area */}
                          <div className="ch-input-row">
                            <textarea
                              ref={inputRef}
                              rows={1}
                              placeholder={`Message #${activeChannel.name}   (@ to mention, ` + '`code`' + ` for code)`}
                              value={inputText}
                              onChange={handleInputChange}
                              onKeyDown={e => {
                                if (mentionQuery !== null && mentionSuggestions.length > 0) {
                                  if (e.key==='Escape') { e.preventDefault(); setMentionQuery(null); return }
                                  if (e.key==='Enter') { e.preventDefault(); selectMention(mentionSuggestions[0]); return }
                                }
                                if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
                              }}
                            />
                            <button className="ch-send-btn" onClick={() => sendMessage()} disabled={(!inputText.trim()&&!pendingFile)||sending||uploading}>
                              {uploading ? '⏳' : '➤'}
                            </button>
                          </div>
                        </div>
                        <div className="ch-input-hint">Enter to send · Shift+Enter for new line · @ to mention · drag & drop files</div>
                      </div>
                    ) : (
                      <div className="ch-readonly-notice">
                        📢 Only admins and HR can post in #{activeChannel.name}
                      </div>
                    )}
                  </div>

                  {/* ── Thread Panel ── */}
                  {selectedThread && (
                    <div className="ch-thread-panel">
                      <div className="ch-thread-header">
                        <span className="ch-thread-title">💬 Thread</span>
                        <button className="ch-panel-close" onClick={() => setSelectedThread(null)}>✕</button>
                      </div>

                      <div className="ch-thread-orig">
                        <div className="ch-thread-orig-header">
                          <Avatar name={selectedThread.sender?.full_name ?? null} size={24} />
                          <span className="ch-thread-orig-name">{selectedThread.sender?.full_name}</span>
                          <span className="ch-thread-orig-time">{timeAgo(selectedThread.created_at)}</span>
                        </div>
                        <div className="ch-thread-orig-content">{selectedThread.content}</div>
                      </div>

                      <div className="ch-thread-messages">
                        {threadMessages.length === 0 ? (
                          <div className="ch-thread-empty">
                            <div style={{ fontSize:'1.5rem', opacity:0.3 }}>💬</div>
                            <div style={{ fontWeight:600, color:'var(--text-primary)', fontSize:'0.88rem' }}>No replies yet</div>
                            <div style={{ fontSize:'0.75rem' }}>Be the first to reply</div>
                          </div>
                        ) : threadMessages.map((msg, i) => (
                          <div key={msg.id} className="ch-thread-msg">
                            <Avatar name={msg.sender?.full_name ?? null} size={28} />
                            <div className="ch-thread-msg-body">
                              <div>
                                <span className="ch-thread-msg-name">{msg.sender?.full_name ?? 'Unknown'}</span>
                                <span className="ch-thread-msg-time">{formatTime(msg.created_at)}</span>
                              </div>
                              <div className="ch-thread-msg-content">
                                <RenderContent content={msg.content} profiles={allProfiles} navigate={navigate} />
                              </div>
                            </div>
                          </div>
                        ))}
                        <div ref={threadEndRef} />
                      </div>

                      <div className="ch-thread-input">
                        {/* Thread @mentions */}
                        {mentionQuery !== null && mentionSuggestions.length > 0 && (
                          <div className="ch-mention-list" style={{ left:0, right:0, bottom:'calc(100%+4px)', position:'absolute' }}>
                            <div className="ch-mention-header">Mention someone</div>
                            {mentionSuggestions.map(p => (
                              <div key={p.id} className="ch-mention-item" onMouseDown={e => { e.preventDefault(); selectMention(p, true) }}>
                                <Avatar name={p.full_name} size={24} />
                                <span className="ch-mention-name">{p.full_name}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="ch-thread-input-wrap">
                          <textarea
                            ref={threadInputRef}
                            rows={1}
                            placeholder="Reply to thread…"
                            value={threadInput}
                            onChange={e => handleInputChange(e, true)}
                            onKeyDown={e => {
                              if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(true) }
                            }}
                          />
                          <button className="ch-thread-send" onClick={() => sendMessage(true)} disabled={!threadInput.trim() || sending}>➤</button>
                        </div>
                        <div className="ch-thread-hint">Enter to send · Shift+Enter for new line</div>
                      </div>
                    </div>
                  )}

                  {/* ── Info Panel ── */}
                  {showInfo && (
                    <div className="ch-info-panel">
                      <div className="ch-thread-header">
                        <span className="ch-thread-title">ℹ #{activeChannel.name}</span>
                        <button className="ch-panel-close" onClick={() => setShowInfo(false)}>✕</button>
                      </div>

                      <div className="ch-info-body">
                        {/* About */}
                        <div className="ch-info-section">
                          <div className="ch-info-section-header">
                            <span className="ch-info-section-label">About</span>
                          </div>
                          <div className="ch-info-section-body">
                            <div style={{ fontSize:'0.82rem', color:'var(--text-secondary)', lineHeight:1.65, marginBottom:'0.75rem' }}>
                              {activeChannel.description ?? 'No description set.'}
                            </div>
                            <div style={{ display:'flex', flexDirection:'column', gap:'0.35rem' }}>
                              {[
                                { label:'Type', value: activeChannel.type },
                                { label:'Members', value: channelMembers.length },
                                { label:'Pinned', value: pinnedMessages.length + ' messages' },
                              ].map(r => (
                                <div key={r.label} style={{ display:'flex', justifyContent:'space-between', fontSize:'0.75rem', color:'var(--text-faint)', borderBottom:'1px solid var(--border-light)', paddingBottom:'0.3rem' }}>
                                  <span>{r.label}</span>
                                  <span style={{ color:'var(--text-primary)', fontWeight:600, textTransform:'capitalize' }}>{r.value}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Members */}
                        <div className="ch-info-section">
                          <div className="ch-info-section-header">
                            <span className="ch-info-section-label">👥 Members ({channelMembers.length})</span>
                          </div>
                          <div className="ch-info-section-body">
                            {channelMembers.slice(0, 20).map(m => {
                              const status = presenceUsers.find(u=>u.user_id===m.id)?.status ?? 'offline'
                              return (
                                <div key={m.id} className="ch-info-member" onClick={() => navigate(`/profile/${m.id}`)}>
                                  <Avatar name={m.full_name} size={28} statusKey={status} />
                                  <div>
                                    <div className="ch-info-member-name">
                                      {m.full_name ?? '—'}{m.id===myProfile?.id?' (you)':''}
                                    </div>
                                    <div className="ch-info-member-role">{m.role}</div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>

                        {/* Pinned messages */}
                        {pinnedMessages.length > 0 && (
                          <div className="ch-info-section">
                            <div className="ch-info-section-header">
                              <span className="ch-info-section-label">📌 Pinned ({pinnedMessages.length})</span>
                            </div>
                            <div className="ch-info-section-body">
                              {pinnedMessages.map(msg => (
                                <div key={msg.id} className="ch-info-pinned-item">
                                  <div className="ch-info-pinned-text">{msg.content}</div>
                                  <div className="ch-info-pinned-meta">by {msg.sender?.full_name} · {timeAgo(msg.created_at)}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Actions */}
                        <div style={{ padding:'0.75rem 1rem' }}>
                          {activeChannel.type !== 'announcement' && activeChannel.type !== 'department' && (
                            <button className="ch-info-danger-btn" onClick={() => leaveChannel(activeChannel.id)}>
                              Leave #{activeChannel.name}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              /* No channel selected */
              <div className="ch-empty">
                <div className="ch-empty-icon">#</div>
                <div style={{ fontWeight:800, fontSize:'1.1rem', color:'var(--text-primary)' }}>Select a channel</div>
                <div style={{ fontSize:'0.85rem', maxWidth:'280px', lineHeight:1.6 }}>
                  Choose a channel from the sidebar or browse all channels to get started.
                </div>
                <button className="ch-btn-primary" style={{ marginTop:'0.5rem' }} onClick={() => { loadAllChannels(); setShowBrowse(true) }}>
                  Browse channels
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════
          BROWSE CHANNELS MODAL
      ══════════════════════════════════════ */}
      {showBrowse && (
        <div className="ch-modal-overlay" onClick={() => setShowBrowse(false)}>
          <div className="ch-modal" style={{ width:580 }} onClick={e => e.stopPropagation()}>
            <div className="ch-modal-header">
              <span className="ch-modal-title">Browse all channels</span>
              <button className="ch-modal-close" onClick={() => setShowBrowse(false)}>✕</button>
            </div>
            <div className="ch-modal-body">
              <input
                className="ch-browse-search"
                placeholder="🔍  Search channels…"
                value={browseSearch}
                onChange={e => setBrowseSearch(e.target.value)}
                autoFocus
              />
              {allChannels
                .filter(c => !browseSearch || c.name.toLowerCase().includes(browseSearch.toLowerCase()) || c.description?.toLowerCase().includes(browseSearch.toLowerCase()))
                .map(ch => {
                  const joined = isMyChannel(ch.id)
                  return (
                    <div key={ch.id} className="ch-browse-item">
                      <div className="ch-browse-icon">{TYPE_ICON[ch.type]}</div>
                      <div className="ch-browse-info">
                        <div className="ch-browse-name">#{ch.name}</div>
                        {ch.description && <div className="ch-browse-desc">{ch.description}</div>}
                        <div className="ch-browse-meta" style={{ textTransform:'capitalize' }}>{ch.type} channel</div>
                      </div>
                      <button
                        className={`ch-browse-join ${joined ? 'open' : 'join'}`}
                        onClick={() => joined ? (setShowBrowse(false), openChannel(ch.id)) : joinChannel(ch.id)}
                      >
                        {joined ? 'Open' : 'Join'}
                      </button>
                    </div>
                  )
                })}
              {allChannels.filter(c => !browseSearch || c.name.toLowerCase().includes(browseSearch.toLowerCase())).length === 0 && (
                <div style={{ textAlign:'center', color:'var(--text-faint)', padding:'2rem', fontSize:'0.85rem' }}>No channels found</div>
              )}
            </div>
            <div className="ch-modal-footer">
              <button className="ch-btn-ghost" onClick={() => setShowBrowse(false)}>Close</button>
              <button className="ch-btn-primary" onClick={() => { setShowBrowse(false); setShowCreate(true) }}>+ Create channel</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════
          CREATE CHANNEL MODAL
      ══════════════════════════════════════ */}
      {showCreate && (
        <div className="ch-modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="ch-modal" onClick={e => e.stopPropagation()}>
            <div className="ch-modal-header">
              <span className="ch-modal-title">Create a new channel</span>
              <button className="ch-modal-close" onClick={() => setShowCreate(false)}>✕</button>
            </div>
            <div className="ch-modal-body">
              <div className="ch-field">
                <label className="ch-label">Channel type</label>
                <div className="ch-type-grid">
                  <button className={`ch-type-card${newChannelType==='public'?' selected':''}`} onClick={() => setNewChannelType('public')}>
                    <div className="ch-type-card-icon">#</div>
                    <div className="ch-type-card-label">Public</div>
                    <div className="ch-type-card-desc">Anyone can view and join this channel</div>
                  </button>
                  <button className={`ch-type-card${newChannelType==='private'?' selected':''}`} onClick={() => setNewChannelType('private')}>
                    <div className="ch-type-card-icon">🔒</div>
                    <div className="ch-type-card-label">Private</div>
                    <div className="ch-type-card-desc">Invite-only, only members can see messages</div>
                  </button>
                </div>
              </div>

              <div className="ch-field">
                <label className="ch-label">Channel name *</label>
                <input
                  className="ch-input"
                  placeholder="e.g. project-alpha, design-reviews"
                  value={newChannelName}
                  onChange={e => setNewChannelName(e.target.value.toLowerCase().replace(/\s/g,'-').replace(/[^a-z0-9-]/g,''))}
                  autoFocus
                />
                {newChannelName && (
                  <div style={{ fontSize:'0.72rem', color:'var(--text-faint)', marginTop:'0.3rem' }}>
                    Channel will be created as <strong>#{newChannelName}</strong>
                  </div>
                )}
              </div>

              <div className="ch-field">
                <label className="ch-label">Description (optional)</label>
                <input
                  className="ch-input"
                  placeholder="What's this channel for?"
                  value={newChannelDesc}
                  onChange={e => setNewChannelDesc(e.target.value)}
                />
              </div>
            </div>
            <div className="ch-modal-footer">
              <button className="ch-btn-ghost" onClick={() => { setShowCreate(false); setNewChannelName(''); setNewChannelDesc('') }}>Cancel</button>
              <button
                className="ch-btn-primary"
                onClick={handleCreateChannel}
                disabled={!newChannelName.trim() || creating}
              >
                {creating ? 'Creating…' : 'Create channel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
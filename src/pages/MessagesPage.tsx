import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Navbar from '../components/Navbar'

interface Profile {
  id: string; full_name: string | null; role: string; department_id: string | null
}
interface Conversation {
  id: string; user1_id: string; user2_id: string; created_at: string
  otherUser: Profile | null; lastMessage: DmMessage | null; unreadCount: number
}
interface DmMessage {
  id: string; conversation_id: string; sender_id: string
  content: string; read_at: string | null; created_at: string
  is_pinned?: boolean; attachment_url?: string | null
  attachment_name?: string | null; attachment_type?: string | null
}
interface GroupConversation {
  id: string; name: string; created_by: string | null; created_at: string
  members: Profile[]; lastMessage: GroupMessage | null; unreadCount: number
}
interface GroupMessage {
  id: string; group_id: string; sender_id: string
  content: string; created_at: string; is_pinned?: boolean
  attachment_url?: string | null; attachment_name?: string | null; attachment_type?: string | null
  sender?: Profile | null
}
interface MessageReaction {
  id: string; message_id: string; user_id: string; emoji: string
}

type ActiveChat = { type: 'dm'; id: string } | { type: 'group'; id: string } | null
const QUICK_EMOJIS = ['👍','❤️','😂','😮','😢','🎉','🔥','✅']
const IMAGE_TYPES = ['image/jpeg','image/png','image/gif','image/webp','image/svg+xml']
const MAX_FILE_MB = 10

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
  const today = new Date(); today.setHours(0,0,0,0)
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate()-1)
  if (date >= today) return 'Today'
  if (date >= yesterday) return 'Yesterday'
  return date.toLocaleDateString('en-AU', { weekday:'long', day:'numeric', month:'long' })
}
function fmtSize(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024*1024) return `${(b/1024).toFixed(1)} KB`
  return `${(b/1024/1024).toFixed(1)} MB`
}
function fileIcon(type?: string | null) {
  if (!type) return '📎'
  if (IMAGE_TYPES.includes(type)) return '🖼'
  if (type === 'application/pdf') return '📄'
  if (type.includes('word')) return '📝'
  if (type.includes('sheet') || type.includes('excel')) return '📊'
  if (type.includes('zip')) return '🗜'
  if (type.includes('video')) return '🎬'
  if (type.includes('audio')) return '🎵'
  return '📎'
}

function Avatar({ name, size = 36, color }: { name: string | null; size?: number; color?: string }) {
  return (
    <div style={{ width:size, height:size, borderRadius:'50%', background: color ?? 'linear-gradient(135deg,#4F81BD,#243F60)', color:'white', fontSize:size*0.33, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
      {initials(name)}
    </div>
  )
}

function GroupAvatar({ members, size = 36 }: { members: Profile[]; size?: number }) {
  const colors = ['#4BACC6','#8064A2','#C0504D','#9BBB59','#F79646','#4F81BD']
  if (members.length === 0) return <Avatar name={null} size={size} />
  if (members.length === 1) return <Avatar name={members[0].full_name} size={size} />
  return (
    <div style={{ width:size, height:size, position:'relative', flexShrink:0 }}>
      {members.slice(0,2).map((m,i) => (
        <div key={m.id} style={{
          position:'absolute',
          width: size*0.65, height: size*0.65,
          borderRadius:'50%',
          background: colors[i % colors.length],
          color:'white', fontSize:size*0.22, fontWeight:700,
          display:'flex', alignItems:'center', justifyContent:'center',
          border:'1.5px solid white',
          top: i===0 ? 0 : undefined,
          bottom: i===1 ? 0 : undefined,
          left: i===0 ? 0 : undefined,
          right: i===1 ? 0 : undefined,
          zIndex: 2-i,
        }}>
          {initials(m.full_name)}
        </div>
      ))}
    </div>
  )
}

function extractMentionedIds(content: string, profiles: Profile[]): string[] {
  const ids: string[] = []
  profiles.forEach(p => { if (p.full_name && content.includes(`@${p.full_name}`)) ids.push(p.id) })
  return ids
}

export default function MessagesPage() {
  const navigate = useNavigate()
  const { userId: targetUserId } = useParams<{ userId?: string }>()

  const [profile, setProfile] = useState<Profile | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [allProfiles, setAllProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  // DM state
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [dmMessages, setDmMessages] = useState<DmMessage[]>([])

  // Group state
  const [groups, setGroups] = useState<GroupConversation[]>([])
  const [groupMessages, setGroupMessages] = useState<GroupMessage[]>([])
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupMembers, setNewGroupMembers] = useState<Set<string>>(new Set())
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [showGroupInfo, setShowGroupInfo] = useState(false)

  // Active chat
  const [activeChat, setActiveChat] = useState<ActiveChat>(null)

  // Shared UI state
  const [inputText, setInputText] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [showNewChat, setShowNewChat] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [convSearch, setConvSearch] = useState('')
  const [typers, setTypers] = useState<string[]>([])
  const [reactions, setReactions] = useState<Record<string, MessageReaction[]>>({})
  const [showEmojiFor, setShowEmojiFor] = useState<string | null>(null)
  const [hoveredMsgId, setHoveredMsgId] = useState<string | null>(null)
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [deletingMsgId, setDeletingMsgId] = useState<string | null>(null)
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null)
  const [showPinnedBar, setShowPinnedBar] = useState(true)
  const [pinnedIdx, setPinnedIdx] = useState(0)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionSuggestions, setMentionSuggestions] = useState<Profile[]>([])
  const [mentionStart, setMentionStart] = useState(0)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingFilePreview, setPendingFilePreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const msgRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const editInputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dmChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const groupChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const globalChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const conversationsRef = useRef<Conversation[]>([])
  const groupsRef = useRef<GroupConversation[]>([])
  const activeChatRef = useRef<ActiveChat>(null)
  const userIdRef = useRef<string | null>(null)
  const profileRef = useRef<Profile | null>(null)

  useEffect(() => { conversationsRef.current = conversations }, [conversations])
  useEffect(() => { groupsRef.current = groups }, [groups])
  useEffect(() => { activeChatRef.current = activeChat }, [activeChat])
  useEffect(() => { userIdRef.current = userId }, [userId])
  useEffect(() => { profileRef.current = profile }, [profile])

  const activeConv = activeChat?.type === 'dm' ? conversations.find(c => c.id === activeChat.id) ?? null : null
  const activeGroup = activeChat?.type === 'group' ? groups.find(g => g.id === activeChat.id) ?? null : null
  const currentMessages = activeChat?.type === 'dm' ? dmMessages : groupMessages
  const pinnedMessages = currentMessages.filter(m => m.is_pinned)
  const totalUnread = conversations.reduce((s,c) => s + c.unreadCount, 0) + groups.reduce((s,g) => s + g.unreadCount, 0)

  useEffect(() => { setShowPinnedBar(true); setPinnedIdx(0) }, [activeChat])

  useEffect(() => {
    if (!showEmojiFor) return
    function h(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest('.emoji-picker-msg') && !(e.target as HTMLElement).closest('.emoji-trigger-msg')) setShowEmojiFor(null)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [showEmojiFor])

  useEffect(() => {
    if (mentionQuery === null) return
    function h(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest('.mention-suggestions') && !(e.target as HTMLElement).closest('.chat-input-wrap')) setMentionQuery(null)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [mentionQuery])

  useEffect(() => {
    if (editingMsgId) setTimeout(() => editInputRef.current?.focus(), 50)
  }, [editingMsgId])

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior:'smooth' }) }, [dmMessages, groupMessages, typers])
  useEffect(() => { return () => { if (pendingFilePreview) URL.revokeObjectURL(pendingFilePreview) } }, [pendingFilePreview])

  useEffect(() => {
    async function load() {
      const { data:{ user } } = await supabase.auth.getUser()
      if (!user) { navigate('/login'); return }
      setUserId(user.id); userIdRef.current = user.id
      const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      setProfile(p); profileRef.current = p
      const { data: ps } = await supabase.from('profiles').select('*').order('full_name')
      setAllProfiles((ps ?? []).filter(pr => pr.id !== user.id))
      await Promise.all([loadConversations(user.id), loadGroups(user.id)])
      setLoading(false)
      if (targetUserId) await openConversationWith(user.id, targetUserId)
    }
    load()
    return () => {
      if (dmChannelRef.current) supabase.removeChannel(dmChannelRef.current)
      if (groupChannelRef.current) supabase.removeChannel(groupChannelRef.current)
      if (globalChannelRef.current) supabase.removeChannel(globalChannelRef.current)
      if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current)
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    }
  }, [navigate, targetUserId])

  // Global realtime
  useEffect(() => {
    if (!userId) return
    if (globalChannelRef.current) supabase.removeChannel(globalChannelRef.current)
    globalChannelRef.current = supabase.channel('global-all')
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'messages' }, (payload) => {
        const msg = payload.new as DmMessage
        const uid = userIdRef.current
        const convs = conversationsRef.current
        const active = activeChatRef.current
        const conv = convs.find(c => c.id === msg.conversation_id)
        if (!conv) return
        const isMine = msg.sender_id === uid
        const isActive = active?.type === 'dm' && active.id === msg.conversation_id
        setConversations(prev => prev.map(c => c.id !== msg.conversation_id ? c : {
          ...c, lastMessage: msg, unreadCount: isActive || isMine ? c.unreadCount : c.unreadCount + 1
        }).sort((a,b) => new Date(b.lastMessage?.created_at ?? b.created_at).getTime() - new Date(a.lastMessage?.created_at ?? a.created_at).getTime()))
        if (!isMine && isActive) {
          setDmMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg])
          supabase.from('messages').update({ read_at: new Date().toISOString() }).eq('id', msg.id).then(()=>{})
        }
      })
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'messages' }, (payload) => {
        const updated = payload.new as DmMessage
        setDmMessages(prev => prev.map(m => m.id === updated.id ? {...m,...updated} : m))
      })
      .on('postgres_changes', { event:'DELETE', schema:'public', table:'messages' }, (payload) => {
        const deleted = payload.old as { id:string }
        setDmMessages(prev => prev.filter(m => m.id !== deleted.id))
      })
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'group_messages' }, async (payload) => {
        const msg = payload.new as GroupMessage
        const uid = userIdRef.current
        const grps = groupsRef.current
        const active = activeChatRef.current
        const grp = grps.find(g => g.id === msg.group_id)
        if (!grp) return
        const isMine = msg.sender_id === uid
        const isActive = active?.type === 'group' && active.id === msg.group_id
        const { data: sender } = await supabase.from('profiles').select('*').eq('id', msg.sender_id).single()
        const fullMsg: GroupMessage = { ...msg, sender: sender ?? null }
        setGroups(prev => prev.map(g => g.id !== msg.group_id ? g : {
          ...g, lastMessage: fullMsg, unreadCount: isActive || isMine ? g.unreadCount : g.unreadCount + 1
        }).sort((a,b) => new Date(b.lastMessage?.created_at ?? b.created_at).getTime() - new Date(a.lastMessage?.created_at ?? a.created_at).getTime()))
        if (!isMine && isActive) {
          setGroupMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, fullMsg])
        }
      })
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'group_messages' }, (payload) => {
        const updated = payload.new as GroupMessage
        setGroupMessages(prev => prev.map(m => m.id === updated.id ? {...m,...updated} : m))
      })
      .on('postgres_changes', { event:'DELETE', schema:'public', table:'group_messages' }, (payload) => {
        const deleted = payload.old as { id:string }
        setGroupMessages(prev => prev.filter(m => m.id !== deleted.id))
      })
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'message_reactions' }, (payload) => {
        const r = payload.new as MessageReaction
        setReactions(prev => ({ ...prev, [r.message_id]: [...(prev[r.message_id]??[]).filter(x => x.id !== r.id), r] }))
      })
      .on('postgres_changes', { event:'DELETE', schema:'public', table:'message_reactions' }, (payload) => {
        const r = payload.old as { id:string; message_id:string }
        setReactions(prev => ({ ...prev, [r.message_id]: (prev[r.message_id]??[]).filter(x => x.id !== r.id) }))
      })
      .subscribe()
    return () => { if (globalChannelRef.current) supabase.removeChannel(globalChannelRef.current) }
  }, [userId])

  // Typing presence
  useEffect(() => {
    if (!activeChat || !userId) return
    if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current)
    setTypers([])
    const channelKey = `typing:${activeChat.type}:${activeChat.id}`
    typingChannelRef.current = supabase
      .channel(channelKey, { config:{ presence:{ key: userId } } })
      .on('presence', { event:'sync' }, () => {
        const state = typingChannelRef.current?.presenceState<{ user_id:string; full_name:string|null; typing:boolean }>() ?? {}
        setTypers(Object.values(state).flat().filter(p => p.user_id !== userId && p.typing).map(p => p.full_name?.split(' ')[0] ?? 'Someone'))
      })
      .subscribe()
    return () => { if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current); setTypers([]) }
  }, [activeChat, userId])

  async function loadConversations(uid: string) {
    const { data: convs } = await supabase.from('conversations')
      .select(`*, user1:profiles!conversations_user1_id_fkey(id,full_name,role,department_id), user2:profiles!conversations_user2_id_fkey(id,full_name,role,department_id)`)
      .or(`user1_id.eq.${uid},user2_id.eq.${uid}`).order('created_at', { ascending:false })
    if (!convs) return
    const enriched = await Promise.all(convs.map(async c => {
      const otherUser = c.user1_id === uid ? c.user2 : c.user1
      const { data: lastMsgs } = await supabase.from('messages').select('*').eq('conversation_id', c.id).order('created_at', { ascending:false }).limit(1)
      const { count: unread } = await supabase.from('messages').select('id', { count:'exact', head:true }).eq('conversation_id', c.id).neq('sender_id', uid).is('read_at', null)
      return { id:c.id, user1_id:c.user1_id, user2_id:c.user2_id, created_at:c.created_at, otherUser: otherUser as Profile, lastMessage: lastMsgs?.[0] ?? null, unreadCount: unread ?? 0 }
    }))
    const sorted = enriched.sort((a,b) => new Date(b.lastMessage?.created_at ?? b.created_at).getTime() - new Date(a.lastMessage?.created_at ?? a.created_at).getTime())
    setConversations(sorted); conversationsRef.current = sorted
  }

  async function loadGroups(uid: string) {
    const { data: myGroups } = await supabase.from('group_members').select('group_id').eq('user_id', uid)
    if (!myGroups || myGroups.length === 0) return
    const groupIds = myGroups.map(g => g.group_id)
    const { data: gcs } = await supabase.from('group_conversations').select('*').in('id', groupIds).order('created_at', { ascending:false })
    if (!gcs) return
    const enriched = await Promise.all((gcs as GroupConversation[]).map(async g => {
      const { data: mems } = await supabase.from('group_members').select('*, profile:profiles!user_id(*)').eq('group_id', g.id)
      const members = (mems ?? []).map((m:any) => m.profile).filter(Boolean) as Profile[]
      const { data: lastMsgs } = await supabase.from('group_messages').select('*, sender:profiles!sender_id(*)').eq('group_id', g.id).order('created_at', { ascending:false }).limit(1)
      return { ...g, members, lastMessage: lastMsgs?.[0] ?? null, unreadCount: 0 }
    }))
    const sorted = enriched.sort((a,b) => new Date(b.lastMessage?.created_at ?? b.created_at).getTime() - new Date(a.lastMessage?.created_at ?? a.created_at).getTime())
    setGroups(sorted); groupsRef.current = sorted
  }

  async function loadReactions(messageIds: string[], table = 'message_reactions') {
    if (!messageIds.length) return
    const { data } = await supabase.from(table).select('*').in('message_id', messageIds)
    if (!data) return
    const grouped: Record<string,MessageReaction[]> = {}
    data.forEach(r => { if (!grouped[r.message_id]) grouped[r.message_id]=[]; grouped[r.message_id].push(r) })
    setReactions(prev => ({ ...prev, ...grouped }))
  }

  async function openConversation(convId: string) {
    setActiveChat({ type:'dm', id:convId })
    setLoadingMessages(true); setEditingMsgId(null); setShowEmojiFor(null); setMentionQuery(null); clearPendingFile(); setShowGroupInfo(false)
    const { data: msgs } = await supabase.from('messages').select('*').eq('conversation_id', convId).order('created_at', { ascending:true })
    setDmMessages(msgs ?? [])
    if (msgs && msgs.length > 0) await loadReactions(msgs.map(m => m.id))
    setLoadingMessages(false)
    await supabase.from('messages').update({ read_at: new Date().toISOString() }).eq('conversation_id', convId).neq('sender_id', userId!).is('read_at', null)
    setConversations(prev => prev.map(c => c.id === convId ? { ...c, unreadCount:0 } : c))
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  async function openGroup(groupId: string) {
    setActiveChat({ type:'group', id:groupId })
    setLoadingMessages(true); setEditingMsgId(null); setShowEmojiFor(null); setMentionQuery(null); clearPendingFile(); setShowGroupInfo(false)
    const { data: msgs } = await supabase.from('group_messages').select('*, sender:profiles!sender_id(*)').eq('group_id', groupId).order('created_at', { ascending:true })
    setGroupMessages((msgs ?? []) as GroupMessage[])
    if (msgs && msgs.length > 0) await loadReactions(msgs.map(m => m.id))
    setLoadingMessages(false)
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, unreadCount:0 } : g))
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  async function openConversationWith(currentUserId: string, otherUserId: string) {
    const sorted = [currentUserId, otherUserId].sort()
    let { data: existing } = await supabase.from('conversations').select('id').eq('user1_id', sorted[0]).eq('user2_id', sorted[1]).maybeSingle()
    if (!existing) {
      const { data: created } = await supabase.from('conversations').insert({ user1_id:sorted[0], user2_id:sorted[1] }).select('id').single()
      existing = created; await loadConversations(currentUserId)
    }
    if (existing) await openConversation(existing.id)
  }

  async function handleNewDm(other: Profile) {
    if (!userId) return
    setShowNewChat(false); setUserSearch('')
    await openConversationWith(userId, other.id)
  }

  async function createGroup() {
    if (!newGroupName.trim() || newGroupMembers.size === 0 || !userId || creatingGroup) return
    setCreatingGroup(true)
    const { data: grp } = await supabase.from('group_conversations').insert({ name: newGroupName.trim(), created_by: userId }).select().single()
    if (!grp) { setCreatingGroup(false); return }
    const memberIds = [userId, ...Array.from(newGroupMembers)]
    await supabase.from('group_members').insert(memberIds.map(uid => ({ group_id: grp.id, user_id: uid })))
    await loadGroups(userId)
    setShowCreateGroup(false); setNewGroupName(''); setNewGroupMembers(new Set())
    setCreatingGroup(false)
    await openGroup(grp.id)
  }

  function handleTyping() {
    const uid = userIdRef.current; const p = profileRef.current
    if (!typingChannelRef.current || !uid || !p) return
    typingChannelRef.current.track({ user_id:uid, full_name:p.full_name, typing:true })
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    typingTimerRef.current = setTimeout(() => { typingChannelRef.current?.untrack() }, 2000)
  }

  function handleFileSelect(file: File) {
    setUploadError(null)
    if (file.size > MAX_FILE_MB * 1024 * 1024) { setUploadError(`Max ${MAX_FILE_MB}MB`); return }
    setPendingFile(file)
    if (IMAGE_TYPES.includes(file.type)) setPendingFilePreview(URL.createObjectURL(file))
    else setPendingFilePreview(null)
  }
  function clearPendingFile() {
    if (pendingFilePreview) URL.revokeObjectURL(pendingFilePreview)
    setPendingFile(null); setPendingFilePreview(null); setUploadProgress(0); setUploadError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function uploadFile(file: File) {
    if (!userId) return null
    setUploading(true); setUploadProgress(0)
    const ext = file.name.split('.').pop()
    const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const interval = setInterval(() => setUploadProgress(p => Math.min(p+15, 85)), 200)
    const { error } = await supabase.storage.from('message-attachments').upload(path, file, { contentType:file.type })
    clearInterval(interval)
    if (error) { setUploadError(error.message); setUploading(false); return null }
    const { data:{ publicUrl } } = supabase.storage.from('message-attachments').getPublicUrl(path)
    setUploadProgress(100); setUploading(false)
    return { url:publicUrl, name:file.name, type:file.type }
  }

  async function sendMessage() {
    if ((!inputText.trim() && !pendingFile) || !activeChat || !userId || sending) return
    setSending(true)
    const content = inputText.trim()
    setInputText(''); if (inputRef.current) inputRef.current.style.height='auto'
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    typingChannelRef.current?.untrack(); setMentionQuery(null)

    let attachmentUrl: string|null=null, attachmentName: string|null=null, attachmentType: string|null=null
    if (pendingFile) {
      const r = await uploadFile(pendingFile)
      if (r) { attachmentUrl=r.url; attachmentName=r.name; attachmentType=r.type }
      clearPendingFile()
    }

    if (activeChat.type === 'dm') {
      const { data: msg } = await supabase.from('messages').insert({
        conversation_id: activeChat.id, sender_id: userId,
        content: content || ' ', attachment_url: attachmentUrl, attachment_name: attachmentName, attachment_type: attachmentType
      }).select().single()
      if (msg) {
        setDmMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg])
        setConversations(prev => prev.map(c => c.id === activeChat.id ? {...c, lastMessage: msg} : c)
          .sort((a,b) => new Date(b.lastMessage?.created_at ?? b.created_at).getTime() - new Date(a.lastMessage?.created_at ?? a.created_at).getTime()))
        if (content) {
          const mentionedIds = extractMentionedIds(content, allProfiles)
          for (const uid of mentionedIds) {
            if (uid === userId) continue
            await supabase.from('notifications').insert({ user_id:uid, type:'mention_message', actor_id:userId, message_id:msg.id, content:content.slice(0,120) })
          }
        }
      }
    } else {
      const { data: msg } = await supabase.from('group_messages').insert({
        group_id: activeChat.id, sender_id: userId,
        content: content || ' ', attachment_url: attachmentUrl, attachment_name: attachmentName, attachment_type: attachmentType
      }).select('*, sender:profiles!sender_id(*)').single()
      if (msg) {
        setGroupMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg as GroupMessage])
        setGroups(prev => prev.map(g => g.id === activeChat.id ? {...g, lastMessage: msg as GroupMessage} : g)
          .sort((a,b) => new Date(b.lastMessage?.created_at ?? b.created_at).getTime() - new Date(a.lastMessage?.created_at ?? a.created_at).getTime()))
      }
    }
    setSending(false); inputRef.current?.focus()
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    setInputText(val); handleTyping()
    const cursor = e.target.selectionStart ?? val.length
    const upTo = val.slice(0, cursor)
    const atIdx = upTo.lastIndexOf('@')
    if (atIdx !== -1) {
      const after = upTo.slice(atIdx+1)
      if (!after.includes(' ')) {
        setMentionQuery(after); setMentionStart(atIdx)
        const q = after.toLowerCase()
        const pool = activeChat?.type === 'group' ? (activeGroup?.members.filter(m => m.id !== userId) ?? []) : allProfiles
        setMentionSuggestions(pool.filter(p => !q || p.full_name?.toLowerCase().includes(q)).slice(0,6))
      } else setMentionQuery(null)
    } else setMentionQuery(null)
    e.target.style.height='auto'; e.target.style.height=Math.min(e.target.scrollHeight,120)+'px'
  }

  function selectMention(person: Profile) {
    const before = inputText.slice(0, mentionStart)
    const after = inputText.slice(mentionStart + 1 + (mentionQuery?.length ?? 0))
    setInputText(`${before}@${person.full_name} ${after}`)
    setMentionQuery(null); setMentionSuggestions([])
    setTimeout(() => {
      inputRef.current?.focus()
      const pos = mentionStart + (person.full_name?.length ?? 0) + 2
      inputRef.current?.setSelectionRange(pos, pos)
    }, 10)
  }

  function startEdit(msgId: string, content: string) { setEditingMsgId(msgId); setEditingText(content) }
  function cancelEdit() { setEditingMsgId(null); setEditingText('') }

  async function saveEdit(msgId: string) {
    if (!editingText.trim() || savingEdit) return
    setSavingEdit(true)
    const table = activeChat?.type === 'group' ? 'group_messages' : 'messages'
    const { data: updated } = await supabase.from(table).update({ content:editingText.trim() }).eq('id', msgId).select().single()
    if (updated) {
      if (activeChat?.type === 'group') setGroupMessages(prev => prev.map(m => m.id === msgId ? {...m,...updated} : m))
      else setDmMessages(prev => prev.map(m => m.id === msgId ? {...m,...updated} : m))
    }
    setSavingEdit(false); setEditingMsgId(null); setEditingText('')
  }

  async function deleteMessage(msgId: string) {
    if (!window.confirm('Delete this message?')) return
    setDeletingMsgId(msgId)
    const table = activeChat?.type === 'group' ? 'group_messages' : 'messages'
    await supabase.from(table).delete().eq('id', msgId)
    if (activeChat?.type === 'group') setGroupMessages(prev => prev.filter(m => m.id !== msgId))
    else setDmMessages(prev => prev.filter(m => m.id !== msgId))
    setDeletingMsgId(null)
  }

  async function togglePin(msgId: string, isPinned: boolean) {
    const newVal = !isPinned
    const table = activeChat?.type === 'group' ? 'group_messages' : 'messages'
    await supabase.from(table).update({ is_pinned:newVal }).eq('id', msgId)
    if (activeChat?.type === 'group') setGroupMessages(prev => prev.map(m => m.id === msgId ? {...m, is_pinned:newVal} : m))
    else setDmMessages(prev => prev.map(m => m.id === msgId ? {...m, is_pinned:newVal} : m))
    if (newVal) setShowPinnedBar(true)
  }

  function scrollToMessage(msgId: string) {
    const el = msgRefs.current[msgId]
    if (el) { el.scrollIntoView({ behavior:'smooth', block:'center' }); setHighlightedMsgId(msgId); setTimeout(() => setHighlightedMsgId(null), 2000) }
  }

  async function toggleReaction(msgId: string, emoji: string) {
    if (!userId) return
    const existing = (reactions[msgId]??[]).find(r => r.user_id === userId && r.emoji === emoji)
    if (existing) {
      await supabase.from('message_reactions').delete().eq('id', existing.id)
      setReactions(prev => ({ ...prev, [msgId]: (prev[msgId]??[]).filter(r => r.id !== existing.id) }))
    } else {
      const { data } = await supabase.from('message_reactions').insert({ message_id:msgId, user_id:userId, emoji }).select().single()
      if (data) setReactions(prev => ({ ...prev, [msgId]: [...(prev[msgId]??[]), data] }))
    }
    setShowEmojiFor(null)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery !== null && mentionSuggestions.length > 0) {
      if (e.key === 'Escape') { e.preventDefault(); setMentionQuery(null); return }
      if (e.key === 'Enter') { e.preventDefault(); selectMention(mentionSuggestions[0]); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }
  function handleEditKeyDown(e: React.KeyboardEvent, msgId: string) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(msgId) }
    if (e.key === 'Escape') cancelEdit()
  }

  function groupByDate(msgs: (DmMessage|GroupMessage)[]) {
    const groups: { label:string; messages:(DmMessage|GroupMessage)[] }[] = []
    msgs.forEach(msg => {
      const label = formatMsgDate(msg.created_at)
      const g = groups.find(x => x.label === label)
      if (g) g.messages.push(msg); else groups.push({ label, messages:[msg] })
    })
    return groups
  }

  function groupReactionsByEmoji(msgId: string) {
    const raw = reactions[msgId] ?? []
    const map: Record<string,{count:number;iMine:boolean}> = {}
    raw.forEach(r => {
      if (!map[r.emoji]) map[r.emoji]={count:0,iMine:false}
      map[r.emoji].count++
      if (r.user_id === userId) map[r.emoji].iMine=true
    })
    return Object.entries(map).map(([emoji,v]) => ({ emoji,...v }))
  }

  function renderContent(content: string) {
    if (!content || content.trim() === ' ') return null
    const parts = content.split(/(@\S+)/g)
    return parts.map((part,i) => {
      if (part.startsWith('@')) {
        const name = part.slice(1)
        const found = allProfiles.find(p => p.full_name === name) || (profile?.full_name === name ? profile : null)
        if (found) {
          const isMe = found.id === userId
          return <span key={i} style={{ background: isMe ? 'rgba(192,80,77,0.15)' : 'rgba(75,172,198,0.15)', color: isMe ? '#C0504D' : '#4BACC6', borderRadius:'4px', padding:'0 3px', fontWeight:700, cursor:'pointer' }} onClick={() => navigate(`/profile/${found.id}`)}>{part}</span>
        }
      }
      return <span key={i}>{part}</span>
    })
  }

  function renderAttachment(msg: DmMessage|GroupMessage, isMine: boolean) {
    if (!msg.attachment_url) return null
    const isImage = msg.attachment_type && IMAGE_TYPES.includes(msg.attachment_type)
    const hasText = msg.content && msg.content.trim() !== ' '
    if (isImage) {
      return (
        <div style={{ marginTop: hasText ? '0.55rem' : 0 }}>
          <a href={msg.attachment_url} target="_blank" rel="noopener noreferrer">
            <img src={msg.attachment_url} alt={msg.attachment_name ?? 'image'} style={{ maxWidth:'100%', maxHeight:240, borderRadius:10, display:'block', cursor:'zoom-in', border: isMine ? 'none' : '1px solid #E2E6EA' }} loading="lazy" />
          </a>
        </div>
      )
    }
    return (
      <a href={msg.attachment_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration:'none', display:'block', marginTop: hasText ? '0.55rem' : 0 }}>
        <div className={`file-card${isMine ? ' mine' : ''}`}>
          <div className="file-card-icon">{fileIcon(msg.attachment_type)}</div>
          <div className="file-card-info">
            <div className="file-card-name">{msg.attachment_name ?? 'File'}</div>
            <div className="file-card-type">{msg.attachment_type?.split('/')[1]?.toUpperCase() ?? 'FILE'}</div>
          </div>
          <div className="file-card-dl">↓</div>
        </div>
      </a>
    )
  }

  const filteredConvs = conversations.filter(c => !convSearch || c.otherUser?.full_name?.toLowerCase().includes(convSearch.toLowerCase()))
  const filteredGroups = groups.filter(g => !convSearch || g.name.toLowerCase().includes(convSearch.toLowerCase()))
  const filteredUsers = allProfiles.filter(p => !userSearch || p.full_name?.toLowerCase().includes(userSearch.toLowerCase()))
  const typingLabel = typers.length === 1 ? `${typers[0]} is typing` : typers.length === 2 ? `${typers[0]} and ${typers[1]} are typing` : 'Several people are typing'
  const sentDmMsgs = dmMessages.filter(m => m.sender_id === userId)
  const lastReadSentMsgId = [...sentDmMsgs].reverse().find(m => m.read_at)?.id
  const canSend = (inputText.trim().length > 0 || !!pendingFile) && !sending && !uploading

  // For group mentions, use group members; for DM use all profiles
  const mentionPool = activeChat?.type === 'group'
    ? (activeGroup?.members.filter(m => m.id !== userId) ?? [])
    : allProfiles

  if (loading) return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'#7A8899', fontFamily:'Nunito, sans-serif' }}>Loading…</div>

  return (
    <>
      <style>{`
        @keyframes msgIn        { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn       { from{opacity:0} to{opacity:1} }
        @keyframes slideUp      { from{opacity:0;transform:translateY(20px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes typingBounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-5px)} }
        @keyframes typingFade   { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes reactionPop  { from{opacity:0;transform:scale(0.5)} to{opacity:1;transform:scale(1)} }
        @keyframes emojiPickerIn{ from{opacity:0;transform:scale(0.85) translateY(6px)} to{opacity:1;transform:scale(1) translateY(0)} }
        @keyframes pinnedSlide  { from{opacity:0;transform:translateY(-10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes highlight    { 0%,100%{background:transparent} 30%{background:rgba(251,191,36,0.18)} }
        @keyframes mentionIn    { from{opacity:0;transform:translateY(6px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes progressPulse{ 0%,100%{opacity:1} 50%{opacity:0.6} }
        @keyframes dropIn       { from{opacity:0} to{opacity:1} }
        @keyframes slideRight   { from{opacity:0;transform:translateX(20px)} to{opacity:1;transform:translateX(0)} }

        .msg-page { display:flex;flex-direction:column;height:100vh;font-family:'Nunito','Segoe UI',system-ui,sans-serif;overflow:hidden; }
        .msg-shell { display:flex;flex:1;min-height:0;overflow:hidden; }

        /* ── Conv panel ── */
        .conv-panel { width:300px;flex-shrink:0;display:flex;flex-direction:column;background:white;border-right:1px solid #E2E6EA;height:100%;overflow:hidden; }
        .conv-header { padding:1rem 1.1rem 0.75rem;border-bottom:1px solid #E2E6EA;flex-shrink:0; }
        .conv-header-top { display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem; }
        .conv-title { font-size:1rem;font-weight:800;color:#1A2B3C;display:flex;align-items:center;gap:0.4rem; }
        .conv-unread-total { background:#365F91;color:white;border-radius:999px;font-size:0.65rem;font-weight:800;padding:0.12rem 0.45rem; }
        .conv-actions { display:flex;gap:0.35rem; }
        .conv-action-btn { width:28px;height:28px;border-radius:7px;background:#EEF4FB;border:1px solid #C5D9F1;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#365F91;font-size:0.95rem;font-weight:700;transition:all 0.12s; }
        .conv-action-btn:hover { background:#C5D9F1; }
        .conv-search-wrap { display:flex;align-items:center;gap:0.4rem;background:#F2F4F7;border-radius:8px;padding:0.4rem 0.65rem; }
        .conv-search-wrap input { background:transparent;border:none;outline:none;flex:1;font-size:0.82rem;color:#1A2B3C;font-family:inherit; }
        .conv-search-wrap input::placeholder { color:#9CA3AF; }
        .conv-list { flex:1;overflow-y:auto; }
        .conv-list::-webkit-scrollbar{width:3px}
        .conv-list::-webkit-scrollbar-thumb{background:#E2E6EA;border-radius:999px}

        /* Section label in sidebar */
        .conv-section-label { font-size:0.6rem;font-weight:800;color:rgba(26,43,60,0.35);text-transform:uppercase;letter-spacing:0.1em;padding:0.75rem 1.1rem 0.3rem;display:flex;align-items:center;justify-content:space-between; }
        .conv-section-add { width:18px;height:18px;border-radius:5px;background:#EEF4FB;border:1px solid #C5D9F1;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#365F91;font-size:0.75rem;font-weight:700;transition:all 0.12s; }
        .conv-section-add:hover { background:#C5D9F1; }

        .conv-item { display:flex;align-items:center;gap:0.7rem;padding:0.7rem 1.1rem;cursor:pointer;transition:background 0.1s;border-bottom:1px solid #F0F2F5; }
        .conv-item:hover { background:#F8F9FA; }
        .conv-item.active { background:#EEF4FB; }
        .conv-item.has-unread .conv-item-name { font-weight:800; }
        .conv-item-info { flex:1;min-width:0; }
        .conv-item-top { display:flex;align-items:center;justify-content:space-between;margin-bottom:0.12rem; }
        .conv-item-name { font-size:0.85rem;font-weight:600;color:#1A2B3C;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .conv-item-time { font-size:0.67rem;color:#9CA3AF;flex-shrink:0;margin-left:0.4rem; }
        .conv-item-preview { font-size:0.75rem;color:#7A8899;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .conv-item-preview.typing { color:#4BACC6;font-style:italic;font-weight:500; }
        .conv-unread-badge { min-width:18px;height:18px;border-radius:9px;background:#365F91;color:white;font-size:0.62rem;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 4px;flex-shrink:0; }

        /* Group badge */
        .group-badge { font-size:0.6rem;background:#EEF4FB;color:#365F91;border:1px solid #C5D9F1;border-radius:999px;padding:0.08rem 0.38rem;font-weight:700;flex-shrink:0; }

        .conv-empty { padding:1.5rem;text-align:center;color:#9CA3AF;font-size:0.8rem; }

        /* ── Chat area ── */
        .chat-area { flex:1;display:flex;min-width:0;overflow:hidden;position:relative; }
        .chat-main { flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden;background:#F8F9FA; }

        .drop-overlay { position:absolute;inset:0;z-index:100;background:rgba(79,129,189,0.08);border:3px dashed #4BACC6;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.75rem;pointer-events:none;animation:dropIn 0.15s ease; }

        .chat-header { display:flex;align-items:center;gap:0.85rem;padding:0.85rem 1.25rem;background:white;border-bottom:1px solid #E2E6EA;flex-shrink:0;box-shadow:0 1px 3px rgba(0,0,0,0.04); }
        .chat-header-name { font-size:1rem;font-weight:800;color:#1A2B3C; }
        .chat-header-sub { font-size:0.75rem;color:#9CA3AF; }
        .chat-header-typing { font-size:0.75rem;color:#4BACC6;font-style:italic;animation:typingFade 0.2s ease; }
        .chat-header-actions { margin-left:auto;display:flex;gap:0.4rem; }
        .chat-header-btn { background:#F2F4F7;border:1px solid #E2E6EA;border-radius:7px;padding:0.38rem 0.7rem;font-size:0.78rem;font-weight:600;color:#4A5568;cursor:pointer;transition:all 0.12s;font-family:inherit; }
        .chat-header-btn:hover { background:#EEF4FB;border-color:#C5D9F1;color:#365F91; }
        .chat-header-pin-badge { display:flex;align-items:center;gap:0.3rem;padding:0.32rem 0.7rem;background:#FFFBEB;border:1px solid #FDE68A;border-radius:7px;font-size:0.75rem;font-weight:700;color:#92400E;cursor:pointer; }
        .chat-header-pin-badge:hover { background:#FEF3C7; }

        /* Member avatars strip in group header */
        .group-member-strip { display:flex;align-items:center; }
        .group-member-strip-avatar { width:20px;height:20px;border-radius:50%;background:linear-gradient(135deg,#4F81BD,#243F60);color:white;font-size:0.5rem;font-weight:800;display:flex;align-items:center;justify-content:center;border:1.5px solid white;margin-left:-6px; }
        .group-member-strip-avatar:first-child { margin-left:0; }

        .pinned-bar { display:flex;align-items:center;gap:0.65rem;padding:0.55rem 1.5rem;background:#FFFBEB;border-bottom:1px solid #FDE68A;flex-shrink:0;animation:pinnedSlide 0.2s ease; }
        .pinned-bar-icon { font-size:0.85rem;color:#D97706;flex-shrink:0; }
        .pinned-bar-body { flex:1;min-width:0;cursor:pointer; }
        .pinned-bar-label { font-size:0.65rem;font-weight:800;color:#D97706;text-transform:uppercase;letter-spacing:0.07em;display:block;margin-bottom:0.08rem; }
        .pinned-bar-preview { font-size:0.8rem;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:color 0.12s; }
        .pinned-bar-body:hover .pinned-bar-preview { color:#1A2B3C; }
        .pinned-bar-nav { display:flex;align-items:center;gap:4px;flex-shrink:0; }
        .pinned-bar-nav-btn { width:22px;height:22px;border-radius:5px;border:1px solid #FDE68A;background:white;color:#D97706;font-size:0.68rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center; }
        .pinned-bar-nav-btn:hover { background:#FEF3C7; }
        .pinned-bar-nav-count { font-size:0.68rem;color:#D97706;font-weight:700;padding:0 2px; }
        .pinned-bar-close { background:none;border:none;color:#D97706;cursor:pointer;font-size:0.8rem;padding:0.15rem;opacity:0.7;flex-shrink:0;transition:opacity 0.12s; }
        .pinned-bar-close:hover { opacity:1; }

        .chat-messages { flex:1;overflow-y:auto;padding:1.25rem 1.5rem 0.5rem;display:flex;flex-direction:column; }
        .chat-messages::-webkit-scrollbar{width:5px}
        .chat-messages::-webkit-scrollbar-thumb{background:#D1D5DB;border-radius:999px}

        .msg-date-divider { display:flex;align-items:center;gap:0.75rem;margin:1.25rem 0 0.75rem; }
        .msg-date-line { flex:1;height:1px;background:#E2E6EA; }
        .msg-date-label { font-size:0.7rem;font-weight:700;color:#9CA3AF;white-space:nowrap;letter-spacing:0.06em;text-transform:uppercase; }

        .msg-row { display:flex;gap:0.6rem;padding:0.15rem 0;animation:msgIn 0.2s ease both;border-radius:10px;transition:background 0.3s; }
        .msg-row.mine { flex-direction:row-reverse; }
        .msg-row.highlighted { animation:highlight 2s ease; }
        .msg-avatar-col { width:30px;flex-shrink:0;display:flex;align-items:flex-end;padding-bottom:1.5rem; }
        .msg-avatar-spacer { width:30px;flex-shrink:0; }
        .msg-content-col { display:flex;flex-direction:column;max-width:70%; }
        .msg-row.mine .msg-content-col { align-items:flex-end; }
        .msg-sender-name { font-size:0.72rem;font-weight:700;color:#4A5568;margin-bottom:0.18rem;padding:0 0.5rem; }

        .msg-bubble-wrap { position:relative; }
        .msg-bubble-wrap:hover .msg-actions { opacity:1;pointer-events:auto; }
        .msg-bubble-wrap:hover .emoji-trigger-msg { opacity:1; }

        .msg-bubble { padding:0.6rem 0.95rem;font-size:0.9rem;line-height:1.55;word-break:break-word;white-space:pre-wrap;border-radius:4px 18px 18px 18px;background:white;color:#1A2B3C;border:1px solid #E2E6EA;box-shadow:0 1px 2px rgba(0,0,0,0.05);position:relative; }
        .msg-row.mine .msg-bubble { background:#365F91;color:white;border:none;border-radius:18px 4px 18px 18px;box-shadow:0 2px 6px rgba(54,95,145,0.3); }
        .msg-bubble.deleting { opacity:0.4; }
        .msg-bubble.is-pinned::after { content:'📌';position:absolute;top:-8px;right:-4px;font-size:0.7rem; }
        .msg-bubble.file-only { background:transparent;border:none;box-shadow:none;padding:0; }
        .msg-row.mine .msg-bubble.file-only { background:transparent; }

        .file-card { display:flex;align-items:center;gap:0.65rem;padding:0.65rem 0.85rem;background:#F2F4F7;border:1px solid #E2E6EA;border-radius:12px;transition:background 0.12s;min-width:200px;max-width:280px; }
        .file-card:hover { background:#EEF4FB;border-color:#C5D9F1; }
        .file-card.mine { background:rgba(255,255,255,0.15);border-color:rgba(255,255,255,0.2); }
        .file-card.mine:hover { background:rgba(255,255,255,0.25); }
        .file-card-icon { font-size:1.5rem;flex-shrink:0; }
        .file-card-info { flex:1;min-width:0; }
        .file-card-name { font-size:0.82rem;font-weight:600;color:#1A2B3C;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .file-card.mine .file-card-name { color:white; }
        .file-card-type { font-size:0.68rem;color:#6b7280;margin-top:0.1rem; }
        .file-card.mine .file-card-type { color:rgba(255,255,255,0.6); }
        .file-card-dl { font-size:0.85rem;color:#4BACC6;flex-shrink:0;font-weight:700; }

        .msg-actions { position:absolute;top:-34px;right:0;display:flex;gap:2px;background:white;border:1px solid #E2E6EA;border-radius:8px;padding:2px;box-shadow:0 2px 8px rgba(0,0,0,0.1);opacity:0;pointer-events:none;transition:opacity 0.15s;z-index:10; }
        .msg-row.mine .msg-actions { right:auto;left:0; }
        .msg-action-btn { display:flex;align-items:center;gap:0.28rem;padding:0.28rem 0.5rem;border:none;background:transparent;border-radius:6px;font-size:0.72rem;font-weight:600;cursor:pointer;transition:background 0.12s;color:#6b7280;font-family:inherit; }
        .msg-action-btn:hover { background:#F2F4F7;color:#374151; }
        .msg-action-btn.delete:hover { background:#FEF2F2;color:#dc2626; }
        .msg-action-btn.pin:hover,.msg-action-btn.pinned { background:#FFFBEB;color:#D97706; }

        .emoji-trigger-msg { position:absolute;top:50%;right:-32px;transform:translateY(-50%);width:26px;height:26px;border-radius:50%;background:white;border:1px solid #E2E6EA;display:flex;align-items:center;justify-content:center;font-size:0.75rem;cursor:pointer;opacity:0;transition:opacity 0.15s;box-shadow:0 1px 4px rgba(0,0,0,0.08);z-index:5; }
        .msg-row.mine .emoji-trigger-msg { right:auto;left:-32px; }
        .emoji-trigger-msg:hover { border-color:#4BACC6; }

        .emoji-picker-msg { position:absolute;bottom:calc(100% + 6px);right:-8px;background:white;border:1px solid #E2E6EA;border-radius:12px;padding:0.45rem;box-shadow:0 6px 20px rgba(0,0,0,0.12);display:flex;gap:2px;z-index:100;animation:emojiPickerIn 0.15s cubic-bezier(0.34,1.56,0.64,1); }
        .msg-row.mine .emoji-picker-msg { right:auto;left:-8px; }
        .emoji-btn-pick { width:32px;height:32px;border-radius:7px;border:none;background:transparent;font-size:1.05rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.1s; }
        .emoji-btn-pick:hover { background:#F2F4F7; }

        .msg-reactions { display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;padding:0 0.2rem; }
        .reaction-pill { display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:999px;border:1px solid #E2E6EA;background:white;font-size:0.78rem;cursor:pointer;transition:all 0.12s;animation:reactionPop 0.2s cubic-bezier(0.34,1.56,0.64,1); }
        .reaction-pill:hover { border-color:#4BACC6;background:#EEF4FB; }
        .reaction-pill.mine { border-color:#4BACC6;background:#EEF4FB; }
        .reaction-count { font-size:0.72rem;font-weight:700;color:#374151; }
        .reaction-pill.mine .reaction-count { color:#365F91; }

        .msg-edit-wrap { display:flex;flex-direction:column;gap:0.4rem;width:100%; }
        .msg-edit-textarea { padding:0.55rem 0.85rem;border:1.5px solid #4BACC6;border-radius:10px;font-size:0.9rem;color:#1A2B3C;font-family:inherit;resize:none;outline:none;min-height:48px;max-height:160px;line-height:1.5;background:white;box-shadow:0 0 0 3px rgba(75,172,198,0.1); }
        .msg-edit-actions { display:flex;gap:0.4rem;justify-content:flex-end;align-items:center; }
        .msg-edit-hint { font-size:0.68rem;color:#9CA3AF;flex:1; }
        .msg-edit-save { padding:0.32rem 0.85rem;background:#365F91;color:white;border:none;border-radius:7px;font-size:0.78rem;font-weight:700;cursor:pointer;font-family:inherit; }
        .msg-edit-save:hover:not(:disabled) { background:#243F60; }
        .msg-edit-save:disabled { opacity:0.5;cursor:not-allowed; }
        .msg-edit-cancel { padding:0.32rem 0.75rem;background:white;color:#6b7280;border:1px solid #E2E6EA;border-radius:7px;font-size:0.78rem;font-weight:600;cursor:pointer;font-family:inherit; }
        .msg-edit-cancel:hover { background:#F2F4F7; }

        .msg-time { font-size:0.65rem;color:#9CA3AF;margin-top:0.2rem;padding:0 0.5rem; }
        .msg-seen { display:flex;align-items:center;gap:0.3rem;font-size:0.65rem;color:#4BACC6;font-weight:600;padding:0 0.5rem;margin-top:0.1rem;animation:fadeIn 0.3s ease; }
        .msg-seen-av { width:14px;height:14px;border-radius:50%;background:linear-gradient(135deg,#4F81BD,#243F60);color:white;font-size:0.45rem;font-weight:800;display:flex;align-items:center;justify-content:center; }

        .typing-row { display:flex;align-items:center;gap:0.6rem;padding:0.5rem 0 0.75rem;animation:typingFade 0.25s ease; }
        .typing-bubble { display:inline-flex;align-items:center;gap:0.55rem;background:white;border:1px solid #E2E6EA;border-radius:4px 18px 18px 18px;padding:0.55rem 0.95rem;box-shadow:0 1px 2px rgba(0,0,0,0.05); }
        .typing-dots { display:flex;align-items:center;gap:3px; }
        .typing-dot { width:7px;height:7px;border-radius:50%;background:#9CA3AF;animation:typingBounce 1.1s ease-in-out infinite; }
        .typing-dot:nth-child(2) { animation-delay:0.18s; }
        .typing-dot:nth-child(3) { animation-delay:0.36s; }
        .typing-name { font-size:0.78rem;color:#9CA3AF;font-style:italic; }

        /* @mention */
        .mention-suggestions { position:absolute;bottom:calc(100% + 6px);left:0;right:0;background:white;border:1px solid #E2E6EA;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.12);overflow:hidden;z-index:200;animation:mentionIn 0.15s cubic-bezier(0.34,1.1,0.64,1); }
        .mention-header { padding:0.45rem 0.85rem;font-size:0.65rem;font-weight:800;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #f3f4f6;background:#f9fafb; }
        .mention-item { display:flex;align-items:center;gap:0.6rem;padding:0.6rem 0.85rem;cursor:pointer;transition:background 0.1s;border-bottom:1px solid #f9fafb; }
        .mention-item:last-child { border-bottom:none; }
        .mention-item:hover { background:#EEF4FB; }
        .mention-item-av { width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#4F81BD,#243F60);color:white;font-size:0.65rem;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0; }
        .mention-item-name { font-size:0.85rem;font-weight:600;color:#1A2B3C; }
        .mention-item-role { font-size:0.7rem;color:#9CA3AF;text-transform:capitalize;margin-left:0.3rem; }

        /* Input */
        .chat-input-area { padding:0.65rem 1.5rem 0.85rem;background:white;border-top:1px solid #E2E6EA;flex-shrink:0;position:relative; }
        .pending-file-bar { display:flex;align-items:center;gap:0.65rem;padding:0.55rem 0.75rem;background:#EEF4FB;border:1px solid #C5D9F1;border-radius:10px;margin-bottom:0.55rem; }
        .pending-file-preview-img { width:44px;height:44px;border-radius:7px;object-fit:cover;flex-shrink:0;border:1px solid #C5D9F1; }
        .pending-file-icon { font-size:1.5rem;flex-shrink:0; }
        .pending-file-info { flex:1;min-width:0; }
        .pending-file-name { font-size:0.82rem;font-weight:600;color:#1A2B3C;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .pending-file-size { font-size:0.7rem;color:#6b7280;margin-top:0.1rem; }
        .pending-file-remove { background:none;border:none;color:#9CA3AF;cursor:pointer;font-size:0.82rem;padding:0.2rem;border-radius:5px;transition:all 0.12s;flex-shrink:0; }
        .pending-file-remove:hover { background:#FEF2F2;color:#dc2626; }
        .upload-progress-bar { height:3px;background:#f3f4f6;border-radius:999px;overflow:hidden;margin-bottom:0.5rem; }
        .upload-progress-fill { height:100%;background:linear-gradient(90deg,#4BACC6,#4F81BD);border-radius:999px;transition:width 0.2s ease;animation:progressPulse 1s ease-in-out infinite; }
        .upload-error { font-size:0.75rem;color:#C0504D;font-weight:600;margin-bottom:0.45rem;display:flex;align-items:center;gap:0.3rem; }
        .chat-input-wrap { display:flex;align-items:flex-end;gap:0.65rem;background:#F2F4F7;border:1.5px solid #E2E6EA;border-radius:12px;padding:0.5rem 0.65rem;transition:border-color 0.15s; }
        .chat-input-wrap:focus-within { border-color:#4F81BD;background:white;box-shadow:0 0 0 3px rgba(79,129,189,0.08); }
        .chat-input-wrap textarea { flex:1;background:transparent;border:none;outline:none;font-size:0.9rem;color:#1A2B3C;font-family:inherit;resize:none;max-height:120px;min-height:22px;line-height:1.5;padding:0.2rem 0; }
        .chat-input-wrap textarea::placeholder { color:#9CA3AF; }
        .attach-btn { width:30px;height:30px;border-radius:7px;flex-shrink:0;background:transparent;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#9CA3AF;font-size:1.05rem;transition:all 0.12s; }
        .attach-btn:hover { background:#EEF4FB;color:#4BACC6; }
        .send-btn { width:34px;height:34px;border-radius:8px;flex-shrink:0;background:#365F91;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s;color:white;font-size:0.9rem; }
        .send-btn:hover:not(:disabled) { background:#243F60; }
        .send-btn:disabled { opacity:0.35;cursor:not-allowed; }
        .chat-input-hint { font-size:0.68rem;color:#B0BCCB;margin-top:0.35rem;padding:0 0.2rem; }

        /* Empty states */
        .chat-empty { flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#9CA3AF;gap:0.75rem;padding:3rem;text-align:center;background:#F8F9FA; }
        .chat-empty-icon { font-size:3rem;opacity:0.35; }
        .chat-empty-title { font-size:1.1rem;font-weight:700;color:#374151; }
        .chat-empty-sub { font-size:0.85rem;max-width:300px;line-height:1.6; }
        .chat-empty-btn { padding:0.65rem 1.5rem;background:#365F91;color:white;border:none;border-radius:9px;font-size:0.88rem;font-weight:700;cursor:pointer;font-family:inherit;margin-top:0.5rem; }
        .chat-empty-btn:hover { background:#243F60; }

        /* ── Group info panel ── */
        .group-info-panel { width:260px;flex-shrink:0;background:white;border-left:1px solid #E2E6EA;display:flex;flex-direction:column;overflow:hidden;animation:slideRight 0.2s ease; }
        .group-info-header { display:flex;align-items:center;justify-content:space-between;padding:1rem 1.1rem;border-bottom:1px solid #E2E6EA;flex-shrink:0; }
        .group-info-title { font-size:0.88rem;font-weight:800;color:#1A2B3C; }
        .group-info-close { background:none;border:none;color:#9CA3AF;cursor:pointer;font-size:0.85rem;padding:0.2rem;border-radius:5px;transition:all 0.12s; }
        .group-info-close:hover { background:#F2F4F7;color:#374151; }
        .group-info-body { flex:1;overflow-y:auto;padding:1rem 1.1rem; }
        .group-info-section { margin-bottom:1.25rem; }
        .group-info-label { font-size:0.65rem;font-weight:800;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.08em;display:block;margin-bottom:0.65rem; }
        .group-member-row { display:flex;align-items:center;gap:0.6rem;padding:0.45rem 0;border-bottom:1px solid #f9fafb;cursor:pointer;transition:background 0.1s;border-radius:7px;margin:0 -0.3rem;padding:0.45rem 0.3rem; }
        .group-member-row:hover { background:#F8F9FA; }
        .group-member-row:last-child { border-bottom:none; }
        .group-member-name { font-size:0.82rem;font-weight:600;color:#1A2B3C;flex:1; }
        .group-member-role { font-size:0.68rem;color:#9CA3AF;text-transform:capitalize; }

        /* Modals */
        .modal-overlay { position:fixed;inset:0;z-index:500;background:rgba(0,0,0,0.3);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;animation:fadeIn 0.15s ease; }
        .modal-box { background:white;border-radius:16px;width:480px;max-width:calc(100vw - 2rem);box-shadow:0 20px 60px rgba(0,0,0,0.15);animation:slideUp 0.25s cubic-bezier(0.34,1.56,0.64,1);overflow:hidden;display:flex;flex-direction:column;max-height:80vh; }
        .modal-header { display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;border-bottom:1px solid #E2E6EA;flex-shrink:0; }
        .modal-title { font-size:1rem;font-weight:800;color:#1A2B3C; }
        .modal-close { background:none;border:none;color:#9CA3AF;font-size:1.1rem;cursor:pointer;padding:0.2rem;border-radius:5px;line-height:1;transition:all 0.12s; }
        .modal-close:hover { background:#F2F4F7;color:#374151; }
        .modal-body { padding:1.1rem 1.25rem;flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:0.85rem; }
        .modal-footer { padding:0.85rem 1.25rem;border-top:1px solid #E2E6EA;display:flex;justify-content:flex-end;gap:0.5rem;flex-shrink:0; }
        .form-label { font-size:0.72rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;display:block;margin-bottom:0.3rem; }
        .form-input { width:100%;padding:0.6rem 0.85rem;border:1.5px solid #E2E6EA;border-radius:9px;font-size:0.9rem;color:#1A2B3C;font-family:inherit;outline:none;box-sizing:border-box; }
        .form-input:focus { border-color:#4BACC6;box-shadow:0 0 0 3px rgba(75,172,198,0.1); }
        .member-search { width:100%;padding:0.5rem 0.75rem;background:#F2F4F7;border:1px solid #E2E6EA;border-radius:8px;font-size:0.85rem;color:#1A2B3C;font-family:inherit;outline:none;box-sizing:border-box; }
        .member-search:focus { border-color:#4BACC6;background:white; }
        .member-list { flex:1;overflow-y:auto;border:1px solid #E2E6EA;border-radius:10px;max-height:220px; }
        .member-list::-webkit-scrollbar { width:3px; }
        .member-list::-webkit-scrollbar-thumb { background:#E2E6EA;border-radius:999px; }
        .member-item { display:flex;align-items:center;gap:0.65rem;padding:0.65rem 0.85rem;cursor:pointer;transition:background 0.1s;border-bottom:1px solid #f9fafb; }
        .member-item:last-child { border-bottom:none; }
        .member-item:hover { background:#F8F9FA; }
        .member-item.selected { background:#EEF4FB; }
        .member-check { width:18px;height:18px;border-radius:50%;border:2px solid #E2E6EA;display:flex;align-items:center;justify-content:center;font-size:0.62rem;color:white;flex-shrink:0;transition:all 0.12s; }
        .member-item.selected .member-check { background:#4BACC6;border-color:#4BACC6; }
        .member-name-text { font-size:0.85rem;font-weight:600;color:#1A2B3C;flex:1; }
        .member-role-text { font-size:0.7rem;color:#9CA3AF;text-transform:capitalize; }
        .selected-chips { display:flex;flex-wrap:wrap;gap:0.35rem;min-height:28px; }
        .selected-chip { display:flex;align-items:center;gap:0.3rem;background:#EEF4FB;border:1px solid #C5D9F1;border-radius:999px;padding:0.18rem 0.55rem;font-size:0.75rem;color:#365F91;font-weight:600; }
        .selected-chip-remove { background:none;border:none;color:#9CA3AF;cursor:pointer;font-size:0.75rem;padding:0;line-height:1;display:flex;align-items:center;transition:color 0.12s; }
        .selected-chip-remove:hover { color:#dc2626; }
        .btn-primary { padding:0.55rem 1.25rem;background:#243F60;color:white;border:none;border-radius:8px;font-size:0.85rem;font-weight:700;cursor:pointer;transition:background 0.15s;font-family:inherit; }
        .btn-primary:hover:not(:disabled) { background:#365F91; }
        .btn-primary:disabled { opacity:0.45;cursor:not-allowed; }
        .btn-secondary-sm { padding:0.55rem 1rem;background:white;color:#374151;border:1px solid #E2E6EA;border-radius:8px;font-size:0.85rem;font-weight:600;cursor:pointer;transition:all 0.12s;font-family:inherit; }
        .btn-secondary-sm:hover { background:#F2F4F7; }

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
          .group-info-panel { position:fixed;right:0;top:60px;bottom:0;width:280px;z-index:300;box-shadow:-4px 0 20px rgba(0,0,0,0.12); }
          .chat-messages { padding:1rem 1rem 0.5rem; }
          .chat-input-area { padding:0.65rem 1rem 0.85rem; }
        }
      `}</style>

      <div className="msg-page">
        <Navbar fullName={profile?.full_name ?? null} role={profile?.role ?? 'employee'} />

        <div className="msg-shell">
          {/* ── Sidebar ── */}
          <div className="conv-panel">
            <div className="conv-header">
              <div className="conv-header-top">
                <span className="conv-title">
                  Messages
                  {totalUnread > 0 && <span className="conv-unread-total">{totalUnread}</span>}
                </span>
                <div className="conv-actions">
                  <button className="conv-action-btn" onClick={() => setShowNewChat(true)} title="New DM">✉</button>
                  <button className="conv-action-btn" onClick={() => setShowCreateGroup(true)} title="New group">👥</button>
                </div>
              </div>
              <div className="conv-search-wrap">
                <span style={{ fontSize:'0.8rem', color:'#9CA3AF' }}>🔍</span>
                <input placeholder="Search…" value={convSearch} onChange={e => setConvSearch(e.target.value)} />
              </div>
            </div>

            <div className="conv-list">
              {/* Direct Messages */}
              <div className="conv-section-label">
                Direct Messages
                <button className="conv-section-add" onClick={() => setShowNewChat(true)} title="New DM">+</button>
              </div>

              {filteredConvs.length === 0 ? (
                <div className="conv-empty">No direct messages yet</div>
              ) : filteredConvs.map(conv => {
                const isTyping = activeChat?.type === 'dm' && activeChat.id === conv.id && typers.length > 0
                const isActive = activeChat?.type === 'dm' && activeChat.id === conv.id
                return (
                  <div key={conv.id} className={`conv-item${isActive ? ' active' : ''}${conv.unreadCount > 0 ? ' has-unread' : ''}`} onClick={() => openConversation(conv.id)}>
                    <Avatar name={conv.otherUser?.full_name ?? null} size={36} />
                    <div className="conv-item-info">
                      <div className="conv-item-top">
                        <span className="conv-item-name">{conv.otherUser?.full_name ?? 'Unknown'}</span>
                        {conv.lastMessage && <span className="conv-item-time">{timeAgo(conv.lastMessage.created_at)}</span>}
                      </div>
                      {isTyping
                        ? <div className="conv-item-preview typing">✦ typing…</div>
                        : <div className="conv-item-preview">{conv.lastMessage ? (conv.lastMessage.sender_id === userId ? 'You: ' : '') + (conv.lastMessage.attachment_url && (!conv.lastMessage.content || conv.lastMessage.content.trim() === ' ') ? '📎 File' : conv.lastMessage.content) : 'No messages yet'}</div>}
                    </div>
                    {conv.unreadCount > 0 && <div className="conv-unread-badge">{conv.unreadCount}</div>}
                  </div>
                )
              })}

              {/* Group Messages */}
              <div className="conv-section-label" style={{ marginTop:'0.5rem' }}>
                Group Messages
                <button className="conv-section-add" onClick={() => setShowCreateGroup(true)} title="New group">+</button>
              </div>

              {filteredGroups.length === 0 ? (
                <div className="conv-empty">No groups yet — create one!</div>
              ) : filteredGroups.map(grp => {
                const isTyping = activeChat?.type === 'group' && activeChat.id === grp.id && typers.length > 0
                const isActive = activeChat?.type === 'group' && activeChat.id === grp.id
                const others = grp.members.filter(m => m.id !== userId)
                return (
                  <div key={grp.id} className={`conv-item${isActive ? ' active' : ''}${grp.unreadCount > 0 ? ' has-unread' : ''}`} onClick={() => openGroup(grp.id)}>
                    <GroupAvatar members={others.slice(0,3)} size={36} />
                    <div className="conv-item-info">
                      <div className="conv-item-top">
                        <span className="conv-item-name">{grp.name}</span>
                        {grp.lastMessage && <span className="conv-item-time">{timeAgo(grp.lastMessage.created_at)}</span>}
                      </div>
                      {isTyping
                        ? <div className="conv-item-preview typing">✦ typing…</div>
                        : <div className="conv-item-preview">
                            {grp.lastMessage
                              ? ((grp.lastMessage as GroupMessage).sender?.full_name?.split(' ')[0] ?? 'Someone') + ': ' + ((grp.lastMessage.attachment_url && (!grp.lastMessage.content || grp.lastMessage.content.trim() === ' ')) ? '📎 File' : grp.lastMessage.content)
                              : 'No messages yet'}
                          </div>}
                    </div>
                    {grp.unreadCount > 0 && <div className="conv-unread-badge">{grp.unreadCount}</div>}
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Chat ── */}
          <div
            className="chat-area"
            onDragEnter={activeChat ? (e => { e.preventDefault(); dragCounterRef.current++; if (e.dataTransfer.types.includes('Files')) setIsDragging(true) }) : undefined}
            onDragLeave={activeChat ? (e => { e.preventDefault(); dragCounterRef.current--; if (dragCounterRef.current === 0) setIsDragging(false) }) : undefined}
            onDragOver={activeChat ? (e => e.preventDefault()) : undefined}
            onDrop={activeChat ? (e => { e.preventDefault(); dragCounterRef.current=0; setIsDragging(false); const f=e.dataTransfer.files[0]; if(f) handleFileSelect(f) }) : undefined}
          >
            <div className="chat-main">
              {isDragging && (
                <div className="drop-overlay">
                  <div style={{ fontSize:'3rem' }}>📎</div>
                  <div style={{ fontSize:'1.1rem', fontWeight:800, color:'#365F91' }}>Drop to send file</div>
                  <div style={{ fontSize:'0.82rem', color:'#4BACC6' }}>Max {MAX_FILE_MB}MB</div>
                </div>
              )}

              {(activeConv || activeGroup) ? (
                <>
                  {/* Header */}
                  <div className="chat-header">
                    {activeConv ? (
                      <>
                        <Avatar name={activeConv.otherUser?.full_name ?? null} size={36} />
                        <div>
                          <div className="chat-header-name">{activeConv.otherUser?.full_name ?? 'Unknown'}</div>
                          {typers.length > 0
                            ? <div className="chat-header-typing">✦ {typingLabel}…</div>
                            : <div className="chat-header-sub">{activeConv.otherUser?.role}</div>}
                        </div>
                        <div className="chat-header-actions">
                          {pinnedMessages.length > 0 && !showPinnedBar && <button className="chat-header-pin-badge" onClick={() => setShowPinnedBar(true)}>📌 {pinnedMessages.length}</button>}
                          <button className="chat-header-btn" onClick={() => navigate(`/profile/${activeConv.otherUser?.id}`)}>👤 Profile</button>
                        </div>
                      </>
                    ) : activeGroup ? (
                      <>
                        <GroupAvatar members={activeGroup.members.filter(m => m.id !== userId).slice(0,3)} size={36} />
                        <div>
                          <div className="chat-header-name">{activeGroup.name}</div>
                          {typers.length > 0
                            ? <div className="chat-header-typing">✦ {typingLabel}…</div>
                            : <div className="chat-header-sub" style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
                                <div className="group-member-strip">
                                  {activeGroup.members.slice(0,4).map((m,i) => (
                                    <div key={m.id} className="group-member-strip-avatar" style={{ background: ['#4BACC6','#8064A2','#C0504D','#9BBB59'][i % 4] }}>
                                      {initials(m.full_name)}
                                    </div>
                                  ))}
                                </div>
                                {activeGroup.members.length} members
                              </div>}
                        </div>
                        <div className="chat-header-actions">
                          {pinnedMessages.length > 0 && !showPinnedBar && <button className="chat-header-pin-badge" onClick={() => setShowPinnedBar(true)}>📌 {pinnedMessages.length}</button>}
                          <button className="chat-header-btn" onClick={() => setShowGroupInfo(o => !o)}>👥 Members</button>
                        </div>
                      </>
                    ) : null}
                  </div>

                  {/* Pinned bar */}
                  {pinnedMessages.length > 0 && showPinnedBar && (
                    <div className="pinned-bar">
                      <span className="pinned-bar-icon">📌</span>
                      <div className="pinned-bar-body" onClick={() => scrollToMessage(pinnedMessages[pinnedIdx]?.id)}>
                        <span className="pinned-bar-label">Pinned message</span>
                        <div className="pinned-bar-preview">{pinnedMessages[pinnedIdx]?.content || pinnedMessages[pinnedIdx]?.attachment_name || 'File'}</div>
                      </div>
                      {pinnedMessages.length > 1 && (
                        <div className="pinned-bar-nav">
                          <button className="pinned-bar-nav-btn" onClick={() => setPinnedIdx(i => (i-1+pinnedMessages.length)%pinnedMessages.length)}>‹</button>
                          <span className="pinned-bar-nav-count">{pinnedIdx+1}/{pinnedMessages.length}</span>
                          <button className="pinned-bar-nav-btn" onClick={() => setPinnedIdx(i => (i+1)%pinnedMessages.length)}>›</button>
                        </div>
                      )}
                      <button className="pinned-bar-close" onClick={() => setShowPinnedBar(false)}>✕</button>
                    </div>
                  )}

                  {/* Messages */}
                  <div className="chat-messages">
                    {loadingMessages ? (
                      <div style={{ textAlign:'center', color:'#9CA3AF', padding:'2rem', fontSize:'0.88rem' }}>Loading…</div>
                    ) : currentMessages.length === 0 ? (
                      <div style={{ textAlign:'center', color:'#9CA3AF', padding:'3rem 1rem' }}>
                        <div style={{ fontSize:'2.5rem', marginBottom:'0.75rem' }}>{activeGroup ? '👥' : '👋'}</div>
                        <div style={{ fontWeight:700, color:'#374151', marginBottom:'0.3rem' }}>
                          {activeGroup ? `Welcome to ${activeGroup.name}!` : `Start the conversation`}
                        </div>
                        <div style={{ fontSize:'0.85rem' }}>
                          {activeGroup ? `${activeGroup.members.length} members · Send the first message` : `Say hello to ${activeConv?.otherUser?.full_name?.split(' ')[0]}!`}
                        </div>
                      </div>
                    ) : groupByDate(currentMessages).map(group => (
                      <div key={group.label}>
                        <div className="msg-date-divider">
                          <div className="msg-date-line" /><div className="msg-date-label">{group.label}</div><div className="msg-date-line" />
                        </div>
                        {group.messages.map((msg, i) => {
                          const isMine = msg.sender_id === userId
                          const prevMsg = group.messages[i-1]
                          const isGroup = activeChat?.type === 'group'
                          const sender = isGroup ? (msg as GroupMessage).sender : null
                          const showAvatar = !isMine && (!prevMsg || prevMsg.sender_id !== msg.sender_id)
                          const isEditing = editingMsgId === msg.id
                          const isDeleting = deletingMsgId === msg.id
                          const msgReactions = groupReactionsByEmoji(msg.id)
                          const showSeen = !isGroup && isMine && msg.id === lastReadSentMsgId
                          const isHighlighted = highlightedMsgId === msg.id
                          const hasText = msg.content && msg.content.trim() !== ' '
                          const fileOnly = !hasText && !!msg.attachment_url

                          return (
                            <div
                              key={msg.id}
                              ref={el => { msgRefs.current[msg.id] = el }}
                              className={`msg-row${isMine ? ' mine' : ''}${isHighlighted ? ' highlighted' : ''}`}
                            >
                              {!isMine
                                ? showAvatar
                                  ? <div className="msg-avatar-col">
                                      <Avatar
                                        name={isGroup ? sender?.full_name ?? null : activeConv?.otherUser?.full_name ?? null}
                                        size={28}
                                      />
                                    </div>
                                  : <div className="msg-avatar-spacer" />
                                : null}

                              <div className="msg-content-col">
                                {showAvatar && (
                                  <div className="msg-sender-name">
                                    {isGroup ? (sender?.full_name ?? 'Unknown') : activeConv?.otherUser?.full_name}
                                  </div>
                                )}

                                {isEditing ? (
                                  <div className="msg-edit-wrap">
                                    <textarea
                                      ref={editInputRef}
                                      className="msg-edit-textarea"
                                      value={editingText}
                                      onChange={e => { setEditingText(e.target.value); e.target.style.height='auto'; e.target.style.height=Math.min(e.target.scrollHeight,160)+'px' }}
                                      onKeyDown={e => handleEditKeyDown(e, msg.id)}
                                    />
                                    <div className="msg-edit-actions">
                                      <span className="msg-edit-hint">Enter to save · Esc to cancel</span>
                                      <button className="msg-edit-cancel" onClick={cancelEdit}>Cancel</button>
                                      <button className="msg-edit-save" onClick={() => saveEdit(msg.id)} disabled={savingEdit || !editingText.trim()}>{savingEdit ? 'Saving…' : 'Save'}</button>
                                    </div>
                                  </div>
                                ) : (
                                  <div
                                    className="msg-bubble-wrap"
                                    onMouseEnter={() => setHoveredMsgId(msg.id)}
                                    onMouseLeave={() => setHoveredMsgId(null)}
                                  >
                                    {hoveredMsgId === msg.id && (
                                      <div className="msg-actions">
                                        <button className={`msg-action-btn pin${msg.is_pinned ? ' pinned' : ''}`} onClick={() => togglePin(msg.id, !!msg.is_pinned)}>
                                          📌 {msg.is_pinned ? 'Unpin' : 'Pin'}
                                        </button>
                                        {isMine && <>
                                          {hasText && <button className="msg-action-btn" onClick={() => startEdit(msg.id, msg.content)}>✎ Edit</button>}
                                          <button className="msg-action-btn delete" onClick={() => deleteMessage(msg.id)}>🗑</button>
                                        </>}
                                      </div>
                                    )}
                                    {hoveredMsgId === msg.id && (
                                      <button className="emoji-trigger-msg" onClick={() => setShowEmojiFor(showEmojiFor === msg.id ? null : msg.id)}>😊</button>
                                    )}
                                    {showEmojiFor === msg.id && (
                                      <div className="emoji-picker-msg">
                                        {QUICK_EMOJIS.map(emoji => (
                                          <button key={emoji} className="emoji-btn-pick" onClick={() => toggleReaction(msg.id, emoji)}>{emoji}</button>
                                        ))}
                                      </div>
                                    )}
                                    <div className={`msg-bubble${isDeleting ? ' deleting' : ''}${msg.is_pinned ? ' is-pinned' : ''}${fileOnly ? ' file-only' : ''}`}>
                                      {hasText && <span style={{ display:'block' }}>{renderContent(msg.content)}</span>}
                                      {renderAttachment(msg, isMine)}
                                    </div>
                                  </div>
                                )}

                                {msgReactions.length > 0 && (
                                  <div className="msg-reactions">
                                    {msgReactions.map(r => (
                                      <button key={r.emoji} className={`reaction-pill${r.iMine ? ' mine' : ''}`} onClick={() => toggleReaction(msg.id, r.emoji)}>
                                        {r.emoji}{r.count > 1 && <span className="reaction-count">{r.count}</span>}
                                      </button>
                                    ))}
                                  </div>
                                )}

                                <div className="msg-time">{formatMsgTime(msg.created_at)}</div>

                                {showSeen && (
                                  <div className="msg-seen">
                                    <div className="msg-seen-av">{initials(activeConv?.otherUser?.full_name ?? null)}</div>
                                    Seen
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ))}

                    {typers.length > 0 && (
                      <div className="typing-row">
                        <div className="msg-avatar-col" style={{ paddingBottom:0 }}>
                          <Avatar name={activeGroup ? typers[0] : activeConv?.otherUser?.full_name ?? null} size={28} />
                        </div>
                        <div className="typing-bubble">
                          <div className="typing-dots">
                            <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
                          </div>
                          <span className="typing-name">{typingLabel}</span>
                        </div>
                      </div>
                    )}

                    <div ref={messagesEndRef} />
                  </div>

                  {/* Input */}
                  <div className="chat-input-area">
                    {mentionQuery !== null && mentionSuggestions.length > 0 && (
                      <div className="mention-suggestions">
                        <div className="mention-header">Mention someone</div>
                        {mentionSuggestions.map(p => (
                          <div key={p.id} className="mention-item" onMouseDown={e => { e.preventDefault(); selectMention(p) }}>
                            <div className="mention-item-av">{initials(p.full_name)}</div>
                            <div><span className="mention-item-name">{p.full_name}</span><span className="mention-item-role">{p.role}</span></div>
                          </div>
                        ))}
                      </div>
                    )}

                    {uploading && <div className="upload-progress-bar"><div className="upload-progress-fill" style={{ width:`${uploadProgress}%` }} /></div>}
                    {uploadError && <div className="upload-error">⚠ {uploadError}<button onClick={() => setUploadError(null)} style={{ background:'none', border:'none', color:'#C0504D', cursor:'pointer', marginLeft:'auto', fontSize:'0.75rem' }}>✕</button></div>}

                    {pendingFile && (
                      <div className="pending-file-bar">
                        {pendingFilePreview ? <img className="pending-file-preview-img" src={pendingFilePreview} alt="" /> : <span className="pending-file-icon">{fileIcon(pendingFile.type)}</span>}
                        <div className="pending-file-info">
                          <div className="pending-file-name">{pendingFile.name}</div>
                          <div className="pending-file-size">{fmtSize(pendingFile.size)}</div>
                        </div>
                        <button className="pending-file-remove" onClick={clearPendingFile}>✕</button>
                      </div>
                    )}

                    <div className="chat-input-wrap">
                      <button className="attach-btn" onClick={() => fileInputRef.current?.click()} title="Attach file">📎</button>
                      <input ref={fileInputRef} type="file" style={{ display:'none' }} accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.mp4,.mp3" onChange={e => { const f=e.target.files?.[0]; if(f) handleFileSelect(f) }} />
                      <textarea
                        ref={inputRef}
                        rows={1}
                        placeholder={activeGroup ? `Message ${activeGroup.name}… (@ to mention)` : `Message ${activeConv?.otherUser?.full_name?.split(' ')[0] ?? ''}… (@ to mention)`}
                        value={inputText}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                      />
                      <button className="send-btn" onClick={sendMessage} disabled={!canSend}>{uploading ? '⏳' : '➤'}</button>
                    </div>
                    <div className="chat-input-hint">Enter to send · Shift+Enter for new line · @ to mention · 📎 drag & drop files</div>
                  </div>
                </>
              ) : (
                <div className="chat-empty">
                  <div className="chat-empty-icon">💬</div>
                  <div className="chat-empty-title">Messages</div>
                  <div className="chat-empty-sub">Select a conversation, or start a new DM or group chat.</div>
                  <div style={{ display:'flex', gap:'0.5rem', marginTop:'0.5rem' }}>
                    <button className="chat-empty-btn" onClick={() => setShowNewChat(true)}>✉ New DM</button>
                    <button className="chat-empty-btn" style={{ background:'#8064A2' }} onClick={() => setShowCreateGroup(true)}>👥 New Group</button>
                  </div>
                </div>
              )}
            </div>

            {/* ── Group Info Panel ── */}
            {showGroupInfo && activeGroup && (
              <div className="group-info-panel">
                <div className="group-info-header">
                  <span className="group-info-title">Group Info</span>
                  <button className="group-info-close" onClick={() => setShowGroupInfo(false)}>✕</button>
                </div>
                <div className="group-info-body">
                  <div className="group-info-section">
                    <span className="group-info-label">Group Name</span>
                    <div style={{ fontSize:'0.95rem', fontWeight:700, color:'#1A2B3C' }}>{activeGroup.name}</div>
                    <div style={{ fontSize:'0.75rem', color:'#9CA3AF', marginTop:'0.2rem' }}>{activeGroup.members.length} members</div>
                  </div>
                  <div className="group-info-section">
                    <span className="group-info-label">Members</span>
                    {activeGroup.members.map(m => (
                      <div key={m.id} className="group-member-row" onClick={() => { navigate(`/profile/${m.id}`); setShowGroupInfo(false) }}>
                        <Avatar name={m.full_name} size={28} />
                        <div>
                          <div className="group-member-name">{m.full_name ?? '—'}{m.id === userId && <span style={{ color:'#9CA3AF', fontWeight:400 }}> (you)</span>}</div>
                          <div className="group-member-role">{m.role}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── New DM modal ── */}
        {showNewChat && (
          <div className="modal-overlay" onClick={() => setShowNewChat(false)}>
            <div className="modal-box" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <span className="modal-title">New direct message</span>
                <button className="modal-close" onClick={() => setShowNewChat(false)}>✕</button>
              </div>
              <div className="new-chat-search-wrap">
                <input className="new-chat-search" placeholder="🔍  Search for a person…" value={userSearch} onChange={e => setUserSearch(e.target.value)} autoFocus />
              </div>
              <div className="new-chat-list">
                {filteredUsers.length === 0
                  ? <div style={{ padding:'2rem', textAlign:'center', color:'#9CA3AF', fontSize:'0.85rem' }}>No users found</div>
                  : filteredUsers.map(u => (
                    <div key={u.id} className="new-chat-user" onClick={() => handleNewDm(u)}>
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

        {/* ── Create Group modal ── */}
        {showCreateGroup && (
          <div className="modal-overlay" onClick={() => setShowCreateGroup(false)}>
            <div className="modal-box" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <span className="modal-title">👥 New group message</span>
                <button className="modal-close" onClick={() => { setShowCreateGroup(false); setNewGroupName(''); setNewGroupMembers(new Set()) }}>✕</button>
              </div>
              <div className="modal-body">
                <div>
                  <label className="form-label">Group name *</label>
                  <input className="form-input" placeholder="e.g. Marketing Team, Project Alpha…" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} autoFocus />
                </div>
                <div>
                  <label className="form-label">Add members *</label>
                  <input
                    className="member-search"
                    placeholder="🔍  Search people to add…"
                    value={userSearch}
                    onChange={e => setUserSearch(e.target.value)}
                  />
                </div>

                {newGroupMembers.size > 0 && (
                  <div className="selected-chips">
                    {Array.from(newGroupMembers).map(uid => {
                      const p = allProfiles.find(x => x.id === uid)
                      return p ? (
                        <div key={uid} className="selected-chip">
                          {p.full_name?.split(' ')[0]}
                          <button className="selected-chip-remove" onClick={() => setNewGroupMembers(prev => { const n=new Set(prev); n.delete(uid); return n })}>✕</button>
                        </div>
                      ) : null
                    })}
                  </div>
                )}

                <div className="member-list">
                  {filteredUsers.length === 0
                    ? <div style={{ padding:'1.5rem', textAlign:'center', color:'#9CA3AF', fontSize:'0.82rem' }}>No users found</div>
                    : filteredUsers.map(u => {
                      const selected = newGroupMembers.has(u.id)
                      return (
                        <div
                          key={u.id}
                          className={`member-item${selected ? ' selected' : ''}`}
                          onClick={() => setNewGroupMembers(prev => { const n=new Set(prev); selected ? n.delete(u.id) : n.add(u.id); return n })}
                        >
                          <Avatar name={u.full_name} size={30} />
                          <span className="member-name-text">{u.full_name}</span>
                          <span className="member-role-text">{u.role}</span>
                          <div className="member-check">{selected ? '✓' : ''}</div>
                        </div>
                      )
                    })}
                </div>

                {newGroupMembers.size > 0 && (
                  <div style={{ fontSize:'0.78rem', color:'#9CA3AF' }}>
                    {newGroupMembers.size} member{newGroupMembers.size !== 1 ? 's' : ''} selected (+ you)
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn-secondary-sm" onClick={() => { setShowCreateGroup(false); setNewGroupName(''); setNewGroupMembers(new Set()); setUserSearch('') }}>Cancel</button>
                <button
                  className="btn-primary"
                  onClick={createGroup}
                  disabled={!newGroupName.trim() || newGroupMembers.size === 0 || creatingGroup}
                >
                  {creatingGroup ? 'Creating…' : `Create group (${newGroupMembers.size + 1})`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
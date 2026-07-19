import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Navbar from '../components/Navbar'
import CallModal from '../components/CallModal'

interface Profile { id:string; full_name:string|null; role:string; department_id:string|null }
interface Conversation { id:string; user1_id:string; user2_id:string; created_at:string; otherUser:Profile|null; lastMessage:DmMessage|null; unreadCount:number }
interface DmMessage { id:string; conversation_id:string; sender_id:string; content:string; read_at:string|null; created_at:string; is_pinned?:boolean; attachment_url?:string|null; attachment_name?:string|null; attachment_type?:string|null }
interface GroupConversation { id:string; name:string; created_by:string|null; created_at:string; members:Profile[]; lastMessage:GroupMessage|null; unreadCount:number }
interface GroupMessage { id:string; group_id:string; sender_id:string; content:string; created_at:string; is_pinned?:boolean; attachment_url?:string|null; attachment_name?:string|null; attachment_type?:string|null; sender?:Profile|null }
interface MessageReaction { id:string; message_id:string; user_id:string; emoji:string }
interface CallRecord { id:string; room_name:string; caller_id:string; caller_name:string|null; callee_id:string|null; type:'audio'|'video'; status:string; created_at:string; ended_at:string|null; conversation_id:string|null; group_id:string|null; group_name:string|null }
interface IncomingCall { id:string; callerName:string; type:'audio'|'video'; roomName:string; conversationId?:string; groupId?:string }
type ActiveChat = {type:'dm';id:string}|{type:'group';id:string}|null

const QUICK_EMOJIS = ['👍','❤️','😂','😮','😢','🎉','🔥','✅']
const IMAGE_TYPES = ['image/jpeg','image/png','image/gif','image/webp','image/svg+xml']
const MAX_FILE_MB = 10

function initials(name:string|null):string {
  if(!name) return '?'
  return name.split(' ').filter(Boolean).slice(0,2).map(n=>n[0]).join('').toUpperCase()
}
function avatarBg(name:string|null):string {
  const c=['#4BACC6','#8064A2','#C0504D','#9BBB59','#F79646','#4F81BD','#243F60']
  if(!name) return c[0]
  let h=0; for(let i=0;i<name.length;i++) h=(name.charCodeAt(i)+((h<<5)-h))|0
  return c[Math.abs(h)%c.length]
}
function timeAgo(d:string):string {
  const diff=Math.floor((Date.now()-new Date(d).getTime())/1000)
  if(diff<60) return 'now'
  if(diff<3600) return `${Math.floor(diff/60)}m`
  if(diff<86400) return `${Math.floor(diff/3600)}h`
  if(diff<604800) return `${Math.floor(diff/86400)}d`
  return new Date(d).toLocaleDateString('en-AU',{day:'numeric',month:'short'})
}
function fmtTime(d:string):string { return new Date(d).toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit',hour12:true}) }
function fmtDate(d:string):string {
  const date=new Date(d); const today=new Date(); today.setHours(0,0,0,0)
  const yest=new Date(today); yest.setDate(yest.getDate()-1)
  if(date>=today) return 'Today'
  if(date>=yest) return 'Yesterday'
  return date.toLocaleDateString('en-AU',{weekday:'long',day:'numeric',month:'long'})
}
function fmtCallTime(d:string):string { return new Date(d).toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit',hour12:true}) }
function fmtDuration(start:string,end:string|null):string {
  if(!end) return ''
  const s=Math.floor((new Date(end).getTime()-new Date(start).getTime())/1000)
  if(s<60) return `${s}s`; return `${Math.floor(s/60)}m ${s%60}s`
}
function fmtSize(b:number):string {
  if(b<1024) return `${b}B`
  if(b<1024*1024) return `${(b/1024).toFixed(1)}KB`
  return `${(b/1024/1024).toFixed(1)}MB`
}
function fileIcon(type?:string|null):string {
  if(!type) return '📎'
  if(IMAGE_TYPES.includes(type)) return '🖼'
  if(type==='application/pdf') return '📄'
  if(type.includes('word')) return '📝'
  if(type.includes('sheet')||type.includes('excel')) return '📊'
  if(type.includes('zip')) return '🗜'
  if(type.includes('video')) return '🎬'
  if(type.includes('audio')) return '🎵'
  return '📎'
}

function Avatar({name,size=36}:{name:string|null;size?:number}) {
  return (
    <div style={{width:size,height:size,borderRadius:'50%',background:`linear-gradient(135deg,${avatarBg(name)},#1A2B3C)`,color:'white',fontSize:size*0.33,fontWeight:800,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
      {initials(name)}
    </div>
  )
}

function GroupAvatar({members,size=36}:{members:Profile[];size?:number}) {
  const colors=['#4BACC6','#8064A2','#C0504D','#9BBB59']
  if(!members.length) return <Avatar name={null} size={size}/>
  if(members.length===1) return <Avatar name={members[0].full_name} size={size}/>
  return (
    <div style={{width:size,height:size,position:'relative',flexShrink:0}}>
      {members.slice(0,2).map((m,i)=>(
        <div key={m.id} style={{position:'absolute',width:size*0.65,height:size*0.65,borderRadius:'50%',background:colors[i%colors.length],color:'white',fontSize:size*0.21,fontWeight:800,display:'flex',alignItems:'center',justifyContent:'center',border:'1.5px solid white',top:i===0?0:undefined,bottom:i===1?0:undefined,left:i===0?0:undefined,right:i===1?0:undefined,zIndex:2-i}}>
          {initials(m.full_name)}
        </div>
      ))}
    </div>
  )
}

export default function MessagesPage() {
  const navigate = useNavigate()
  const {userId:targetUserId} = useParams<{userId?:string}>()

  const [profile, setProfile] = useState<Profile|null>(null)
  const [myId, setMyId] = useState<string>('')
  const [allProfiles, setAllProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [dmMessages, setDmMessages] = useState<DmMessage[]>([])
  const [groups, setGroups] = useState<GroupConversation[]>([])
  const [groupMessages, setGroupMessages] = useState<GroupMessage[]>([])
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupMembers, setNewGroupMembers] = useState<Set<string>>(new Set())
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [groupSearch, setGroupSearch] = useState('')
  const [showGroupInfo, setShowGroupInfo] = useState(false)
  const [activeChat, setActiveChat] = useState<ActiveChat>(null)
  const [inputText, setInputText] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [showNewDm, setShowNewDm] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [convSearch, setConvSearch] = useState('')
  const [typers, setTypers] = useState<string[]>([])
  const [reactions, setReactions] = useState<Record<string,MessageReaction[]>>({})
  const [showEmojiFor, setShowEmojiFor] = useState<string|null>(null)
  const [hoveredMsg, setHoveredMsg] = useState<string|null>(null)
  const [editingId, setEditingId] = useState<string|null>(null)
  const [editingText, setEditingText] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [highlightId, setHighlightId] = useState<string|null>(null)
  const [showPinBar, setShowPinBar] = useState(true)
  const [pinIdx, setPinIdx] = useState(0)
  const [mentionQuery, setMentionQuery] = useState<string|null>(null)
  const [mentionSugs, setMentionSugs] = useState<Profile[]>([])
  const [mentionStart, setMentionStart] = useState(0)
  const [pendingFile, setPendingFile] = useState<File|null>(null)
  const [pendingPreview, setPendingPreview] = useState<string|null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState<string|null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragCnt = useRef(0)
  const [callOpen, setCallOpen] = useState(false)
  const [callRoom, setCallRoom] = useState('')
  const [callType, setCallType] = useState<'audio'|'video'>('audio')
  const [callName, setCallName] = useState('')
  const [callOut, setCallOut] = useState(true)
  const [callId, setCallId] = useState<string|null>(null)
  const [callRemoteStatus, setCallRemoteStatus] = useState<string|null>(null)
  const [incomingCall, setIncomingCall] = useState<IncomingCall|null>(null)
  const [callHistory, setCallHistory] = useState<CallRecord[]>([])
  const [showCallHist, setShowCallHist] = useState(false)

  const msgsEndRef = useRef<HTMLDivElement>(null)
  const msgRefs = useRef<Record<string,HTMLDivElement|null>>({})
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const editRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const globalCh = useRef<ReturnType<typeof supabase.channel>|null>(null)
  const typingCh = useRef<ReturnType<typeof supabase.channel>|null>(null)
  const callCh = useRef<ReturnType<typeof supabase.channel>|null>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout>|null>(null)
  const myIdRef = useRef<string>('')
  const profileRef = useRef<Profile|null>(null)
  const activeChatRef = useRef<ActiveChat>(null)
  const convsRef = useRef<Conversation[]>([])
  const groupsRef = useRef<GroupConversation[]>([])
  const callIdRef = useRef<string|null>(null)

  useEffect(()=>{myIdRef.current=myId},[myId])
  useEffect(()=>{profileRef.current=profile},[profile])
  useEffect(()=>{activeChatRef.current=activeChat},[activeChat])
  useEffect(()=>{convsRef.current=conversations},[conversations])
  useEffect(()=>{groupsRef.current=groups},[groups])
  useEffect(()=>{callIdRef.current=callId},[callId])

  const activeConv = activeChat?.type==='dm' ? conversations.find(c=>c.id===activeChat.id)??null : null
  const activeGroup = activeChat?.type==='group' ? groups.find(g=>g.id===activeChat.id)??null : null
  const curMsgs = activeChat?.type==='dm' ? dmMessages : groupMessages
  const pinnedMsgs = curMsgs.filter(m=>m.is_pinned)
  const totalUnread = conversations.reduce((s,c)=>s+c.unreadCount,0)+groups.reduce((s,g)=>s+g.unreadCount,0)

  useEffect(()=>{setShowPinBar(true);setPinIdx(0)},[activeChat])
  useEffect(()=>{msgsEndRef.current?.scrollIntoView({behavior:'smooth'})},[dmMessages,groupMessages,typers])
  useEffect(()=>{if(editingId) setTimeout(()=>editRef.current?.focus(),50)},[editingId])
  useEffect(()=>{ return ()=>{if(pendingPreview) URL.revokeObjectURL(pendingPreview)} },[pendingPreview])

  useEffect(()=>{
    if(!showEmojiFor) return
    const h=(e:MouseEvent)=>{
      if(!(e.target as HTMLElement).closest('.ep-box')&&!(e.target as HTMLElement).closest('.ep-trig'))
        setShowEmojiFor(null)
    }
    document.addEventListener('mousedown',h)
    return ()=>document.removeEventListener('mousedown',h)
  },[showEmojiFor])

  // ── Boot ────────────────────────────────────────────────────
  useEffect(()=>{
    async function boot(){
      const {data:{user}}=await supabase.auth.getUser()
      if(!user){navigate('/login');return}
      setMyId(user.id); myIdRef.current=user.id
      const {data:p}=await supabase.from('profiles').select('*').eq('id',user.id).single()
      setProfile(p); profileRef.current=p
      const {data:ps}=await supabase.from('profiles').select('*').order('full_name')
      setAllProfiles((ps??[]).filter((x:Profile)=>x.id!==user.id))
      await Promise.all([loadConvs(user.id),loadGroups(user.id),loadCallHist(user.id)])
      // Guard against React StrictMode double-invoking this effect in dev, which
      // was leaving two listeners registered on the same channel topic and throwing
      // "cannot add postgres_changes callbacks ... after subscribe()".
      if(callCh.current){ supabase.removeChannel(callCh.current); callCh.current=null }
      // Single global channel, no call_participants table involved at all.
      // Every authenticated client receives every INSERT/UPDATE on `calls` and
      // decides locally whether it's relevant — this removes the two-table,
      // two-RLS-check race that was silently dropping invites before.
      callCh.current=supabase.channel('all-calls')
        .on('postgres_changes',{event:'INSERT',schema:'public',table:'calls'},(payload)=>{
          const call=payload.new as any
          console.log('[calls] INSERT event received:',call)
          if(call.caller_id===user.id) return // it's my own outgoing call
          if(call.status!=='ringing') return
          if(call.callee_id){
            if(call.callee_id!==user.id) return // DM call meant for someone else
          } else if(call.group_id){
            const amMember=groupsRef.current.some(g=>g.id===call.group_id)
            if(!amMember) return // group call for a group I'm not in
          } else {
            return // malformed row, ignore
          }
          console.log('[calls] this call is for me — ringing')
          const ic:IncomingCall={id:call.id,callerName:call.caller_name??'Someone',type:call.type,roomName:call.room_name,conversationId:call.conversation_id,groupId:call.group_id}
          setIncomingCall(ic)
          setCallName(call.caller_name??'Someone')
          setCallType(call.type)
          setCallRoom(call.room_name)
          setCallOut(false)
          setCallId(call.id)
          setCallRemoteStatus(null)
          setCallOpen(true)
        })
        .on('postgres_changes',{event:'UPDATE',schema:'public',table:'calls'},(payload)=>{
          const call=payload.new as any
          // Only react if this update is about the call currently open on screen
          if(callIdRef.current!==call.id) return
          console.log('[calls] UPDATE event received for current call — status:',call.status)
          // Previously this only handled 'declined'/'ended' and silently ignored
          // 'active' — which is exactly why the caller's screen never learned the
          // callee had picked up. Now every status flows to CallModal via this
          // state, and CallModal itself decides how to react (see remoteStatus prop).
          setCallRemoteStatus(call.status)
        })
        .subscribe((status)=>{
          if(status==='CHANNEL_ERROR') console.error('[calls channel] failed to subscribe — check that Realtime is enabled for the calls table in Database > Replication, and that the SQL rebuild ran without error')
          if(status==='SUBSCRIBED') console.log('[calls channel] listening for calls')
        })
      setLoading(false)
      if(targetUserId) await openConvWith(user.id,targetUserId)
    }
    boot()
    return ()=>{supabase.removeAllChannels();if(typingTimer.current)clearTimeout(typingTimer.current)}
  },[navigate,targetUserId])

  // ── Global realtime ─────────────────────────────────────────
  useEffect(()=>{
    if(!myId) return
    if(globalCh.current) supabase.removeChannel(globalCh.current)
    globalCh.current=supabase.channel('msg-global')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},(payload)=>{
        const msg=payload.new as DmMessage
        const uid=myIdRef.current; const active=activeChatRef.current
        const isMine=msg.sender_id===uid; const isActive=active?.type==='dm'&&active.id===msg.conversation_id
        setConversations(prev=>prev.map(c=>c.id!==msg.conversation_id?c:{...c,lastMessage:msg,unreadCount:isActive||isMine?c.unreadCount:c.unreadCount+1}).sort((a,b)=>new Date(b.lastMessage?.created_at??b.created_at).getTime()-new Date(a.lastMessage?.created_at??a.created_at).getTime()))
        if(!isMine&&isActive){setDmMessages(prev=>prev.find(m=>m.id===msg.id)?prev:[...prev,msg]);supabase.from('messages').update({read_at:new Date().toISOString()}).eq('id',msg.id).then(()=>{})}
      })
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'messages'},(payload)=>{
        const u=payload.new as DmMessage; setDmMessages(prev=>prev.map(m=>m.id===u.id?{...m,...u}:m))
      })
      .on('postgres_changes',{event:'DELETE',schema:'public',table:'messages'},(payload)=>{
        const d=payload.old as {id:string}; setDmMessages(prev=>prev.filter(m=>m.id!==d.id))
      })
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'group_messages'},async(payload)=>{
        const msg=payload.new as GroupMessage
        const uid=myIdRef.current; const active=activeChatRef.current
        const isMine=msg.sender_id===uid; const isActive=active?.type==='group'&&active.id===msg.group_id
        const {data:sender}=await supabase.from('profiles').select('*').eq('id',msg.sender_id).single()
        const full:GroupMessage={...msg,sender:sender??null}
        setGroups(prev=>prev.map(g=>g.id!==msg.group_id?g:{...g,lastMessage:full,unreadCount:isActive||isMine?g.unreadCount:g.unreadCount+1}).sort((a,b)=>new Date(b.lastMessage?.created_at??b.created_at).getTime()-new Date(a.lastMessage?.created_at??a.created_at).getTime()))
        if(!isMine&&isActive) setGroupMessages(prev=>prev.find(m=>m.id===msg.id)?prev:[...prev,full])
      })
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'group_messages'},(payload)=>{
        const u=payload.new as GroupMessage; setGroupMessages(prev=>prev.map(m=>m.id===u.id?{...m,...u}:m))
      })
      .on('postgres_changes',{event:'DELETE',schema:'public',table:'group_messages'},(payload)=>{
        const d=payload.old as {id:string}; setGroupMessages(prev=>prev.filter(m=>m.id!==d.id))
      })
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'message_reactions'},(payload)=>{
        const r=payload.new as MessageReaction; setReactions(prev=>({...prev,[r.message_id]:[...(prev[r.message_id]??[]).filter(x=>x.id!==r.id),r]}))
      })
      .on('postgres_changes',{event:'DELETE',schema:'public',table:'message_reactions'},(payload)=>{
        const r=payload.old as {id:string;message_id:string}; setReactions(prev=>({...prev,[r.message_id]:(prev[r.message_id]??[]).filter(x=>x.id!==r.id)}))
      })
      .subscribe()
    return ()=>{if(globalCh.current) supabase.removeChannel(globalCh.current)}
  },[myId])

  // ── Typing ──────────────────────────────────────────────────
  useEffect(()=>{
    if(!activeChat||!myId) return
    if(typingCh.current) supabase.removeChannel(typingCh.current)
    setTypers([])
    typingCh.current=supabase.channel(`typing:${activeChat.type}:${activeChat.id}`,{config:{presence:{key:myId}}})
      .on('presence',{event:'sync'},()=>{
        const state=typingCh.current?.presenceState<{user_id:string;name:string;typing:boolean}>()??{}
        setTypers(Object.values(state).flat().filter(p=>p.user_id!==myId&&p.typing).map(p=>p.name.split(' ')[0]))
      })
      .subscribe()
    return ()=>{if(typingCh.current) supabase.removeChannel(typingCh.current)}
  },[activeChat,myId])

  function emitTyping(){
    const p=profileRef.current
    if(!typingCh.current||!p) return
    typingCh.current.track({user_id:myIdRef.current,name:p.full_name??'Someone',typing:true})
    if(typingTimer.current) clearTimeout(typingTimer.current)
    typingTimer.current=setTimeout(()=>typingCh.current?.untrack(),2200)
  }

  // ── Loaders ─────────────────────────────────────────────────
  async function loadConvs(uid:string){
    const {data}=await supabase.from('conversations')
      .select('*,u1:profiles!conversations_user1_id_fkey(id,full_name,role,department_id),u2:profiles!conversations_user2_id_fkey(id,full_name,role,department_id)')
      .or(`user1_id.eq.${uid},user2_id.eq.${uid}`)
    if(!data) return
    const enriched=await Promise.all(data.map(async c=>{
      const other=c.user1_id===uid?c.u2:c.u1
      const {data:last}=await supabase.from('messages').select('*').eq('conversation_id',c.id).order('created_at',{ascending:false}).limit(1)
      const {count:unread}=await supabase.from('messages').select('id',{count:'exact',head:true}).eq('conversation_id',c.id).neq('sender_id',uid).is('read_at',null)
      return{id:c.id,user1_id:c.user1_id,user2_id:c.user2_id,created_at:c.created_at,otherUser:other as Profile,lastMessage:last?.[0]??null,unreadCount:unread??0}
    }))
    const sorted=enriched.sort((a,b)=>new Date(b.lastMessage?.created_at??b.created_at).getTime()-new Date(a.lastMessage?.created_at??a.created_at).getTime())
    setConversations(sorted); convsRef.current=sorted
  }

  async function loadGroups(uid:string){
    const {data:mems,error:memsErr}=await supabase.from('group_members').select('group_id').eq('user_id',uid)
    if(memsErr) console.error('[loadGroups] could not read group_members:',memsErr.message)
    if(!mems||!mems.length){ setGroups([]); groupsRef.current=[]; return }
    const {data:gcs,error:gcsErr}=await supabase.from('group_conversations').select('*').in('id',mems.map(m=>m.group_id))
    if(gcsErr) console.error('[loadGroups] could not read group_conversations:',gcsErr.message)
    if(!gcs) return
    const enriched=await Promise.all(gcs.map(async g=>{
      const {data:members}=await supabase.from('group_members').select('*,profile:profiles!user_id(*)').eq('group_id',g.id)
      const {data:last}=await supabase.from('group_messages').select('*,sender:profiles!sender_id(*)').eq('group_id',g.id).order('created_at',{ascending:false}).limit(1)
      return{...g,members:(members??[]).map((m:any)=>m.profile).filter(Boolean) as Profile[],lastMessage:last?.[0]??null,unreadCount:0}
    }))
    const sorted=enriched.sort((a,b)=>new Date(b.lastMessage?.created_at??b.created_at).getTime()-new Date(a.lastMessage?.created_at??a.created_at).getTime())
    setGroups(sorted); groupsRef.current=sorted
  }

  async function loadCallHist(uid:string){
    const {data:direct}=await supabase.from('calls').select('*').or(`caller_id.eq.${uid},callee_id.eq.${uid}`).order('created_at',{ascending:false}).limit(20)
    const myGroupIds=groupsRef.current.map(g=>g.id)
    let groupCalls:CallRecord[]=[]
    if(myGroupIds.length){
      const {data:gc}=await supabase.from('calls').select('*').in('group_id',myGroupIds).order('created_at',{ascending:false}).limit(20)
      groupCalls=(gc??[]) as CallRecord[]
    }
    const merged=[...((direct??[]) as CallRecord[]),...groupCalls]
    const dedup=Array.from(new Map(merged.map(c=>[c.id,c])).values())
    dedup.sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime())
    setCallHistory(dedup.slice(0,20))
  }

  async function loadRxns(ids:string[]){
    if(!ids.length) return
    const {data}=await supabase.from('message_reactions').select('*').in('message_id',ids)
    if(!data) return
    const g:Record<string,MessageReaction[]>={}
    data.forEach(r=>{if(!g[r.message_id])g[r.message_id]=[];g[r.message_id].push(r)})
    setReactions(prev=>({...prev,...g}))
  }

  async function openConv(convId:string){
    setActiveChat({type:'dm',id:convId}); setLoadingMsgs(true)
    setEditingId(null); setShowEmojiFor(null); setMentionQuery(null); clearFile(); setShowGroupInfo(false)
    const {data}=await supabase.from('messages').select('*').eq('conversation_id',convId).order('created_at',{ascending:true})
    setDmMessages(data??[]); if(data?.length) await loadRxns(data.map(m=>m.id))
    setLoadingMsgs(false)
    await supabase.from('messages').update({read_at:new Date().toISOString()}).eq('conversation_id',convId).neq('sender_id',myId).is('read_at',null)
    setConversations(prev=>prev.map(c=>c.id===convId?{...c,unreadCount:0}:c))
    setTimeout(()=>inputRef.current?.focus(),100)
  }

  async function openGroup(groupId:string){
    setActiveChat({type:'group',id:groupId}); setLoadingMsgs(true)
    setEditingId(null); setShowEmojiFor(null); setMentionQuery(null); clearFile(); setShowGroupInfo(false)
    const {data}=await supabase.from('group_messages').select('*,sender:profiles!sender_id(*)').eq('group_id',groupId).order('created_at',{ascending:true})
    setGroupMessages((data??[]) as GroupMessage[]); if(data?.length) await loadRxns(data.map(m=>m.id))
    setLoadingMsgs(false)
    setGroups(prev=>prev.map(g=>g.id===groupId?{...g,unreadCount:0}:g))
    setTimeout(()=>inputRef.current?.focus(),100)
  }

  async function openConvWith(uid:string,otherId:string){
    const sorted=[uid,otherId].sort()
    let {data:ex}=await supabase.from('conversations').select('id').eq('user1_id',sorted[0]).eq('user2_id',sorted[1]).maybeSingle()
    if(!ex){const {data:cr}=await supabase.from('conversations').insert({user1_id:sorted[0],user2_id:sorted[1]}).select('id').single();ex=cr;await loadConvs(uid)}
    if(ex) await openConv(ex.id)
  }

  async function handleNewDm(other:Profile){if(!myId) return;setShowNewDm(false);setUserSearch('');await openConvWith(myId,other.id)}

  // ── Create group (FIXED: uses profile.id, surfaces real errors, verifies membership landed) ──
  async function createGroup(){
    const uid = profile?.id ?? myId
    if(!newGroupName.trim()||newGroupMembers.size===0||!uid||creatingGroup) return
    setCreatingGroup(true)

    const {data:grp,error:ge}=await supabase
      .from('group_conversations')
      .insert({name:newGroupName.trim(),created_by:uid})
      .select()
      .single()

    if(ge||!grp){
      console.error('Group creation error:',ge)
      alert(`Couldn't create the group: ${ge?.message ?? 'the insert returned no row — check the group_conversations RLS SELECT policy allows created_by = auth.uid()'}`)
      setCreatingGroup(false)
      return
    }

    const memberIds=[uid,...Array.from(newGroupMembers)]
    const {error:me}=await supabase
      .from('group_members')
      .insert(memberIds.map(mid=>({group_id:grp.id,user_id:mid})))

    if(me){
      console.error('Group members error:',me)
      alert(`Group was created but adding members failed: ${me.message}. Rolling back.`)
      await supabase.from('group_conversations').delete().eq('id',grp.id)
      setCreatingGroup(false)
      return
    }

    // Verify the members actually landed (RLS can silently insert 0 rows in some misconfigurations)
    const {data:check}=await supabase.from('group_members').select('user_id').eq('group_id',grp.id)
    if(!check||check.length<memberIds.length){
      console.error('Group members verification mismatch — expected',memberIds.length,'got',check?.length)
      alert('Group members did not save correctly. Check the group_members INSERT policy in Supabase.')
    }

    await loadGroups(uid)
    setShowCreateGroup(false);setNewGroupName('');setNewGroupMembers(new Set());setGroupSearch('');setCreatingGroup(false)
    await openGroup(grp.id)
  }

  // ── File ────────────────────────────────────────────────────
  function handleFile(file:File){setUploadErr(null);if(file.size>MAX_FILE_MB*1024*1024){setUploadErr(`Max ${MAX_FILE_MB}MB`);return};setPendingFile(file);if(IMAGE_TYPES.includes(file.type))setPendingPreview(URL.createObjectURL(file))}
  function clearFile(){if(pendingPreview)URL.revokeObjectURL(pendingPreview);setPendingFile(null);setPendingPreview(null);setUploadErr(null);if(fileRef.current)fileRef.current.value=''}
  async function uploadFile(file:File){
    setUploading(true)
    const ext=file.name.split('.').pop()
    const path=`${myId}/${Date.now()}.${ext}`
    const {error}=await supabase.storage.from('message-attachments').upload(path,file,{contentType:file.type})
    setUploading(false)
    if(error){setUploadErr(error.message);return null}
    const {data:{publicUrl}}=supabase.storage.from('message-attachments').getPublicUrl(path)
    return{url:publicUrl,name:file.name,type:file.type}
  }

  // ── Send ────────────────────────────────────────────────────
  async function sendMessage(){
    if((!inputText.trim()&&!pendingFile)||!activeChat||!myId||sending) return
    setSending(true); const content=inputText.trim()
    setInputText(''); if(inputRef.current)inputRef.current.style.height='auto'
    if(typingTimer.current)clearTimeout(typingTimer.current)
    typingCh.current?.untrack(); setMentionQuery(null)
    let aUrl:string|null=null,aName:string|null=null,aType:string|null=null
    if(pendingFile){const r=await uploadFile(pendingFile);if(r){aUrl=r.url;aName=r.name;aType=r.type};clearFile()}
    if(activeChat.type==='dm'){
      const {data:msg}=await supabase.from('messages').insert({conversation_id:activeChat.id,sender_id:myId,content:content||' ',attachment_url:aUrl,attachment_name:aName,attachment_type:aType}).select().single()
      if(msg){
        setDmMessages(prev=>prev.find(m=>m.id===msg.id)?prev:[...prev,msg])
        setConversations(prev=>prev.map(c=>c.id===activeChat.id?{...c,lastMessage:msg}:c).sort((a,b)=>new Date(b.lastMessage?.created_at??b.created_at).getTime()-new Date(a.lastMessage?.created_at??a.created_at).getTime()))
        if(content){const mentioned=allProfiles.filter(p=>p.full_name&&content.includes(`@${p.full_name}`)&&p.id!==myId);for(const mp of mentioned)await supabase.from('notifications').insert({user_id:mp.id,type:'mention_message',actor_id:myId,content:content.slice(0,120)})}
      }
    } else {
      const {data:msg}=await supabase.from('group_messages').insert({group_id:activeChat.id,sender_id:myId,content:content||' ',attachment_url:aUrl,attachment_name:aName,attachment_type:aType}).select('*,sender:profiles!sender_id(*)').single()
      if(msg){setGroupMessages(prev=>prev.find(m=>m.id===msg.id)?prev:[...prev,msg as GroupMessage]);setGroups(prev=>prev.map(g=>g.id===activeChat.id?{...g,lastMessage:msg as GroupMessage}:g).sort((a,b)=>new Date(b.lastMessage?.created_at??b.created_at).getTime()-new Date(a.lastMessage?.created_at??a.created_at).getTime()))}
    }
    setSending(false); inputRef.current?.focus()
  }

  // ── Mention ─────────────────────────────────────────────────
  function handleInput(e:React.ChangeEvent<HTMLTextAreaElement>){
    const val=e.target.value; setInputText(val); emitTyping()
    const cursor=e.target.selectionStart??val.length; const upTo=val.slice(0,cursor); const atIdx=upTo.lastIndexOf('@')
    if(atIdx!==-1){const after=upTo.slice(atIdx+1);if(!after.includes(' ')){setMentionQuery(after);setMentionStart(atIdx);const q=after.toLowerCase();const pool=activeChat?.type==='group'?(activeGroup?.members.filter(m=>m.id!==myId)??[]):allProfiles;setMentionSugs(pool.filter(p=>!q||p.full_name?.toLowerCase().includes(q)).slice(0,6))}else setMentionQuery(null)}else setMentionQuery(null)
    e.target.style.height='auto'; e.target.style.height=Math.min(e.target.scrollHeight,120)+'px'
  }
  function pickMention(person:Profile){
    const before=inputText.slice(0,mentionStart); const after=inputText.slice(mentionStart+1+(mentionQuery?.length??0))
    setInputText(`${before}@${person.full_name} ${after}`); setMentionQuery(null)
    setTimeout(()=>{inputRef.current?.focus();const pos=mentionStart+(person.full_name?.length??0)+2;inputRef.current?.setSelectionRange(pos,pos)},10)
  }

  // ── Edit / Delete / Pin ─────────────────────────────────────
  async function saveEdit(msgId:string){
    if(!editingText.trim()||savingEdit) return; setSavingEdit(true)
    const tbl=activeChat?.type==='group'?'group_messages':'messages'
    const {data:u}=await supabase.from(tbl).update({content:editingText.trim()}).eq('id',msgId).select().single()
    if(u){if(activeChat?.type==='group')setGroupMessages(prev=>prev.map(m=>m.id===msgId?{...m,...u}:m));else setDmMessages(prev=>prev.map(m=>m.id===msgId?{...m,...u}:m))}
    setSavingEdit(false); setEditingId(null); setEditingText('')
  }
  async function deleteMessage(msgId:string){
    if(!window.confirm('Delete this message?')) return
    const tbl=activeChat?.type==='group'?'group_messages':'messages'
    await supabase.from(tbl).delete().eq('id',msgId)
    if(activeChat?.type==='group')setGroupMessages(prev=>prev.filter(m=>m.id!==msgId));else setDmMessages(prev=>prev.filter(m=>m.id!==msgId))
  }
  async function togglePin(msgId:string,isPinned:boolean){
    const tbl=activeChat?.type==='group'?'group_messages':'messages'
    await supabase.from(tbl).update({is_pinned:!isPinned}).eq('id',msgId)
    if(activeChat?.type==='group')setGroupMessages(prev=>prev.map(m=>m.id===msgId?{...m,is_pinned:!isPinned}:m));else setDmMessages(prev=>prev.map(m=>m.id===msgId?{...m,is_pinned:!isPinned}:m))
    if(!isPinned)setShowPinBar(true)
  }
  function scrollToMsg(msgId:string){
    const el=msgRefs.current[msgId]
    if(el){el.scrollIntoView({behavior:'smooth',block:'center'});setHighlightId(msgId);setTimeout(()=>setHighlightId(null),2000)}
  }

  // ── Reactions ────────────────────────────────────────────────
  async function toggleReaction(msgId:string,emoji:string){
    if(!myId) return
    const existing=(reactions[msgId]??[]).find(r=>r.user_id===myId&&r.emoji===emoji)
    if(existing){await supabase.from('message_reactions').delete().eq('id',existing.id);setReactions(prev=>({...prev,[msgId]:(prev[msgId]??[]).filter(r=>r.id!==existing.id)}))}
    else{const {data}=await supabase.from('message_reactions').insert({message_id:msgId,user_id:myId,emoji}).select().single();if(data)setReactions(prev=>({...prev,[msgId]:[...(prev[msgId]??[]),data as MessageReaction]}))}
    setShowEmojiFor(null)
  }
  function groupRxns(msgId:string){
    const raw=reactions[msgId]??[]; const map:Record<string,{count:number;iMine:boolean}>={};
    raw.forEach(r=>{if(!map[r.emoji])map[r.emoji]={count:0,iMine:false};map[r.emoji].count++;if(r.user_id===myId)map[r.emoji].iMine=true})
    return Object.entries(map).map(([emoji,v])=>({emoji,...v}))
  }

  // ── Calls (REBUILT: single row on `calls`, no call_participants table at all) ──
  async function startCall(type:'audio'|'video'){
    const uid = profile?.id ?? myId
    if(!uid||!activeChat||callOpen) return
    if(activeChat.type==='dm'&&!activeConv?.otherUser){ alert("Couldn't start the call: the other person's profile hasn't loaded yet."); return }

    const roomName=`infowall-${activeChat.id.replace(/-/g,'').slice(0,10)}-${Date.now()}`
    const otherName=activeChat.type==='dm'?activeConv?.otherUser?.full_name??'Someone':activeGroup?.name??'Group'

    const {data:call,error}=await supabase.from('calls').insert({
      room_name:roomName,
      caller_id:uid,
      caller_name:profile?.full_name??null,
      callee_id:activeChat.type==='dm'?(activeConv?.otherUser?.id??null):null,
      conversation_id:activeChat.type==='dm'?activeChat.id:null,
      group_id:activeChat.type==='group'?activeChat.id:null,
      group_name:activeChat.type==='group'?activeGroup?.name:null,
      type,
      status:'ringing'
    }).select().single()

    if(error||!call){
      console.error('Call creation error:',error)
      alert(`Couldn't start the call: ${error?.message ?? 'insert failed'}`)
      return
    }

    console.log('[calls] created call row',call.id,'for',otherName,'— waiting for the other side to receive the realtime INSERT event')
    setCallId(call.id);setCallRoom(roomName);setCallType(type);setCallName(otherName);setCallOut(true);setCallRemoteStatus(null);setCallOpen(true)
  }
  async function handleCallEnd(){
    if(callId) await supabase.from('calls').update({status:'ended',ended_at:new Date().toISOString()}).eq('id',callId)
    setCallOpen(false);setCallId(null);setIncomingCall(null);setCallRemoteStatus(null);if(myId) await loadCallHist(myId)
  }
  async function handleCallAccept(){
    if(!incomingCall) return
    const {error}=await supabase.from('calls').update({status:'active'}).eq('id',incomingCall.id)
    if(error) console.error('[calls] failed to mark active:',error.message)
    setIncomingCall(null)
  }
  async function handleCallDecline(){
    if(!incomingCall) return
    const {error}=await supabase.from('calls').update({status:'declined'}).eq('id',incomingCall.id)
    if(error) console.error('[calls] failed to mark declined:',error.message)
    setCallOpen(false);setCallId(null);setIncomingCall(null);setCallRemoteStatus(null);if(myId) await loadCallHist(myId)
  }

  // ── Render helpers ──────────────────────────────────────────
  function renderContent(content:string){
    if(!content||content.trim()===' ') return null
    return content.split(/(@\S+)/g).map((part,i)=>{
      if(part.startsWith('@')){const name=part.slice(1);const found=allProfiles.find(p=>p.full_name===name)??(profile?.full_name===name?profile:null);if(found)return <span key={i} style={{background:found.id===myId?'rgba(192,80,77,0.18)':'rgba(75,172,198,0.15)',color:found.id===myId?'#fca5a5':'#7dd3fc',borderRadius:3,padding:'0 3px',fontWeight:700,cursor:'pointer'}} onClick={()=>navigate(`/profile/${found.id}`)}>{part}</span>}
      return <span key={i}>{part}</span>
    })
  }
  function renderAttachment(msg:DmMessage|GroupMessage,isMine:boolean){
    if(!msg.attachment_url) return null
    const isImg=msg.attachment_type&&IMAGE_TYPES.includes(msg.attachment_type)
    const hasText=msg.content&&msg.content.trim()!==' '
    if(isImg) return <div style={{marginTop:hasText?'0.5rem':0}}><a href={msg.attachment_url!} target="_blank" rel="noopener noreferrer"><img src={msg.attachment_url!} alt="" style={{maxWidth:'100%',maxHeight:220,borderRadius:10,display:'block',cursor:'zoom-in',border:isMine?'none':'1px solid var(--border)'}} loading="lazy"/></a></div>
    return <a href={msg.attachment_url!} target="_blank" rel="noopener noreferrer" style={{textDecoration:'none',display:'block',marginTop:hasText?'0.5rem':0}}><div className={`fc${isMine?' fc-mine':''}`}><span className="fc-icon">{fileIcon(msg.attachment_type)}</span><div className="fc-info"><div className="fc-name">{msg.attachment_name??'File'}</div><div className="fc-meta">{msg.attachment_type?.split('/')[1]?.toUpperCase()??'FILE'} · Download</div></div><span style={{fontSize:'0.85rem',color:isMine?'rgba(255,255,255,0.6)':'#4BACC6'}}>↓</span></div></a>
  }
  function byDate(msgs:(DmMessage|GroupMessage)[]){
    const out:{label:string;messages:(DmMessage|GroupMessage)[]}[]=[]
    msgs.forEach(m=>{const label=fmtDate(m.created_at);const g=out.find(x=>x.label===label);if(g)g.messages.push(m);else out.push({label,messages:[m]})})
    return out
  }

  const typingLabel=typers.length===1?`${typers[0]} is typing`:typers.length>1?`${typers.join(' & ')} are typing`:''
  const filteredConvs=conversations.filter(c=>!convSearch||c.otherUser?.full_name?.toLowerCase().includes(convSearch.toLowerCase()))
  const filteredGroups=groups.filter(g=>!convSearch||g.name.toLowerCase().includes(convSearch.toLowerCase()))
  const filteredUsers=allProfiles.filter(u=>!userSearch||u.full_name?.toLowerCase().includes(userSearch.toLowerCase()))
  const filteredGrpUsers=allProfiles.filter(u=>!groupSearch||u.full_name?.toLowerCase().includes(groupSearch.toLowerCase()))
  const sentDm=dmMessages.filter(m=>m.sender_id===myId)
  const lastReadId=[...sentDm].reverse().find(m=>m.read_at)?.id

  if(loading) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',color:'var(--text-faint)',fontFamily:'Nunito,sans-serif'}}>Loading messages…</div>

  return (
    <>
      <style>{`
        @keyframes msgIn    {from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeIn   {from{opacity:0}to{opacity:1}}
        @keyframes slideUp  {from{opacity:0;transform:translateY(16px) scale(0.97)}to{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes typBnc   {0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-5px)}}
        @keyframes typIn    {from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes rxnPop   {from{opacity:0;transform:scale(0.4)}to{opacity:1;transform:scale(1)}}
        @keyframes epIn     {from{opacity:0;transform:scale(0.8) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}
        @keyframes pinSlide {from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes hl       {0%,100%{background:transparent}35%{background:rgba(251,191,36,0.15)}}
        @keyframes mtnIn    {from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
        @keyframes dropIn   {from{opacity:0}to{opacity:1}}
        @keyframes sldR     {from{opacity:0;transform:translateX(18px)}to{opacity:1;transform:translateX(0)}}
        *,*::before,*::after{box-sizing:border-box}
        .mp{display:flex;flex-direction:column;height:100vh;overflow:hidden;font-family:'Nunito','Segoe UI',system-ui,sans-serif}
        .mp-shell{display:flex;flex:1;min-height:0;overflow:hidden}
        .sb{width:290px;flex-shrink:0;background:var(--bg-surface);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden}
        .sb-top{padding:1rem 1.1rem 0.75rem;border-bottom:1px solid var(--border);flex-shrink:0}
        .sb-tr{display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem}
        .sb-title{font-size:0.98rem;font-weight:900;color:var(--text-primary);display:flex;align-items:center;gap:0.4rem}
        .sb-bdg{background:#365F91;color:white;border-radius:999px;font-size:0.62rem;font-weight:800;padding:0.1rem 0.4rem}
        .sb-btns{display:flex;gap:0.3rem}
        .sb-btn{width:27px;height:27px;border-radius:7px;background:#EEF4FB;border:1px solid #C5D9F1;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#365F91;font-size:0.88rem;font-weight:700;transition:all 0.12s}
        .sb-btn:hover{background:#C5D9F1}
        .sb-srch{display:flex;align-items:center;gap:0.4rem;background:var(--bg-page);border-radius:8px;padding:0.4rem 0.65rem}
        .sb-srch input{background:transparent;border:none;outline:none;flex:1;font-size:0.82rem;color:var(--text-primary);font-family:inherit}
        .sb-srch input::placeholder{color:var(--text-faint)}
        .sb-list{flex:1;overflow-y:auto}
        .sb-list::-webkit-scrollbar{width:3px}
        .sb-list::-webkit-scrollbar-thumb{background:var(--border);border-radius:999px}
        .sb-sec{font-size:0.6rem;font-weight:800;color:rgba(26,43,60,0.3);text-transform:uppercase;letter-spacing:0.1em;padding:0.75rem 1.1rem 0.3rem;display:flex;align-items:center;justify-content:space-between}
        .sb-sa{width:18px;height:18px;border-radius:4px;background:#EEF4FB;border:1px solid #C5D9F1;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#365F91;font-size:0.72rem;font-weight:700}
        .sb-sa:hover{background:#C5D9F1}
        .cvr{display:flex;align-items:center;gap:0.7rem;padding:0.68rem 1.1rem;cursor:pointer;transition:background 0.1s;border-bottom:1px solid var(--border-light)}
        .cvr:hover{background:var(--bg-hover)}
        .cvr.active{background:var(--bg-active)}
        .cvr.unread .cv-n{font-weight:800}
        .cv-i{flex:1;min-width:0}
        .cv-t{display:flex;align-items:center;justify-content:space-between;margin-bottom:0.1rem}
        .cv-n{font-size:0.84rem;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .cv-tm{font-size:0.65rem;color:var(--text-faint);flex-shrink:0;margin-left:0.3rem}
        .cv-p{font-size:0.74rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .cv-p.typ{color:#4BACC6;font-style:italic}
        .cv-b{min-width:18px;height:18px;border-radius:9px;background:#365F91;color:white;font-size:0.6rem;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 4px;flex-shrink:0}
        .cv-e{padding:1.5rem;text-align:center;color:var(--text-faint);font-size:0.78rem}
        .cht{display:flex;align-items:center;gap:0.5rem;padding:0.6rem 1.1rem;cursor:pointer;background:transparent;border:none;font-size:0.78rem;color:var(--text-faint);font-family:inherit;width:100%;text-align:left;border-top:1px solid var(--border);transition:background 0.1s}
        .cht:hover{background:var(--bg-hover);color:var(--text-primary)}
        .chp{border-top:1px solid var(--border);background:var(--bg-subtle);flex-shrink:0;max-height:210px;overflow-y:auto}
        .chi{display:flex;align-items:center;gap:0.6rem;padding:0.55rem 1.1rem;border-bottom:1px solid var(--border-light)}
        .chi:last-child{border-bottom:none}
        .ch-ic{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.82rem;flex-shrink:0}
        .ch-ic.ended{background:rgba(75,172,198,0.1)}
        .ch-ic.missed,.ch-ic.declined{background:rgba(192,80,77,0.1)}
        .ch-ic.ringing{background:rgba(34,197,94,0.1)}
        .ch-if{flex:1;min-width:0}
        .ch-nm{font-size:0.78rem;font-weight:700;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .ch-mt{font-size:0.65rem;color:var(--text-faint);margin-top:0.1rem}
        .ca{flex:1;display:flex;min-width:0;overflow:hidden;position:relative}
        .cm{flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden;background:var(--bg-page)}
        .dropz{position:absolute;inset:0;z-index:50;background:rgba(79,129,189,0.07);border:3px dashed #4BACC6;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.75rem;pointer-events:none;animation:dropIn 0.15s ease}
        .hdr{display:flex;align-items:center;gap:0.85rem;padding:0.85rem 1.25rem;background:var(--bg-surface);border-bottom:1px solid var(--border);flex-shrink:0;box-shadow:var(--shadow-sm)}
        .hdr-n{font-size:0.98rem;font-weight:800;color:var(--text-primary)}
        .hdr-s{font-size:0.73rem;color:var(--text-faint)}
        .hdr-ty{font-size:0.73rem;color:#4BACC6;font-style:italic;animation:typIn 0.2s ease}
        .hdr-r{margin-left:auto;display:flex;gap:0.4rem;align-items:center}
        .hb{background:var(--bg-page);border:1px solid var(--border);border-radius:7px;padding:0.38rem 0.75rem;font-size:0.76rem;font-weight:700;color:var(--text-muted);cursor:pointer;transition:all 0.12s;font-family:inherit;display:flex;align-items:center;gap:0.3rem}
        .hb:hover{background:var(--bg-active);border-color:#C5D9F1;color:var(--text-primary)}
        .hb.call{background:rgba(34,197,94,0.07);border-color:rgba(34,197,94,0.2);color:#16a34a}
        .hb.call:hover{background:rgba(34,197,94,0.14)}
        .hb.vid{background:rgba(75,172,198,0.07);border-color:rgba(75,172,198,0.2);color:#4BACC6}
        .hb.vid:hover{background:rgba(75,172,198,0.14)}
        .pinbar{display:flex;align-items:center;gap:0.65rem;padding:0.5rem 1.5rem;background:#FFFBEB;border-bottom:1px solid #FDE68A;flex-shrink:0;animation:pinSlide 0.2s ease}
        .pin-ic{font-size:0.82rem;color:#D97706;flex-shrink:0}
        .pin-bd{flex:1;min-width:0;cursor:pointer}
        .pin-lb{font-size:0.6rem;font-weight:800;color:#D97706;text-transform:uppercase;letter-spacing:0.07em;display:block;margin-bottom:0.06rem}
        .pin-pv{font-size:0.78rem;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .pin-bd:hover .pin-pv{color:var(--text-primary)}
        .pin-nv{display:flex;align-items:center;gap:3px;flex-shrink:0}
        .pin-nb{width:20px;height:20px;border-radius:4px;border:1px solid #FDE68A;background:white;color:#D97706;font-size:0.65rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center}
        .pin-ct{font-size:0.65rem;color:#D97706;font-weight:700;padding:0 2px}
        .pin-x{background:none;border:none;color:#D97706;cursor:pointer;font-size:0.78rem;opacity:0.6;flex-shrink:0;transition:opacity 0.12s}
        .pin-x:hover{opacity:1}
        .msgs{flex:1;overflow-y:auto;padding:1.25rem 1.5rem 0.5rem;display:flex;flex-direction:column}
        .msgs::-webkit-scrollbar{width:5px}
        .msgs::-webkit-scrollbar-thumb{background:var(--border);border-radius:999px}
        .dtd{display:flex;align-items:center;gap:0.75rem;margin:1.25rem 0 0.75rem}
        .dtl{flex:1;height:1px;background:var(--border)}
        .dtlb{font-size:0.68rem;font-weight:700;color:var(--text-faint);letter-spacing:0.06em;text-transform:uppercase;white-space:nowrap}
        /* ─── MESSAGE ROW — mine=right theirs=left ─── */
        .mr{display:flex;gap:0.65rem;padding:0.12rem 0;border-radius:10px;transition:background 0.3s;animation:msgIn 0.2s ease both}
        .mr.mine{flex-direction:row-reverse}
        .mr.hl{animation:hl 2s ease}
        .mr-av{width:32px;flex-shrink:0;display:flex;align-items:flex-end;padding-bottom:1.4rem}
        .mr-sp{width:32px;flex-shrink:0}
        .mr-col{display:flex;flex-direction:column;max-width:68%}
        .mr.mine .mr-col{align-items:flex-end}
        .mr-sn{font-size:0.7rem;font-weight:700;color:var(--text-muted);margin-bottom:0.16rem;padding:0 0.45rem}
        .mr-bw{position:relative}
        .mr-bw:hover .mr-acts{opacity:1;pointer-events:auto}
        .mr-bw:hover .ep-trig{opacity:1}
        /* Bubble theirs */
        .mr-b{padding:0.58rem 0.9rem;font-size:0.9rem;line-height:1.56;word-break:break-word;white-space:pre-wrap;border-radius:4px 18px 18px 18px;background:var(--bg-surface);color:var(--text-primary);border:1px solid var(--border);box-shadow:var(--shadow-sm);position:relative}
        /* Bubble mine */
        .mr.mine .mr-b{background:#2d5186;color:white;border:none;border-radius:18px 4px 18px 18px;box-shadow:0 2px 8px rgba(36,63,96,0.35)}
        .mr-b.pinned::after{content:'📌';position:absolute;top:-8px;right:-4px;font-size:0.68rem}
        .mr-b.fo{background:transparent;border:none;box-shadow:none;padding:0}
        .mr.mine .mr-b.fo{background:transparent;box-shadow:none}
        .fc{display:flex;align-items:center;gap:0.6rem;padding:0.6rem 0.8rem;background:var(--bg-page);border:1px solid var(--border);border-radius:11px;min-width:200px;max-width:280px;transition:all 0.12s}
        .fc:hover{background:var(--bg-active);border-color:#C5D9F1}
        .fc-mine{background:rgba(255,255,255,0.12);border-color:rgba(255,255,255,0.18)}
        .fc-mine:hover{background:rgba(255,255,255,0.2)}
        .fc-icon{font-size:1.4rem;flex-shrink:0}
        .fc-info{flex:1;min-width:0}
        .fc-name{font-size:0.8rem;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .fc-mine .fc-name{color:white}
        .fc-meta{font-size:0.65rem;color:var(--text-faint);margin-top:0.08rem}
        .fc-mine .fc-meta{color:rgba(255,255,255,0.55)}
        .mr-acts{position:absolute;top:-34px;right:0;display:flex;gap:2px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:2px;box-shadow:var(--shadow-md);opacity:0;pointer-events:none;transition:opacity 0.15s;z-index:10}
        .mr.mine .mr-acts{right:auto;left:0}
        .mr-act{display:flex;align-items:center;gap:0.25rem;padding:0.26rem 0.5rem;border:none;background:transparent;border-radius:5px;font-size:0.7rem;font-weight:600;cursor:pointer;color:var(--text-muted);font-family:inherit;transition:background 0.1s;white-space:nowrap}
        .mr-act:hover{background:var(--bg-hover);color:var(--text-primary)}
        .mr-act.del:hover{background:#FEF2F2;color:#dc2626}
        .mr-act.pin:hover,.mr-act.pinned{color:#D97706}
        .ep-trig{position:absolute;top:50%;right:-30px;transform:translateY(-50%);width:24px;height:24px;border-radius:50%;background:var(--bg-surface);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:0.72rem;cursor:pointer;opacity:0;transition:opacity 0.15s;box-shadow:var(--shadow-sm);z-index:5}
        .mr.mine .ep-trig{right:auto;left:-30px}
        .ep-box{position:absolute;bottom:calc(100%+6px);right:-6px;background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:0.4rem;box-shadow:var(--shadow-lg);display:flex;gap:2px;z-index:100;animation:epIn 0.15s cubic-bezier(0.34,1.56,0.64,1)}
        .mr.mine .ep-box{right:auto;left:-6px}
        .ep-btn{width:30px;height:30px;border-radius:7px;border:none;background:transparent;font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.1s}
        .ep-btn:hover{background:var(--bg-hover)}
        .mr-rxns{display:flex;flex-wrap:wrap;gap:3px;margin-top:3px;padding:0 0.2rem}
        .rxn{display:inline-flex;align-items:center;gap:2px;padding:2px 7px;border-radius:999px;border:1px solid var(--border);background:var(--bg-surface);font-size:0.76rem;cursor:pointer;transition:all 0.12s;animation:rxnPop 0.2s cubic-bezier(0.34,1.56,0.64,1)}
        .rxn:hover{border-color:#4BACC6;background:var(--bg-active)}
        .rxn.mine{border-color:#4BACC6;background:var(--bg-active)}
        .rxn-c{font-size:0.7rem;font-weight:700;color:var(--text-secondary)}
        .rxn.mine .rxn-c{color:#365F91}
        .edit-w{display:flex;flex-direction:column;gap:0.35rem}
        .edit-ta{padding:0.5rem 0.8rem;border:1.5px solid #4BACC6;border-radius:9px;font-size:0.9rem;color:var(--text-primary);font-family:inherit;resize:none;outline:none;min-height:44px;max-height:140px;line-height:1.5;background:var(--bg-surface);box-shadow:0 0 0 3px rgba(75,172,198,0.09)}
        .edit-acts{display:flex;gap:0.4rem;justify-content:flex-end}
        .edit-hint{font-size:0.65rem;color:var(--text-faint);flex:1}
        .edit-save{padding:0.3rem 0.82rem;background:#365F91;color:white;border:none;border-radius:6px;font-size:0.76rem;font-weight:700;cursor:pointer;font-family:inherit}
        .edit-save:hover{background:#243F60}
        .edit-save:disabled{opacity:0.4;cursor:not-allowed}
        .edit-cancel{padding:0.3rem 0.72rem;background:var(--bg-page);color:var(--text-muted);border:1px solid var(--border);border-radius:6px;font-size:0.76rem;font-weight:600;cursor:pointer;font-family:inherit}
        .mr-time{font-size:0.63rem;color:var(--text-faint);margin-top:0.2rem;padding:0 0.45rem}
        .mr-seen{display:flex;align-items:center;gap:0.3rem;font-size:0.63rem;color:#4BACC6;font-weight:600;padding:0 0.45rem;margin-top:0.08rem;animation:fadeIn 0.3s ease}
        .seen-av{width:13px;height:13px;border-radius:50%;background:linear-gradient(135deg,#4F81BD,#243F60);color:white;font-size:0.42rem;font-weight:800;display:flex;align-items:center;justify-content:center}
        .typ-row{display:flex;align-items:center;gap:0.6rem;padding:0.45rem 0 0.65rem;animation:typIn 0.2s ease}
        .typ-bbl{display:inline-flex;align-items:center;gap:0.5rem;background:var(--bg-surface);border:1px solid var(--border);border-radius:4px 18px 18px 18px;padding:0.5rem 0.9rem;box-shadow:var(--shadow-sm)}
        .typ-dots{display:flex;gap:3px;align-items:center}
        .typ-dot{width:6px;height:6px;border-radius:50%;background:var(--text-faint);animation:typBnc 1.1s ease-in-out infinite}
        .typ-dot:nth-child(2){animation-delay:0.18s}
        .typ-dot:nth-child(3){animation-delay:0.36s}
        .typ-nm{font-size:0.76rem;color:var(--text-faint);font-style:italic}
        .mtn-box{position:absolute;bottom:calc(100%+6px);left:0;right:0;background:var(--bg-surface);border:1px solid var(--border);border-radius:11px;box-shadow:var(--shadow-lg);overflow:hidden;z-index:200;animation:mtnIn 0.15s ease}
        .mtn-hdr{padding:0.42rem 0.85rem;font-size:0.62rem;font-weight:800;color:var(--text-faint);text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid var(--border-light);background:var(--bg-subtle)}
        .mtn-item{display:flex;align-items:center;gap:0.58rem;padding:0.58rem 0.85rem;cursor:pointer;transition:background 0.1s;border-bottom:1px solid var(--border-light)}
        .mtn-item:last-child{border-bottom:none}
        .mtn-item:hover{background:var(--bg-hover)}
        .mtn-n{font-size:0.84rem;font-weight:600;color:var(--text-primary)}
        .mtn-r{font-size:0.68rem;color:var(--text-faint);text-transform:capitalize;margin-left:0.3rem}
        .inp-area{padding:0.65rem 1.5rem 0.85rem;background:var(--bg-surface);border-top:1px solid var(--border);flex-shrink:0;position:relative}
        .pbar{display:flex;align-items:center;gap:0.6rem;padding:0.5rem 0.75rem;background:#EEF4FB;border:1px solid #C5D9F1;border-radius:10px;margin-bottom:0.5rem}
        .pbar-img{width:42px;height:42px;border-radius:6px;object-fit:cover;flex-shrink:0;border:1px solid #C5D9F1}
        .pbar-n{font-size:0.8rem;font-weight:600;color:var(--text-primary);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .pbar-rm{background:none;border:none;color:var(--text-faint);cursor:pointer;font-size:0.8rem;padding:0.2rem;border-radius:4px;transition:all 0.12s}
        .pbar-rm:hover{background:#FEF2F2;color:#dc2626}
        .uperr{font-size:0.73rem;color:#C0504D;font-weight:600;margin-bottom:0.4rem;display:flex;align-items:center;gap:0.3rem}
        .inp-box{display:flex;align-items:flex-end;gap:0.6rem;background:var(--bg-page);border:1.5px solid var(--border);border-radius:12px;padding:0.45rem 0.6rem;transition:all 0.15s}
        .inp-box:focus-within{border-color:#4F81BD;box-shadow:0 0 0 3px rgba(79,129,189,0.08);background:var(--bg-surface)}
        .inp-box textarea{flex:1;background:transparent;border:none;outline:none;font-size:0.9rem;color:var(--text-primary);font-family:inherit;resize:none;max-height:120px;min-height:22px;line-height:1.5;padding:0.18rem 0}
        .inp-box textarea::placeholder{color:var(--text-faint)}
        .att-btn{width:28px;height:28px;border-radius:6px;background:transparent;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--text-faint);font-size:1rem;flex-shrink:0;transition:all 0.12s}
        .att-btn:hover{background:var(--bg-active);color:#4BACC6}
        .snd-btn{width:32px;height:32px;border-radius:8px;background:#365F91;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:0.88rem;color:white;flex-shrink:0;transition:all 0.15s}
        .snd-btn:hover:not(:disabled){background:#243F60}
        .snd-btn:disabled{opacity:0.3;cursor:not-allowed}
        .inp-hint{font-size:0.66rem;color:var(--text-ghost);margin-top:0.3rem}
        .chat-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.75rem;color:var(--text-faint);padding:3rem;text-align:center}
        .e-icon{font-size:3rem;opacity:0.3}
        .e-title{font-size:1.1rem;font-weight:800;color:var(--text-primary)}
        .e-sub{font-size:0.84rem;max-width:280px;line-height:1.6}
        .e-btns{display:flex;gap:0.5rem;margin-top:0.4rem}
        .e-btn{padding:0.62rem 1.35rem;background:#365F91;color:white;border:none;border-radius:9px;font-size:0.86rem;font-weight:700;cursor:pointer;font-family:inherit;transition:background 0.15s}
        .e-btn:hover{background:#243F60}
        .e-btn.g{background:#8064A2}
        .e-btn.g:hover{background:#6a5290}
        .gi{width:255px;flex-shrink:0;background:var(--bg-surface);border-left:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;animation:sldR 0.2s ease}
        .gi-hdr{display:flex;align-items:center;justify-content:space-between;padding:0.9rem 1rem;border-bottom:1px solid var(--border);flex-shrink:0}
        .gi-title{font-size:0.86rem;font-weight:800;color:var(--text-primary)}
        .gi-x{background:none;border:none;color:var(--text-faint);cursor:pointer;font-size:0.82rem;padding:0.2rem;border-radius:4px;transition:all 0.12s}
        .gi-x:hover{background:var(--bg-hover);color:var(--text-primary)}
        .gi-body{flex:1;overflow-y:auto;padding:1rem}
        .gi-lbl{font-size:0.62rem;font-weight:800;color:var(--text-faint);text-transform:uppercase;letter-spacing:0.08em;display:block;margin-bottom:0.6rem}
        .gi-mem{display:flex;align-items:center;gap:0.6rem;padding:0.42rem 0.28rem;border-bottom:1px solid var(--border-light);cursor:pointer;transition:background 0.1s;border-radius:6px}
        .gi-mem:last-child{border-bottom:none}
        .gi-mem:hover{background:var(--bg-hover)}
        .gi-mn{font-size:0.8rem;font-weight:600;color:var(--text-primary);flex:1}
        .gi-mr{font-size:0.65rem;color:var(--text-faint);text-transform:capitalize}
        .gms{display:flex;align-items:center}
        .gma{width:19px;height:19px;border-radius:50%;color:white;font-size:0.45rem;font-weight:800;display:flex;align-items:center;justify-content:center;border:1.5px solid var(--bg-surface);margin-left:-5px}
        .gma:first-child{margin-left:0}
        .modal-bg{position:fixed;inset:0;z-index:600;background:rgba(0,0,0,0.32);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;animation:fadeIn 0.15s ease}
        .modal{background:var(--bg-surface);border-radius:16px;width:480px;max-width:calc(100vw - 2rem);box-shadow:var(--shadow-lg);animation:slideUp 0.25s cubic-bezier(0.34,1.56,0.64,1);overflow:hidden;display:flex;flex-direction:column;max-height:82vh}
        .mhdr{display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;border-bottom:1px solid var(--border);flex-shrink:0}
        .mtitle{font-size:0.98rem;font-weight:800;color:var(--text-primary)}
        .mx{background:none;border:none;color:var(--text-faint);font-size:1.1rem;cursor:pointer;padding:0.2rem;border-radius:5px;transition:all 0.12s;line-height:1}
        .mx:hover{background:var(--bg-hover);color:var(--text-primary)}
        .mbody{padding:1rem 1.25rem;flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:0.8rem}
        .mfoot{padding:0.85rem 1.25rem;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:0.5rem;flex-shrink:0}
        .flbl{font-size:0.72rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;display:block;margin-bottom:0.3rem}
        .finp{width:100%;padding:0.62rem 0.85rem;border:1.5px solid var(--border);border-radius:9px;font-size:0.9rem;color:var(--text-primary);background:var(--bg-page);font-family:inherit;outline:none}
        .finp:focus{border-color:#4BACC6;box-shadow:0 0 0 3px rgba(75,172,198,0.09)}
        .ulist{flex:1;overflow-y:auto;border:1px solid var(--border);border-radius:10px;max-height:230px}
        .ulist::-webkit-scrollbar{width:3px}
        .ulist::-webkit-scrollbar-thumb{background:var(--border);border-radius:999px}
        .uitem{display:flex;align-items:center;gap:0.65rem;padding:0.65rem 0.85rem;cursor:pointer;transition:background 0.1s;border-bottom:1px solid var(--border-light)}
        .uitem:last-child{border-bottom:none}
        .uitem:hover{background:var(--bg-hover)}
        .uitem.sel{background:var(--bg-active)}
        .uchk{width:17px;height:17px;border-radius:50%;border:2px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:0.58rem;color:white;flex-shrink:0;transition:all 0.12s}
        .uitem.sel .uchk{background:#4BACC6;border-color:#4BACC6}
        .uname{font-size:0.84rem;font-weight:600;color:var(--text-primary);flex:1}
        .urole{font-size:0.68rem;color:var(--text-faint);text-transform:capitalize}
        .chip-row{display:flex;flex-wrap:wrap;gap:0.3rem;min-height:26px}
        .chip{display:flex;align-items:center;gap:0.28rem;background:#EEF4FB;border:1px solid #C5D9F1;border-radius:999px;padding:0.16rem 0.5rem;font-size:0.72rem;color:#365F91;font-weight:600}
        .chip-x{background:none;border:none;color:var(--text-faint);cursor:pointer;font-size:0.7rem;padding:0;line-height:1;transition:color 0.12s}
        .chip-x:hover{color:#dc2626}
        .bp{padding:0.55rem 1.2rem;background:#243F60;color:white;border:none;border-radius:8px;font-size:0.84rem;font-weight:700;cursor:pointer;transition:background 0.15s;font-family:inherit}
        .bp:hover:not(:disabled){background:#365F91}
        .bp:disabled{opacity:0.4;cursor:not-allowed}
        .bs{padding:0.55rem 1rem;background:var(--bg-page);color:var(--text-secondary);border:1px solid var(--border);border-radius:8px;font-size:0.84rem;font-weight:600;cursor:pointer;transition:all 0.12s;font-family:inherit}
        .bs:hover{background:var(--bg-hover)}
        .nsw{padding:0.85rem 1.25rem;border-bottom:1px solid var(--border-light);flex-shrink:0}
        .ns{width:100%;padding:0.6rem 0.85rem;background:var(--bg-page);border:1px solid var(--border);border-radius:9px;font-size:0.87rem;color:var(--text-primary);font-family:inherit;outline:none}
        .ns:focus{border-color:#4F81BD}
        .nlist{overflow-y:auto;flex:1}
        .nlist::-webkit-scrollbar{width:3px}
        .nlist::-webkit-scrollbar-thumb{background:var(--border);border-radius:999px}
        .nu{display:flex;align-items:center;gap:0.75rem;padding:0.74rem 1.25rem;cursor:pointer;transition:background 0.1s;border-bottom:1px solid var(--border-light)}
        .nu:hover{background:var(--bg-hover)}
        .nu-n{font-size:0.87rem;font-weight:600;color:var(--text-primary);display:block}
        .nu-r{font-size:0.7rem;color:var(--text-faint);text-transform:capitalize;display:block;margin-top:0.1rem}
      `}</style>

      <div className="mp">
        <Navbar fullName={profile?.full_name??null} role={profile?.role??'employee'}/>
        <div className="mp-shell">

          {/* ── SIDEBAR ── */}
          <div className="sb">
            <div className="sb-top">
              <div className="sb-tr">
                <span className="sb-title">Messages{totalUnread>0&&<span className="sb-bdg">{totalUnread}</span>}</span>
                <div className="sb-btns">
                  <button className="sb-btn" onClick={()=>setShowNewDm(true)} title="New DM">✉</button>
                  <button className="sb-btn" onClick={()=>setShowCreateGroup(true)} title="New Group">👥</button>
                </div>
              </div>
              <div className="sb-srch">
                <span style={{fontSize:'0.78rem',color:'var(--text-faint)'}}>🔍</span>
                <input placeholder="Search…" value={convSearch} onChange={e=>setConvSearch(e.target.value)}/>
              </div>
            </div>

            <div className="sb-list">
              <div className="sb-sec">Direct Messages<button className="sb-sa" onClick={()=>setShowNewDm(true)}>+</button></div>
              {filteredConvs.length===0
                ?<div className="cv-e">No conversations yet</div>
                :filteredConvs.map(conv=>{
                  const isActive=activeChat?.type==='dm'&&activeChat.id===conv.id
                  const isTyping=isActive&&typers.length>0
                  return (
                    <div key={conv.id} className={`cvr${isActive?' active':''}${conv.unreadCount>0?' unread':''}`} onClick={()=>openConv(conv.id)}>
                      <Avatar name={conv.otherUser?.full_name??null} size={36}/>
                      <div className="cv-i">
                        <div className="cv-t"><span className="cv-n">{conv.otherUser?.full_name??'Unknown'}</span>{conv.lastMessage&&<span className="cv-tm">{timeAgo(conv.lastMessage.created_at)}</span>}</div>
                        {isTyping?<div className="cv-p typ">✦ typing…</div>
                          :<div className="cv-p">{conv.lastMessage?(conv.lastMessage.sender_id===myId?'You: ':'')+((conv.lastMessage.attachment_url&&(!conv.lastMessage.content||conv.lastMessage.content.trim()===' '))?'📎 File':conv.lastMessage.content):'No messages yet'}</div>}
                      </div>
                      {conv.unreadCount>0&&<div className="cv-b">{conv.unreadCount}</div>}
                    </div>
                  )
                })}

              <div className="sb-sec" style={{marginTop:'0.5rem'}}>Group Messages<button className="sb-sa" onClick={()=>setShowCreateGroup(true)}>+</button></div>
              {filteredGroups.length===0
                ?<div className="cv-e">No groups yet — create one!</div>
                :filteredGroups.map(grp=>{
                  const isActive=activeChat?.type==='group'&&activeChat.id===grp.id
                  const isTyping=isActive&&typers.length>0
                  const others=grp.members.filter(m=>m.id!==myId)
                  return (
                    <div key={grp.id} className={`cvr${isActive?' active':''}${grp.unreadCount>0?' unread':''}`} onClick={()=>openGroup(grp.id)}>
                      <GroupAvatar members={others.slice(0,3)} size={36}/>
                      <div className="cv-i">
                        <div className="cv-t"><span className="cv-n">{grp.name}</span>{grp.lastMessage&&<span className="cv-tm">{timeAgo(grp.lastMessage.created_at)}</span>}</div>
                        {isTyping?<div className="cv-p typ">✦ typing…</div>
                          :<div className="cv-p">{grp.lastMessage?((grp.lastMessage as GroupMessage).sender?.full_name?.split(' ')[0]??'Someone')+': '+((grp.lastMessage.attachment_url&&(!grp.lastMessage.content||grp.lastMessage.content.trim()===' '))?'📎 File':grp.lastMessage.content):'No messages yet'}</div>}
                      </div>
                      {grp.unreadCount>0&&<div className="cv-b">{grp.unreadCount}</div>}
                    </div>
                  )
                })}
            </div>

            <button className="cht" onClick={()=>setShowCallHist(p=>!p)}>
              📞 Call history ({callHistory.length})
              <span style={{marginLeft:'auto'}}>{showCallHist?'▲':'▼'}</span>
            </button>
            {showCallHist&&callHistory.length>0&&(
              <div className="chp">
                {callHistory.map(call=>{
                  const isCaller=call.caller_id===myId
                  const icon=call.type==='video'?'📹':'📞'
                  const statusColor:{[k:string]:string}={ended:'#4BACC6',missed:'#C0504D',declined:'#C0504D',ringing:'#22c55e',active:'#22c55e'}
                  return (
                    <div key={call.id} className="chi">
                      <div className={`ch-ic ${call.status}`}>{icon}</div>
                      <div className="ch-if">
                        <div className="ch-nm">{isCaller?`↗ ${call.group_name??'Outgoing'}`:` ↙ ${call.caller_name??'Unknown'}`}</div>
                        <div className="ch-mt">
                          <span style={{color:statusColor[call.status]??'var(--text-faint)'}}>{call.status}</span>
                          {' · '}{fmtCallTime(call.created_at)}
                          {call.ended_at&&` · ${fmtDuration(call.created_at,call.ended_at)}`}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── CHAT ── */}
          <div className="ca"
            onDragEnter={activeChat?e=>{e.preventDefault();dragCnt.current++;if(e.dataTransfer.types.includes('Files'))setIsDragging(true)}:undefined}
            onDragLeave={activeChat?e=>{e.preventDefault();dragCnt.current--;if(dragCnt.current===0)setIsDragging(false)}:undefined}
            onDragOver={activeChat?e=>e.preventDefault():undefined}
            onDrop={activeChat?e=>{e.preventDefault();dragCnt.current=0;setIsDragging(false);const f=e.dataTransfer.files[0];if(f)handleFile(f)}:undefined}
          >
            <div className="cm">
              {isDragging&&<div className="dropz"><div style={{fontSize:'2.5rem'}}>📎</div><div style={{fontSize:'1.05rem',fontWeight:800,color:'#365F91'}}>Drop to send</div></div>}

              {(activeConv||activeGroup)?(
                <>
                  {/* Header */}
                  <div className="hdr">
                    {activeConv?(
                      <>
                        <Avatar name={activeConv.otherUser?.full_name??null} size={36}/>
                        <div>
                          <div className="hdr-n">{activeConv.otherUser?.full_name??'Unknown'}</div>
                          {typers.length>0?<div className="hdr-ty">✦ {typingLabel}…</div>:<div className="hdr-s">{activeConv.otherUser?.role}</div>}
                        </div>
                        <div className="hdr-r">
                          {pinnedMsgs.length>0&&!showPinBar&&<button className="hb" onClick={()=>setShowPinBar(true)}>📌 {pinnedMsgs.length}</button>}
                          <button className="hb call" onClick={()=>startCall('audio')}>📞 Call</button>
                          <button className="hb vid" onClick={()=>startCall('video')}>📹 Video</button>
                          <button className="hb" onClick={()=>navigate(`/profile/${activeConv.otherUser?.id}`)}>👤 Profile</button>
                        </div>
                      </>
                    ):activeGroup?(
                      <>
                        <GroupAvatar members={activeGroup.members.filter(m=>m.id!==myId).slice(0,3)} size={36}/>
                        <div>
                          <div className="hdr-n">{activeGroup.name}</div>
                          {typers.length>0?<div className="hdr-ty">✦ {typingLabel}…</div>
                            :<div className="hdr-s" style={{display:'flex',alignItems:'center',gap:'0.4rem'}}>
                              <div className="gms">{activeGroup.members.slice(0,4).map((m,i)=><div key={m.id} className="gma" style={{background:['#4BACC6','#8064A2','#C0504D','#9BBB59'][i%4]}}>{initials(m.full_name)}</div>)}</div>
                              {activeGroup.members.length} members
                            </div>}
                        </div>
                        <div className="hdr-r">
                          {pinnedMsgs.length>0&&!showPinBar&&<button className="hb" onClick={()=>setShowPinBar(true)}>📌 {pinnedMsgs.length}</button>}
                          <button className="hb call" onClick={()=>startCall('audio')}>📞 Call</button>
                          <button className="hb vid" onClick={()=>startCall('video')}>📹 Video</button>
                          <button className="hb" onClick={()=>setShowGroupInfo(p=>!p)}>👥 Members</button>
                        </div>
                      </>
                    ):null}
                  </div>

                  {/* Pinned bar */}
                  {pinnedMsgs.length>0&&showPinBar&&(
                    <div className="pinbar">
                      <span className="pin-ic">📌</span>
                      <div className="pin-bd" onClick={()=>scrollToMsg(pinnedMsgs[pinIdx]?.id)}>
                        <span className="pin-lb">Pinned message</span>
                        <div className="pin-pv">{pinnedMsgs[pinIdx]?.content?.trim()||pinnedMsgs[pinIdx]?.attachment_name||'File'}</div>
                      </div>
                      {pinnedMsgs.length>1&&<div className="pin-nv"><button className="pin-nb" onClick={()=>setPinIdx(i=>(i-1+pinnedMsgs.length)%pinnedMsgs.length)}>‹</button><span className="pin-ct">{pinIdx+1}/{pinnedMsgs.length}</span><button className="pin-nb" onClick={()=>setPinIdx(i=>(i+1)%pinnedMsgs.length)}>›</button></div>}
                      <button className="pin-x" onClick={()=>setShowPinBar(false)}>✕</button>
                    </div>
                  )}

                  {/* Messages */}
                  <div className="msgs">
                    {loadingMsgs?(
                      <div style={{textAlign:'center',color:'var(--text-faint)',padding:'2rem',fontSize:'0.86rem'}}>Loading…</div>
                    ):curMsgs.length===0?(
                      <div style={{textAlign:'center',color:'var(--text-faint)',padding:'3rem 1rem'}}>
                        <div style={{fontSize:'2.5rem',marginBottom:'0.75rem'}}>{activeGroup?'👥':'👋'}</div>
                        <div style={{fontWeight:700,color:'var(--text-primary)',marginBottom:'0.3rem'}}>{activeGroup?`Welcome to ${activeGroup.name}`:'Start the conversation'}</div>
                        <div style={{fontSize:'0.84rem'}}>{activeGroup?`${activeGroup.members.length} members · Say hello!`:`Say hi to ${activeConv?.otherUser?.full_name?.split(' ')[0]}!`}</div>
                      </div>
                    ):byDate(curMsgs).map(group=>(
                      <div key={group.label}>
                        <div className="dtd"><div className="dtl"/><div className="dtlb">{group.label}</div><div className="dtl"/></div>
                        {group.messages.map((msg,i)=>{
                          // KEY FIX: profile.id is reliable, myId state may be stale
                          const isMine = msg.sender_id===(profile?.id??myId)
                          const prev=group.messages[i-1]
                          const isGrp=activeChat?.type==='group'
                          const sender=isGrp?(msg as GroupMessage).sender:null
                          const showAv=!isMine&&(!prev||prev.sender_id!==msg.sender_id)
                          const isEditing=editingId===msg.id
                          const rxns=groupRxns(msg.id)
                          const showSeen=!isGrp&&isMine&&msg.id===lastReadId
                          const hasText=msg.content&&msg.content.trim()!==' '
                          const fileOnly=!hasText&&!!msg.attachment_url
                          return (
                            <div key={msg.id} ref={el=>{msgRefs.current[msg.id]=el}} className={`mr${isMine?' mine':''}${highlightId===msg.id?' hl':''}`}>
                              {!isMine?showAv?<div className="mr-av"><Avatar name={isGrp?sender?.full_name??null:activeConv?.otherUser?.full_name??null} size={28}/></div>:<div className="mr-sp"/>:null}
                              <div className="mr-col">
                                {showAv&&<div className="mr-sn">{isGrp?sender?.full_name??'Unknown':activeConv?.otherUser?.full_name}</div>}
                                {isEditing?(
                                  <div className="edit-w">
                                    <textarea ref={editRef} className="edit-ta" value={editingText}
                                      onChange={e=>{setEditingText(e.target.value);e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,140)+'px'}}
                                      onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();saveEdit(msg.id)};if(e.key==='Escape'){setEditingId(null);setEditingText('')}}}/>
                                    <div className="edit-acts">
                                      <span className="edit-hint">Enter to save · Esc to cancel</span>
                                      <button className="edit-cancel" onClick={()=>{setEditingId(null);setEditingText('')}}>Cancel</button>
                                      <button className="edit-save" onClick={()=>saveEdit(msg.id)} disabled={savingEdit||!editingText.trim()}>{savingEdit?'Saving…':'Save'}</button>
                                    </div>
                                  </div>
                                ):(
                                  <div className="mr-bw" onMouseEnter={()=>setHoveredMsg(msg.id)} onMouseLeave={()=>{setHoveredMsg(null);if(showEmojiFor===msg.id)setShowEmojiFor(null)}}>
                                    {hoveredMsg===msg.id&&(
                                      <div className="mr-acts">
                                        <button className={`mr-act pin${msg.is_pinned?' pinned':''}`} onClick={()=>togglePin(msg.id,!!msg.is_pinned)}>📌{msg.is_pinned?' Unpin':' Pin'}</button>
                                        {isMine&&hasText&&<button className="mr-act" onClick={()=>{setEditingId(msg.id);setEditingText(msg.content)}}>✎ Edit</button>}
                                        {isMine&&<button className="mr-act del" onClick={()=>deleteMessage(msg.id)}>🗑</button>}
                                      </div>
                                    )}
                                    {hoveredMsg===msg.id&&<button className="ep-trig" onClick={()=>setShowEmojiFor(showEmojiFor===msg.id?null:msg.id)}>😊</button>}
                                    {showEmojiFor===msg.id&&<div className="ep-box">{QUICK_EMOJIS.map(e=><button key={e} className="ep-btn" onClick={()=>toggleReaction(msg.id,e)}>{e}</button>)}</div>}
                                    <div className={`mr-b${msg.is_pinned?' pinned':''}${fileOnly?' fo':''}`}>
                                      {hasText&&<span style={{display:'block'}}>{renderContent(msg.content)}</span>}
                                      {renderAttachment(msg,isMine)}
                                    </div>
                                  </div>
                                )}
                                {rxns.length>0&&<div className="mr-rxns">{rxns.map(r=><button key={r.emoji} className={`rxn${r.iMine?' mine':''}`} onClick={()=>toggleReaction(msg.id,r.emoji)}>{r.emoji}{r.count>1&&<span className="rxn-c">{r.count}</span>}</button>)}</div>}
                                <div className="mr-time">{fmtTime(msg.created_at)}</div>
                                {showSeen&&<div className="mr-seen"><div className="seen-av">{initials(activeConv?.otherUser?.full_name??null)}</div>Seen</div>}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ))}
                    {typers.length>0&&(
                      <div className="typ-row">
                        <div className="mr-av"><Avatar name={activeGroup?typers[0]:activeConv?.otherUser?.full_name??null} size={28}/></div>
                        <div className="typ-bbl"><div className="typ-dots"><div className="typ-dot"/><div className="typ-dot"/><div className="typ-dot"/></div><span className="typ-nm">{typingLabel}</span></div>
                      </div>
                    )}
                    <div ref={msgsEndRef}/>
                  </div>

                  {/* Input */}
                  <div className="inp-area">
                    {mentionQuery!==null&&mentionSugs.length>0&&(
                      <div className="mtn-box">
                        <div className="mtn-hdr">Mention someone</div>
                        {mentionSugs.map(p=><div key={p.id} className="mtn-item" onMouseDown={e=>{e.preventDefault();pickMention(p)}}><Avatar name={p.full_name} size={26}/><span className="mtn-n">{p.full_name}</span><span className="mtn-r">{p.role}</span></div>)}
                      </div>
                    )}
                    {uploadErr&&<div className="uperr">⚠ {uploadErr}<button onClick={()=>setUploadErr(null)} style={{background:'none',border:'none',color:'#C0504D',cursor:'pointer',marginLeft:'auto',fontSize:'0.72rem'}}>✕</button></div>}
                    {pendingFile&&(
                      <div className="pbar">
                        {pendingPreview?<img className="pbar-img" src={pendingPreview} alt=""/>:<span style={{fontSize:'1.4rem',flexShrink:0}}>{fileIcon(pendingFile.type)}</span>}
                        <span className="pbar-n">{pendingFile.name} ({fmtSize(pendingFile.size)})</span>
                        <button className="pbar-rm" onClick={clearFile}>✕</button>
                      </div>
                    )}
                    <div className="inp-box">
                      <button className="att-btn" onClick={()=>fileRef.current?.click()} title="Attach">📎</button>
                      <input ref={fileRef} type="file" style={{display:'none'}} accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.mp4,.mp3" onChange={e=>{const f=e.target.files?.[0];if(f)handleFile(f)}}/>
                      <textarea ref={inputRef} rows={1}
                        placeholder={activeGroup?`Message ${activeGroup.name}… (@ to mention)`:`Message ${activeConv?.otherUser?.full_name?.split(' ')[0]??''}… (@ to mention)`}
                        value={inputText} onChange={handleInput}
                        onKeyDown={e=>{
                          if(mentionQuery!==null&&mentionSugs.length>0){if(e.key==='Escape'){e.preventDefault();setMentionQuery(null);return};if(e.key==='Enter'){e.preventDefault();pickMention(mentionSugs[0]);return}}
                          if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage()}
                        }}/>
                      <button className="snd-btn" onClick={sendMessage} disabled={(!inputText.trim()&&!pendingFile)||sending||uploading}>{uploading?'⏳':'➤'}</button>
                    </div>
                    <div className="inp-hint">Enter to send · Shift+Enter new line · @ to mention · drag & drop files</div>
                  </div>
                </>
              ):(
                <div className="chat-empty">
                  <div className="e-icon">💬</div>
                  <div className="e-title">Messages</div>
                  <div className="e-sub">Select a conversation or start a new one.</div>
                  <div className="e-btns">
                    <button className="e-btn" onClick={()=>setShowNewDm(true)}>✉ New DM</button>
                    <button className="e-btn g" onClick={()=>setShowCreateGroup(true)}>👥 New Group</button>
                  </div>
                </div>
              )}
            </div>

            {/* Group info */}
            {showGroupInfo&&activeGroup&&(
              <div className="gi">
                <div className="gi-hdr"><span className="gi-title">Group Members</span><button className="gi-x" onClick={()=>setShowGroupInfo(false)}>✕</button></div>
                <div className="gi-body">
                  <span className="gi-lbl">Members ({activeGroup.members.length})</span>
                  {activeGroup.members.map(m=>(
                    <div key={m.id} className="gi-mem" onClick={()=>{navigate(`/profile/${m.id}`);setShowGroupInfo(false)}}>
                      <Avatar name={m.full_name} size={28}/>
                      <div><div className="gi-mn">{m.full_name??'—'}{m.id===myId&&<span style={{color:'var(--text-faint)',fontWeight:400}}> (you)</span>}</div><div className="gi-mr">{m.role}</div></div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* New DM modal */}
        {showNewDm&&(
          <div className="modal-bg" onClick={()=>{setShowNewDm(false);setUserSearch('')}}>
            <div className="modal" onClick={e=>e.stopPropagation()}>
              <div className="mhdr"><span className="mtitle">New direct message</span><button className="mx" onClick={()=>{setShowNewDm(false);setUserSearch('')}}>✕</button></div>
              <div className="nsw"><input className="ns" placeholder="🔍  Search for a person…" value={userSearch} onChange={e=>setUserSearch(e.target.value)} autoFocus/></div>
              <div className="nlist">
                {filteredUsers.length===0?<div style={{padding:'2rem',textAlign:'center',color:'var(--text-faint)',fontSize:'0.84rem'}}>No users found</div>
                  :filteredUsers.map(u=><div key={u.id} className="nu" onClick={()=>handleNewDm(u)}><Avatar name={u.full_name} size={36}/><div><span className="nu-n">{u.full_name}</span><span className="nu-r">{u.role}</span></div></div>)}
              </div>
            </div>
          </div>
        )}

        {/* Create group modal */}
        {showCreateGroup&&(
          <div className="modal-bg" onClick={()=>{setShowCreateGroup(false);setNewGroupName('');setNewGroupMembers(new Set());setGroupSearch('')}}>
            <div className="modal" onClick={e=>e.stopPropagation()}>
              <div className="mhdr"><span className="mtitle">👥 New group message</span><button className="mx" onClick={()=>{setShowCreateGroup(false);setNewGroupName('');setNewGroupMembers(new Set());setGroupSearch('')}}>✕</button></div>
              <div className="mbody">
                <div><label className="flbl">Group name *</label><input className="finp" placeholder="e.g. Marketing Team…" value={newGroupName} onChange={e=>setNewGroupName(e.target.value)} autoFocus/></div>
                <div><label className="flbl">Add members *</label><input className="finp" style={{marginBottom:'0.5rem'}} placeholder="🔍  Search people…" value={groupSearch} onChange={e=>setGroupSearch(e.target.value)}/></div>
                {newGroupMembers.size>0&&<div className="chip-row">{Array.from(newGroupMembers).map(uid=>{const p=allProfiles.find(x=>x.id===uid);return p?<div key={uid} className="chip">{p.full_name?.split(' ')[0]}<button className="chip-x" onClick={()=>setNewGroupMembers(prev=>{const n=new Set(prev);n.delete(uid);return n})}>✕</button></div>:null})}</div>}
                <div className="ulist">
                  {filteredGrpUsers.length===0?<div style={{padding:'1.5rem',textAlign:'center',color:'var(--text-faint)',fontSize:'0.8rem'}}>No users found</div>
                    :filteredGrpUsers.map(u=>{const sel=newGroupMembers.has(u.id);return(
                      <div key={u.id} className={`uitem${sel?' sel':''}`} onClick={()=>setNewGroupMembers(prev=>{const n=new Set(prev);sel?n.delete(u.id):n.add(u.id);return n})}>
                        <Avatar name={u.full_name} size={30}/><span className="uname">{u.full_name}</span><span className="urole">{u.role}</span><div className="uchk">{sel?'✓':''}</div>
                      </div>
                    )})}
                </div>
                {newGroupMembers.size>0&&<div style={{fontSize:'0.76rem',color:'var(--text-faint)'}}>{newGroupMembers.size} member{newGroupMembers.size!==1?'s':''} selected (+ you)</div>}
              </div>
              <div className="mfoot">
                <button className="bs" onClick={()=>{setShowCreateGroup(false);setNewGroupName('');setNewGroupMembers(new Set());setGroupSearch('')}}>Cancel</button>
                <button className="bp" onClick={createGroup} disabled={!newGroupName.trim()||newGroupMembers.size===0||creatingGroup}>{creatingGroup?'Creating…':`Create (${newGroupMembers.size+1} people)`}</button>
              </div>
            </div>
          </div>
        )}

        {/* Call modal */}
        <CallModal
          isOpen={callOpen}
          roomName={callRoom}
          displayName={profile?.full_name??'Me'}
          callType={callType}
          otherName={callName}
          isOutgoing={callOut}
          remoteStatus={callRemoteStatus}
          onEnd={handleCallEnd}
          onAccept={handleCallAccept}
          onDecline={handleCallDecline}
        />
      </div>
    </>
  )
}

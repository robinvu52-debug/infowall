import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import CallModal from '../components/CallModal'

interface IncomingCall { id:string; callerName:string; type:'audio'|'video'; roomName:string; conversationId?:string; groupId?:string }

interface StartCallArgs {
  type: 'audio' | 'video'
  otherName: string
  calleeId?: string        // set for a direct-message call — the other user's profile id
  conversationId?: string  // set for a direct-message call
  groupId?: string         // set for a group call
  groupName?: string       // set for a group call
}

interface CallContextValue {
  startCall: (args: StartCallArgs) => Promise<void>
  activeCallId: string | null
}

const CallContext = createContext<CallContextValue | null>(null)

export function useCall() {
  const ctx = useContext(CallContext)
  if (!ctx) throw new Error('useCall() must be used inside <CallProvider>')
  return ctx
}

/**
 * Mount this ONCE, above your router (e.g. in App.tsx, wrapping <BrowserRouter>).
 * It owns the realtime "calls" subscription and renders the CallModal overlay,
 * so incoming calls ring no matter which page the user is currently viewing —
 * not just while MessagesPage happens to be mounted.
 */
export function CallProvider({ children }: { children: ReactNode }) {
  const [myId, setMyId] = useState('')
  const [fullName, setFullName] = useState<string | null>(null)
  const [groupIds, setGroupIds] = useState<string[]>([])

  const [callOpen, setCallOpen] = useState(false)
  const [callRoom, setCallRoom] = useState('')
  const [callType, setCallType] = useState<'audio' | 'video'>('audio')
  const [callName, setCallName] = useState('')
  const [callOut, setCallOut] = useState(true)
  const [callId, setCallId] = useState<string | null>(null)
  const [callRemoteStatus, setCallRemoteStatus] = useState<string | null>(null)
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null)

  const myIdRef = useRef('')
  const callIdRef = useRef<string | null>(null)
  const groupIdsRef = useRef<string[]>([])
  const callsChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const groupsChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => { myIdRef.current = myId }, [myId])
  useEffect(() => { callIdRef.current = callId }, [callId])
  useEffect(() => { groupIdsRef.current = groupIds }, [groupIds])

  async function refreshGroupIds(uid: string) {
    const { data } = await supabase.from('group_members').select('group_id').eq('user_id', uid)
    const ids = (data ?? []).map((g: any) => g.group_id)
    setGroupIds(ids); groupIdsRef.current = ids
  }

  function subscribeToCalls(uid: string) {
    if (callsChannelRef.current) { supabase.removeChannel(callsChannelRef.current); callsChannelRef.current = null }
    callsChannelRef.current = supabase.channel('all-calls-global')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls' }, (payload) => {
        const call = payload.new as any
        if (call.caller_id === uid) return // my own outgoing call
        if (call.status !== 'ringing') return
        if (call.callee_id) {
          if (call.callee_id !== uid) return // DM call meant for someone else
        } else if (call.group_id) {
          if (!groupIdsRef.current.includes(call.group_id)) return // group call I'm not in
        } else {
          return // malformed row
        }
        setIncomingCall({ id: call.id, callerName: call.caller_name ?? 'Someone', type: call.type, roomName: call.room_name, conversationId: call.conversation_id, groupId: call.group_id })
        setCallName(call.caller_name ?? 'Someone')
        setCallType(call.type)
        setCallRoom(call.room_name)
        setCallOut(false)
        setCallId(call.id)
        setCallRemoteStatus(null)
        setCallOpen(true)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls' }, (payload) => {
        const call = payload.new as any
        if (callIdRef.current !== call.id) return
        setCallRemoteStatus(call.status)
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') console.error('[global calls] failed to subscribe — check Realtime is enabled for the calls table')
        if (status === 'SUBSCRIBED') console.log('[global calls] listening app-wide for calls')
      })
  }

  function subscribeToGroupMembership(uid: string) {
    if (groupsChannelRef.current) { supabase.removeChannel(groupsChannelRef.current); groupsChannelRef.current = null }
    // Keep groupIds live so a group call rings even if the user was just added
    // to that group and hasn't opened Messages since.
    groupsChannelRef.current = supabase.channel(`my-group-membership-${uid}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_members', filter: `user_id=eq.${uid}` }, () => {
        refreshGroupIds(uid)
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'group_members', filter: `user_id=eq.${uid}` }, () => {
        refreshGroupIds(uid)
      })
      .subscribe()
  }

  useEffect(() => {
    let cancelled = false

    async function bootFor(uid: string) {
      setMyId(uid); myIdRef.current = uid
      const { data: p } = await supabase.from('profiles').select('full_name').eq('id', uid).single()
      if (!cancelled) setFullName(p?.full_name ?? null)
      await refreshGroupIds(uid)
      if (cancelled) return
      subscribeToCalls(uid)
      subscribeToGroupMembership(uid)
    }

    function teardown() {
      if (callsChannelRef.current) { supabase.removeChannel(callsChannelRef.current); callsChannelRef.current = null }
      if (groupsChannelRef.current) { supabase.removeChannel(groupsChannelRef.current); groupsChannelRef.current = null }
      setMyId(''); myIdRef.current = ''
      setGroupIds([]); groupIdsRef.current = []
    }

    // Boot immediately if already signed in...
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user && !cancelled) bootFor(user.id)
    })

    // ...and re-boot on login/logout so the listener follows the session,
    // without needing a full page reload.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        teardown()
        bootFor(session.user.id)
      } else if (event === 'SIGNED_OUT') {
        teardown()
      }
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
      teardown()
    }
  }, [])

  async function startCall({ type, otherName, calleeId, conversationId, groupId, groupName }: StartCallArgs) {
    if (!myIdRef.current || callOpen) return
    const baseId = conversationId ?? groupId ?? String(Date.now())
    const roomName = `infowall-${baseId.replace(/-/g, '').slice(0, 10)}-${Date.now()}`

    const { data: call, error } = await supabase.from('calls').insert({
      room_name: roomName,
      caller_id: myIdRef.current,
      caller_name: fullName,
      callee_id: calleeId ?? null,
      conversation_id: conversationId ?? null,
      group_id: groupId ?? null,
      group_name: groupName ?? null,
      type,
      status: 'ringing',
    }).select().single()

    if (error || !call) {
      console.error('Call creation error:', error)
      alert(`Couldn't start the call: ${error?.message ?? 'insert failed'}`)
      return
    }

    console.log('[calls] created call row', call.id, 'for', otherName)
    setCallId(call.id); setCallRoom(roomName); setCallType(type); setCallName(otherName)
    setCallOut(true); setCallRemoteStatus(null); setCallOpen(true)
  }

  async function handleCallEnd() {
    if (callId) await supabase.from('calls').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', callId)
    setCallOpen(false); setCallId(null); setIncomingCall(null); setCallRemoteStatus(null)
  }
  async function handleCallAccept() {
    if (!incomingCall) return
    const { error } = await supabase.from('calls').update({ status: 'active' }).eq('id', incomingCall.id)
    if (error) console.error('[calls] failed to mark active:', error.message)
    setIncomingCall(null)
  }
  async function handleCallDecline() {
    if (!incomingCall) return
    const { error } = await supabase.from('calls').update({ status: 'declined' }).eq('id', incomingCall.id)
    if (error) console.error('[calls] failed to mark declined:', error.message)
    setCallOpen(false); setCallId(null); setIncomingCall(null); setCallRemoteStatus(null)
  }

  return (
    <CallContext.Provider value={{ startCall, activeCallId: callId }}>
      {children}
      <CallModal
        isOpen={callOpen}
        roomName={callRoom}
        displayName={fullName ?? 'Me'}
        callType={callType}
        otherName={callName}
        isOutgoing={callOut}
        remoteStatus={callRemoteStatus}
        onEnd={handleCallEnd}
        onAccept={handleCallAccept}
        onDecline={handleCallDecline}
      />
    </CallContext.Provider>
  )
}

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

type UserStatus = 'online' | 'away' | 'busy' | 'offline'

interface PresenceUser {
  user_id: string
  full_name: string | null
  status: UserStatus
}

interface PresenceContextValue {
  onlineUserIds: Set<string>
  presenceUsers: PresenceUser[]
  myStatus: UserStatus
  setMyStatus: (s: UserStatus) => void
}

const Ctx = createContext<PresenceContextValue>({
  onlineUserIds: new Set(),
  presenceUsers: [],
  myStatus: 'offline',
  setMyStatus: () => {}
})

export function PresenceProvider({ children }: { children: React.ReactNode }) {
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set())
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([])
  const [myStatus, setMyStatusState] = useState<UserStatus>('online')
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const myStatusRef = useRef<UserStatus>('online')
  const meRef = useRef<{ id: string; full_name: string | null } | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      const { data: p } = await supabase.from('profiles').select('full_name').eq('id', user.id).single()
      meRef.current = { id: user.id, full_name: p?.full_name ?? null }

      channelRef.current = supabase
        .channel('global-presence', { config: { presence: { key: user.id } } })
        .on('presence', { event: 'sync' }, () => {
          const state = channelRef.current?.presenceState<PresenceUser>() ?? {}
          const users = Object.values(state).flat()
          const ids = new Set(users.map(u => u.user_id))
          setOnlineUserIds(ids)
          setPresenceUsers(users)
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED' && meRef.current) {
            await channelRef.current?.track({
              user_id: meRef.current.id,
              full_name: meRef.current.full_name,
              status: myStatusRef.current,
            })
          }
        })
    })

    // Mark away when tab hidden
    function onVisibility() {
      const s = document.hidden ? 'away' : 'online'
      myStatusRef.current = s
      setMyStatusState(s)
      channelRef.current?.track({ user_id: meRef.current?.id, full_name: meRef.current?.full_name, status: s })
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      if (channelRef.current) supabase.removeChannel(channelRef.current)
    }
  }, [])

  function setMyStatus(s: UserStatus) {
    myStatusRef.current = s
    setMyStatusState(s)
    if (meRef.current) {
      channelRef.current?.track({ user_id: meRef.current.id, full_name: meRef.current.full_name, status: s })
    }
  }

  return <Ctx.Provider value={{ onlineUserIds, presenceUsers, myStatus, setMyStatus }}>{children}</Ctx.Provider>
}

export function usePresence() { return useContext(Ctx) }
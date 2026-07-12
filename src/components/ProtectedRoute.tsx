import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

interface Props {
  children: React.ReactNode
  roles?: string[]
}

export default function ProtectedRoute({ children, roles }: Props) {
  const [loading, setLoading] = useState(true)
  const [authed, setAuthed] = useState(false)
  const [roleOk, setRoleOk] = useState(false)

  useEffect(() => {
    async function check() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      setAuthed(true)

      if (!roles || roles.length === 0) {
        setRoleOk(true)
        setLoading(false)
        return
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (profile && roles.includes(profile.role)) {
        setRoleOk(true)
      }

      setLoading(false)
    }
    check()
  }, [])

  if (loading) return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', fontFamily: 'Nunito, sans-serif', color: '#6b7280',
      background: 'var(--bg-page)',
    }}>
      Loading…
    </div>
  )

  if (!authed) return <Navigate to="/login" replace />
  if (!roleOk) return <Navigate to="/dashboard" replace />

  return <>{children}</>
}
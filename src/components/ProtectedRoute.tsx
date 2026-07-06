import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

interface ProtectedRouteProps {
  children: React.ReactNode
  allowedRoles?: string[]
}

function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const [status, setStatus] = useState<'loading' | 'allowed' | 'denied'>('loading')
  const navigate = useNavigate()

  useEffect(() => {
    async function check() {
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        navigate('/login')
        return
      }

      if (!allowedRoles) {
        setStatus('allowed')
        return
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (profile && allowedRoles.includes(profile.role)) {
        setStatus('allowed')
      } else {
        navigate('/dashboard')
      }
    }

    check()
  }, [navigate, allowedRoles])

  if (status === 'loading') {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        fontSize: '1rem',
        color: '#6b7280',
      }}>
        Loading…
      </div>
    )
  }

  if (status === 'denied') return null

  return <>{children}</>
}

export default ProtectedRoute

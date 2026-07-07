import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

interface Props {
  children: React.ReactNode
  allowedRoles?: string[]
}

export default function ProtectedRoute({ children, allowedRoles }: Props) {
  const navigate = useNavigate()
  const [ok, setOk] = useState(false)

  useEffect(() => {
    async function check() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { navigate('/login'); return }
      if (allowedRoles) {
        const { data: p } = await supabase.from('profiles').select('role').eq('id', user.id).single()
        if (!p || !allowedRoles.includes(p.role)) { navigate('/dashboard'); return }
      }
      setOk(true)
    }
    check()
  }, [navigate])

  if (!ok) return null
  return <>{children}</>
}
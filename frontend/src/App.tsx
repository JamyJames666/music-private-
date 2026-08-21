import { useState, useCallback } from 'react'
import { login as apiLogin } from '@/lib/api'
import LoginScreen from '@/components/LoginScreen'
import Dashboard from '@/components/Dashboard'
import ReconnectingToast from '@/components/ReconnectingToast'

export default function App() {
  const [token, setToken] = useState<string>(() => localStorage.getItem('muse_token') ?? '')
  const [isAdmin, setIsAdmin] = useState<boolean>(() => localStorage.getItem('muse_is_admin') === 'true')
  const [authed, setAuthed]  = useState<boolean>(() => !!localStorage.getItem('muse_token'))
  const [reconnecting, setReconnecting] = useState(false)

  const handleLogin = useCallback(async (password: string) => {
    const { token: tok, isAdmin: admin } = await apiLogin(password)
    localStorage.setItem('muse_token', tok)
    localStorage.setItem('muse_is_admin', String(admin))
    setToken(tok)
    setIsAdmin(admin)
    setAuthed(true)
  }, [])

  const handleSessionExpired = useCallback(() => {
    localStorage.removeItem('muse_token')
    localStorage.removeItem('muse_is_admin')
    setToken('')
    setIsAdmin(false)
    setAuthed(false)
  }, [])

  const handleReconnecting = useCallback((v: boolean) => setReconnecting(v), [])

  if (!authed) {
    return <LoginScreen onLogin={handleLogin} />
  }

  return (
    <>
      <ReconnectingToast show={reconnecting} />
      <Dashboard
        token={token}
        isAdmin={isAdmin}
        onSessionExpired={handleSessionExpired}
        onReconnecting={handleReconnecting}
      />
    </>
  )
}

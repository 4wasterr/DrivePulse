import { useCallback, useEffect, useRef, useState } from 'react'
import App from './App'
import AuthPage from './components/AuthPage'
import AgentPortal from './components/AgentPortal'
import { api } from './api'
import './workspace.css'

const clientPages = ['overview', 'bookings', 'documents', 'payments', 'saved']
const authPages = ['login', 'signup', 'agent-login', 'agent-signup']
export default function RootApp() {
  const [page, setPage] = useState(() => window.location.hash.slice(1) || 'home')
  const [workspace, setWorkspace] = useState(null)
  const [availability, setAvailability] = useState([])
  const [config, setConfig] = useState({ demo: false, agentSignup: true })
  const [loading, setLoading] = useState(true)
  const [connectionError, setConnectionError] = useState('')
  const sequence = useRef(0)
  const returnTo = useRef('overview')
  const refresh = useCallback(async () => {
    const current = ++sequence.current
    try {
      const [session, schedule] = await Promise.all([api('/session'), api('/availability')])
      const data = session.user ? await api('/workspace') : null
      if (current !== sequence.current) return
      setConfig(session); setWorkspace(data); setAvailability(schedule); setConnectionError('')
    } catch (error) { if (current === sequence.current) { setConnectionError(error.message); if (error.status === 401) setWorkspace(null) } }
    finally { if (current === sequence.current) setLoading(false) }
  }, [])
  useEffect(() => {
    const change = () => { setPage(window.location.hash.slice(1) || 'home'); window.scrollTo({ top: 0, behavior: 'instant' }) }
    const focus = () => refresh()
    window.addEventListener('hashchange', change); window.addEventListener('focus', focus)
    refresh()
    const interval = setInterval(refresh, 30000)
    return () => { sequence.current += 1; clearInterval(interval); window.removeEventListener('hashchange', change); window.removeEventListener('focus', focus) }
  }, [refresh])
  const navigate = to => { window.location.hash = to; setPage(to) }
  const authenticate = (to = 'overview') => { returnTo.current = to; navigate('login') }
  async function signedIn(user) { await refresh(); navigate(user.role === 'agent' ? 'agent-overview' : clientPages.includes(page) ? page : returnTo.current) }
  async function logout() { await api('/logout', { method: 'POST' }); sequence.current += 1; setWorkspace(null); navigate('home') }
  const user = workspace?.user
  const requiresAuth = clientPages.includes(page) || page.startsWith('agent-') && !authPages.includes(page)
  if (loading) return <div className="workspace-loading" role="status"><span className="loading-line" /><strong>Getting your journey ready.</strong></div>
  let content
  if (authPages.includes(page) || requiresAuth && !user) content = <AuthPage key={page} mode={page.includes('signup') ? 'signup' : 'login'} role={page.startsWith('agent-') ? 'agent' : 'client'} onNavigate={navigate} onSuccess={signedIn} config={config} />
  else if (user?.role === 'agent' && (page.startsWith('agent-') || clientPages.includes(page))) content = <AgentPortal page={page.startsWith('agent-') ? page : 'agent-overview'} user={user} workspace={workspace} availability={availability} onRefresh={refresh} onNavigate={navigate} onLogout={logout} />
  else if (user && page.startsWith('agent-')) content = <div className="role-gate"><h1>Your client workspace is ready.</h1><p>Sign in with a booking-agent account to use the front desk.</p><a className="button button-dark" href="#overview">Open my portal</a><a className="button button-outline" href="#agent-login">Agent sign in</a></div>
  else content = <App user={user} workspace={workspace} availability={availability} onRefresh={refresh} onLogout={logout} onAuthenticate={authenticate} />
  return <>{connectionError && <div className="connection-banner" role="alert"><span>{connectionError}</span><button onClick={refresh}>Reconnect</button></div>}{content}</>
}

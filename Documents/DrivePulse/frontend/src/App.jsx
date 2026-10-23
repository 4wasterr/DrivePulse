import { useState, useRef, useCallback, useEffect } from 'react'
import { api } from './api.js'
import MechanicPortal from './pages/Fleet Mechanic/MechanicPortal.jsx'
import ManagerPortal from './pages/Operations Manager/ManagerPortal.jsx'
import AuthPage from './pages/Authentication/AuthPage.jsx'
import AgentPortal from './pages/Booking Agent/AgentPortal.jsx'
import ClientPortal from './pages/Client Portal/ClientPortal.jsx'

const clientPages = ['overview', 'fleet', 'bookings', 'documents', 'payments']

const authPages = ['login', 'signup', ...['agent', 'mechanic', 'manager'].flatMap(role => [`${role}-login`, `${role}-signup`])]

const pageRole = page => ['agent', 'mechanic', 'manager'].find(role => page.startsWith(`${role}-`)) || 'client'

export default function App() {
  const [page, setPage] = useState(() => window.location.hash.slice(1) || 'home')
  const [workspace, setWorkspace] = useState(null)
  const [availability, setAvailability] = useState([])
  const [config, setConfig] = useState({ demo: false, agentSignup: true, rates: {} })
  const [loading, setLoading] = useState(true)
  const [connectionError, setConnectionError] = useState('')
  const sequence = useRef(0)
  const returnTo = useRef('overview')
  const refresh = useCallback(() => {
    const current = ++sequence.current
    return Promise.all([api('/session'), api('/availability')])
      .then(async ([session, schedule]) => {
        let data = null
        if (session.user) {
          const [workspace, operations] = await Promise.all([api('/workspace'), session.user.role !== 'client' ? api('/operations') : Promise.resolve(null)])
          data = { ...workspace, operations }
        }
        if (current !== sequence.current) return
        setConfig(session); setWorkspace(data); setAvailability(schedule); setConnectionError('')
      })
      .catch(error => { if (current === sequence.current) { setConnectionError(error.message); if (error.status === 401) setWorkspace(null) } })
      .finally(() => { if (current === sequence.current) setLoading(false) })
  }, [])
  useEffect(() => {
    const change = () => { setPage(window.location.hash.slice(1) || 'home'); window.scrollTo({ top: 0, behavior: 'instant' }) }
    const focus = () => refresh()
    window.addEventListener('hashchange', change); window.addEventListener('focus', focus)
    refresh()
    const interval = setInterval(refresh, 30000)
    return () => { sequence.current += 1; clearInterval(interval); window.removeEventListener('hashchange', change); window.removeEventListener('focus', focus) }
  }, [refresh])
  const navigate = to => { window.location.assign(`#${to}`); setPage(to) }
  const authenticate = (to = 'overview') => { returnTo.current = to; navigate('login') }
  async function signedIn(user) { await refresh(); navigate(user.role !== 'client' ? `${user.role}-overview` : clientPages.includes(page) ? page : returnTo.current) }
  async function logout() { await api('/logout', { method: 'POST' }); sequence.current += 1; setWorkspace(null); navigate('home') }
  useEffect(() => {
    if (!authPages.includes(page) && clientPages.includes(page)) {
      returnTo.current = page
    }
  }, [page])
  const user = workspace?.user
  const requiresAuth = page !== 'home' && !authPages.includes(page)
  if (loading) return <div className="workspace-loading" role="status"><span className="loading-line" /><strong>Getting your journey ready.</strong></div>
  const StaffWorkspace = user?.role === 'mechanic' ? MechanicPortal : ManagerPortal
  let content
  if (authPages.includes(page) || requiresAuth && !user) {
    content = <AuthPage key={page} mode={page.includes('signup') ? 'signup' : 'login'} onSuccess={signedIn} config={config} />
  }
  else if (user && ['mechanic', 'manager'].includes(user.role) && (page.startsWith(`${user.role}-`) || clientPages.includes(page))) content = <StaffWorkspace page={page.startsWith(`${user.role}-`) ? page : `${user.role}-overview`} user={user} operations={workspace.operations} onRefresh={refresh} onNavigate={navigate} onLogout={logout} />
  else if (user?.role === 'agent' && (page.startsWith('agent-') || clientPages.includes(page))) content = <AgentPortal page={page.startsWith('agent-') ? page : 'agent-overview'} user={user} workspace={workspace} availability={availability} onRefresh={refresh} onNavigate={navigate} onLogout={logout} />
  else if (user && pageRole(page) !== 'client') content = <div className="role-gate"><h1>Open your workspace.</h1><p>Your account has its own workspace.</p><a className="button button-dark" href={`#${user.role === 'client' ? 'overview' : `${user.role}-overview`}`}>Open my workspace</a><a className="button button-outline" href="#login">Sign in with another account</a></div>
  else content = <ClientPortal user={user} workspace={workspace} availability={availability} rates={config.rates} onRefresh={refresh} onLogout={logout} onAuthenticate={authenticate} />
  return <>{connectionError && <div className="connection-banner" role="alert"><span>{connectionError}</span><button onClick={refresh}>Reconnect</button></div>}{content}</>
}

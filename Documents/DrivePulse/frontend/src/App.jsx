import { useState, useRef, useCallback, useEffect } from 'react'
import { api } from './api.js'
import MechanicPortal from './pages/Fleet Mechanic/MechanicPortal.jsx'
import ManagerPortal from './pages/Operations Manager/ManagerPortal.jsx'
import AuthPage from './pages/Authentication/AuthPage.jsx'
import AgentPortal from './pages/Booking Agent/AgentPortal.jsx'
import ClientPortal from './pages/Client Portal/ClientPortal.jsx'
import LandingPage from './pages/Public/LandingPage.jsx'
import { isPublicPage, workspaceHome } from './utils/roles.js'
import { syncVehicles } from './data.js'
import { NotificationContext } from './components/ui/notificationContext.js'
import { getBackNavigation, readNavigationTrail } from './utils/navigation.js'
import BackButton from './components/ui/BackButton.jsx'

const clientPages = ['overview', 'fleet', 'bookings', 'documents', 'payments']

const authPages = ['login', 'signup', ...['agent', 'mechanic', 'manager'].flatMap(role => [`${role}-login`, `${role}-signup`])]

const pageRole = page => ['agent', 'mechanic', 'manager'].find(role => page.startsWith(`${role}-`)) || 'client'

export default function App() {
  const [page, setPage] = useState(() => window.location.hash.slice(1) || 'home')
  const navigationTrail = useRef(readNavigationTrail(page, window.history.state))
  const [workspace, setWorkspace] = useState(null)
  const [availability, setAvailability] = useState([])
  const [notifications, setNotifications] = useState([])
  const [config, setConfig] = useState({ demo: false, agentSignup: true, rates: {} })
  const [loading, setLoading] = useState(true)
  const [connectionError, setConnectionError] = useState('')
  const sequence = useRef(0)
  const returnTo = useRef('overview')
  const refresh = useCallback(() => {
    const current = ++sequence.current
    return Promise.all([api('/session'), api('/availability'), api('/vehicles')])
      .then(async ([session, schedule, fleet]) => {
        let data = null
        let notices = []
        if (session.user) {
          const [workspace, operations, alerts] = await Promise.all([api('/workspace'), session.user.role !== 'client' ? api('/operations') : Promise.resolve(null), api('/notifications')])
          data = { ...workspace, operations }
          notices = alerts
        }
        if (current !== sequence.current) return
        syncVehicles(fleet)
        setNotifications(notices)
        setConfig(session); setWorkspace(data); setAvailability(schedule); setConnectionError('')
      })
      .catch(error => { if (current === sequence.current) { setConnectionError(error.message); if (error.status === 401) setWorkspace(null) } })
      .finally(() => { if (current === sequence.current) setLoading(false) })
  }, [])
  useEffect(() => {
    const change = () => {
      const next = window.location.hash.slice(1) || 'home'
      navigationTrail.current = readNavigationTrail(next, window.history.state, navigationTrail.current)
      window.history.replaceState({ ...window.history.state, drivepulseNavigation: navigationTrail.current }, '')
      setPage(next)
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
    window.history.replaceState({ ...window.history.state, drivepulseNavigation: navigationTrail.current }, '')
    const focus = () => refresh()
    window.addEventListener('hashchange', change); window.addEventListener('focus', focus)
    refresh()
    const interval = setInterval(refresh, 30000)
    return () => { sequence.current += 1; clearInterval(interval); window.removeEventListener('hashchange', change); window.removeEventListener('focus', focus) }
  }, [refresh])
  const navigate = to => { window.location.assign(`#${to}`); setPage(to) }
  const authenticate = (to = 'overview') => { returnTo.current = to; navigate('login') }
  async function signedIn(user) { await refresh(); navigate(user.role !== 'client' ? workspaceHome(user.role) : clientPages.includes(page) ? page : returnTo.current) }
  async function logout() { await api('/logout', { method: 'POST' }); sequence.current += 1; returnTo.current = 'overview'; navigationTrail.current = []; setWorkspace(null); navigate('home') }
  useEffect(() => {
    if (!authPages.includes(page) && clientPages.includes(page)) {
      returnTo.current = page
    }
  }, [page])
  const user = workspace?.user
  function goBack() {
    const target = getBackNavigation(navigationTrail.current, page, user?.role)
    if (target.delta) { window.history.go(target.delta); return }
    navigationTrail.current = [target.page]
    window.history.replaceState({ ...window.history.state, drivepulseNavigation: navigationTrail.current }, '', `#${target.page}`)
    setPage(target.page)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }
  const requiresAuth = !isPublicPage(page) && !authPages.includes(page)
  if (loading) return <div className="workspace-loading" role="status"><span className="loading-line" /><strong>Loading DrivePulse.</strong></div>
  const StaffWorkspace = user?.role === 'mechanic' ? MechanicPortal : ManagerPortal
  let content
  if (isPublicPage(page)) content = <LandingPage user={user} section={page} onBack={goBack} />
  else if (authPages.includes(page) || requiresAuth && !user) {
    content = <AuthPage key={page} mode={page.includes('signup') ? 'signup' : 'login'} onSuccess={signedIn} config={config} onBack={goBack} />
  }
  else if (user && ['mechanic', 'manager'].includes(user.role) && (page.startsWith(`${user.role}-`) || clientPages.includes(page))) content = <StaffWorkspace page={page.startsWith(`${user.role}-`) ? page : `${user.role}-overview`} user={user} operations={workspace.operations} onRefresh={refresh} onNavigate={navigate} onLogout={logout} onBack={goBack} />
  else if (user?.role === 'agent' && (page.startsWith('agent-') || clientPages.includes(page))) content = <AgentPortal page={page.startsWith('agent-') ? page : 'agent-overview'} user={user} workspace={workspace} availability={availability} onRefresh={refresh} onNavigate={navigate} onLogout={logout} onBack={goBack} />
  else if (user && pageRole(page) !== 'client') content = <div className="role-gate"><BackButton onBack={goBack} /><h1>Open your workspace.</h1><p>Your account has its own workspace.</p><a className="button button-dark" href={`#${user.role === 'client' ? 'overview' : `${user.role}-overview`}`}>Open my workspace</a><a className="button button-outline" href="#login">Sign in with another account</a></div>
  else content = <ClientPortal user={user} workspace={workspace} availability={availability} rates={config.rates} onRefresh={refresh} onLogout={logout} onAuthenticate={authenticate} onBack={goBack} />
  return <NotificationContext.Provider value={{ user, notifications, onRefresh: refresh }}>{connectionError && <div className="connection-banner" role="alert"><span>{connectionError}</span><button onClick={refresh}>Reconnect</button></div>}{content}</NotificationContext.Provider>
}

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
import { readNavigationTrail, routeFromHash } from './utils/navigation.js'
import { DraftOwnerContext, clearDrafts } from './utils/drafts.js'
import { watchInactivity, EXPIRATION_MESSAGE } from './utils/inactivity.js'

const clientPages = ['overview', 'fleet', 'bookings', 'documents', 'payments']

const accountPages = ['forgot-password', 'reset-password', 'verify-email']
const authPages = ['login', 'signup', ...accountPages, ...['agent', 'mechanic', 'manager'].flatMap(role => [`${role}-login`, `${role}-signup`])]
const authMode = page => accountPages.includes(page) ? page : page.includes('signup') ? 'signup' : 'login'

const pageRole = page => ['agent', 'mechanic', 'manager'].find(role => page.startsWith(`${role}-`)) || 'client'

export default function App() {
  const [page, setPage] = useState(() => routeFromHash())
  const navigationTrail = useRef(readNavigationTrail(page, window.history.state))
  const [workspace, setWorkspace] = useState(null)
  const [availability, setAvailability] = useState([])
  const [notifications, setNotifications] = useState([])
  const [config, setConfig] = useState({ demo: false, agentSignup: true, rates: {} })
  const [loading, setLoading] = useState(true)
  const [connectionError, setConnectionError] = useState('')
  const sequence = useRef(0)
  const returnTo = useRef('overview')
  const expireSession = useCallback(() => {
    sequence.current += 1
    returnTo.current = 'overview'
    navigationTrail.current = []
    clearDrafts()
    setWorkspace(null); setNotifications([]); setConnectionError(''); setLoading(false)
    sessionStorage.setItem('drivepulse:session-expired', EXPIRATION_MESSAGE)
    window.location.replace('#login'); setPage('login')
    api('/logout', { method: 'POST', automatic: true }).catch(() => {})
  }, [])
  useEffect(() => {
    window.addEventListener('drivepulse:session-expired', expireSession)
    return () => window.removeEventListener('drivepulse:session-expired', expireSession)
  }, [expireSession])
  const userId = workspace?.user?.id
  useEffect(() => {
    if (!userId) return
    return watchInactivity({ userId, lastActivity: config.lastActivity, onExpire: expireSession, onActivity: () => api('/session/activity', { method: 'POST' }).catch(() => {}) })
  }, [userId, config.lastActivity, expireSession])
  const refresh = useCallback(() => {
    const current = ++sequence.current
    return Promise.all([api('/session'), api('/availability'), api('/vehicles')])
      .then(async ([session, schedule, fleet]) => {
        if (current !== sequence.current) return
        if (session.sessionExpired) { expireSession(); return }
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
  }, [expireSession])
  useEffect(() => {
    const change = () => {
      const next = routeFromHash()
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
  async function signedIn(user) { sessionStorage.removeItem('drivepulse:session-expired'); await refresh(); navigate(user.role !== 'client' ? workspaceHome(user.role) : clientPages.includes(page) ? page : returnTo.current) }
  async function logout() {
    try { await api('/logout', { method: 'POST' }) }
    catch (error) { if (error.code !== 'ACTION_CANCELLED') setConnectionError(error.message); return }
    clearDrafts(); localStorage.setItem(`drivepulse:logout:${workspace?.user?.id}`, String(Date.now())); sequence.current += 1; returnTo.current = 'overview'; navigationTrail.current = []; setWorkspace(null); navigate('home')
  }
  useEffect(() => {
    if (!authPages.includes(page) && clientPages.includes(page)) {
      returnTo.current = page
    }
  }, [page])
  const user = workspace?.user
  const requiresAuth = !isPublicPage(page) && !authPages.includes(page)
  if (loading) return <div className="workspace-loading" role="status"><span className="loading-line" /><strong>Loading DrivePulse.</strong></div>
  const StaffWorkspace = user?.role === 'mechanic' ? MechanicPortal : ManagerPortal
  let content
  if (isPublicPage(page)) content = <LandingPage user={user} section={page} />
  else if (authPages.includes(page) || requiresAuth && !user) {
    content = <AuthPage key={page} mode={authPages.includes(page) ? authMode(page) : 'login'} emailDelivery={config.emailDelivery} onSuccess={signedIn} onNavigate={navigate} />
  }
  else if (user && ['mechanic', 'manager'].includes(user.role) && (page.startsWith(`${user.role}-`) || clientPages.includes(page))) content = <StaffWorkspace page={page.startsWith(`${user.role}-`) ? page : `${user.role}-overview`} user={user} operations={workspace.operations} onRefresh={refresh} onNavigate={navigate} onLogout={logout} />
  else if (user?.role === 'agent' && (page.startsWith('agent-') || clientPages.includes(page))) content = <AgentPortal page={page.startsWith('agent-') ? page : 'agent-overview'} user={user} workspace={workspace} availability={availability} onRefresh={refresh} onNavigate={navigate} onLogout={logout} />
  else if (user && pageRole(page) !== 'client') content = <div className="role-gate"><h1>Open your workspace.</h1><p>Your account has its own workspace.</p><a className="button button-dark" href={`#${user.role === 'client' ? 'overview' : `${user.role}-overview`}`}>Open my workspace</a><a className="button button-outline" href="#login">Sign in with another account</a></div>
  else content = <ClientPortal user={user} workspace={workspace} availability={availability} rates={config.rates} onRefresh={refresh} onLogout={logout} onAuthenticate={authenticate} />
  return <DraftOwnerContext.Provider value={user?.id}><NotificationContext.Provider value={{ user, notifications, onRefresh: refresh }}>{connectionError && <div className="connection-banner" role="alert"><span>{connectionError}</span><button onClick={refresh}>Reconnect</button></div>}{content}</NotificationContext.Provider></DraftOwnerContext.Provider>
}

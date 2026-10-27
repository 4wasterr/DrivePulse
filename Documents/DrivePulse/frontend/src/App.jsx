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
import { sessionState } from './utils/session.js'

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
  const [expirationNotice, setExpirationNotice] = useState('')
  const refreshRequest = useRef(null)
  const refreshPending = useRef(null)
  const expirationLogout = useRef(Promise.resolve())
  const sequence = useRef(0)
  const returnTo = useRef('overview')
  const dismissExpiration = useCallback(() => {
    setExpirationNotice('')
    try { sessionStorage.removeItem('drivepulse:session-expired') } catch { /* The notice is never persisted. */ }
  }, [])
  const expireSession = useCallback(expected => {
    const revision = typeof expected === 'number' ? expected : expected?.detail?.revision ?? sessionState.revision
    if (!sessionState.expire(revision)) return
    sequence.current += 1
    refreshRequest.current?.abort()
    returnTo.current = 'overview'
    navigationTrail.current = []
    clearDrafts()
    setWorkspace(null); setNotifications([]); setConnectionError(''); setLoading(false)
    const alreadyAuthenticating = authPages.includes(routeFromHash())
    setExpirationNotice(alreadyAuthenticating ? '' : EXPIRATION_MESSAGE)
    if (!alreadyAuthenticating) { window.location.replace('#login'); setPage('login') }
    expirationLogout.current = api('/logout', { method: 'POST', automatic: true }).catch(() => {})
  }, [])
  useEffect(() => {
    if (!expirationNotice) return
    const timer = setTimeout(dismissExpiration, 8000)
    return () => clearTimeout(timer)
  }, [expirationNotice, dismissExpiration])
  useEffect(() => {
    window.addEventListener('drivepulse:session-expired', expireSession)
    return () => window.removeEventListener('drivepulse:session-expired', expireSession)
  }, [expireSession])
  const userId = workspace?.user?.id
  useEffect(() => {
    if (!userId || authPages.includes(page)) return
    const revision = sessionState.revision
    return watchInactivity({ userId, lastActivity: config.lastActivity, onExpire: () => expireSession(revision), onActivity: () => api('/session/activity', { method: 'POST' }).catch(() => {}) })
  }, [userId, page, config.lastActivity, expireSession])
  const refresh = useCallback((invalidate = false) => {
    if (sessionState.authenticating) return Promise.resolve()
    // Focus, visibility and polling often fire together. Aborting fetch does not
    // cancel a database query already running on Vercel, so share that request.
    if (invalidate !== true && refreshPending.current && !refreshRequest.current?.signal.aborted) return refreshPending.current
    const current = ++sequence.current
    const revision = sessionState.revision
    refreshRequest.current?.abort()
    const controller = new AbortController()
    refreshRequest.current = controller
    const pending = api('/sync', { signal: controller.signal })
      .then(({ session, availability: schedule, vehicles: fleet, workspace, operations, notifications: notices }) => {
        if (current !== sequence.current || !sessionState.isCurrent(revision)) return
        if (!session.user && sessionState.userId) { expireSession(revision); return }
        sessionState.restore(session.user?.id || null)
        const data = workspace ? { ...workspace, operations } : null
        syncVehicles(fleet)
        setNotifications(notices)
        setConfig(session); setWorkspace(data); setAvailability(schedule); setConnectionError('')
      })
      .catch(error => { if (!controller.signal.aborted && current === sequence.current && sessionState.isCurrent(revision)) { if (error.code === 'SESSION_EXPIRED' && !sessionState.userId) { setWorkspace(null); setConnectionError('') } else { setConnectionError(error.message); if (error.status === 401) setWorkspace(null) } } })
      .finally(() => { if (refreshPending.current === pending) refreshPending.current = null; if (current === sequence.current) setLoading(false) })
    refreshPending.current = pending
    return pending
  }, [expireSession])
  useEffect(() => {
    const change = () => {
      const next = routeFromHash()
      dismissExpiration()
      navigationTrail.current = readNavigationTrail(next, window.history.state, navigationTrail.current)
      window.history.replaceState({ ...window.history.state, drivepulseNavigation: navigationTrail.current }, '')
      setPage(next)
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
    window.history.replaceState({ ...window.history.state, drivepulseNavigation: navigationTrail.current }, '')
    const focus = () => refresh()
    const mutation = () => refresh(true)
    const visible = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('hashchange', change); window.addEventListener('focus', focus); window.addEventListener('online', focus); window.addEventListener('drivepulse:mutation-succeeded', mutation); document.addEventListener('visibilitychange', visible)
    try { sessionStorage.removeItem('drivepulse:session-expired') } catch { /* The notice is never persisted. */ }
    refresh()
    const interval = setInterval(refresh, 30000)
    return () => { sequence.current += 1; refreshRequest.current?.abort(); clearInterval(interval); window.removeEventListener('hashchange', change); window.removeEventListener('focus', focus); window.removeEventListener('online', focus); window.removeEventListener('drivepulse:mutation-succeeded', mutation); document.removeEventListener('visibilitychange', visible) }
  }, [refresh, dismissExpiration])
  const navigate = to => { window.location.assign(`#${to}`); setPage(to) }
  const authenticate = (to = 'overview') => { returnTo.current = to; navigate('login') }
  async function beforeAuthenticate() {
    dismissExpiration()
    sequence.current += 1; refreshRequest.current?.abort()
    sessionState.beginAuthentication()
    setWorkspace(null); setNotifications([]); setConnectionError('')
    // Wait for the old session's cookie-clear response before creating a new
    // cookie, otherwise that delayed logout can erase a successful sign-in.
    await expirationLogout.current
  }
  async function signedIn(user) { dismissExpiration(); await refresh(); navigate(user.role !== 'client' ? workspaceHome(user.role) : clientPages.includes(page) ? page : returnTo.current) }
  async function logout() {
    try { await api('/logout', { method: 'POST' }) }
    catch (error) { if (error.code !== 'ACTION_CANCELLED') setConnectionError(error.message); return }
    sessionState.clear(); dismissExpiration(); clearDrafts(); localStorage.setItem(`drivepulse:logout:${workspace?.user?.id}`, String(Date.now())); sequence.current += 1; returnTo.current = 'overview'; navigationTrail.current = []; setWorkspace(null); navigate('home')
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
    content = <AuthPage key={page} sessionNotice={expirationNotice} onDismissNotice={dismissExpiration} onBeforeAuthenticate={beforeAuthenticate} onAuthenticationFinished={() => sessionState.finishAuthentication()} mode={authPages.includes(page) ? authMode(page) : 'login'} emailDelivery={config.emailDelivery} onSuccess={signedIn} onNavigate={navigate} />
  }
  else if (user && ['mechanic', 'manager'].includes(user.role) && (page.startsWith(`${user.role}-`) || clientPages.includes(page))) content = <StaffWorkspace page={page.startsWith(`${user.role}-`) ? page : `${user.role}-overview`} user={user} operations={workspace.operations} onRefresh={refresh} onNavigate={navigate} onLogout={logout} />
  else if (user?.role === 'agent' && (page.startsWith('agent-') || clientPages.includes(page))) content = <AgentPortal page={page.startsWith('agent-') ? page : 'agent-overview'} user={user} workspace={workspace} availability={availability} onRefresh={refresh} onNavigate={navigate} onLogout={logout} />
  else if (user && pageRole(page) !== 'client') content = <div className="role-gate"><h1>Open your workspace.</h1><p>Your account has its own workspace.</p><a className="button button-dark" href={`#${user.role === 'client' ? 'overview' : `${user.role}-overview`}`}>Open my workspace</a><a className="button button-outline" href="#login">Sign in with another account</a></div>
  else content = <ClientPortal user={user} workspace={workspace} availability={availability} rates={config.rates} onRefresh={refresh} onLogout={logout} onAuthenticate={authenticate} />
  return <DraftOwnerContext.Provider value={user?.id}><NotificationContext.Provider value={{ user, notifications, onRefresh: refresh }}>{connectionError && <div className="connection-banner" role="alert"><span>{connectionError}</span><button onClick={refresh}>Reconnect</button></div>}{content}</NotificationContext.Provider></DraftOwnerContext.Provider>
}

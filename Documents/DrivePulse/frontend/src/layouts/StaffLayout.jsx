import { useState } from 'react'
import BrandMark from '../components/ui/BrandMark.jsx'
import Icon from '../components/ui/Icon.jsx'
import NotificationCenter from '../components/ui/NotificationCenter.jsx'
import BackButton from '../components/ui/BackButton.jsx'
import { prettyDate, dateISO } from '../data.js'

const names = { mechanic: 'Fleet Mechanic', manager: 'Operations Manager / Admin' }

export default function StaffLayout({ user, navigation, section, title, approvals = [], notice, error, setNotice, setError, onLogout, onBack, actions, children, dialogs }) {
  const [menu, setMenu] = useState(false)
  const mechanic = user.role === 'mechanic'
  async function signOut() { try { await onLogout() } catch (e) { setError(e.message) } }
  return <div className="agent-shell staff-shell">
    {menu && <button className="agent-scrim" aria-label="Close navigation" onClick={() => setMenu(false)} />}
    <aside className={`agent-sidebar ${menu ? 'is-open' : ''}`}>
      <a className="agent-brand" href="#home"><BrandMark /><span>drivepulse.</span></a>
      <div className="agent-workspace-label"><span>STAFF WORKSPACE</span><strong>{names[user.role]}</strong></div>
      <nav aria-label={`${names[user.role]} navigation`}>{navigation.map(([id, icon, label]) => <a key={id} href={`#${user.role}-${id}`} className={id === section ? 'active' : ''} aria-current={id === section ? 'page' : undefined} onClick={() => setMenu(false)}><Icon name={icon} size={20} /><span>{label}</span>{id === 'approvals' && approvals.some(a => a.status === 'pending') && <small>{approvals.filter(a => a.status === 'pending').length}</small>}</a>)}</nav>
      <div className="agent-sidebar-bottom"><div className="agent-sidebar-note"><Icon name={mechanic ? 'settings' : 'road'} size={27} /><strong>{mechanic ? 'Checked with care. Ready for the road.' : 'One fleet. A clearer perspective.'}</strong><span>Single business · Single branch</span></div><button className="agent-signout" onClick={signOut}><Icon name="logout" size={18} />Log Out</button><div className="agent-user"><span className="avatar">{user.name.split(' ').map(n => n[0]).slice(0, 2).join('')}</span><div><strong>{user.name}</strong><span>{names[user.role]}</span></div></div></div>
    </aside>
    <main className="agent-main"><header className="agent-topbar"><div><button className="icon-button agent-mobile-menu" aria-label="Open navigation" onClick={() => setMenu(true)}><Icon name="menu" /></button><span>{names[user.role]}</span><Icon name="chevron" size={13} /><strong>{navigation.find(([id]) => section === id)?.[2] || 'Overview'}</strong></div><div><NotificationCenter /><span className="agent-development-tag">DEVELOPMENT</span><span className="agent-topbar-date">{prettyDate(dateISO(), { year: 'numeric' })} · PHT</span></div></header>
      <div className="agent-page" key={section}><BackButton onBack={onBack} /><section className="agent-page-heading"><div><p className="workspace-kicker">{section === 'overview' ? `WELCOME BACK, ${user.name.split(' ')[0].toUpperCase()}` : 'ONE FLEET. EVERY DETAIL.'}</p><h1>{title[0]}</h1><p>{title[1]}</p></div>{actions}</section>
        {notice && <div className="workspace-notice" role="status"><Icon name="check" /><span>{notice}</span><button className="icon-button" aria-label="Dismiss update" onClick={() => setNotice('')}><Icon name="close" /></button></div>}
        {error && <p className="error-banner" role="alert">{error}</p>}
        {children}
        <footer className="agent-footer"><span>Every journey, accounted for. <strong>drivepulse.</strong></span><span>{names[user.role]} · All times in PHT</span></footer>
      </div>
    </main>
    {dialogs}
  </div>
}

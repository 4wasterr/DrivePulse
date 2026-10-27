import Icon from './Icon.jsx'

export default function SidebarFooter({ user, role, onLogout, onProfile }) {
  const initials = user.name.split(' ').filter(Boolean).map(name => name[0]).slice(0, 2).join('').toUpperCase()
  const identity = <><span className="avatar">{initials}</span><span><strong>{user.name}</strong><small>{role}</small></span>{onProfile && <Icon name="settings" size={18} />}</>
  return <div className="sidebar-account-footer" aria-label="Account and logout">
    {onProfile ? <button className="sidebar-account" onClick={onProfile} aria-label="View profile">{identity}</button> : <div className="sidebar-account">{identity}</div>}
    <button type="button" className="sidebar-logout" onClick={onLogout}><Icon name="logout" size={18} />Log Out</button>
  </div>
}

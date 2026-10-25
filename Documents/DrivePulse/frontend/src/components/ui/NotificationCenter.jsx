import { useContext, useState } from 'react'
import { NotificationContext } from './notificationContext.js'
import Modal from './Modal.jsx'
import Icon from './Icon.jsx'
import { PaginatedList } from './Pagination.jsx'
import { api } from '../../api.js'

export default function NotificationCenter() {
  const { user, notifications, onRefresh } = useContext(NotificationContext)
  const [open, setOpen] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  if (!user) return null
  const unread = notifications.filter(n => !n.read)
  async function markRead(ids) {
    setBusy(true); setError('')
    try {
      for (let i = 0; i < ids.length; i += 300) await api('/notifications/read', { method: 'POST', body: { ids: ids.slice(i, i + 300) } })
      await onRefresh()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <>
    <button type="button" className="icon-button global-notification-button" aria-label={`Notifications${unread.length ? `, ${unread.length} unread` : ''}`} aria-haspopup="dialog" onClick={() => setOpen(true)}><Icon name="bell" size={19} />{unread.length > 0 && <span>{unread.length}</span>}</button>
    {open && <Modal title="Notification center" eyebrow={`${unread.length} UNREAD UPDATES`} wide onClose={() => setOpen(false)}>
      <div className="notification-actions"><p>Vehicle renewals, Security Deposit updates, and system alerts.</p><button type="button" className="button button-outline" disabled={busy || !unread.length} onClick={() => markRead(unread.map(n => n.id))}>Mark all as read</button></div>
      {error && <p className="error-banner" role="alert">{error}</p>}
      {notifications.length ? <PaginatedList>{notifications.map(n => <article key={n.id} className={`global-notification ${n.severity} ${n.read ? 'is-read' : ''}`}>
        <Icon name={n.category === 'deposit' ? 'wallet' : n.category === 'renewal' ? 'calendar' : 'shield'} /><div><strong>{n.title}</strong><p>{n.message}</p>{n.at && <small>{new Date(n.at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} PHT</small>}</div>
        {!n.read && <button type="button" className="text-link" disabled={busy} onClick={() => markRead([n.id])}>Mark read</button>}
      </article>)}</PaginatedList> : <p role="status">You’re all caught up. New updates appear here automatically.</p>}
    </Modal>}
  </>
}

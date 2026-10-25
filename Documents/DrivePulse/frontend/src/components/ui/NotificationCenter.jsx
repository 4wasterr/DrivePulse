import { useContext, useEffect, useId, useRef, useState } from 'react'
import { NotificationContext } from './notificationContext.js'
import Icon from './Icon.jsx'
import { PaginatedList } from './Pagination.jsx'
import { api } from '../../api.js'

export default function NotificationCenter() {
  const { user, notifications, onRefresh } = useContext(NotificationContext)
  const [open, setOpen] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const containerRef = useRef(null)
  const triggerRef = useRef(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return undefined
    function handlePointerDown(event) {
      if (!containerRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  if (!user) return null
  const unread = notifications.filter(n => !n.read)

  async function markRead(ids) {
    setBusy(true); setError('')
    try {
      for (let i = 0; i < ids.length; i += 300) await api('/notifications/read', { method: 'POST', body: { ids: ids.slice(i, i + 300) } })
      await onRefresh()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="notification-center" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="icon-button global-notification-button"
        aria-label={`Notifications${unread.length ? `, ${unread.length} unread` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(current => !current)}
      >
        <Icon name="bell" size={19} />
        {unread.length > 0 && <span>{unread.length}</span>}
      </button>

      {open && (
        <div
          id={panelId}
          className="notification-dropdown"
          role="dialog"
          aria-modal="false"
          aria-labelledby={`${panelId}-title`}
        >
          <header className="notification-dropdown-header">
            <div>
              <span className="eyebrow">{unread.length} UNREAD {unread.length === 1 ? 'UPDATE' : 'UPDATES'}</span>
              <h2 id={`${panelId}-title`}>Notifications</h2>
            </div>
            <div className="notification-header-controls">
              {unread.length > 0 && (
                <button
                  type="button"
                  className="text-link notification-mark-all"
                  disabled={busy}
                  onClick={() => markRead(unread.map(n => n.id))}
                >
                  Mark all read
                </button>
              )}
              <button
                type="button"
                className="icon-button notification-close"
                aria-label="Close notifications"
                onClick={() => setOpen(false)}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          </header>

          {error && <p className="error-banner notification-error" role="alert">{error}</p>}

          <div className="notification-dropdown-body">
            {notifications.length ? (
              <PaginatedList>
                {notifications.map(n => (
                  <article key={n.id} className={`global-notification ${n.severity} ${n.read ? 'is-read' : ''}`}>
                    <Icon name={n.category === 'deposit' ? 'wallet' : n.category === 'renewal' ? 'calendar' : 'shield'} size={18} />
                    <div>
                      <strong>{n.title}</strong>
                      <p>{n.message}</p>
                      {n.at && <small>{new Date(n.at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} PHT</small>}
                    </div>
                    {!n.read && (
                      <button type="button" className="text-link" disabled={busy} onClick={() => markRead([n.id])}>
                        Mark read
                      </button>
                    )}
                  </article>
                ))}
              </PaginatedList>
            ) : (
              <p className="notification-empty" role="status">
                You’re all caught up. New updates appear here automatically.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

import { useState } from 'react'
import Modal from '../../../components/ui/Modal.jsx'
import Icon from '../../../components/ui/Icon.jsx'
import { api } from '../../../api.js'
import { prettyDate, money, rentalDays, dateISO } from '../../../data.js'

export default function ExtensionModal({ booking, vehicle, onClose, onSuccess }) {
  const [newEnd, setNewEnd] = useState(() => {
    const cur = new Date(Date.parse(`${booking.end}T12:00:00Z`))
    cur.setDate(cur.getDate() + 1)
    return cur.toISOString().slice(0, 10)
  })
  const [newEndTime, setNewEndTime] = useState(booking.endTime || '10:00')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const additionalDays = Math.max(0, rentalDays(booking.start, newEnd, booking.startTime, newEndTime) - booking.days)
  const additionalCost = additionalDays * (vehicle?.rate || 3500)

  async function handleExtend(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api(`/bookings/${encodeURIComponent(booking.id)}/extend`, {
        method: 'POST',
        body: {
          end: newEnd,
          endTime: newEndTime,
          version: booking.version
        }
      })
      await onSuccess()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Extend your journey" eyebrow={`RESERVATION · ${booking.id}`} onClose={onClose}>
      <form onSubmit={handleExtend}>
        <div style={{ background: '#f9fafb', padding: '14px', borderRadius: '8px', border: '1px solid #e5e7eb', marginBottom: '18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', color: '#6b7280' }}>Vehicle:</span>
            <strong style={{ fontSize: '13px', color: '#111827' }}>{vehicle?.name}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', color: '#6b7280' }}>Current return:</span>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#111827' }}>
              {prettyDate(booking.end)} at {booking.endTime}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '13px', color: '#6b7280' }}>Daily rental rate:</span>
            <span style={{ fontSize: '13px', color: '#111827' }}>{money(vehicle?.rate || booking.rental / booking.days)} / day</span>
          </div>
        </div>

        <div className="form-grid" style={{ marginBottom: '16px' }}>
          <label className="form-field">
            New return date
            <input
              type="date"
              required
              min={booking.end || dateISO()}
              value={newEnd}
              onChange={e => setNewEnd(e.target.value)}
            />
          </label>
          <label className="form-field">
            New return time
            <input
              type="time"
              required
              value={newEndTime}
              onChange={e => setNewEndTime(e.target.value)}
            />
          </label>
        </div>

        <div style={{ background: '#f0fdf4', padding: '14px', borderRadius: '8px', border: '1px solid #bbf7d0', marginBottom: '18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '13px', color: '#166534' }}>Additional duration:</span>
            <strong style={{ fontSize: '13px', color: '#166534' }}>+{additionalDays} day(s)</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '13px', color: '#166534' }}>Additional rental charge:</span>
            <strong style={{ fontSize: '15px', color: '#15803d' }}>{money(additionalCost)}</strong>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#166534' }}>
            * Charged in cash at counter upon return. Security deposit of {money(booking.deposit)} remains unchanged.
          </p>
        </div>

        {error && <div className="error-banner" role="alert" style={{ marginBottom: '16px' }}>{error}</div>}

        <div style={{ display: 'flex', gap: '10px' }}>
          <button type="button" className="button button-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="button button-dark" style={{ flex: 1 }} disabled={busy || additionalDays <= 0}>
            <Icon name="check" size={17} />
            {busy ? 'Confirming extension…' : 'Confirm rental extension'}
          </button>
        </div>
      </form>
    </Modal>
  )
}


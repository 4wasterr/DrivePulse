import useDraftState from '../../../hooks/useDraftState.js'
import ValidatedField from '../../../components/ui/ValidatedField.jsx'
import ValidatedForm from '../../../components/ui/ValidatedForm.jsx'
import { useState } from 'react'
import Modal from '../../../components/ui/Modal.jsx'
import Icon from '../../../components/ui/Icon.jsx'
import { api } from '../../../api.js'
import { prettyDate, money, rentalDays, dateISO } from '../../../data.js'
import { extensionError } from '../../../../../shared/validation.mjs'

export default function ExtensionModal({ booking, vehicle, onClose, onBack, onSuccess }) {
  const [newEnd, setNewEnd] = useDraftState(`extension:${booking.id}`, 'newEnd', () => {
    const cur = new Date(Date.parse(`${booking.end}T12:00:00Z`))
    cur.setDate(cur.getDate() + 1)
    return cur.toISOString().slice(0, 10)
  })
  const [newEndTime, setNewEndTime] = useDraftState(`extension:${booking.id}`, 'newEndTime', booking.endTime || '10:00')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const additionalDays = Math.max(0, rentalDays(booking.start, newEnd, booking.startTime, newEndTime) - booking.days)
  const dailyRate = booking.dailyRate || booking.rental / booking.days
  const additionalCost = additionalDays * dailyRate
  const scheduleProblem = extensionError(booking, newEnd, newEndTime)

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
    <Modal draftKey={`extension:${booking.id}`} title="Extend your journey" eyebrow={`RESERVATION · ${booking.id}`} onClose={onClose}>
      <ValidatedForm onSubmit={handleExtend} validate={form => [{ name: 'end', message: extensionError(booking, form.elements.namedItem('end').value, form.elements.namedItem('endTime').value) }]}>
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
            <span style={{ fontSize: '13px', color: '#111827' }}>{money(dailyRate)} / day</span>
          </div>
        </div>

        <div className="form-grid" style={{ marginBottom: '16px' }}>
          <label className="form-field">
            New return date
            <ValidatedField
              type="date"
              name="end"
              required
              min={booking.end || dateISO()}
              value={newEnd}
              onChange={e => setNewEnd(e.target.value)}
            />
          </label>
          <label className="form-field">
            New return time
            <ValidatedField
              type="time"
              name="endTime"
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
            The Operations Manager or Booking Agent must verify availability and approve this request before the return date or contract changes. Any approved charge is paid in cash. Security deposit: {money(booking.deposit)}.
          </p>
        </div>

        {error && <div className="error-banner" role="alert" style={{ marginBottom: '16px' }}>{error}</div>}

        <div style={{ display: 'flex', gap: '10px' }}>
          <button type="button" className="button button-outline" onClick={onBack || onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="button button-dark" style={{ flex: 1 }} disabled={busy || additionalDays <= 0 || Boolean(scheduleProblem)}>
            <Icon name="check" size={17} />
            {busy ? 'Submitting request…' : 'Request extension approval'}
          </button>
        </div>
      </ValidatedForm>
    </Modal>
  )
}


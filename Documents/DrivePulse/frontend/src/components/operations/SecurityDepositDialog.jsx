import { useState } from 'react'
import useDraftState from '../../hooks/useDraftState.js'
import Modal from '../ui/Modal.jsx'
import RecordPaymentForm from './RecordPaymentForm.jsx'
import { api } from '../../api.js'
import { money } from '../../data.js'

export default function SecurityDepositDialog({ bookings, onClose, onDone, onRefresh }) {
  const eligible = bookings.filter(booking => booking.status !== 'Cancelled' && booking.billing.depositBalance > 0)
  const [bookingId, setBookingId] = useDraftState('security-deposit', 'bookingId', eligible[0]?.id || '')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const booking = eligible.find(booking => booking.id === bookingId)
  return <Modal draftKey="security-deposit" title="Security Deposit" eyebrow="CASH COLLECTION & BOOKING LEDGER" onClose={onClose}>
    <label className="form-field">Reservation<select value={bookingId} onChange={event => { setBookingId(event.target.value); setError('') }} disabled={busy}><option value="">Select a reservation</option>{eligible.map(booking => <option key={booking.id} value={booking.id}>{booking.id} · {booking.renter.name} · {money(booking.billing.depositBalance)} due</option>)}</select></label>
    {!eligible.length && <p>No reservations have an outstanding security deposit.</p>}
    {booking && <RecordPaymentForm key={`${booking.id}:${booking.version}`} booking={booking} busy={busy} depositOnly onSave={async body => {
      setBusy(true); setError('')
      try {
        await api(`/agent/bookings/${booking.id}/payment`, { method: 'POST', body: { ...body, version: booking.version } })
        await onDone(`Security Deposit recorded for ${booking.id}. The financial summary, cash receipt and ledger have been updated.`)
      } catch (error) { setError(error.message); await onRefresh() }
      finally { setBusy(false) }
    }} />}
    {error && <p className="error-banner" role="alert">{error}</p>}
  </Modal>
}

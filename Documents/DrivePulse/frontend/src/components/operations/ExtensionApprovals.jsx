import { useEffect, useState } from 'react'
import { api } from '../../api.js'
import { getAvailabilityReason, money } from '../../data.js'
import { vehicleFor } from '../../utils/vehicles.js'
import { PaginatedList } from '../ui/Pagination.jsx'
import ValidatedForm from '../ui/ValidatedForm.jsx'
import ValidatedField from '../ui/ValidatedField.jsx'

export default function ExtensionApprovals({ bookings, onRefresh, onNotice }) {
  const pending = bookings.flatMap(booking => (booking.extensionRequests || []).filter(request => request.status === 'pending').map(request => ({ booking, request })))
  return <section className="workspace-surface staff-section"><h2>Extensions · Pending verification / approval ({pending.length})</h2>
    <p>Review the vehicle schedule before approving. The current contract stays in effect until approval.</p>
    {pending.length ? <PaginatedList>{pending.map(({ booking, request }) => <ExtensionReview key={`${request.id}:${booking.version}`} booking={booking} request={request} onRefresh={onRefresh} onNotice={onNotice} />)}</PaginatedList> : <p className="workspace-muted">No extension requests awaiting review.</p>}
  </section>
}

function ExtensionReview({ booking, request, onRefresh, onNotice }) {
  const [availability, setAvailability] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    api('/availability').then(data => { if (active) setAvailability(data) }).catch(err => { if (active) setError(err.message) })
    return () => { active = false }
  }, [])
  const future = availability?.filter(b => !b.blocked && b.id !== booking.id && b.vehicleId === booking.vehicleId && !['Cancelled', 'Completed'].includes(b.status) && b.end >= booking.end) || []
  const conflict = availability ? getAvailabilityReason(booking.vehicleId, { ...booking, end: request.newEnd, endTime: request.newEndTime }, future) : ''
  return <details className="record-section"><summary>{booking.id} · {vehicleFor(booking).name} · Return requested: {request.newEnd} {request.newEndTime}</summary>
    <p>Current return: {booking.end} {booking.endTime} PHT. Requested by {request.requestedBy}. Additional rental: {money(request.additionalRental)}.</p>
    <h4>Other scheduled reservations</h4>
    {availability === null ? <p role="status">Checking vehicle schedule…</p> : future.length ? future.map(b => <p key={b.id}>{b.id}: {b.start} {b.startTime} – {b.end} {b.endTime} · {b.status}</p>) : <p>No future reservations currently block this vehicle.</p>}
    {conflict && <p className="error-banner" role="alert">{conflict}</p>}
    <ValidatedForm onSubmit={async event => {
      event.preventDefault(); const form = new FormData(event.currentTarget), decision = event.nativeEvent.submitter?.value
      setBusy(true); setError('')
      try {
        await api(`/bookings/${encodeURIComponent(booking.id)}/extensions/${encodeURIComponent(request.id)}/review`, { method: 'POST', body: { version: booking.version, decision, reason: form.get('reason') } })
        await onRefresh(); onNotice?.(`Extension ${decision}.${decision === 'approved' ? ' Return schedule and contract updated.' : ' Current contract retained.'}`)
      } catch (err) { setError(err.message); await onRefresh() } finally { setBusy(false) }
    }}><fieldset disabled={busy}>
      <label className="form-field">Schedule review note<ValidatedField as="textarea" name="reason" required maxLength={1000} /></label>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <div className="staff-card-actions"><button type="submit" name="decision" value="approved" className="button button-dark" disabled={busy || availability === null || Boolean(conflict)}>Approve extension</button><button type="submit" name="decision" value="rejected" className="button button-outline" disabled={busy}>Reject request</button></div>
    </fieldset></ValidatedForm>
  </details>
}

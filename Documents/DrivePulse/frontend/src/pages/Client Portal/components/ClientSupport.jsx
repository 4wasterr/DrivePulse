import { useState } from 'react'
import { api } from '../../../api.js'
import Icon from '../../../components/ui/Icon.jsx'
import Conversation from '../../../components/support/Conversation.jsx'

export default function ClientSupport({ bookings, tickets, onRefresh }) {
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  async function submit(event) {
    event.preventDefault(); const form = event.currentTarget, data = new FormData(form); setError(''); setNotice(''); setBusy(true)
    try { await api('/support', { method: 'POST', body: Object.fromEntries(data) }); form.reset(); await onRefresh(); setNotice('Your query has been sent to the booking team.') }
    catch (problem) { setError(problem.message) } finally { setBusy(false) }
  }
  return <section className="client-support"><h3>Talk to your booking team.</h3><p className="muted small">Request an extension or cancellation, or ask about your booking.</p><form onSubmit={submit}><div className="form-grid"><label className="form-field">About<select name="category"><option>General</option><option>Extension</option><option>Cancellation</option><option>Billing</option><option>Documents</option></select></label><label className="form-field">Booking<select name="bookingId"><option value="">General query</option>{bookings.map(booking => <option key={booking.id} value={booking.id}>{booking.id}</option>)}</select></label></div><label className="form-field">Subject<input name="subject" maxLength={150} required placeholder="How can we help?" /></label><label className="form-field">Message<textarea name="message" maxLength={3000} required rows={4} placeholder="Tell us what you need, including new dates for an extension." /></label>{error && <p className="error-banner" role="alert">{error}</p>}{notice && <p className="workspace-notice" role="status">{notice}</p>}<button className="button button-dark" disabled={busy}>{busy ? 'Sending…' : 'Send query'}<Icon name="arrow" /></button></form>{tickets.length > 0 && <div className="client-query-list"><h3>Your conversations.</h3>{tickets.map(ticket => <Conversation key={ticket.id} ticket={ticket} onRefresh={onRefresh} />)}</div>}</section>
}

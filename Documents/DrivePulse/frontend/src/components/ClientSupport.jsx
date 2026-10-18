import { useState } from 'react'
import { api } from '../api'
import Icon from './Icon'

export function Conversation({ ticket, onRefresh, agent = false, onOpenBooking }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function reply(event) {
    event.preventDefault(); const form = event.currentTarget, data = new FormData(form); setBusy(true); setError('')
    try { await api(`/support/${ticket.id}/reply`, { method: 'POST', body: { message: data.get('message'), resolve: data.get('resolve') === 'on', version: ticket.version } }); form.reset(); await onRefresh() }
    catch (problem) { setError(problem.message) } finally { setBusy(false) }
  }
  return <article className="support-conversation"><div className="support-conversation-heading"><div><span className="workspace-kicker">{ticket.id} · {ticket.category}</span><h3>{ticket.subject}</h3></div><span className={`workspace-tag ${ticket.status === 'resolved' ? 'tag-solid' : ''}`}>{ticket.status === 'resolved' ? 'Resolved' : 'Open'}</span></div>{ticket.bookingId && <button className="text-link" onClick={() => onOpenBooking?.(ticket.bookingId)} disabled={!onOpenBooking}>{ticket.bookingId}{onOpenBooking && <Icon name="diagonal" size={16} />}</button>}<div className="support-messages">{ticket.messages.map(message => <div className={`support-message ${message.role === 'agent' ? 'from-agent' : ''}`} key={message.id}><div><strong>{message.by}{message.role === 'agent' ? ' · Booking team' : ''}</strong><time>{new Date(message.at).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></div><p>{message.message}</p></div>)}</div><form onSubmit={reply}><label className="form-field">{agent ? 'Reply to customer' : 'Add a reply'}<textarea name="message" required maxLength={3000} rows={3} placeholder="Write your message…" /></label>{agent && <label className="checkbox-label"><input name="resolve" type="checkbox" />Resolve this query after replying</label>}{error && <p className="error-banner" role="alert">{error}</p>}<button className="button button-dark" disabled={busy}>{busy ? 'Sending…' : 'Send reply'}<Icon name="arrow" size={16} /></button></form></article>
}

export default function ClientSupport({ bookings, tickets, onRefresh }) {
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  async function submit(event) {
    event.preventDefault(); const form = event.currentTarget, data = new FormData(form); setError(''); setNotice(''); setBusy(true)
    try { await api('/support', { method: 'POST', body: Object.fromEntries(data) }); form.reset(); await onRefresh(); setNotice('Your query has been sent to the booking team.') }
    catch (problem) { setError(problem.message) } finally { setBusy(false) }
  }
  return <section className="client-support"><h3>Talk to your booking team.</h3><p className="muted small">Request an extension or cancellation, or ask about your booking.</p><form onSubmit={submit}><div className="form-grid"><label className="form-field">About<select name="category"><option>General</option><option>Extension</option><option>Cancellation</option><option>Billing</option><option>Documents</option></select></label><label className="form-field">Booking<select name="bookingId"><option value="">General query</option>{bookings.map(booking => <option key={booking.id} value={booking.id}>{booking.id}</option>)}</select></label></div><label className="form-field">Subject<input name="subject" maxLength={150} required placeholder="How can we help?" /></label><label className="form-field">Message<textarea name="message" maxLength={3000} required rows={4} placeholder="Tell us what you need, including new dates for an extension." /></label>{error && <p className="error-banner" role="alert">{error}</p>}{notice && <p className="workspace-notice" role="status">{notice}</p>}<button className="button button-dark" disabled={busy}>{busy ? 'Sending…' : 'Send query'}<Icon name="arrow" /></button></form>{tickets.length > 0 && <div className="client-query-list"><h3>Your conversations.</h3>{tickets.map(ticket => <Conversation key={ticket.id} ticket={ticket} onRefresh={onRefresh} />)}</div>}</section>
}

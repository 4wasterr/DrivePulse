import { useState } from 'react'
import { api } from '../../api.js'
import Icon from '../ui/Icon.jsx'

export default function Conversation({ ticket, onRefresh, agent = false, onOpenBooking }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function reply(event) {
    event.preventDefault(); const form = event.currentTarget, data = new FormData(form); setBusy(true); setError('')
    try { await api(`/support/${ticket.id}/reply`, { method: 'POST', body: { message: data.get('message'), resolve: data.get('resolve') === 'on', version: ticket.version } }); form.reset(); await onRefresh() }
    catch (problem) { setError(problem.message) } finally { setBusy(false) }
  }
  return <article className="support-conversation"><div className="support-conversation-heading"><div><span className="workspace-kicker">{ticket.id} · {ticket.category}</span><h3>{ticket.subject}</h3></div><span className={`workspace-tag ${ticket.status === 'resolved' ? 'tag-solid' : ''}`}>{ticket.status === 'resolved' ? 'Resolved' : 'Open'}</span></div>{ticket.bookingId && <button className="text-link" onClick={() => onOpenBooking?.(ticket.bookingId)} disabled={!onOpenBooking}>{ticket.bookingId}{onOpenBooking && <Icon name="diagonal" size={16} />}</button>}<div className="support-messages">{ticket.messages.map(message => <div className={`support-message ${message.role === 'agent' ? 'from-agent' : ''}`} key={message.id}><div><strong>{message.by}{message.role === 'agent' ? ' · Booking team' : ''}</strong><time>{new Date(message.at).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></div><p>{message.message}</p></div>)}</div><form onSubmit={reply}><label className="form-field">{agent ? 'Reply to customer' : 'Add a reply'}<textarea name="message" required maxLength={3000} rows={3} placeholder="Write your message…" /></label>{agent && <label className="checkbox-label"><input name="resolve" type="checkbox" />Resolve this query after replying</label>}{error && <p className="error-banner" role="alert">{error}</p>}<button className="button button-dark" disabled={busy}>{busy ? 'Sending…' : 'Send reply'}<Icon name="arrow" size={16} /></button></form></article>
}

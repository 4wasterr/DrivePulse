import { useState } from 'react'
import Modal from '../../../components/ui/Modal.jsx'
import Empty from '../../../components/workspace/StaffEmpty.jsx'
import { api } from '../../../api.js'
import Icon from '../../../components/ui/Icon.jsx'

export default function RiskForm({ bookings, onClose, onDone }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <Modal title="Log a driver risk" eyebrow="MANUAL RISK REVIEW" onClose={onClose}>{!bookings.length ? <Empty>A reservation is needed to record a driver risk.</Empty> : <form className="staff-form" onSubmit={async e => { e.preventDefault(); const data = new FormData(e.currentTarget); setBusy(true); setError(''); try { await api('/manager/risks', { method: 'POST', body: Object.fromEntries(data) }); await onDone('Driver risk logged.') } catch (e) { setError(e.message) } finally { setBusy(false) } }}><fieldset disabled={busy}><label className="form-field">Customer / reservation<select name="bookingId">{bookings.map(b => <option key={b.id} value={b.id}>{b.renter.name} · {b.id}</option>)}</select></label><label className="form-field">Severity<select name="severity"><option>Low</option><option>Medium</option><option>High</option></select></label><label className="form-field">Risk description<textarea name="description" required maxLength={1500} rows={4} /></label>{error && <p className="error-banner" role="alert">{error}</p>}<button className="button button-dark" disabled={busy}>Save risk log<Icon name="shield" size={18} /></button></fieldset></form>}</Modal>
}

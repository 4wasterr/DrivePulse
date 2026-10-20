import { useState } from 'react'
import Modal from '../../../components/ui/Modal.jsx'
import { api } from '../../../api.js'
import Icon from '../../../components/ui/Icon.jsx'

export default function MaintenanceForm({ fleet, onClose, onDone }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <Modal title="Log a service request" eyebrow="MAINTENANCE LEDGER" onClose={onClose}><form className="staff-form" onSubmit={async e => { e.preventDefault(); const data = new FormData(e.currentTarget); setBusy(true); setError(''); try { await api('/mechanic/maintenance', { method: 'POST', body: Object.fromEntries(data) }); await onDone('Service request logged.') } catch (e) { setError(e.message) } finally { setBusy(false) } }}><fieldset disabled={busy}><label className="form-field">Vehicle<select name="vehicleId">{fleet.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label><label className="form-field">Service category<select name="type"><option>Maintenance request</option><option>Repair</option><option>Oil change</option></select></label><label className="form-field">Description<textarea name="description" maxLength={1500} required rows={3} /></label><label className="form-field">Due date (optional)<input name="dueDate" type="date" /></label>{error && <p className="error-banner" role="alert">{error}</p>}<button className="button button-dark" disabled={busy}>Save service request<Icon name="check" size={18} /></button></fieldset></form></Modal>
}

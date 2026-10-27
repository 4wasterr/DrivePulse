import ValidatedField from '../../../components/ui/ValidatedField.jsx'
import ValidatedForm from '../../../components/ui/ValidatedForm.jsx'
import { useState } from 'react'
import Modal from '../../../components/ui/Modal.jsx'
import { api } from '../../../api.js'
import Icon from '../../../components/ui/Icon.jsx'

export default function StatusForm({ vehicle, onClose, onDone }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <Modal draftKey={`status:${vehicle.id}`} title="Update vehicle status" eyebrow={vehicle.name} onClose={onClose}><p className="workspace-muted">To restore availability, complete a safe clearance inspection with fresh condition photos.</p><ValidatedForm className="staff-form" onSubmit={async e => { e.preventDefault(); const data = new FormData(e.currentTarget); setBusy(true); setError(''); try { await api(`/mechanic/vehicles/${vehicle.id}/status`, { method: 'POST', body: { version: vehicle.version, ...Object.fromEntries(data) } }); await onDone('Vehicle hold saved. Existing dispatch passes were invalidated.') } catch (e) { setError(e.message) } finally { setBusy(false) } }}><fieldset disabled={busy}><label className="form-field">Status<ValidatedField as="select" name="status"><option>Under Inspection</option><option>Out of Service</option></ValidatedField></label><label className="form-field">Reason<ValidatedField as="textarea" required name="reason" maxLength={1000} rows={3} /></label>{error && <p className="error-banner" role="alert">{error}</p>}<button className="button button-dark" disabled={busy}>Save vehicle status<Icon name="check" size={18} /></button></fieldset></ValidatedForm></Modal>
}

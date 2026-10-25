import ValidatedField from '../../../components/ui/ValidatedField.jsx'
import ValidatedForm from '../../../components/ui/ValidatedForm.jsx'
import { useState } from 'react'
import Modal from '../../../components/ui/Modal.jsx'
import { vehicleName } from '../../../utils/workspace.js'
import { api } from '../../../api.js'
import Icon from '../../../components/ui/Icon.jsx'

export default function ServiceUpdate({ record: m, onClose, onDone }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), completing = m.status === 'In progress'
  return <Modal title={completing ? 'Complete service work' : 'Start service work'} eyebrow={vehicleName(m.vehicleId)} onClose={onClose}><p className="workspace-muted">{m.type} · {m.description}</p><ValidatedForm className="staff-form" onSubmit={async e => { e.preventDefault(); const data = new FormData(e.currentTarget); setBusy(true); setError(''); try { await api(`/mechanic/maintenance/${m.id}`, { method: 'POST', body: { version: m.version, status: completing ? 'Completed' : 'In progress', note: data.get('note'), cost: Number(data.get('cost')), reference: data.get('reference') } }); await onDone(completing ? 'Service completed. A mechanic must inspect and clear the vehicle before release.' : 'Service started. Vehicle release is blocked.') } catch (e) { setError(e.message) } finally { setBusy(false) } }}><fieldset disabled={busy}><label className="form-field">Work notes<ValidatedField as="textarea" name="note" required maxLength={1500} rows={3} /></label>{completing && <><label className="form-field">Actual expenditure (PHP)<ValidatedField type="number" name="cost" min="0" max="1000000000" step="0.01" required /></label><label className="form-field">Invoice / service reference<ValidatedField name="reference" maxLength={150} required /></label></>}{error && <p className="error-banner" role="alert">{error}</p>}<button className="button button-dark" disabled={busy}>{completing ? 'Complete & record expenditure' : 'Start maintenance'}<Icon name="check" size={18} /></button></fieldset></ValidatedForm></Modal>
}

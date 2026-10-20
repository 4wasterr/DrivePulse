import { useState } from 'react'
import Modal from '../../../components/ui/Modal.jsx'
import { api } from '../../../api.js'
import Icon from '../../../components/ui/Icon.jsx'

export default function DecisionForm({ title, description, path, version, decisions = false, onClose, onDone }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <Modal title={title} eyebrow="OPERATIONS MANAGER · AUDITED DECISION" onClose={onClose}><p className="workspace-muted">{description}</p><form className="staff-form" onSubmit={async e => { e.preventDefault(); const data = new FormData(e.currentTarget), decision = e.nativeEvent.submitter?.value; setBusy(true); setError(''); try { await api(path, { method: 'POST', body: { version, reason: data.get('reason'), ...(decisions ? { decision } : {}) } }); await onDone('Manager decision recorded in the activity log.') } catch (e) { setError(e.message) } finally { setBusy(false) } }}><fieldset disabled={busy}><label className="form-field">Decision reason<textarea name="reason" required maxLength={1500} rows={4} /></label>{error && <p className="error-banner" role="alert">{error}</p>}<div className="review-actions">{decisions && <button className="button button-outline" value="rejected" disabled={busy}>Reject request</button>}<button className="button button-dark" value="approved" disabled={busy}>{decisions ? 'Approve request' : 'Record override'}<Icon name="check" size={17} /></button></div></fieldset></form></Modal>
}

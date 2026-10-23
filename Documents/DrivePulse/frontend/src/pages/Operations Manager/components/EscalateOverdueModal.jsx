import { useState } from 'react'
import Modal from '../../../components/ui/Modal.jsx'
import Icon from '../../../components/ui/Icon.jsx'
import { api } from '../../../api.js'

export default function EscalateOverdueModal({ bookingId, onClose, onDone }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleEscalate() {
    setBusy(true)
    setError('')
    try {
      await api(`/manager/bookings/${encodeURIComponent(bookingId)}/escalate-overdue`, {
        method: 'POST'
      })
      await onDone(`Overdue rental ${bookingId} escalated. Demand alert and incident record recorded in compliance audit log.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Escalate overdue rental" eyebrow={`ANOMALY INCIDENT · ${bookingId}`} onClose={onClose}>
      <div style={{ padding: '6px 0' }}>
        <p className="workspace-muted" style={{ marginBottom: '14px' }}>
          This vehicle has exceeded its scheduled return deadline without an approved extension. Escalating this incident executes the following governance actions:
        </p>

        <ul style={{ listStyle: 'disc', paddingLeft: '20px', marginBottom: '18px', fontSize: '13px', color: '#374151', lineHeight: '1.6' }}>
          <li>Records a high-priority <strong>Policy override / Overdue escalation</strong> forensic alert in the central audit trail.</li>
          <li>Locks the booking record against unverified walk-in modifications.</li>
          <li>Generates an official demand reference for counter recovery and legal turnover.</li>
        </ul>

        {error && <div className="error-banner" role="alert" style={{ marginBottom: '14px' }}>{error}</div>}

        <div style={{ display: 'flex', gap: '10px' }}>
          <button type="button" className="button button-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="button button-dark" style={{ flex: 1 }} onClick={handleEscalate} disabled={busy}>
            <Icon name="shield" size={17} />
            {busy ? 'Issuing escalation notice…' : 'Confirm & Issue Demand Escalation'}
          </button>
        </div>
      </div>
    </Modal>
  )
}


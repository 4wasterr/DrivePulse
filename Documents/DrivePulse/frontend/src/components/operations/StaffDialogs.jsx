import { useState } from 'react'
import ReportPreview from './InspectionReportModal.jsx'
import Modal from '../ui/Modal.jsx'
import ReportList from './InspectionReports.jsx'
import MaintenanceList from './MaintenanceList.jsx'
import { fmt } from '../../utils/workspace.js'
import { api } from '../../api.js'
import { money } from '../../data.js'
import Icon from '../ui/Icon.jsx'

function RateModal({ vehicle, onClose, onDone }) {
  const [rate, setRate] = useState(vehicle.rate), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const pct = Math.abs(Number(rate) - vehicle.rate) / vehicle.rate * 100
  return <Modal title={`Modify daily rate · ${vehicle.name}`} eyebrow="OPERATIONS MANAGER · RATE OVERRIDE" onClose={onClose}>
    <form className="staff-form" onSubmit={async e => {
      e.preventDefault(); const data = new FormData(e.currentTarget); setBusy(true); setError('')
      try {
        await api(`/manager/vehicles/${vehicle.id}/rate`, { method: 'PATCH', body: { version: vehicle.version, rate: Number(rate), reason: data.get('reason') } })
        await onDone(`Updated ${vehicle.name} daily rate to ${money(Number(rate))}.${pct > 20 ? ' Threshold alert (>20% change) recorded in Audit Logs.' : ''}`)
      } catch (err) { setError(err.message) } finally { setBusy(false) }
    }}>
      <fieldset disabled={busy}>
        <p className="workspace-muted">Current daily rate: <strong>{money(vehicle.rate)}</strong>. Rate changes exceeding 20% are automatically flagged on the Threshold Alerts widget.</p>
        <label className="form-field">New daily rate (PHP)<input type="number" required min="500" max="100000" step="100" value={rate} onChange={e => setRate(e.target.value)} /></label>
        {pct > 20 && <p className="info-note"><Icon name="info" size={16} /><span>This is a <strong>{pct.toFixed(1)}%</strong> rate change (over the 20% threshold) and will generate a system audit alert.</span></p>}
        <label className="form-field">Reason for rate modification<textarea name="reason" required maxLength={1000} rows={3} placeholder="Explain seasonal adjustment, market rate update, or promotional pricing." /></label>
        {error && <p className="error-banner" role="alert">{error}</p>}
        <button className="button button-dark" disabled={busy}><Icon name="check" size={17} />{busy ? 'Saving…' : 'Save rate modification'}</button>
      </fieldset>
    </form>
  </Modal>
}

function DecommissionModal({ vehicle, mechanic, onClose, onDone }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <Modal title={mechanic ? `Request decommission · ${vehicle.name}` : `Confirm decommission · ${vehicle.name}`} eyebrow={mechanic ? 'FLEET MECHANIC · ARCHIVE REQUEST' : 'OPERATIONS MANAGER · ARCHIVE CONFIRMATION'} onClose={onClose}>
    <form className="staff-form" onSubmit={async e => {
      e.preventDefault(); const data = new FormData(e.currentTarget); setBusy(true); setError('')
      try {
        await api(`/vehicles/${vehicle.id}/decommission`, { method: 'POST', body: { version: vehicle.version, reason: data.get('reason') } })
        await onDone(mechanic ? `Decommission request sent to Operations Manager for ${vehicle.name}.` : `${vehicle.name} decommissioned and moved to Data Archives.`)
      } catch (err) { setError(err.message) } finally { setBusy(false) }
    }}>
      <fieldset disabled={busy}>
        <p className="workspace-muted">{mechanic ? 'Standard staff can flag a vehicle for decommissioning; an Operations Manager confirms the archive action.' : 'Decommissioning removes this vehicle from active booking inventory and places it in Data Archives where it can be restored if needed.'}</p>
        <label className="form-field">Decommission reason<textarea name="reason" required maxLength={1000} rows={3} defaultValue={vehicle.decommissionRequested?.reason || ''} placeholder="Record mechanical retirement, end-of-service life, or major damage." /></label>
        {error && <p className="error-banner" role="alert">{error}</p>}
        <button className="button button-dark" disabled={busy}><Icon name="check" size={17} />{mechanic ? 'Submit decommission request' : 'Confirm vehicle decommission'}</button>
      </fieldset>
    </form>
  </Modal>
}

export default function StaffDialogs({ dialog, setDialog, inspections, maintenance, mechanic, done }) {
  return <>
    {dialog?.kind === 'report' && <ReportPreview report={dialog.report} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'rate' && <RateModal vehicle={dialog.vehicle} onClose={() => setDialog(null)} onDone={done} />}
    {dialog?.kind === 'decommission' && <DecommissionModal vehicle={dialog.vehicle} mechanic={mechanic} onClose={() => setDialog(null)} onDone={done} />}
    {dialog?.kind === 'vehicle-history' && <Modal title={dialog.vehicle.name} eyebrow="VEHICLE HISTORY" wide onClose={() => setDialog(null)}>
      <h3>Inspections</h3>
      <ReportList inspections={inspections.filter(i => i.vehicleId === dialog.vehicle.id)} onOpen={r => setDialog({ kind: 'report', report: r })} />
      <h3 className="staff-caption">Maintenance</h3>
      <MaintenanceList records={maintenance.filter(m => m.vehicleId === dialog.vehicle.id)} />
      <h3 className="staff-caption">Status & rate changes</h3>
      {[...(dialog.vehicle.activity || [])].reverse().map(a => <article className="staff-ledger-row" key={a.id}><div><h4>{a.action}</h4><p>{a.note}</p><small>{a.by} · {fmt(a.at)}</small></div></article>)}
    </Modal>}
  </>
}

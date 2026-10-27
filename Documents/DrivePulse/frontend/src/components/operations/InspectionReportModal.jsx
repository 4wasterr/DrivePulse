import checklist from '../../../../shared/inspectionChecklist.json'
import { conditionLabel } from '../../../../shared/inspection.mjs'
import VehicleIdentity from '../fleet/VehicleIdentity.jsx'
import Modal from '../ui/Modal.jsx'
import { vehicleName, fmt } from '../../utils/workspace.js'
import Tag from '../workspace/StaffTag.jsx'

export default function ReportPreview({ report: r, onClose, onBack }) {
  return <Modal title={vehicleName(r.vehicleId)} eyebrow={`${r.type.toUpperCase()} · ${r.bookingId || 'SAFETY CLEARANCE'}`} wide onClose={onClose}>
    <p className="inspection-mechanic">Inspecting mechanic: <strong>{r.by}</strong> · {fmt(r.at)} PHT</p>
    <section aria-label="Vehicle details"><h3>01 / Vehicle details</h3><VehicleIdentity vehicle={r.vehicle} vehicleId={r.vehicleId} />
      <div className="staff-report-readings"><div><span>Odometer</span><strong>{r.odometer.toLocaleString()} km</strong></div><div><span>Fuel / battery</span><strong>{r.fuelLevel}%</strong></div></div>
      {r.mileageConsumption != null && <section className="mileage-summary" aria-label="Trip mileage calculation"><h4>Total mileage consumption</h4><p>Dispatch: {r.dispatchOdometer.toLocaleString()} km · Return: {r.odometer.toLocaleString()} km</p><strong>{r.mileageConsumption.toLocaleString()} km used</strong></section>}
      <h4>Tire pressure (PSI)</h4><p>Front L {r.tirePressure.frontLeft} · Front R {r.tirePressure.frontRight} · Rear L {r.tirePressure.rearLeft} · Rear R {r.tirePressure.rearRight}</p>
      <p>{r.driverVerification === 'matched' ? `Driver matched: ${r.driverName || 'Named reservation driver'}` : r.driverVerification === 'not-applicable' ? 'Vehicle identity verified for safety clearance' : 'Driver verification recorded under the earlier inspection workflow'}</p>
    </section>
    <section aria-label="Vehicle condition"><h3>02 / Vehicle condition</h3><dl className="inspection-review">{checklist.map(({ key, label }) => <div key={key}><dt>{label}</dt><dd>{conditionLabel(r.conditionRatings?.[key] ?? r.checks?.[key])}</dd></div>)}<div><dt>Interior cleanliness</dt><dd>{r.cleanliness}</dd></div></dl></section>
    <section aria-label="Damage status"><h3>03 / Damage status</h3><p>{r.damageFlag ? 'Damage / repair required' : 'No damage observed'}</p><p>{r.scratches}</p>
      <div className="staff-proof-grid">{r.photos.map(photo => <figure key={photo.id}><a href={`/api/documents/${encodeURIComponent(photo.id)}`} target="_blank" rel="noreferrer"><img src={`/api/documents/${encodeURIComponent(photo.id)}`} alt={`${photo.view} condition proof for ${vehicleName(r.vehicleId)}`} /></a><figcaption>{photo.view} · {photo.name}</figcaption></figure>)}</div>
    </section>
    <section aria-label="Dispatch decision"><h3>04 / Dispatch decision</h3><div className="workspace-section-heading"><strong>{r.dispatchDecision || (r.status === 'approved' ? 'Approved by mechanic' : 'Do not dispatch')}</strong><Tag>{r.status}</Tag></div>{r.note && <p className="info-note">{r.note}</p>}<p className="workspace-muted">Booking Agent release checks still apply before dispatch.</p></section>
    {onBack && <div className="form-actions"><button type="button" className="button button-outline" onClick={onBack}>Return to vehicle history</button></div>}
  </Modal>
}

import ValidatedField from '../../../components/ui/ValidatedField.jsx'
import ValidatedForm from '../../../components/ui/ValidatedForm.jsx'
import { useState } from 'react'
import { validateFile } from '../../../storage.js'
import { uploadConditionPhoto, api } from '../../../api.js'
import Modal from '../../../components/ui/Modal.jsx'
import Icon from '../../../components/ui/Icon.jsx'
import VehicleIdentity from '../../../components/fleet/VehicleIdentity.jsx'
import checklist from '../../../../../shared/inspectionChecklist.json'

export default function InspectionForm({ operations, initial, onClose, onDone }) {
  const initialType = initial.type || (operations.bookings.some(b => b.vehicleId === initial.vehicleId && ['Pending Approval', 'Ready for Dispatch'].includes(b.status)) || !initial.vehicleId ? 'pre-dispatch' : 'clearance')
  const [type, setType] = useState(initialType), [vehicleId, setVehicleId] = useState(initial.booking?.vehicleId || initial.vehicleId || operations.fleet[0]?.id || '')
  const [bookingId, setBookingId] = useState(initial.booking?.id || ''), [busy, setBusy] = useState(false)
  const vehicle = operations.fleet.find(v => v.id === vehicleId)
  const eligible = operations.bookings.filter(b => b.vehicleId === vehicleId && (type === 'pre-dispatch' ? ['Pending Approval', 'Ready for Dispatch'].includes(b.status) : b.status === 'Completed' && b.returnedAt))
  const chosen = eligible.find(b => b.id === bookingId) || eligible[0]
  return <Modal title="Digital vehicle inspection" eyebrow="FLEET MECHANIC · INDIVIDUAL VERIFICATION" wide onClose={onClose}>
    {!vehicle ? <p>No active vehicles are available for inspection.</p> : <>
      <VehicleIdentity vehicle={vehicle} />
      <fieldset className="inspection-selector" disabled={busy}><div className="form-grid">
        <label className="form-field"><span>Inspection type</span><ValidatedField as="select" name="type" value={type} onChange={e => { setType(e.target.value); setBookingId('') }}><option value="pre-dispatch">Pre-dispatch / handover</option><option value="post-return">Post-return</option><option value="clearance">Safety / maintenance clearance</option></ValidatedField></label>
        <label className="form-field"><span>Vehicle</span><ValidatedField as="select" name="vehicleId" value={vehicleId} onChange={e => { setVehicleId(e.target.value); setBookingId('') }}>{operations.fleet.map(v => <option key={v.id} value={v.id}>{v.fleetCode || v.id} · {v.name} · {v.plate || 'Plate not recorded'}</option>)}</ValidatedField></label>
        {type !== 'clearance' && <label className="form-field span-2"><span>Reservation</span><ValidatedField as="select" name="reservationId" required value={chosen?.id || ''} onChange={e => setBookingId(e.target.value)}><option value="" disabled>Select a reservation</option>{eligible.map(b => <option value={b.id} key={b.id}>{b.id} · {b.start} – {b.end} · {b.status}</option>)}</ValidatedField></label>}
      </div></fieldset>
      {type !== 'clearance' && !chosen && <p className="info-note">No eligible reservation for this inspection type. Use safety clearance for service work.</p>}
      <InspectionChecklist key={vehicleId + ':' + type + ':' + (chosen?.id || '')} vehicle={vehicle} type={type} booking={chosen} busy={busy} setBusy={setBusy} onDone={onDone} />
    </>}
  </Modal>
}

function InspectionChecklist({ vehicle, type, booking, busy, setBusy, onDone }) {
  const [outcome, setOutcome] = useState('approved'), [damageFlag, setDamageFlag] = useState(false), [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError('')
    try {
      const checks = Object.fromEntries(checklist.map(({ key }) => [key, data.get(key) === 'on']))
      if (!Object.values(checks).every(Boolean)) throw new Error('Verify every checklist item individually.')
      const files = ['exterior', 'interior'].map(view => ({ view, file: data.get(view + 'Photo') }))
      for (const { file } of files) { const problem = validateFile(file); if (problem || !file.type.startsWith('image/')) throw new Error(problem || 'Upload separate exterior and interior photos.') }
      const photos = []
      for (const { view, file } of files) { const photo = await uploadConditionPhoto(vehicle.id, file); photos.push({ id: photo.id, view }) }
      const result = await api('/mechanic/inspections', { method: 'POST', body: {
        vehicleId: vehicle.id, vehicleVersion: vehicle.version, type, bookingId: type === 'clearance' ? null : booking?.id, version: booking?.version,
        odometer: Number(data.get('odometer')), fuelLevel: Number(data.get('fuelLevel')),
        tirePressure: Object.fromEntries(['frontLeft', 'frontRight', 'rearLeft', 'rearRight'].map(key => [key, Number(data.get(key))])),
        cleanliness: data.get('cleanliness'), scratches: data.get('scratches'), note: data.get('note'), outcome, damageFlag, checks, photos
      } })
      await onDone(outcome === 'unsafe' ? 'Inspection saved. Vehicle release is blocked.' : result.cleanReturn ? 'Inspection saved. Clean return verified and Security Deposit release recorded.' : 'Inspection saved with condition photo proof.')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return <ValidatedForm className="staff-form inspection-form" onSubmit={submit}><fieldset disabled={busy}>
    <h3>01 / Measured readings</h3>
    <div className="form-grid">
      <label className="form-field"><span>Odometer (km)</span><ValidatedField name="odometer" type="number" required min={vehicle.odometer ?? 0} max="10000000" step="0.01" placeholder={vehicle.odometer == null ? 'Read at the vehicle' : 'Last reading: ' + vehicle.odometer} /></label>
      <label className="form-field"><span>Fuel / battery level (%)</span><ValidatedField name="fuelLevel" type="number" required min="0" max="100" step="0.01" /></label>
      {[['frontLeft', 'Front left'], ['frontRight', 'Front right'], ['rearLeft', 'Rear left'], ['rearRight', 'Rear right']].map(([key, label]) => <label className="form-field" key={key}><span>{label} tire pressure (PSI)</span><ValidatedField name={key} type="number" required min="0" max="100" step="0.1" /></label>)}
    </div>
    <h3>02 / Condition record</h3>
    <label className="form-field"><span>Exterior condition / damage locations</span><ValidatedField as="textarea" name="scratches" required maxLength={1500} rows={3} placeholder="Describe observed damage and its location, or explicitly record no visible damage." /></label>
    <label className="form-field"><span>Interior condition</span><ValidatedField as="select" name="cleanliness" required defaultValue=""><option value="" disabled>Select observed condition</option><option>Clean</option><option>Needs cleaning</option><option>Damaged</option></ValidatedField></label>
    <label className="checkbox-label"><ValidatedField type="checkbox" checked={damageFlag} onChange={e => setDamageFlag(e.target.checked)} />Damage observed / requires repair{type === 'post-return' && ' (holds Security Deposit for review)'}</label>
    <h3>03 / Individual verification</h3>
    <div className="staff-checklist">{checklist.map(({ key, label }) => <label className="checkbox-label" key={key}><ValidatedField type="checkbox" name={key} required />{label}</label>)}</div>
    <h3>04 / Fresh photo proof</h3>
    <p className="workspace-muted">Separate exterior and interior photos · JPG, PNG or WebP · up to 4 MB each.</p>
    <div className="form-grid">{['exterior', 'interior'].map(view => <label className="form-field staff-photo-input" key={view}><span><Icon name="camera" size={18} />{view === 'exterior' ? 'Exterior photo' : 'Interior photo'}</span><ValidatedField type="file" name={view + 'Photo'} accept="image/jpeg,image/png,image/webp" required /></label>)}</div>
    <h3>05 / Assessment</h3>
    <label className="form-field"><span>Inspection outcome</span><ValidatedField as="select" name="outcome" value={outcome} onChange={e => setOutcome(e.target.value)}><option value="approved">Safe / approved</option><option value="unsafe">Unsafe / Out of Service</option></ValidatedField></label>
    <label className="form-field"><span>Inspection notes{outcome === 'unsafe' ? ' (required)' : ''}</span><ValidatedField as="textarea" name="note" required={outcome === 'unsafe'} maxLength={1500} rows={3} /></label>
    {type === 'post-return' && <p className="info-note">An approved clean return with full fuel and no damage flags qualifies for automatic Security Deposit release.</p>}
    {error && <p className="error-banner" role="alert">{error}</p>}
    <footer className="inspection-footer"><button type="submit" className="button button-dark" disabled={busy || type !== 'clearance' && !booking}><Icon name="check" size={18} />{busy ? 'Saving…' : 'Save Inspection'}</button></footer>
  </fieldset></ValidatedForm>
}

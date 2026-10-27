import useDraftState from '../../../hooks/useDraftState.js'
import ValidatedField from '../../../components/ui/ValidatedField.jsx'
import ValidatedForm from '../../../components/ui/ValidatedForm.jsx'
import { useState } from 'react'
import { validateFile } from '../../../storage.js'
import { uploadConditionPhoto, api } from '../../../api.js'
import Modal from '../../../components/ui/Modal.jsx'
import Icon from '../../../components/ui/Icon.jsx'
import VehicleIdentity from '../../../components/fleet/VehicleIdentity.jsx'
import checklist from '../../../../../shared/inspectionChecklist.json'
import { CONDITION_STATUSES, conditionProblem } from '../../../../../shared/inspection.mjs'

export default function InspectionForm({ operations, initial, onClose, onDone }) {
  const initialType = initial.type || (operations.bookings.some(b => b.vehicleId === initial.vehicleId && ['Pending Approval', 'Ready for Dispatch'].includes(b.status)) || !initial.vehicleId ? 'pre-dispatch' : 'clearance')
  const [type, setType] = useDraftState('inspection', 'type', initialType), [vehicleId, setVehicleId] = useDraftState('inspection', 'vehicleId', initial.booking?.vehicleId || initial.vehicleId || operations.fleet[0]?.id || '')
  const [bookingId, setBookingId] = useDraftState('inspection', 'bookingId', initial.booking?.id || ''), [busy, setBusy] = useState(false)
  const vehicle = operations.fleet.find(v => v.id === vehicleId)
  const eligible = operations.bookings.filter(b => b.vehicleId === vehicleId && (type === 'pre-dispatch' ? ['Pending Approval', 'Ready for Dispatch'].includes(b.status) : b.status === 'Completed' && b.returnedAt))
  const chosen = eligible.find(b => b.id === bookingId) || eligible[0]
  return <Modal draftKey={'inspection'} title="Digital vehicle inspection" eyebrow="FLEET MECHANIC · INDIVIDUAL VERIFICATION" wide onClose={onClose}>
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
  const [outcome, setOutcome] = useDraftState(`inspection:checklist:${vehicle.id}:${type}:${booking?.id || ''}`, 'outcome', 'approved'), [damageFlag, setDamageFlag] = useDraftState(`inspection:checklist:${vehicle.id}:${type}:${booking?.id || ''}`, 'damageFlag', false), [error, setError] = useState('')
  const [step, setStep] = useDraftState(`inspection:checklist:${vehicle.id}:${type}:${booking?.id || ''}`, 'step', 0), [driverVerification, setDriverVerification] = useDraftState(`inspection:checklist:${vehicle.id}:${type}:${booking?.id || ''}`, 'driverVerification', '')
  const [checks, setChecks] = useDraftState(`inspection:checklist:${vehicle.id}:${type}:${booking?.id || ''}`, 'checks', {})
  const [photos, setPhotos] = useDraftState(`inspection:checklist:${vehicle.id}:${type}:${booking?.id || ''}`, 'photos', {}), [uploading, setUploading] = useState(0)
  async function upload(view, file) {
    if (!file) return
    const problem = validateFile(file)
    if (problem || !file.type.startsWith('image/')) { setError(problem || 'Choose a condition image.'); return }
    setUploading(count => count + 1); setError('')
    try { const photo = await uploadConditionPhoto(vehicle.id, file); setPhotos(previous => ({ ...previous, [view]: { id: photo.id, view, name: file.name } })) }
    catch (err) { setError(err.message) }
    finally { setUploading(count => count - 1) }
  }
  async function submit(event) {
    event.preventDefault()
    if (step === 0) {
      if (!driverVerification) { setError('Complete individual / driver verification.'); return }
      setStep(1); setError(''); return
    }
    const data = new FormData(event.currentTarget); setBusy(true); setError('')
    try {
      const problem = conditionProblem(checks, checklist, outcome)
      if (problem) throw new Error(problem)
      if (uploading || !photos.exterior || !photos.interior) throw new Error('Upload separate exterior and interior photos and wait for both uploads to finish.')
      const result = await api('/mechanic/inspections', { method: 'POST', body: {
        vehicleId: vehicle.id, vehicleVersion: vehicle.version, type, bookingId: type === 'clearance' ? null : booking?.id, version: booking?.version,
        odometer: Number(data.get('odometer')), fuelLevel: Number(data.get('fuelLevel')),
        tirePressure: Object.fromEntries(['frontLeft', 'frontRight', 'rearLeft', 'rearRight'].map(key => [key, Number(data.get(key))])),
        cleanliness: data.get('cleanliness'), scratches: data.get('scratches'), note: data.get('note'), outcome, damageFlag, checks, photos: Object.values(photos), driverVerification
      } })
      await onDone(outcome === 'unsafe' ? 'Inspection saved. Vehicle release is blocked.' : result.cleanReturn ? 'Inspection saved. Clean return verified and Security Deposit release recorded.' : 'Inspection saved with condition photo proof.')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return <ValidatedForm draftKey={`${vehicle.id}:${type}:${booking?.id || ''}`} className="staff-form inspection-form" onSubmit={submit}><fieldset disabled={busy}>
    <div className="booking-steps" aria-label="Inspection progress"><span aria-current={step === 0 ? 'step' : undefined}>01 / Individual / driver verification</span><span aria-current={step === 1 ? 'step' : undefined}>02 / Vehicle condition record</span></div>
    <fieldset hidden={step !== 0} disabled={step !== 0}>
      <h3>Individual / driver verification</h3>
      {type !== 'clearance' && <p className="info-note">Driver: {booking?.driverName || booking?.renter?.name || 'See reservation'} · Agent ID review: {booking?.verificationStatus || 'Pending review'}. Match the individual and presented identification to the reservation before proceeding.</p>}
      <label className="form-field"><span>{type === 'clearance' ? 'Technician verification' : 'Driver / identification match'}</span><ValidatedField as="select" name="driverVerification" required value={driverVerification} onChange={e => { setDriverVerification(e.target.value); setError('') }}><option value="" disabled>Select verification result</option><option value={type === 'clearance' ? 'not-applicable' : 'matched'}>{type === 'clearance' ? 'Vehicle identity verified; no driver for safety clearance' : 'Individual and identification match the named driver'}</option></ValidatedField></label>
    </fieldset>
    <fieldset hidden={step !== 1} disabled={step !== 1}>
    <h3>Measured readings</h3>
    <div className="form-grid">
      <label className="form-field"><span>Odometer (km)</span><ValidatedField name="odometer" type="number" required min={vehicle.odometer ?? 0} max="10000000" step="0.01" placeholder={vehicle.odometer == null ? 'Read at the vehicle' : 'Last reading: ' + vehicle.odometer} /></label>
      <label className="form-field"><span>Fuel / battery level (%)</span><ValidatedField name="fuelLevel" type="number" required min="0" max="100" step="0.01" /></label>
      {[['frontLeft', 'Front left'], ['frontRight', 'Front right'], ['rearLeft', 'Rear left'], ['rearRight', 'Rear right']].map(([key, label]) => <label className="form-field" key={key}><span>{label} tire pressure (PSI)</span><ValidatedField name={key} type="number" required min="0" max="100" step="0.1" /></label>)}
    </div>
    <h3>Condition record</h3>
    <label className="form-field"><span>Exterior condition / damage locations</span><ValidatedField as="textarea" name="scratches" required maxLength={1500} rows={3} placeholder="Describe observed damage and its location, or explicitly record no visible damage." /></label>
    <label className="form-field"><span>Interior condition</span><ValidatedField as="select" name="cleanliness" required defaultValue=""><option value="" disabled>Select observed condition</option><option>Clean</option><option>Needs cleaning</option><option>Damaged</option></ValidatedField></label>
    <label className="form-field"><span>Damage observed / requires repair{type === 'post-return' && ' (holds Security Deposit for review)'}</span><ValidatedField as="select" name="damageFlag" value={damageFlag ? 'yes' : 'no'} onChange={e => setDamageFlag(e.target.value === 'yes')}><option value="no">No damage observed</option><option value="yes">Damage / repair required</option></ValidatedField></label>
    <div className="form-grid">{checklist.map(({ key, label }) => <label className="form-field" key={key}><span>{label}</span><ValidatedField as="select" name={key} required value={checks[key] || ''} onChange={e => setChecks(previous => ({ ...previous, [key]: e.target.value }))}><option value="" disabled>Select status</option>{CONDITION_STATUSES.map(status => <option key={status}>{status}</option>)}</ValidatedField></label>)}</div>
    <h3>Fresh photo proof</h3>
    <p className="workspace-muted">Separate exterior and interior photos · JPG, PNG or WebP · up to 4 MB each.</p>
    <div className="form-grid">{['exterior', 'interior'].map(view => <label className="form-field staff-photo-input" key={view}><span><Icon name="camera" size={18} />{view === 'exterior' ? 'Exterior photo' : 'Interior photo'}</span><ValidatedField type="file" name={view + 'Photo'} accept="image/jpeg,image/png,image/webp" disabled={uploading > 0} onChange={e => { upload(view, e.target.files[0]); e.target.value = '' }} /><small role="status">{photos[view] ? `Uploaded: ${photos[view].name}` : 'Upload required'}</small></label>)}</div>
    {uploading > 0 && <p role="status">Uploading condition photo…</p>}
    <h3>Assessment</h3>
    <label className="form-field"><span>Inspection outcome</span><ValidatedField as="select" name="outcome" value={outcome} onChange={e => setOutcome(e.target.value)}><option value="approved">Safe / approved</option><option value="unsafe">Unsafe / Out of Service</option></ValidatedField></label>
    <label className="form-field"><span>Inspection notes{outcome === 'unsafe' ? ' (required)' : ''}</span><ValidatedField as="textarea" name="note" required={outcome === 'unsafe'} maxLength={1500} rows={3} /></label>
    {type === 'post-return' && <p className="info-note">An approved clean return with full fuel and no damage flags qualifies for automatic Security Deposit release.</p>}
    </fieldset>
    {error && <p className="error-banner" role="alert">{error}</p>}
    <footer className="inspection-footer">{step === 1 && <button type="button" className="button button-outline" disabled={busy || uploading > 0} onClick={() => { setStep(0); setError('') }}>Back to verification</button>}<button type="submit" className="button button-dark" disabled={busy || uploading > 0 || type !== 'clearance' && !booking || step === 1 && (!photos.exterior || !photos.interior)}><Icon name="check" size={18} />{busy ? 'Saving…' : step === 0 ? 'Continue to condition record' : 'Save Inspection'}</button></footer>
  </fieldset></ValidatedForm>
}

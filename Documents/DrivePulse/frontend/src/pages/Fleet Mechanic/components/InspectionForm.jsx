import useDraftState from '../../../hooks/useDraftState.js'
import ValidatedField from '../../../components/ui/ValidatedField.jsx'
import ValidatedForm from '../../../components/ui/ValidatedForm.jsx'
import { useContext, useState } from 'react'
import { DraftOwnerContext, clearDraftScope } from '../../../utils/drafts.js'
import { validateFile } from '../../../storage.js'
import { uploadConditionPhoto, api } from '../../../api.js'
import Modal from '../../../components/ui/Modal.jsx'
import Icon from '../../../components/ui/Icon.jsx'
import VehicleIdentity from '../../../components/fleet/VehicleIdentity.jsx'
import checklist from '../../../../../shared/inspectionChecklist.json'
import { CONDITION_RATINGS, conditionLabel, conditionProblem } from '../../../../../shared/inspection.mjs'
import { mileageConsumption } from '../../../../../shared/mileage.mjs'
import { inspectionBooking, inspectionTypeForVehicle } from '../../../utils/inspectionBooking.js'

const stages = ['Vehicle details', 'Vehicle condition', 'Damage status', 'Dispatch decision']
const corners = [['frontLeft', 'Front left'], ['frontRight', 'Front right'], ['rearLeft', 'Rear left'], ['rearRight', 'Rear right']]

export default function InspectionForm({ operations, initial, mechanic, onClose, onDone }) {
  const initialVehicleId = initial.booking?.vehicleId || initial.vehicleId || operations.fleet[0]?.id || ''
  const initialType = initial.type || (initial.booking ? initial.booking.status === 'Completed' ? 'post-return' : 'pre-dispatch' : inspectionTypeForVehicle(operations.bookings, initialVehicleId))
  const [type, setType] = useState(initialType)
  const [vehicleId, setVehicleId] = useState(initialVehicleId)
  const [busy, setBusy] = useState(false)
  const vehicle = operations.fleet.find(v => v.id === vehicleId)
  const chosen = inspectionBooking(operations.bookings, vehicleId, type, initial.booking?.id)
  const missingBooking = type !== 'clearance' && !chosen
  const onRental = operations.bookings.some(booking => booking.vehicleId === vehicleId && booking.status === 'On Rental')
  const suggestedType = inspectionTypeForVehicle(operations.bookings, vehicleId)
  const details = <div className="form-grid">
    <label className="form-field">Inspection type<ValidatedField as="select" name="type" value={type} onChange={event => setType(event.target.value)}><option value="pre-dispatch">Pre-dispatch / handover</option><option value="post-return">Post-return</option><option value="clearance">Safety / maintenance clearance</option></ValidatedField></label>
    <label className="form-field">Vehicle<ValidatedField as="select" name="vehicleId" value={vehicleId} onChange={event => setVehicleId(event.target.value)}>{operations.fleet.map(v => <option key={v.id} value={v.id}>{v.fleetCode || v.id} · {v.name} · {v.plate || 'Plate not recorded'}</option>)}</ValidatedField></label>
  </div>
  return <Modal draftKey="inspection" title="Digital vehicle inspection" eyebrow="FLEET MECHANIC" wide onClose={onClose}>
    {!vehicle ? <p>No active vehicles are available for inspection.</p> : missingBooking ? <>
      {details}<VehicleIdentity vehicle={vehicle} />
      <p className="info-note" role="status">{onRental ? 'This vehicle is still on rental. Record its return in the Booking Agent workspace before completing a post-return inspection.' : type === 'post-return' ? 'No returned trip is awaiting inspection for this vehicle.' : 'No upcoming trip is awaiting a pre-dispatch inspection for this vehicle.'}</p>
      {!onRental && suggestedType !== type && <button type="button" className="button button-outline" onClick={() => setType(suggestedType)}>{suggestedType === 'clearance' ? 'Start safety / maintenance clearance' : suggestedType === 'post-return' ? 'Open pending post-return inspection' : 'Open pending pre-dispatch inspection'}</button>}
    </> : <InspectionChecklist key={`${vehicleId}:${type}:${chosen?.id || ''}`} vehicle={vehicle} type={type} booking={chosen} mechanic={mechanic} details={details} busy={busy} setBusy={setBusy} onDone={onDone} />}
  </Modal>
}

function InspectionChecklist({ vehicle, type, booking, mechanic, details, busy, setBusy, onDone }) {
  const owner = useContext(DraftOwnerContext)
  const scope = `inspection:checklist:${vehicle.id}:${type}:${booking?.id || ''}:ratings-v1`
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(0)
  const [readings, setReadings] = useDraftState(scope, 'readings', { odometer: '', fuelLevel: '', frontLeft: '', frontRight: '', rearLeft: '', rearRight: '' })
  const [driverVerification, setDriverVerification] = useDraftState(scope, 'driverVerification', '')
  const [ratings, setRatings] = useDraftState(scope, 'ratings', {})
  const [cleanliness, setCleanliness] = useDraftState(scope, 'cleanliness', '')
  const [damageStatus, setDamageStatus] = useDraftState(scope, 'damageStatus', '')
  const [scratches, setScratches] = useDraftState(scope, 'scratches', '')
  const [photos, setPhotos] = useDraftState(scope, 'photos', {})
  const [outcome, setOutcome] = useDraftState(scope, 'outcome', '')
  const [note, setNote] = useDraftState(scope, 'note', '')
  const dispatchOdometer = booking?.dispatchOdometer ?? booking?.inspection?.odometer
  let distance = null, mileageError = ''
  if (type === 'post-return') {
    try { distance = mileageConsumption(dispatchOdometer, readings.odometer === '' ? null : Number(readings.odometer)) } catch (error) { mileageError = error.message }
  }
  const safeProblem = conditionProblem(ratings, checklist, 'approved') || (cleanliness !== 'Clean' ? 'Clean or repair the interior before approving the vehicle.' : '')
  const updateReading = (key, value) => setReadings(previous => ({ ...previous, [key]: value }))
  const moveTo = next => { setError(''); setStep(next) }

  async function upload(view, file) {
    if (!file) return
    const problem = validateFile(file)
    if (problem || !file.type.startsWith('image/')) { setError(problem || 'Choose a condition image.'); return }
    setUploading(count => count + 1); setError('')
    try { const photo = await uploadConditionPhoto(vehicle.id, file); setPhotos(previous => ({ ...previous, [view]: { id: photo.id, view, name: file.name } })) }
    catch (error) { setError(error.message) }
    finally { setUploading(count => count - 1) }
  }

  async function submit(event) {
    event.preventDefault(); setError('')
    if (step === 0) {
      if (type !== 'clearance' && !booking) { setError('No trip is awaiting this inspection. Reopen the vehicle from the inspection queue.'); return }
      if (mileageError) { setError(mileageError); return }
    }
    if (step === 1) {
      const problem = conditionProblem(ratings, checklist)
      if (problem) { setError(problem); return }
    }
    if (step === 2) {
      if (Object.values(ratings).some(value => value >= 3) && damageStatus !== 'yes') { setError('A rating of 3 or 4 requires damage / repair to be recorded.'); return }
      if (uploading || !photos.exterior || !photos.interior) { setError('Upload separate exterior and interior photos and wait for both uploads to finish.'); return }
    }
    if (step < 3) { moveTo(step + 1); return }
    const problem = conditionProblem(ratings, checklist, outcome) || (outcome === 'approved' ? safeProblem : '') || mileageError
    if (problem) { setError(problem); return }
    setBusy(true)
    try {
      const result = await api('/mechanic/inspections', { method: 'POST', body: {
        vehicleId: vehicle.id, vehicleVersion: vehicle.version, type, bookingId: type === 'clearance' ? null : booking?.id, version: booking?.version,
        odometer: Number(readings.odometer), fuelLevel: Number(readings.fuelLevel),
        tirePressure: Object.fromEntries(corners.map(([key]) => [key, Number(readings[key])])),
        cleanliness, scratches, note, outcome, damageFlag: damageStatus === 'yes', conditionRatings: ratings, photos: Object.values(photos), driverVerification
      } })
      clearDraftScope(owner, scope)
      await onDone(outcome === 'unsafe' ? 'Inspection saved. Do not dispatch; vehicle is Out of Service.' : result.cleanReturn ? 'Inspection and mileage saved. Clean return verified and Security Deposit release recorded.' : 'Condition ratings and mechanic dispatch approval saved. Booking Agent release checks still apply.')
    } catch (error) { setError(error.message) } finally { setBusy(false) }
  }

  return <>
    <ol className="inspection-stages" aria-label="Inspection sequence">{stages.map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined}><span>{String(index + 1).padStart(2, '0')}</span>{label}</li>)}</ol>
    <p className="inspection-mechanic"><Icon name="shield" size={18} />Inspecting mechanic: <strong>{mechanic?.name || 'Signed-in Fleet Mechanic'}</strong></p>
    <ValidatedForm key={step} draftKey={`${scope}:${step}`} className="staff-form inspection-form" onSubmit={submit}><fieldset disabled={busy}>
      <h3>{String(step + 1).padStart(2, '0')} / {stages[step]}</h3>
      {step === 0 && <>
        {details}
        <VehicleIdentity vehicle={vehicle} />
        {type !== 'clearance' && <p className="info-note">Trip: {booking.id} · Driver: {booking.driverName || booking.renter?.name || 'Named booking driver'} · Agent ID review: {booking.verificationStatus || 'Pending review'}. Match the driver and presented identification to the trip.</p>}
        <label className="form-field">{type === 'clearance' ? 'Technician verification' : 'Driver / identification match'}<ValidatedField as="select" name="driverVerification" required value={driverVerification} onChange={event => setDriverVerification(event.target.value)}><option value="" disabled>Select verification result</option><option value={type === 'clearance' ? 'not-applicable' : 'matched'}>{type === 'clearance' ? 'Vehicle identity verified for safety clearance' : 'Individual and identification match the named driver'}</option></ValidatedField></label>
        <h4>Measured readings</h4>
        <div className="form-grid">
          <label className="form-field">{type === 'post-return' ? 'Return odometer (km)' : 'Odometer (km)'}<ValidatedField name="odometer" type="number" required min={Math.max(vehicle.odometer ?? 0, type === 'post-return' ? dispatchOdometer ?? 0 : 0)} max="10000000" step="0.01" placeholder={vehicle.odometer == null ? 'Read at the vehicle' : `Last reading: ${vehicle.odometer}`} value={readings.odometer} onChange={event => updateReading('odometer', event.target.value)} /></label>
          <label className="form-field">Fuel / battery level (%)<ValidatedField name="fuelLevel" type="number" required min="0" max="100" step="0.01" value={readings.fuelLevel} onChange={event => updateReading('fuelLevel', event.target.value)} /></label>
          {corners.map(([key, label]) => <label className="form-field" key={key}>{label} tire pressure (PSI)<ValidatedField name={key} type="number" required min="0" max="100" step="0.1" value={readings[key]} onChange={event => updateReading(key, event.target.value)} /></label>)}
        </div>
        {type === 'post-return' && <section className="mileage-summary" aria-label="Trip mileage calculation" aria-live="polite"><h4>Total mileage consumption</h4><p>Dispatch: {Number.isFinite(dispatchOdometer) ? dispatchOdometer.toLocaleString('en-PH') : 'Not recorded'} km → Return: {readings.odometer === '' ? 'Enter reading' : Number(readings.odometer).toLocaleString('en-PH')} km</p>{distance !== null ? <strong>{Number(readings.odometer).toLocaleString('en-PH')} − {dispatchOdometer.toLocaleString('en-PH')} = {distance.toLocaleString('en-PH')} km used</strong> : <p>{readings.odometer === '' && Number.isFinite(dispatchOdometer) ? 'Enter the return odometer before re-acceptance.' : mileageError}</p>}</section>}
      </>}
      {step === 1 && <>
        <p>Rate every checkpoint individually. 1 – Good · 2 – Fair · 3 – Damaged · 4 – Needs Repair.</p>
        <div className="form-grid">{checklist.map(({ key, label }) => <label className="form-field" key={key}>{label}<ValidatedField as="select" name={key} required value={ratings[key] || ''} onChange={event => { setRatings(previous => ({ ...previous, [key]: Number(event.target.value) })); setOutcome('') }}><option value="" disabled>Select rating (1–4)</option>{CONDITION_RATINGS.map(rating => <option key={rating.value} value={rating.value}>{rating.value} – {rating.label}</option>)}</ValidatedField></label>)}</div>
        <label className="form-field">Interior cleanliness<ValidatedField as="select" name="cleanliness" required value={cleanliness} onChange={event => { setCleanliness(event.target.value); setOutcome('') }}><option value="" disabled>Select observed condition</option><option>Clean</option><option>Needs cleaning</option><option>Damaged</option></ValidatedField></label>
      </>}
      {step === 2 && <>
        <label className="form-field">Damage observed / requires repair{type === 'post-return' && ' (holds Security Deposit for review)'}<ValidatedField as="select" name="damageStatus" required value={damageStatus} onChange={event => { setDamageStatus(event.target.value); setOutcome('') }}><option value="" disabled>Select damage status</option><option value="no">No damage observed</option><option value="yes">Damage / repair required</option></ValidatedField></label>
        <label className="form-field">Exterior condition / damage locations<ValidatedField as="textarea" name="scratches" required maxLength={1500} rows={3} placeholder="Describe damage and its location, or record no visible damage." value={scratches} onChange={event => setScratches(event.target.value)} /></label>
        <h4>Fresh photo proof</h4><p>Separate exterior and interior photos · JPG, PNG or WebP · up to 4 MB each.</p>
        <div className="form-grid">{['exterior', 'interior'].map(view => <label className="form-field staff-photo-input" key={view}><span><Icon name="camera" size={18} />{view === 'exterior' ? 'Exterior photo' : 'Interior photo'}</span><ValidatedField type="file" name={`${view}Photo`} accept="image/jpeg,image/png,image/webp" disabled={uploading > 0} onChange={event => { upload(view, event.target.files[0]); event.target.value = '' }} /><small role="status">{photos[view] ? `Uploaded: ${photos[view].name}` : 'Upload required'}</small></label>)}</div>
        {uploading > 0 && <p role="status">Uploading condition photo…</p>}
      </>}
      {step === 3 && <>
        <VehicleIdentity vehicle={vehicle} />
        <dl className="inspection-review"><div><dt>Odometer</dt><dd>{Number(readings.odometer).toLocaleString()} km</dd></div>{distance !== null && <div><dt>Total mileage consumption</dt><dd>{distance.toLocaleString()} km used</dd></div>}<div><dt>Fuel / battery</dt><dd>{readings.fuelLevel}%</dd></div>{checklist.map(({ key, label }) => <div key={key}><dt>{label}</dt><dd>{conditionLabel(ratings[key])}</dd></div>)}<div><dt>Interior cleanliness</dt><dd>{cleanliness}</dd></div><div><dt>Damage status</dt><dd>{damageStatus === 'yes' ? 'Damage / repair required' : 'No damage observed'}</dd></div><div><dt>Exterior condition</dt><dd>{scratches}</dd></div><div><dt>Photo proof</dt><dd>{Object.values(photos).map(photo => photo.name).join(' · ')}</dd></div></dl>
        {safeProblem && <p className="info-note">{safeProblem} Select “Do not dispatch” or go back and correct the inspection after repairs.</p>}
        <label className="form-field">{type === 'pre-dispatch' ? 'Mechanic dispatch decision' : 'Vehicle readiness decision'}<ValidatedField as="select" name="outcome" required value={outcome} onChange={event => setOutcome(event.target.value)}><option value="" disabled>Select final decision</option><option value="approved" disabled={Boolean(safeProblem)}>{type === 'pre-dispatch' ? 'Approved for dispatch by mechanic' : 'Safe / ready for fleet re-acceptance'}</option><option value="unsafe">Do not dispatch — Out of Service</option></ValidatedField></label>
        <label className="form-field">Inspection notes{outcome === 'unsafe' ? ' (required)' : ''}<ValidatedField as="textarea" name="note" required={outcome === 'unsafe'} maxLength={1500} rows={3} value={note} onChange={event => setNote(event.target.value)} /></label>
        <p className="workspace-muted">Mechanic approval records vehicle readiness. The Booking Agent completes identity, payment and dispatch-pass checks before releasing the vehicle.</p>
        {type === 'post-return' && <p className="info-note">An approved clean return with full fuel and no damage flags qualifies for automatic Security Deposit release.</p>}
      </>}
      {error && <p className="error-banner" role="alert">{error}</p>}
      <footer className="inspection-footer">{step > 0 && <button type="button" className="button button-outline" disabled={busy || uploading > 0} onClick={() => moveTo(step - 1)}>Back to {stages[step - 1].toLowerCase()}</button>}<button type="submit" className="button button-dark" disabled={busy || uploading > 0 || type !== 'clearance' && !booking}><Icon name={step === 3 ? 'check' : 'arrow'} size={18} />{busy ? 'Saving…' : step === 3 ? 'Save inspection & decision' : `Continue to ${stages[step + 1].toLowerCase()}`}</button></footer>
    </fieldset></ValidatedForm>
  </>
}

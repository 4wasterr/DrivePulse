import ValidatedField from '../../../components/ui/ValidatedField.jsx'
import ValidatedForm from '../../../components/ui/ValidatedForm.jsx'
import { useState } from 'react'
import { initialDates, vehicles, rentalDays, rentalPeriodError, getAvailabilityReason, money, dateISO, locations } from '../../../data.js'
import { inputError } from '../../../../../shared/validation.mjs'
import { api } from '../../../api.js'
import Modal from '../../../components/ui/Modal.jsx'
import Icon from '../../../components/ui/Icon.jsx'

export default function WalkInReservation({ values = {}, availability, onClose, onCreated }) {
  const fleet = vehicles.filter(v => !v.archivedAt)
  const [dates, setDates] = useState(() => ({ ...initialDates(), ...values, vehicleId: values.vehicleId || fleet[0]?.id || '' }))
  const [customer, setCustomer] = useState({ name: '', email: '', phone: '' })
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const vehicle = fleet.find(v => v.id === dates.vehicleId), days = rentalDays(dates.start, dates.end, dates.startTime, dates.endTime)
  const update = (key, value) => setDates(previous => ({ ...previous, [key]: value, ...(key === 'start' && previous.end < value ? { end: value } : {}) }))
  const updateCustomer = (key, value) => setCustomer(previous => ({ ...previous, [key]: value }))

  const periodProblem = rentalPeriodError(dates)
  const conflict = vehicle ? getAvailabilityReason(vehicle.id, dates, availability) : 'No active vehicle selected.'
  const incompleteOrInvalid = Boolean(
    inputError(customer.name, { kind: 'name', required: true, maxLength: 70 }) ||
    inputError(customer.email, { kind: 'email', required: false, maxLength: 160 }) ||
    inputError(customer.phone, { kind: 'phone', required: true, maxLength: 40 }) ||
    !dates.vehicleId || !dates.pickup || !dates.dropoff ||
    periodProblem || conflict
  )

  async function submit(event) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setError('')
    const problem = periodProblem || conflict
    if (problem) { setError(problem); return }
    setBusy(true)
    try { const booking = await api('/agent/bookings', { method: 'POST', body: { ...dates, renter: { name: data.get('name'), email: data.get('email'), phone: data.get('phone') }, note: data.get('note') } }); await onCreated(booking) }
    catch (problem) { setError(problem.message) } finally { setBusy(false) }
  }

  return <Modal title="Create a reservation" eyebrow="CUSTOMER DETAILS & WALK-IN RESERVATION" wide onClose={onClose}>
    {!vehicle ? <p>No active vehicles are available.</p> : <ValidatedForm className="walkin-form customer-details-form" validation="rental" onSubmit={submit}><fieldset disabled={busy}>
      <div className="walkin-layout"><div>
        <h3>Customer details</h3>
        <div className="form-grid customer-details-grid">
          <label className="form-field span-2"><span className="field-label">Full name</span><ValidatedField name="name" required maxLength={70} autoComplete="name" value={customer.name} onChange={e => updateCustomer('name', e.target.value)} /></label>
          <label className="form-field"><span className="field-label">Email address <span className="field-optional">Optional</span></span><ValidatedField name="email" type="email" maxLength={160} autoComplete="email" value={customer.email} onChange={e => updateCustomer('email', e.target.value)} /></label>
          <label className="form-field"><span className="field-label">Contact number</span><ValidatedField name="phone" required maxLength={40} type="tel" inputMode="tel" autoComplete="tel" placeholder="09XX XXX XXXX or +63…" value={customer.phone} onChange={e => updateCustomer('phone', e.target.value)} /></label>
        </div>
        <p className="small muted">An email matching an existing client account links this reservation to their portal.</p>
        <h3 className="walkin-trip-heading">Trip details</h3>
        <div className="form-grid customer-details-grid">
          <label className="form-field span-2"><span className="field-label">Vehicle</span><ValidatedField as="select" name="vehicleId" required value={dates.vehicleId} onChange={e => update('vehicleId', e.target.value)}>{fleet.map(v => <option key={v.id} value={v.id}>{v.name} · {v.fleetCode || v.id} · {money(v.rate)} / day</option>)}</ValidatedField></label>
          <label className="form-field"><span className="field-label">Pick-up date</span><ValidatedField name="start" type="date" required min={dateISO()} value={dates.start} onChange={e => update('start', e.target.value)} /></label>
          <label className="form-field"><span className="field-label">Pick-up time</span><ValidatedField name="startTime" type="time" required value={dates.startTime} onChange={e => update('startTime', e.target.value)} /></label>
          <label className="form-field"><span className="field-label">Return date</span><ValidatedField name="end" type="date" required min={dates.start > dateISO() ? dates.start : dateISO()} value={dates.end} onChange={e => update('end', e.target.value)} /></label>
          <label className="form-field"><span className="field-label">Return time</span><ValidatedField name="endTime" type="time" required value={dates.endTime} onChange={e => update('endTime', e.target.value)} /></label>
          <label className="form-field span-2"><span className="field-label">Pick-up location</span><ValidatedField as="select" name="pickup" required value={dates.pickup} onChange={e => update('pickup', e.target.value)}>{locations.map(l => <option key={l}>{l}</option>)}</ValidatedField></label>
          <label className="form-field span-2"><span className="field-label">Return location</span><ValidatedField as="select" name="dropoff" required value={dates.dropoff} onChange={e => update('dropoff', e.target.value)}>{locations.map(l => <option key={l}>{l}</option>)}</ValidatedField></label>
          <label className="form-field span-2"><span className="field-label">Reservation note</span><ValidatedField as="textarea" name="note" maxLength={1000} rows={3} /></label>
        </div>
      </div><aside className="walkin-quote"><img src={vehicle.image} alt={vehicle.name} /><div><p className="workspace-kicker">RESERVATION SUMMARY</p><h3>{vehicle.name}</h3><p>{vehicle.fleetCode || vehicle.id} · {vehicle.plate || 'Plate not recorded'}</p><dl><div><dt>Daily rate</dt><dd>{money(vehicle.rate)}</dd></div><div><dt>Rental days</dt><dd>{Number.isFinite(days) ? days : 0}</dd></div><div><dt>Rental</dt><dd>{money(Number.isFinite(days) ? days * vehicle.rate : 0)}</dd></div><div><dt>Security Deposit</dt><dd>{money(5000)}</dd></div><div className="quote-total"><dt>Total quotation</dt><dd>{money((Number.isFinite(days) ? days * vehicle.rate : 0) + 5000)}</dd></div></dl><p className="small muted">The confirmation and complete rental terms open after scheduling. Documents, cash payment and a mechanic inspection must be verified before release.</p>{conflict && <p className="error-banner">{conflict}</p>}</div></aside></div>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <div className="form-actions"><button className="button button-outline" type="button" onClick={onClose}>Cancel</button><button className="button button-dark" disabled={busy || incompleteOrInvalid}>{busy ? 'Creating…' : 'Create reservation'}<Icon name="arrow" /></button></div>
    </fieldset></ValidatedForm>}
  </Modal>
}

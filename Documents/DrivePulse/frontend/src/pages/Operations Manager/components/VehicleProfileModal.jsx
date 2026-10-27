import useDraftState from '../../../hooks/useDraftState.js'
import ValidatedField from '../../../components/ui/ValidatedField.jsx'
import ValidatedForm from '../../../components/ui/ValidatedForm.jsx'
import { useState } from 'react'
import Modal from '../../../components/ui/Modal.jsx'
import VehicleImageField from '../../../components/ui/VehicleImageField.jsx'
import { api, uploadVehicleImage } from '../../../api.js'
import { duplicateVehicleErrors } from '../../../../../shared/validation.mjs'
import { vehicles } from '../../../data.js'
import catalog from '../../../../../shared/vehicleCatalog.json'

export default function VehicleProfileModal({ vehicle, onClose, onDone }) {
  const [photo, setPhoto] = useDraftState(`vehicle-profile:${vehicle.id}`, 'photo', null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [brand, setBrand] = useDraftState(`vehicle-profile:${vehicle.id}`, 'brand', vehicle.brand || ''), [model, setModel] = useDraftState(`vehicle-profile:${vehicle.id}`, 'model', vehicle.model || '')
  return <Modal draftKey={`vehicle-profile:${vehicle.id}`} title={vehicle.name} eyebrow="VEHICLE PROFILE & RENEWALS" onClose={onClose}>
    <ValidatedForm validate={form => duplicateVehicleErrors(Object.fromEntries(new FormData(form)), vehicles, vehicle.id)} onSubmit={async e => {
      e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); setError('')
      try {
        const image = photo ? await uploadVehicleImage(photo) : null
        await api(`/manager/vehicles/${encodeURIComponent(vehicle.id)}/profile`, { method: 'PATCH', body: { version: vehicle.version, fleetCode: form.get('fleetCode'), registrationExpiry: form.get('registrationExpiry'), insuranceExpiry: form.get('insuranceExpiry'), imageId: image?.id || vehicle.imageId, brand, model, category: form.get('category'), plate: form.get('plate'), transmission: form.get('transmission'), fuelType: form.get('fuelType'), seats: Number(form.get('seats')), tankCapacity: Number(form.get('tankCapacity')), rate: Number(form.get('rate')), status: form.get('status'), reason: form.get('reason') } })
        await onDone('Vehicle specifications, status and renewal dates updated.')
      } catch (err) { setError(err.message) } finally { setBusy(false) }
    }}><fieldset disabled={busy}>
      <VehicleImageField file={photo} image={vehicle.image} onChange={setPhoto} disabled={busy} />
      <label className="form-field">Unique Vehicle ID / Fleet code<ValidatedField name="fleetCode" data-validate="fleet-code" defaultValue={vehicle.fleetCode} required maxLength={30} /></label>
      <div className="form-grid">
        <label className="form-field">Brand<ValidatedField as="select" name="brand" required value={brand} onChange={e => { setBrand(e.target.value); setModel('') }}><option value="" disabled>Select brand</option>{Object.keys(catalog.brands).map(value => <option key={value}>{value}</option>)}</ValidatedField></label>
        <label className="form-field">Model<ValidatedField as="select" name="model" required value={model} onChange={e => setModel(e.target.value)}><option value="" disabled>Select model</option>{(catalog.brands[brand] || []).map(value => <option key={value}>{value}</option>)}</ValidatedField></label>
        <label className="form-field">Category<ValidatedField as="select" name="category" required defaultValue={vehicle.category || 'Sedan'}>{Object.keys(catalog.categories).map(value => <option key={value}>{value}</option>)}</ValidatedField></label>
        <label className="form-field">License plate<ValidatedField name="plate" data-validate="plate" defaultValue={vehicle.plate || ''} required maxLength={30} /></label>
        <label className="form-field">Daily rate (PHP)<ValidatedField name="rate" type="number" required min="500" max="100000" step="0.01" defaultValue={vehicle.rate} /></label>
        <label className="form-field">Transmission<ValidatedField as="select" name="transmission" defaultValue={vehicle.transmission || 'Automatic'}><option>Automatic</option><option>Manual</option></ValidatedField></label>
        <label className="form-field">Seats<ValidatedField name="seats" type="number" required min="2" max="15" defaultValue={vehicle.seats || 5} /></label>
        <label className="form-field">Fuel type<ValidatedField as="select" name="fuelType" defaultValue={vehicle.fuelType || (vehicle.category === 'Electric' ? 'Electric' : 'Gasoline')}>{['Gasoline', 'Diesel', 'Hybrid', 'Electric'].map(value => <option key={value}>{value}</option>)}</ValidatedField></label>
        <label className="form-field">Tank / battery capacity<ValidatedField name="tankCapacity" type="number" required min="10" max="150" defaultValue={vehicle.tankCapacity || catalog.categories[vehicle.category]?.tankCapacity || 50} /></label>
        <label className="form-field">Operational status<ValidatedField as="select" name="status" defaultValue={vehicle.holdStatus || 'Available'}><option value={vehicle.holdStatus || 'Available'}>Keep current ({vehicle.status})</option>{['Under Inspection', 'Out of Service'].filter(value => value !== vehicle.holdStatus).map(value => <option key={value}>{value}</option>)}</ValidatedField></label>
      </div>
      <label className="form-field">OR/CR Registration Expiry Date<ValidatedField type="date" name="registrationExpiry" defaultValue={vehicle.registrationExpiry || ''} /></label>
      <label className="form-field">Insurance Expiry Date<ValidatedField type="date" name="insuranceExpiry" defaultValue={vehicle.insuranceExpiry || ''} /></label>
      <p>Renewal alerts update automatically at 30, 15 and 7 days, and when overdue.</p>
      <label className="form-field">Change reason<ValidatedField as="textarea" name="reason" required maxLength={1000} rows={2} /></label>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <button className="button button-dark" disabled={busy}>{busy ? 'Saving…' : 'Save vehicle profile'}</button>
    </fieldset></ValidatedForm>
  </Modal>
}

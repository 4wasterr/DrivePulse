import ValidatedField from '../../../components/ui/ValidatedField.jsx'
import ValidatedForm from '../../../components/ui/ValidatedForm.jsx'
import { useState } from 'react'
import Modal from '../../../components/ui/Modal.jsx'
import Icon from '../../../components/ui/Icon.jsx'
import { api, uploadVehicleImage } from '../../../api.js'
import VehicleImageField from '../../../components/ui/VehicleImageField.jsx'
import catalog from '../../../../../shared/vehicleCatalog.json'
import { duplicateVehicleErrors, inputError } from '../../../../../shared/validation.mjs'
import { vehicles } from '../../../data.js'

export default function AddVehicleModal({ onClose, onDone }) {
  const [brand, setBrand] = useState('')
  const [model, setModel] = useState('')
  const [category, setCategory] = useState('Sedan')
  const [rate, setRate] = useState(3500)
  const [plate, setPlate] = useState('')
  const [transmission, setTransmission] = useState('Automatic')
  const [seats, setSeats] = useState(5)
  const [fuelType, setFuelType] = useState('Gasoline')
  const [tankCapacity, setTankCapacity] = useState(50)
  const [mileage, setMileage] = useState(15000)
  const [fleetCode, setFleetCode] = useState('')
  const [registrationExpiry, setRegistrationExpiry] = useState(''), [insuranceExpiry, setInsuranceExpiry] = useState('')
  const [photo, setPhoto] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const duplicateProblems = duplicateVehicleErrors({ fleetCode, plate }, vehicles)
  const formIncompleteOrInvalid = Boolean(
    !brand ||
    !model ||
    inputError(plate, { kind: 'plate', required: true, maxLength: 30 }) ||
    inputError(fleetCode, { kind: 'fleet-code', required: false, maxLength: 30 }) ||
    inputError(rate, { kind: 'number', required: true, min: 500, max: 100000, step: 0.01 }) ||
    inputError(seats, { kind: 'number', required: true, min: 2, max: 15, step: 1 }) ||
    inputError(tankCapacity, { kind: 'number', required: true, min: 10, max: 150, step: 1 }) ||
    inputError(mileage, { kind: 'number', required: true, min: 0, max: 10000000, step: 1 }) ||
    duplicateProblems.some(item => item.message)
  )

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const image = photo ? await uploadVehicleImage(photo) : null
      await api('/manager/vehicles', {
        method: 'POST',
        body: {
          brand,
          model,
          category,
          fleetCode, registrationExpiry, insuranceExpiry, imageId: image?.id,
          rate: Number(rate),
          plate,
          transmission,
          seats: Number(seats),
          fuelType,
          tankCapacity: Number(tankCapacity),
          mileage: Number(mileage)
        }
      })
      await onDone(`New fleet vehicle ${brand} ${model} (${plate}) added successfully.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Add vehicle to fleet" eyebrow="OPERATIONS MANAGER · FLEET EXPANSION" wide onClose={onClose}>
      <ValidatedForm onSubmit={handleSubmit} validate={form => duplicateVehicleErrors(Object.fromEntries(new FormData(form)), vehicles)}>
        <fieldset disabled={busy}>
        <VehicleImageField onChange={setPhoto} disabled={busy} />
        <div className="form-grid">
          <label className="form-field">Unique Vehicle ID / Fleet code<ValidatedField name="fleetCode" data-validate="fleet-code" maxLength={30} placeholder="Leave blank to generate CAR-XXXXXXXX" value={fleetCode} onChange={e => setFleetCode(e.target.value)} /></label>
          <label className="form-field">
            Vehicle brand
            <ValidatedField as="select" name="brand" required value={brand} onChange={e => { setBrand(e.target.value); setModel('') }}><option value="">Select a brand</option>{Object.keys(catalog.brands).map(b => <option key={b}>{b}</option>)}</ValidatedField>
          </label>
          <label className="form-field">
            Vehicle model
            <ValidatedField as="select" name="model" required disabled={!brand} value={model} onChange={e => setModel(e.target.value)}><option value="">{brand ? 'Select a model' : 'Select a brand first'}</option>{(catalog.brands[brand] || []).map(m => <option key={m}>{m}</option>)}</ValidatedField>
          </label>
          <label className="form-field">
            Category
            <ValidatedField as="select" name="category" value={category} onChange={e => { const c = e.target.value; setCategory(c); setSeats(catalog.categories[c].seats); setTankCapacity(catalog.categories[c].tankCapacity); if (c === 'Electric') setFuelType('Electric'); else if (fuelType === 'Electric') setFuelType('Gasoline') }}>
              {Object.keys(catalog.categories).map(c => <option key={c}>{c}</option>)}
            </ValidatedField>
          </label>
          <label className="form-field">
            License plate number
            <ValidatedField name="plate" data-validate="plate" required maxLength={30} placeholder="e.g. ABC 1234 or NGD 8899" value={plate} onChange={e => setPlate(e.target.value)} />
          </label>
          <label className="form-field">
            Daily rental rate (PHP)
            <ValidatedField name="rate" required type="number" min="500" max="100000" step="0.01" value={rate} onChange={e => setRate(e.target.value)} />
          </label>
          <label className="form-field">
            Transmission
            <ValidatedField as="select" name="transmission" value={transmission} onChange={e => setTransmission(e.target.value)}>
              <option value="Automatic">Automatic</option>
              <option value="Manual">Manual</option>
            </ValidatedField>
          </label>
          <label className="form-field">
            Seating capacity
            <ValidatedField name="seats" required type="number" min="2" max="15" value={seats} onChange={e => setSeats(e.target.value)} />
          </label>
          <label className="form-field">
            Fuel type
            <ValidatedField as="select" name="fuelType" value={fuelType} onChange={e => setFuelType(e.target.value)}>
              <option value="Gasoline">Gasoline</option>
              <option value="Diesel">Diesel</option>
              <option value="Hybrid">Hybrid</option>
              <option value="Electric">Electric</option>
            </ValidatedField>
          </label>
          <label className="form-field">
            Tank / battery capacity ({fuelType === 'Electric' ? 'kWh' : 'L'})
            <ValidatedField name="tankCapacity" required type="number" min="10" max="150" value={tankCapacity} onChange={e => setTankCapacity(e.target.value)} />
          </label>
          <label className="form-field">
            Current odometer reading (km)
            <ValidatedField name="mileage" required type="number" min="0" max="10000000" value={mileage} onChange={e => setMileage(e.target.value)} />
          </label>
          <label className="form-field">OR/CR Registration Expiry Date<ValidatedField type="date" name="registrationExpiry" value={registrationExpiry} onChange={e => setRegistrationExpiry(e.target.value)} /></label>
          <label className="form-field">Insurance Expiry Date<ValidatedField type="date" name="insuranceExpiry" value={insuranceExpiry} onChange={e => setInsuranceExpiry(e.target.value)} /></label>
        </div>
        <p className="workspace-muted">Category defaults are suggestions; adjust seating and capacity to match the vehicle. Renewal notices appear within 30, 15 and 7 days, and when overdue.</p>

        {error && <div className="error-banner" role="alert" style={{ margin: '14px 0' }}>{error}</div>}

        <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
          <button type="button" className="button button-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="button button-dark" style={{ flex: 1 }} disabled={busy || formIncompleteOrInvalid}>
            <Icon name="check" size={17} />
            {busy ? 'Registering vehicle…' : 'Add vehicle to active fleet'}
          </button>
        </div>
        </fieldset>
      </ValidatedForm>
    </Modal>
  )
}

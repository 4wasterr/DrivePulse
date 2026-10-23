import { useState } from 'react'
import Modal from '../../../components/ui/Modal.jsx'
import Icon from '../../../components/ui/Icon.jsx'
import { api } from '../../../api.js'

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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('/manager/vehicles', {
        method: 'POST',
        body: {
          brand,
          model,
          category,
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
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <label className="form-field">
            Vehicle brand
            <input required placeholder="e.g. Toyota, Honda, Ford" value={brand} onChange={e => setBrand(e.target.value)} />
          </label>
          <label className="form-field">
            Vehicle model
            <input required placeholder="e.g. Fortuner, Civic, Everest" value={model} onChange={e => setModel(e.target.value)} />
          </label>
          <label className="form-field">
            Category
            <select value={category} onChange={e => setCategory(e.target.value)}>
              <option value="Sedan">Sedan</option>
              <option value="SUV">SUV</option>
              <option value="Compact">Compact</option>
              <option value="Van">Van</option>
              <option value="Electric">Electric</option>
              <option value="Luxury">Luxury</option>
            </select>
          </label>
          <label className="form-field">
            License plate number
            <input required placeholder="e.g. ABC 1234 or NGD 8899" value={plate} onChange={e => setPlate(e.target.value)} />
          </label>
          <label className="form-field">
            Daily rental rate (PHP)
            <input required type="number" min="500" max="100000" step="50" value={rate} onChange={e => setRate(e.target.value)} />
          </label>
          <label className="form-field">
            Transmission
            <select value={transmission} onChange={e => setTransmission(e.target.value)}>
              <option value="Automatic">Automatic</option>
              <option value="Manual">Manual</option>
            </select>
          </label>
          <label className="form-field">
            Seating capacity
            <input required type="number" min="2" max="15" value={seats} onChange={e => setSeats(e.target.value)} />
          </label>
          <label className="form-field">
            Fuel type
            <select value={fuelType} onChange={e => setFuelType(e.target.value)}>
              <option value="Gasoline">Gasoline</option>
              <option value="Diesel">Diesel</option>
              <option value="Hybrid">Hybrid</option>
              <option value="Electric">Electric</option>
            </select>
          </label>
          <label className="form-field">
            Tank / battery capacity ({fuelType === 'Electric' ? 'kWh' : 'L'})
            <input required type="number" min="10" max="150" value={tankCapacity} onChange={e => setTankCapacity(e.target.value)} />
          </label>
          <label className="form-field">
            Current odometer reading (km)
            <input required type="number" min="0" max="10000000" value={mileage} onChange={e => setMileage(e.target.value)} />
          </label>
        </div>

        {error && <div className="error-banner" role="alert" style={{ margin: '14px 0' }}>{error}</div>}

        <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
          <button type="button" className="button button-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="button button-dark" style={{ flex: 1 }} disabled={busy}>
            <Icon name="check" size={17} />
            {busy ? 'Registering vehicle…' : 'Add vehicle to active fleet'}
          </button>
        </div>
      </form>
    </Modal>
  )
}


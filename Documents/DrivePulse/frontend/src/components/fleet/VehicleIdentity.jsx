import { vehicles } from '../../data.js'

export default function VehicleIdentity({ vehicle, vehicleId }) {
  const v = vehicle || vehicles.find(v => v.id === vehicleId) || { id: vehicleId, name: vehicleId }
  return <section className="vehicle-identity" aria-label="Vehicle identification">
    <div><span className="workspace-kicker">VEHICLE</span><h3>{v.name}</h3></div>
    <div><span>Unique Vehicle ID</span><strong>{v.fleetCode || v.id}</strong></div>
    <div><span>License plate</span><strong>{v.plate || 'Not recorded'}</strong></div>
  </section>
}

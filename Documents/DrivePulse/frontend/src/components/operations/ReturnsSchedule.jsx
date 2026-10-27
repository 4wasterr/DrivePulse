import { useState } from 'react'
import Modal from '../ui/Modal.jsx'
import { PaginatedTable } from '../ui/Pagination.jsx'
import { vehicleFor } from '../../utils/vehicles.js'
import { dropoffStatus, conditionSignoff } from '../../utils/returns.js'
import { prettyDate } from '../../data.js'

const stamp = value => new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) + ' PHT'

export default function ReturnsSchedule({ bookings, onRecordReturn }) {
  const [filter, setFilter] = useState('All returns'), [query, setQuery] = useState(''), [selectedId, setSelectedId] = useState(null)
  const selected = bookings.find(booking => booking.id === selectedId)
  const rows = bookings.filter(booking => booking.status !== 'Cancelled' && (booking.status !== 'Completed' || booking.returnedAt))
    .filter(booking => filter === 'All returns' || filter === dropoffStatus(booking) || filter === 'Awaiting inspection' && conditionSignoff(booking) === filter)
    .filter(booking => `${booking.id} ${booking.renter.name} ${vehicleFor(booking).name} ${vehicleFor(booking).fleetCode || booking.vehicleId}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => `${a.end}T${a.endTime}`.localeCompare(`${b.end}T${b.endTime}`))
  return <section className="workspace-surface staff-section returns-schedule">
    <div className="workspace-section-heading"><div><p className="workspace-kicker">RETURN HANDOVERS · PHT</p><h2>Returns Schedule</h2></div><span>{rows.length} return(s)</span></div>
    <div className="staff-toolbar"><label className="staff-search"><input type="search" aria-label="Search returns" placeholder="Search reservation, client or vehicle" value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="Filter returns" value={filter} onChange={event => setFilter(event.target.value)}>{['All returns', 'Scheduled', 'Overdue', 'Dropped off', 'Awaiting inspection'].map(value => <option key={value}>{value}</option>)}</select></div>
    {rows.length ? <div className="agent-table-scroll"><PaginatedTable className="agent-table returns-table" resetKey={query + filter}><thead><tr><th>Scheduled return time</th><th>Vehicle ID / Model</th><th>Client name</th><th>Drop-off status</th><th>Condition sign-off</th><th>Details</th></tr></thead><tbody>{rows.map(booking => {
      const vehicle = vehicleFor(booking)
      return <tr key={booking.id}><td><strong>{prettyDate(booking.end, { year: 'numeric' })}</strong><small>{booking.endTime} PHT</small></td><td><strong>{vehicle.fleetCode || booking.vehicleId}</strong><small>{vehicle.name}</small></td><td><strong>{booking.renter.name}</strong><small>{booking.id}</small></td><td><span className={`workspace-tag ${dropoffStatus(booking) === 'Overdue' ? 'return-overdue' : ''}`}>{dropoffStatus(booking)}</span></td><td>{conditionSignoff(booking)}</td><td><button className="button button-outline" onClick={() => setSelectedId(booking.id)}>View return</button></td></tr>
    })}</tbody></PaginatedTable></div> : <p className="workspace-muted">No returns match this view.</p>}
    {selected && <Modal title="Return details" eyebrow={selected.id} onClose={() => setSelectedId(null)}>
      <dl className="return-details-grid">
        <div><dt>Scheduled return time</dt><dd>{prettyDate(selected.end, { year: 'numeric' })} · {selected.endTime} PHT</dd></div>
        <div><dt>Vehicle ID / Model</dt><dd>{vehicleFor(selected).fleetCode || selected.vehicleId}<small>{vehicleFor(selected).name} · {vehicleFor(selected).plate}</small></dd></div>
        <div><dt>Client name</dt><dd>{selected.renter.name}</dd></div>
        <div><dt>Drop-off location</dt><dd>{selected.dropoff}</dd></div>
        <div><dt>Drop-off status</dt><dd>{dropoffStatus(selected)}{selected.returnedAt && <small>{stamp(selected.returnedAt)}</small>}</dd></div>
        <div><dt>Condition sign-off</dt><dd>{conditionSignoff(selected)}{selected.returnInspection && <small>{selected.returnInspection.by} · {stamp(selected.returnInspection.at)}</small>}</dd></div>
      </dl>
      {selected.status === 'On Rental' && onRecordReturn && <button className="button button-dark full-width" onClick={() => { setSelectedId(null); onRecordReturn(selected.id) }}>Record vehicle return</button>}
    </Modal>}
  </section>
}

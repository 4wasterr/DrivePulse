import { useState } from 'react'
import Icon from '../ui/Icon.jsx'
import { vehicles, money } from '../../data.js'
import Tag from '../workspace/StaffTag.jsx'
import Empty from '../workspace/StaffEmpty.jsx'
import { PaginatedList } from '../ui/Pagination.jsx'

export default function FleetPage({ fleet, stages, mechanic, onRefresh, setDialog, filter, setFilter, query, setQuery }) {
  const [anomaliesOnly, setAnomaliesOnly] = useState(false)
  const shownFleet = fleet.filter(v =>
    (filter === 'All statuses' || v.status === filter) &&
    (!anomaliesOnly || ['Overdue', 'Out of Service', 'Maintenance', 'Under Inspection'].includes(v.status) || v.decommissionRequested) &&
    `${v.name} ${v.model || ''} ${v.fleetCode || ''} ${v.id} ${v.plate || ''}`.toLowerCase().includes(query.trim().toLowerCase())
  )
  return <section className="workspace-surface staff-section">
    <div className="workspace-section-heading">
      <div>
        <p className="workspace-kicker">LIVE DEPLOYMENT</p>
        <h2>Fleet oversight <span className="workspace-result-count">{shownFleet.length} of {fleet.length} units</span></h2>
      </div>
      <div className="staff-card-actions">
        {!mechanic && (
          <button type="button" className="button button-dark" onClick={() => setDialog({ kind: 'add-vehicle' })}>
            <Icon name="plus" size={16} />Add Vehicle
          </button>
        )}
        <button type="button" className={`button button-outline ${anomaliesOnly ? 'active' : ''}`} onClick={() => setAnomaliesOnly(!anomaliesOnly)}>
          <Icon name="shield" size={16} />{anomaliesOnly ? 'Showing anomalies only' : 'Drill-down anomalies'}
        </button>
        <button className="text-link" onClick={onRefresh}><Icon name="refresh" size={16} />Refresh</button>
      </div>
    </div>
    <div className="staff-toolbar">
      <label className="staff-search"><Icon name="search" size={18} /><input aria-label="Search fleet by name or ID" placeholder="Search name, model, fleet code or plate" maxLength={150} value={query} onChange={e => setQuery(e.target.value)} /></label>
      <select aria-label="Filter fleet status" value={filter} onChange={e => setFilter(e.target.value)}><option>All statuses</option>{stages.map(s => <option key={s}>{s}</option>)}</select>
    </div>
    <div className="staff-vehicle-grid">
      <PaginatedList resetKey={`${query}:${filter}:${anomaliesOnly}`}>{shownFleet.map(v => <article className="staff-vehicle" key={v.id}>
        <div className="staff-vehicle-photo">
          <img src={v.image || vehicles.find(x => x.id === v.id)?.image || '/images/car-sedan.jpg'} alt={v.name} />
          <Tag>{v.status}</Tag>
        </div>
        <div className="staff-vehicle-copy">
          <h3>{v.name}</h3>
          <p><strong>{v.fleetCode || v.id}</strong>{v.plate && ` · ${v.plate}`}</p>
          <p>{v.bookingId ? `Active booking: ${v.bookingId}` : `${v.reservations} upcoming reservation${v.reservations === 1 ? '' : 's'}`} · <strong>{money(v.rate)} / day</strong></p>
          {v.decommissionRequested && <p className="info-note">Decommission requested by {v.decommissionRequested.by}: {v.decommissionRequested.reason}</p>}
          <dl>
            <div><dt>Odometer</dt><dd>{v.odometer === null ? 'Not recorded' : `${v.odometer.toLocaleString()} km`}</dd></div>
            <div><dt>{v.id === 'tesla-3' ? 'Battery' : 'Fuel'}</dt><dd>{v.fuelLevel === null ? 'Not recorded' : `${v.fuelLevel}%`}</dd></div>
          </dl>
          <p className="vehicle-renewal-dates">OR/CR: {v.registrationExpiry || 'Not recorded'} · Insurance: {v.insuranceExpiry || 'Not recorded'}</p>
          {mechanic ? (
            <div className="staff-card-actions">
              <button className="button button-outline" onClick={() => setDialog({ kind: 'inspection', vehicleId: v.id })}>Inspect</button>
              <button className="text-link" onClick={() => setDialog({ kind: 'status', vehicle: v })}>Flag status</button>
              {!v.decommissionRequested && v.status !== 'Rented' && <button className="text-link" onClick={() => setDialog({ kind: 'decommission', vehicle: v })}>Request decommission</button>}
            </div>
          ) : (
            <div className="staff-card-actions">
              <button className="button button-outline" onClick={() => setDialog({ kind: 'vehicle-profile', vehicle: v })}>Edit profile / renewals</button>
              <button className="button button-outline" onClick={() => setDialog({ kind: 'rate', vehicle: v })}>Modify rate</button>
              <button className="text-link" onClick={() => setDialog({ kind: 'decommission', vehicle: v })}>{v.decommissionRequested ? 'Approve decommission' : 'Decommission'}</button>
              <button className="text-link" onClick={() => setDialog({ kind: 'vehicle-history', vehicle: v })}>History<Icon name="arrow" size={14} /></button>
            </div>
          )}
        </div>
      </article>)}</PaginatedList>
    </div>
    {!shownFleet.length && <Empty>No vehicles match this view.</Empty>}
  </section>
}

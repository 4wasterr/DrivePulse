import { PaginatedTable } from '../ui/Pagination.jsx'
import { vehicleName, fmt } from '../../utils/workspace.js'
import { vehicles, prettyDate, money } from '../../data.js'
import { workOrderId } from '../../utils/maintenance.js'
import Tag from '../workspace/StaffTag.jsx'
import Empty from '../workspace/StaffEmpty.jsx'

export default function MaintenanceList({ records, onUpdate, onArchive, onRestore, busy = false, resetKey }) {
  const actions = onUpdate || onArchive || onRestore
  return records.length ? <div className="agent-table-scroll"><PaginatedTable className="agent-table" resetKey={resetKey}>
    <thead><tr><th>Work Order / Vehicle</th><th>Service detail</th><th>Mechanic / Logged</th><th>Status</th><th>Expenditure</th>{actions && <th>Actions</th>}</tr></thead>
    <tbody>{records.map(m => {
      const v = vehicles.find(v => v.id === m.vehicleId) || m.vehicle || {}
      return <tr key={m.id}>
        <td><strong>{workOrderId(m)}</strong><small>{vehicleName(m.vehicleId)}</small><small>{v.fleetCode || m.vehicleId}{v.plate ? ' · ' + v.plate : ''}</small></td>
        <td><strong>{m.description}</strong><small>{m.type}</small>{m.dueDate && <small>Due {prettyDate(m.dueDate)}</small>}<small>{m.note}</small>{m.reference && <small>{m.reference}</small>}</td>
        <td><strong>{m.mechanic || m.by}</strong><small>{fmt(m.at)}</small></td>
        <td><Tag>{m.archivedAt ? 'Archived' : m.status}</Tag>{m.archivedAt && <small>{fmt(m.archivedAt)} · {m.archivedBy}</small>}</td>
        <td><strong>{m.status === 'Completed' ? money(m.cost) : '—'}</strong><small>{m.completedAt ? fmt(m.completedAt) : 'Not yet invoiced'}</small></td>
        {actions && <td><div className="staff-card-actions">{m.archivedAt ? onRestore && <button className="button button-outline" disabled={busy} onClick={() => onRestore(m)}>Restore</button> : <>
          {onUpdate && m.status !== 'Completed' && <button className="button button-outline" disabled={busy} onClick={() => onUpdate(m)}>{m.status === 'Requested' ? 'Start work' : 'Complete work'}</button>}
          {onArchive && m.status === 'Completed' && <button className="button button-outline" disabled={busy} onClick={() => onArchive(m)}>Archive</button>}
        </>}</div></td>}
      </tr>
    })}</tbody>
  </PaginatedTable></div> : <Empty>No work orders or repairs match this view.</Empty>
}

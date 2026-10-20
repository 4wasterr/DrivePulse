import { vehicleName, fmt } from '../../utils/workspace.js'
import { prettyDate, money } from '../../data.js'
import Tag from '../workspace/StaffTag.jsx'
import Empty from '../workspace/StaffEmpty.jsx'

export default function MaintenanceList({ records, onUpdate }) {
  return records.length ? <div className="agent-table-scroll"><table className="agent-table"><thead><tr><th>Vehicle / work</th><th>Service detail</th><th>Status</th><th>Expenditure</th>{onUpdate && <th>Next action</th>}</tr></thead><tbody>{records.map(m => <tr key={m.id}><td><strong>{vehicleName(m.vehicleId)}</strong><small>{m.type}</small>{m.dueDate && <small>Due {prettyDate(m.dueDate)}</small>}</td><td><strong>{m.description}</strong><small>{m.note || `Logged by ${m.by}`}</small>{m.reference && <small>{m.reference}</small>}</td><td><Tag>{m.status}</Tag></td><td><strong>{m.status === 'Completed' ? money(m.cost) : '—'}</strong><small>{m.completedAt ? fmt(m.completedAt) : 'Not yet invoiced'}</small></td>{onUpdate && <td>{m.status !== 'Completed' && <button className="button button-outline" onClick={() => onUpdate(m)}>{m.status === 'Requested' ? 'Start work' : 'Complete work'}</button>}</td>}</tr>)}</tbody></table></div> : <Empty>Maintenance requests, repairs, and oil changes will appear here.</Empty>
}

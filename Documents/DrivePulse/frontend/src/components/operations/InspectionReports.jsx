import VehicleIdentity from '../fleet/VehicleIdentity.jsx'
import { PaginatedList } from '../ui/Pagination.jsx'
import { fmt } from '../../utils/workspace.js'
import Tag from '../workspace/StaffTag.jsx'
import Icon from '../ui/Icon.jsx'
import Empty from '../workspace/StaffEmpty.jsx'

export default function ReportList({ inspections, onOpen }) {
  return inspections.length ? <PaginatedList>{inspections.map(r => <article className="staff-ledger-row" key={r.id}><div><VehicleIdentity vehicle={r.vehicle} vehicleId={r.vehicleId} /><p>{r.type} · {r.bookingId || 'Safety clearance'} · {r.odometer.toLocaleString()} km</p><small>{r.by} · {fmt(r.at)} · {r.photos.length} photos</small></div><Tag>{r.status}</Tag><button className="text-link" onClick={() => onOpen(r)}>View proof<Icon name="diagonal" size={16} /></button></article>)}</PaginatedList> : <Empty>Completed inspections and condition photos will appear here.</Empty>
}

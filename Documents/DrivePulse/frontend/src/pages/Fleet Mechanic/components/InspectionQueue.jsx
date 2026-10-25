import { PaginatedList } from '../../../components/ui/Pagination.jsx'
import Tag from '../../../components/workspace/StaffTag.jsx'
import { vehicleName } from '../../../utils/workspace.js'
import { prettyDate } from '../../../data.js'
import Icon from '../../../components/ui/Icon.jsx'
import Empty from '../../../components/workspace/StaffEmpty.jsx'

export default function InspectionQueue({ bookings, onInspect }) {
  return <section className="workspace-surface staff-section"><div className="workspace-section-heading"><div><p className="workspace-kicker">THE NEXT CHECK</p><h2>Inspection queue</h2></div><Tag>{`${bookings.length} awaiting`}</Tag></div>{bookings.length ? <PaginatedList>{bookings.map(b => <article className="staff-ledger-row" key={b.id}><div><h3>{vehicleName(b.vehicleId)}</h3><p>{b.id} · {b.inspectionType === 'pre-dispatch' ? 'Pre-dispatch handover' : 'Post-return inspection'}</p><small>{prettyDate(b.start)} – {prettyDate(b.end)} · {b.status}</small></div><button className="button button-outline" onClick={() => onInspect(b)}>Inspect vehicle<Icon name="arrow" size={16} /></button></article>)}</PaginatedList> : <Empty>No reservations are awaiting an inspection.</Empty>}</section>
}

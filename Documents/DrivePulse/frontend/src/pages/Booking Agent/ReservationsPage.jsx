import Icon from '../../components/ui/Icon.jsx'
import ReservationTable from './components/ReservationTable.jsx'

const statuses = ['All statuses', 'Needs ID review', 'Payment review', 'Pending Approval', 'Ready for Dispatch', 'On Rental', 'Completed', 'Cancelled']

export default function AgentReservationsPage({ query, setQuery, status, setStatus, channel, setChannel, reservationList, open, onArchive }) {
  return <section className="workspace-surface">
    <div className="agent-table-toolbar">
      <label className="agent-search"><Icon name="search" size={18} /><input aria-label="Search reservations" maxLength={150} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search customer, vehicle, or reference" /></label>
      <div>
        <select aria-label="Filter booking status" value={status} onChange={e => setStatus(e.target.value)}>{statuses.map(s => <option key={s}>{s}</option>)}</select>
        <select aria-label="Filter booking channel" value={channel} onChange={e => setChannel(e.target.value)}><option>All channels</option><option>Online</option><option>Walk-in</option></select>
      </div>
    </div>
    <div className="workspace-section-heading">
      <h2>Reservations <span className="workspace-result-count">{reservationList.length}</span></h2>
      <span className="workspace-muted">One-click soft delete is available for completed or cancelled bookings</span>
    </div>
    <ReservationTable bookings={reservationList} onOpen={open} onArchive={onArchive} />
  </section>
}

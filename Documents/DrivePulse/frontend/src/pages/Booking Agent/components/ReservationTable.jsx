import WorkspaceEmpty from '../../../components/workspace/WorkspaceEmpty.jsx'
import { vehicleFor } from '../../../utils/vehicles.js'
import { prettyDate, money } from '../../../data.js'
import Tag from '../../../components/workspace/AgentTag.jsx'
import Icon from '../../../components/ui/Icon.jsx'

export default function ReservationTable({ bookings, onOpen, onArchive, compact = false }) {
  if (!bookings.length) return <WorkspaceEmpty title="You’re all caught up." copy="Reservations matching this view will appear here." />
  return <div className="agent-table-scroll"><table className={`agent-table ${compact ? 'is-compact' : ''}`}>
    <thead><tr><th>Customer / booking</th><th>Vehicle / schedule</th>{!compact && <th>Verification</th>}{!compact && <th>Payment</th>}<th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
    <tbody>{bookings.map(booking => <tr key={booking.id}>
      <td><strong>{booking.renter.name}</strong><small>{booking.id}{booking.sample ? ' · SAMPLE' : ''}</small><span className="table-channel">{booking.source}</span></td>
      <td><strong>{vehicleFor(booking).name}</strong><small>{prettyDate(booking.start)} – {prettyDate(booking.end)}</small></td>
      {!compact && <td><Tag solid={booking.verificationStatus === 'Verified'}>{booking.verificationStatus}</Tag></td>}
      {!compact && <td><strong>{money(booking.total)}</strong><small>{booking.paymentStatus}</small></td>}
      <td><Tag solid={['Ready for Dispatch', 'On Rental'].includes(booking.status)}>{booking.status}</Tag></td>
      <td>
        <div className="staff-card-actions">
          {!compact && onArchive && ['Completed', 'Cancelled'].includes(booking.status) && (
            <button type="button" className="text-link" onClick={() => onArchive(booking.id)}>Archive</button>
          )}
          <button className="icon-button" aria-label={`Open reservation ${booking.id}`} onClick={() => onOpen(booking.id)}><Icon name="diagonal" size={21} /></button>
        </div>
      </td>
    </tr>)}</tbody>
  </table></div>
}

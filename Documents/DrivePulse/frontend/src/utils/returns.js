import { tripTime } from '../data.js'

export function dropoffStatus(booking, now = Date.now()) {
  if (booking.returnedAt) return 'Dropped off'
  if (booking.status === 'On Rental' && tripTime(booking.end, booking.endTime) < now) return 'Overdue'
  return 'Scheduled'
}
export function conditionSignoff(booking) {
  if (!booking.returnedAt) return 'Pending drop-off'
  if (!booking.returnInspection) return 'Awaiting inspection'
  return booking.returnInspection.status === 'approved' ? 'Signed off' : 'Action required'
}

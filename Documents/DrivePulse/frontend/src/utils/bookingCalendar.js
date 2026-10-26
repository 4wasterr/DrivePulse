import { tripTime } from '../data.js'

// Use the selected times so a return and the next pickup may share a day.
// Return dates also check the whole interval, preventing a range from spanning
// a booking even when both endpoints would otherwise be free.
export function isBookedDate(day, { vehicleId, field, dates, bookings = [] }) {
  const point = tripTime(day, field === 'start' ? dates.startTime : dates.endTime)
  return bookings.some(b => {
    if (b.vehicleId !== vehicleId || b.archivedAt || ['Completed', 'Cancelled'].includes(b.status)) return false
    if (b.blocked) return true
    const start = tripTime(b.start, b.startTime), end = tripTime(b.end, b.endTime)
    if (field === 'start') return point >= start && point < end
    const pickup = tripTime(dates.start, dates.startTime)
    return point > pickup && pickup < end && point > start
  })
}

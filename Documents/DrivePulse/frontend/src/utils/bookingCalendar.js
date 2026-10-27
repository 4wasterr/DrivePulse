import { tripTime } from '../data.js'
import { overlaps } from '../../../shared/availability.mjs'

// Use the selected times so a return and the next pickup may share a day.
// Return dates also check the whole interval, preventing a range from spanning
// a booking even when both endpoints would otherwise be free.
export function isBookedDate(day, { vehicleId, field, dates, bookings = [] }) {
  const point = tripTime(day, field === 'start' ? dates.startTime : dates.endTime)
  return bookings.some(b => {
    if (b.vehicleId !== vehicleId || b.archivedAt || ['Completed', 'Cancelled'].includes(b.status)) return false
    if (b.blocked) {
      if (field === 'start') return (!b.end || point < tripTime(b.end, b.endTime)) && (!b.start || point >= tripTime(b.start, b.startTime))
      return overlaps(b, { ...dates, end: day })
    }
    const start = tripTime(b.start, b.startTime), end = tripTime(b.end, b.endTime)
    if (field === 'start') return point >= start && point < end
    const pickup = tripTime(dates.start, dates.startTime)
    return point > pickup && pickup < end && point > start
  })
}

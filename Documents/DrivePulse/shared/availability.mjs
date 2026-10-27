import { phtTime } from './validation.mjs'

// Half-open intervals allow a return and the next pickup at the same instant.
// Holds without a known end remain blocked until a mechanic clears them.
export function overlaps(record, input) {
  if (record.archivedAt || ['Completed', 'Cancelled'].includes(record.status)) return false
  const from = phtTime(input.start, input.startTime || '10:00')
  const until = phtTime(input.end, input.endTime || '10:00')
  if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from) return false
  if (record.blocked && !record.start && !record.end) return true
  const start = record.start ? phtTime(record.start, record.startTime || '10:00') : -Infinity
  const end = record.end ? phtTime(record.end, record.endTime || '10:00') : Infinity
  return from < end && until > start
}

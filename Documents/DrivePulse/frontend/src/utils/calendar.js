import { dateISO } from '../data.js'

export const addCalendarDays = (day, days) => new Date(Date.parse(day + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10)
export const clampCalendarStart = (day, today = dateISO()) => day && day >= today ? day : today
export function bookingDatesForDay(day, now = new Date()) {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' })
  const today = format.format(now)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '') || day < today || !Number.isFinite(Date.parse(day + 'T12:00:00Z'))) return null
  const next = new Date(now.getTime() + 60000)
  if (day === today && format.format(next) !== today) return null
  const startTime = day === today ? next.toLocaleTimeString('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false }) : '10:00'
  return { start: day, end: addCalendarDays(day, 1), startTime, endTime: '10:00' }
}

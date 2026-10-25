import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampCalendarStart, bookingDatesForDay } from '../src/utils/calendar.js'
import { filterMaintenance } from '../src/utils/maintenance.js'
import { paginate } from '../src/utils/pagination.js'
import { vehicles } from '../src/data.js'

test('calendar clamps past dates in PHT and starts same-day reservations in the future', () => {
  const now = new Date('2026-10-24T18:15:00Z')
  assert.equal(clampCalendarStart('2026-10-24', '2026-10-25'), '2026-10-25')
  assert.equal(bookingDatesForDay('2026-10-24', now), null)
  const today = bookingDatesForDay('2026-10-25', now)
  assert.equal(today.startTime, '02:16')
  assert.equal(today.end, '2026-10-26')
  assert.ok(Date.parse(today.start + 'T' + today.startTime + ':00+08:00') > now.getTime())
  assert.equal(bookingDatesForDay('2026-10-26', now).startTime, '10:00')
  assert.equal(bookingDatesForDay('2026-10-25', new Date('2026-10-25T15:59:45Z')), null)
})

test('repair filters separate active, completed and archived records and include PHT date boundaries', () => {
  const records = [
    { id: 'order-1', vehicleId: vehicles[0].id, status: 'Requested', by: 'Riley Cruz', at: '2026-10-24T16:30:00Z' },
    { id: 'order-2', workOrderCode: 'WO-REPAIR', vehicleId: vehicles[0].id, status: 'Completed', mechanic: 'Sam Mechanic', at: '2026-10-25T15:59:00Z' },
    { id: 'order-3', vehicleId: vehicles[0].id, status: 'Completed', archivedAt: '2026-10-26', by: 'Riley Cruz', at: '2026-10-25T16:00:00Z' }
  ]
  assert.deepEqual(filterMaintenance(records).map(r => r.id), ['order-1'])
  assert.deepEqual(filterMaintenance(records, { tab: 'completed', query: 'wo-repair' }).map(r => r.id), ['order-2'])
  assert.equal(filterMaintenance(records, { tab: 'completed', query: 'sam mechanic', start: '2026-10-25', end: '2026-10-25' }).length, 1)
  assert.equal(filterMaintenance(records, { query: 'riley', start: '2026-10-25', end: '2026-10-25' }).length, 1)
  assert.equal(filterMaintenance(records, { tab: 'archived', start: '2026-10-25', end: '2026-10-25' }).length, 0)
  assert.equal(filterMaintenance(records, { tab: 'archived', start: '2026-10-26', end: '2026-10-26' }).length, 1)
  assert.equal(filterMaintenance(records, { start: '2026-10-26', end: '2026-10-25' }).length, 0)
  const fleetRecord = { ...records[0], vehicle: { fleetCode: 'CAR-SEARCH' }, vehicleId: 'test-unit' }
  assert.equal(filterMaintenance([fleetRecord], { query: 'car-search' }).length, 1)
  assert.equal(paginate(Array.from({ length: 24 }, (_, id) => ({ ...records[0], id }))).items.length, 10)
})

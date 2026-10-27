import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isBookedDate } from '../src/utils/bookingCalendar.js'
import { conditionProblem, normalizeConditions, normalizeRatings, conditionLabel } from '../../shared/inspection.mjs'
import checklist from '../../shared/inspectionChecklist.json' with { type: 'json' }

test('calendar locks booked dates and intervals while permitting exact timed handovers', () => {
  const booking = { vehicleId: 'car', start: '2028-01-12', end: '2028-01-14', startTime: '10:00', endTime: '10:00', status: 'Ready for Dispatch' }
  const context = { vehicleId: 'car', field: 'start', dates: { start: '2028-01-10', startTime: '10:00', endTime: '10:00' }, bookings: [booking] }
  assert.equal(isBookedDate('2028-01-12', context), true)
  assert.equal(isBookedDate('2028-01-13', context), true)
  assert.equal(isBookedDate('2028-01-14', context), false)
  assert.equal(isBookedDate('2028-01-11', context), false)
  assert.equal(isBookedDate('2028-01-12', { ...context, field: 'end' }), false)
  assert.equal(isBookedDate('2028-01-15', { ...context, field: 'end' }), true)
  for (const status of ['Cancelled', 'Completed']) assert.equal(isBookedDate('2028-01-13', { ...context, bookings: [{ ...booking, status }] }), false)
  assert.equal(isBookedDate('2028-01-13', { ...context, bookings: [{ ...booking, archivedAt: 'today' }] }), false)
  assert.equal(isBookedDate('2028-01-13', { ...context, vehicleId: 'other' }), false)
  assert.equal(isBookedDate('2028-01-30', { ...context, bookings: [{ vehicleId: 'car', blocked: true, status: 'Maintenance' }] }), true)
})

test('condition statuses reject missing assessments and prevent unsafe approval', () => {
  const good = Object.fromEntries(checklist.map(({ key }) => [key, 'Good']))
  assert.equal(conditionProblem(good, checklist, 'approved'), '')
  assert.ok(conditionProblem({ ...good, tyres: '' }, checklist, 'approved'))
  assert.ok(conditionProblem({ ...good, tyres: 'N/A' }, checklist, 'approved'))
  assert.ok(conditionProblem({ ...good, exterior: 'Damaged' }, checklist, 'approved'))
  assert.equal(conditionProblem({ ...good, exterior: 'Damaged' }, checklist, 'unsafe'), '')
  assert.equal(conditionProblem({ ...good, exterior: 'N/A', interior: 'Fair' }, checklist, 'approved'), '')
  assert.deepEqual(normalizeConditions(Object.fromEntries(checklist.map(({ key }) => [key, true])), checklist), good)
})

test('mechanic ratings preserve the 1–4 scale and enforce dispatch safety', () => {
  const ratings = { tyres: 1, controls: 2, exterior: 3, interior: 4, fuel: 1 }
  assert.deepEqual(normalizeConditions(ratings, checklist), { tyres: 'Good', controls: 'Fair', exterior: 'Damaged', interior: 'Needs Repair', fuel: 'Good' })
  assert.deepEqual(normalizeRatings(normalizeConditions(ratings, checklist), checklist), ratings)
  assert.equal(conditionLabel(1), '1 – Good')
  assert.equal(conditionLabel(4), '4 – Needs Repair')
  assert.equal(conditionLabel('Fair'), '2 – Fair')
  assert.equal(conditionLabel('N/A'), 'N/A (earlier inspection)')
  assert.equal(conditionLabel(null), 'Not recorded')
  assert.match(conditionProblem(ratings, checklist, 'approved'), /Repair/)
  assert.equal(conditionProblem(ratings, checklist, 'unsafe'), '')
  assert.equal(conditionProblem({ ...ratings, exterior: 1, interior: 2 }, checklist, 'approved'), '')
  for (const invalid of [0, 5, 1.5, null, false, '', 'unknown']) assert.ok(conditionProblem({ ...ratings, tyres: invalid }, checklist, 'unsafe'))
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inspectionBooking, inspectionTypeForVehicle } from '../src/utils/inspectionBooking.js'

const returned = { id: 'return-new', vehicleId: 'car', status: 'Completed', returnedAt: '2026-10-27T03:00:00Z', dispatchOdometer: 1500 }
const upcoming = { id: 'pickup-next', vehicleId: 'car', status: 'Pending Approval', start: '2026-10-28', startTime: '10:00' }

test('vehicle inspections automatically link the outstanding trip and preserve queue context', () => {
  const bookings = [
    { ...returned, id: 'already-reviewed', returnedAt: '2026-10-25T03:00:00Z', returnInspection: { status: 'approved' } },
    { ...returned, id: 'other-car', vehicleId: 'another' }, returned, upcoming,
  ]
  assert.equal(inspectionBooking(bookings, 'car', 'post-return').id, returned.id)
  assert.equal(inspectionBooking(bookings, 'car', 'post-return').dispatchOdometer, 1500)
  assert.equal(inspectionTypeForVehicle(bookings, 'car'), 'post-return')
  assert.equal(inspectionBooking(bookings, 'car', 'pre-dispatch').id, upcoming.id)
  assert.equal(inspectionBooking([...bookings, { ...returned, id: 'queue-context' }], 'car', 'post-return', 'queue-context').id, 'queue-context')
  assert.equal(inspectionBooking(bookings, 'car', 'clearance'), null)
})

test('automatic linking chooses the earliest outstanding inspection and never uses a closed or archived trip', () => {
  const bookings = [{ ...upcoming, id: 'later', start: '2026-11-01' }, upcoming, { ...upcoming, id: 'cancelled', status: 'Cancelled' }, { ...upcoming, id: 'archived', start: '2026-10-01', archivedAt: '2026-10-02' }]
  assert.equal(inspectionBooking(bookings, 'car', 'pre-dispatch').id, upcoming.id)
  assert.equal(inspectionTypeForVehicle(bookings, 'car'), 'pre-dispatch')
  assert.equal(inspectionTypeForVehicle([], 'car'), 'clearance')
  assert.equal(inspectionBooking([{ ...returned, returnedAt: undefined }], 'car', 'post-return'), null)
  assert.equal(inspectionBooking([{ ...returned, returnInspection: { status: 'approved' } }], 'car', 'post-return'), null)
})

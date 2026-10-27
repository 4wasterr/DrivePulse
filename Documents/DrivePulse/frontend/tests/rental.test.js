import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialDates, isAvailable, canChooseBookingDates, rentalDays, rentalPeriodError, tripTime } from '../src/data.js'
import { validateFile } from '../src/storage.js'

test('quotes use started 24-hour periods and allow a shorter same-day rental', () => {
  assert.equal(rentalDays('2099-01-01', '2099-01-04'), 3)
  assert.equal(rentalDays('2099-01-01', '2099-01-02', '10:00', '10:01'), 2)
  assert.equal(rentalDays('2099-01-01', '2099-01-01', '10:00', '16:00'), 1)
  assert.equal(tripTime('2099-01-01', '10:00'), Date.parse('2099-01-01T02:00:00Z'))
})

test('availability blocks overlaps but permits an exact handover and ignores completed rentals', () => {
  const booking = { vehicleId: 'car-1', start: '2099-01-03', end: '2099-01-06', startTime: '10:00', endTime: '10:00', status: 'Pending Approval' }
  assert.equal(isAvailable('car-1', { start: '2099-01-02', end: '2099-01-04' }, [booking]), false)
  assert.equal(isAvailable('car-1', { start: '2099-01-04', end: '2099-01-05' }, [booking]), false)
  assert.equal(isAvailable('car-1', { start: '2099-01-01', end: '2099-01-09' }, [booking]), false)
  assert.equal(isAvailable('car-1', { start: '2099-01-01', end: '2099-01-03' }, [booking]), true)
  assert.equal(isAvailable('car-1', { start: '2099-01-06', end: '2099-01-07' }, [booking]), true)
  assert.equal(isAvailable('car-2', { start: '2099-01-04', end: '2099-01-05' }, [booking]), true)
  assert.equal(isAvailable('car-1', { start: '2099-01-04', end: '2099-01-05' }, [{ ...booking, status: 'Completed' }]), true)
  assert.equal(isAvailable('car-1', { start: '', end: '' }, []), false)
})

test('invalid, past, and inverted rental periods cannot proceed', () => {
  assert.match(rentalPeriodError({ start: '', end: '' }), /valid/)
  assert.match(rentalPeriodError({ start: '2099-02-31', end: '2099-03-05' }), /valid/)
  assert.match(rentalPeriodError({ start: '2000-01-01', end: '2000-01-02' }), /future/)
  assert.match(rentalPeriodError({ start: '2099-01-03', end: '2099-01-02' }), /after/)
  assert.match(rentalPeriodError({ start: '2099-01-03', end: '2099-01-03' }), /after/)
  assert.equal(rentalPeriodError({ start: '2099-01-03', end: '2099-01-03', startTime: '10:00', endTime: '16:00' }), '')
  assert.equal(rentalPeriodError(initialDates()), '')
  assert.equal(rentalPeriodError({ start: '2099-01-01', end: '2100-01-02' }), '')
  assert.match(rentalPeriodError({ start: '2099-01-01', end: '2100-01-03' }), /366/)
})

test('reserved and rented vehicles remain selectable and free periods include exact timed handovers', () => {
  for (const status of ['Pending Approval', 'Ready for Dispatch', 'On Rental']) {
    const booking = { vehicleId: 'car-1', start: '2099-01-10', startTime: '10:00', end: '2099-01-12', endTime: '14:00', status }
    assert.equal(canChooseBookingDates('car-1', [booking]), true)
    assert.equal(isAvailable('car-1', { start: '2099-01-09', end: '2099-01-10', endTime: '10:00' }, [booking]), true)
    assert.equal(isAvailable('car-1', { start: '2099-01-12', startTime: '14:00', end: '2099-01-13' }, [booking]), true)
    assert.equal(isAvailable('car-1', { start: '2099-01-12', startTime: '13:59', end: '2099-01-13' }, [booking]), false)
    assert.equal(isAvailable('car-1', { start: '2099-01-11', end: '2099-01-12' }, [booking]), false)
  }
  const maintenance = { vehicleId: 'car-1', blocked: true, status: 'Maintenance', start: '2099-01-10', end: '2099-01-12' }
  assert.equal(canChooseBookingDates('car-1', [maintenance]), true)
  assert.equal(isAvailable('car-1', { start: '2099-01-13', end: '2099-01-14' }, [maintenance]), true)
  for (const status of ['Maintenance', 'Under Inspection', 'Out of Service', 'Overdue']) {
    assert.equal(canChooseBookingDates('car-1', [{ vehicleId: 'car-1', blocked: true, status }]), false)
  }
})

test('operational holds block all dates and cannot appear as rentable vehicles', () => {
  for (const status of ['Maintenance', 'Under Inspection', 'Out of Service', 'Overdue']) {
    assert.equal(isAvailable('car-1', { start: '2099-01-01', end: '2099-01-02' }, [{ vehicleId: 'car-1', status, blocked: true }]), false)
    assert.equal(isAvailable('car-2', { start: '2099-01-01', end: '2099-01-02' }, [{ vehicleId: 'car-1', status, blocked: true }]), true)
  }
})

test('document uploads reject unsupported formats and files larger than 4 MB', () => {
  assert.equal(validateFile(new File(['sample'], 'license.pdf', { type: 'application/pdf' })), null)
  assert.equal(validateFile(new File(['sample'], 'id.png', { type: 'image/png' })), null)
  assert.match(validateFile(new File(['sample'], 'script.html', { type: 'text/html' })), /PDF/)
  assert.equal(validateFile({ type: 'application/pdf', size: 4 * 1024 * 1024 }), null)
  assert.match(validateFile({ type: 'application/pdf', size: 4 * 1024 * 1024 + 1 }), /4 MB/)
  assert.match(validateFile(undefined), /choose a file/)
})

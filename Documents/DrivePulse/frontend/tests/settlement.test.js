import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cancellationFee, cancellationSettlement } from '../../shared/cancellation.mjs'
import { mileageConsumption } from '../../shared/mileage.mjs'
import { isAvailable } from '../src/data.js'
import { isBookedDate } from '../src/utils/bookingCalendar.js'
import { fetchDocument } from '../src/api.js'

test('pre-dispatch cancellation charges 20% of verified downpayment and returns the full deposit', () => {
  const booking = { payments: [{ type: 'rental', amount: 3000, status: 'confirmed' }, { type: 'deposit', amount: 5000, status: 'confirmed' }, { type: 'rental', amount: 9000, status: 'pending' }] }
  assert.equal(cancellationFee(booking), 600)
  assert.deepEqual(cancellationSettlement(booking), { fee: 600, feeFromRental: 600, feeFromDeposit: 0, rentalRefund: 2400, depositRefund: 5000, refundDue: 7400, balanceDue: 0 })
  assert.equal(cancellationFee({ payments: [{ type: 'deposit', amount: 5000, status: 'confirmed' }] }), 0)
  assert.equal(cancellationFee({ payments: [{ type: 'rental', amount: 1.03, status: 'confirmed' }] }), 0.21)
  assert.equal(cancellationSettlement({ ...booking, cancellation: { reason: 'Legacy cancellation' } }).fee, 0, 'existing cancellations must not acquire a new fee')
})

test('return mileage uses the dispatch baseline and rejects missing or reversed readings', () => {
  assert.equal(mileageConsumption(1500, 2500), 1000)
  assert.equal(mileageConsumption(1500, 1500), 0)
  assert.equal(mileageConsumption(1500.01, 2500.12), 1000.11)
  assert.throws(() => mileageConsumption(1500, 1499), /lower/)
  for (const missing of [null, undefined, NaN, '1500']) assert.throws(() => mileageConsumption(missing, 2500), /dispatch odometer/)
})

test('scheduled downtime blocks its exact interval in both the picker and availability checks', () => {
  const hold = { vehicleId: 'car', blocked: true, status: 'Maintenance', start: '2099-01-10', startTime: '09:00', end: '2099-01-11', endTime: '14:00' }
  const dates = { start: '2099-01-11', startTime: '14:00', end: '2099-01-12', endTime: '10:00' }
  assert.equal(isAvailable('car', dates, [hold]), true)
  assert.equal(isAvailable('car', { ...dates, startTime: '13:59' }, [hold]), false)
  assert.equal(isAvailable('car', { start: '2099-01-01', end: '2099-01-10', endTime: '09:00' }, [hold]), true)
  assert.equal(isBookedDate('2099-01-11', { vehicleId: 'car', field: 'start', dates, bookings: [hold] }), false)
  assert.equal(isBookedDate('2099-01-10', { vehicleId: 'car', field: 'start', dates: { ...dates, startTime: '10:00' }, bookings: [hold] }), true)
})

test('document failures explain network, access and invalid payloads; successful reads bypass caches', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch') })
  await assert.rejects(fetchDocument('file'), /Check your connection/)
  globalThis.fetch = async () => Response.json({ error: 'Document not found.' }, { status: 404 })
  await assert.rejects(fetchDocument('file'), error => error.status === 404)
  globalThis.fetch = async () => new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } })
  await assert.rejects(fetchDocument('file'), /unsupported document/)
  globalThis.fetch = async (url, options) => { assert.equal(options.cache, 'no-store'); assert.equal(options.credentials, 'same-origin'); return new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } }) }
  assert.equal((await fetchDocument('file')).type, 'application/pdf')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inputError, validDate, phtTime, extensionError, returnError, duplicateVehicleErrors } from '../../shared/validation.mjs'
import { validateFile } from '../src/storage.js'

test('names and contact details reject obvious mistakes while allowing common real formats', () => {
  for (const name of ['José O’Neill', "Anne-Marie D'Souza", '李 明', 'Prince', 'J. R. Cruz']) assert.equal(inputError(name, { kind: 'name', required: true }), '')
  for (const name of ['   ', '12345', '<script>', 'Alex@Home']) assert.ok(inputError(name, { kind: 'name', required: true }))
  for (const email of ['alex@example.com', 'alex+rentals@sub.example.ph', '  Alex@Example.com  ']) assert.equal(inputError(email, { kind: 'email' }), '')
  for (const email of ['alex@', 'alex@example', '.alex@example.com', 'alex..test@example.com', 'alex@-example.com', 'alex@example..com']) assert.ok(inputError(email, { kind: 'email' }))
  for (const phone of ['09171234567', '+63 (917) 123-4567', '(02) 8123 4567', '+1-202-555-0123']) assert.equal(inputError(phone, { kind: 'phone' }), '')
  for (const phone of ['call me', '123', '+63+9171234567', '1234567890123456']) assert.ok(inputError(phone, { kind: 'phone' }))
  assert.equal(inputError('', { kind: 'email' }), '')
  assert.equal(inputError('', { kind: 'fleet-code' }), '')
})

test('amounts and readings respect numeric bounds and precision without imposing rate increments', () => {
  const money = { kind: 'number', required: true, min: 0, max: 1e9, step: 0.01 }
  for (const value of [0, '0.01', '5123.45', 999999999.99]) assert.equal(inputError(value, money), '')
  for (const value of ['', ' ', '-1', 'NaN', Infinity, '12.345', true, {}]) assert.ok(inputError(value, money))
  assert.equal(inputError('4', { kind: 'number', min: 2, max: 15, step: 1 }), '')
  assert.ok(inputError('4.5', { kind: 'number', min: 2, max: 15, step: 1 }))
  assert.ok(inputError('101', { kind: 'number', min: 0, max: 100, step: 0.01 }))
})

test('text, fleet identifiers and references have useful, forgiving boundaries', () => {
  assert.ok(inputError('   ', { required: true }))
  assert.equal(inputError('  ', { required: false }), '')
  assert.equal(inputError('No damage.\nInterior clean.', { required: true }), '')
  assert.ok(inputError('bad\u0000value'))
  assert.ok(inputError('long', { maxLength: 3 }))
  assert.equal(inputError(' Abcdef! ', { kind: 'password', required: true, minLength: 8 }), '')
  assert.equal(inputError('ABC 1234', { kind: 'plate' }), '')
  assert.equal(inputError('CAR_2026-01', { kind: 'fleet-code' }), '')
  assert.ok(inputError('!!!', { kind: 'plate' }))
  assert.equal(inputError('OR/2026-0001', { kind: 'reference' }), '')
  assert.ok(inputError('---', { kind: 'reference' }))
})

test('dates use real calendar days and rental changes compare both date and time in PHT', () => {
  assert.equal(validDate('2028-02-29'), true)
  assert.equal(validDate('2026-02-29'), false)
  assert.equal(validDate('2026-04-31'), false)
  assert.equal(inputError('2026-10-25', { kind: 'date', min: '2026-10-25', max: '2026-10-26' }), '')
  assert.ok(inputError('2026-10-27', { kind: 'date', max: '2026-10-26' }))
  assert.ok(inputError('24:00', { kind: 'time' }))
  const booking = { start: '2026-10-25', startTime: '10:00', end: '2026-10-26', endTime: '10:00', dispatchedAt: '2026-10-25T02:15:00Z' }
  const now = phtTime('2026-10-26', '11:00')
  assert.ok(extensionError(booking, '2026-10-26', '09:00', now))
  assert.ok(extensionError(booking, '2026-10-26', '10:00', now))
  assert.equal(extensionError(booking, '2026-10-26', '12:00', now), '')
  assert.ok(returnError(booking, '2026-10-25', '10:10', now))
  assert.ok(returnError(booking, '2026-10-26', '12:00', now))
  assert.equal(returnError(booking, '2026-10-26', '10:00', now), '')
})

test('empty uploads are rejected before sending bytes', () => {
  assert.match(validateFile({ type: 'image/png', size: 0 }), /empty/i)
  assert.equal(validateFile({ type: 'image/png', size: 100 }), null)
})

test('sign-in accepts demo usernames and existing emails without applying registration password rules', () => {
  for (const value of ['demo', 'bkagent', 'flmechanic', 'opmanager', 'Alex@Example.com', 'alex.santos-1']) assert.equal(inputError(value, { kind: 'login-identifier', required: true, maxLength: 160 }), '')
  for (const value of ['  ', 'alex name', 'alex@example..com', '???']) assert.ok(inputError(value, { kind: 'login-identifier', required: true }))
  assert.equal(inputError('demo', { kind: 'password', required: true, maxLength: 128 }), '')
  assert.ok(inputError('demo', { kind: 'password', required: true, minLength: 8 }))
})

test('fleet identity checks ignore spacing and the vehicle currently being edited', () => {
  const vehicles = [{ id: 'car-one', fleetCode: 'CAR-001', plate: 'ABC 1234' }]
  const errors = duplicateVehicleErrors({ fleetCode: 'car 001', plate: 'abc-1234' }, vehicles)
  assert.ok(errors.every(error => error.message))
  assert.ok(duplicateVehicleErrors({ fleetCode: 'CAR-001' }, vehicles, 'car-one').every(error => !error.message))
  assert.ok(duplicateVehicleErrors({ fleetCode: '', plate: '' }, vehicles).every(error => !error.message))
})

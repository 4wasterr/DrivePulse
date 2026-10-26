import { test } from 'node:test'
import assert from 'node:assert/strict'
import { confirmationFor, registerConfirmationHandler } from '../src/utils/confirmations.js'
import { api } from '../src/api.js'
import { clientProfile } from '../../shared/clientProfile.mjs'

test('destructive and operational routes require confirmation while authentication and uploads remain direct', () => {
  for (const [path, method] of [['/manager/archives/users/id', 'DELETE'], ['/manager/users/id', 'PATCH'], ['/agent/bookings/id/dispatch', 'POST'], ['/mechanic/vehicles/id/status', 'POST'], ['/bookings/id/cancel', 'POST']]) assert.ok(confirmationFor(path, { method }))
  assert.match(confirmationFor('/manager/archives/users/id', { method: 'DELETE' }).message, /cannot be undone/)
  assert.equal(confirmationFor('/logout', { method: 'POST' }).message, 'Are you sure you want to log out?')
  for (const path of ['/auth/login', '/auth/reset-password', '/bookings/agreement-preview', '/documents/license', '/notifications/read']) assert.equal(confirmationFor(path, { method: 'POST' }), null)
})

test('cancelled confirmations prevent any network mutation', async t => {
  let sent = 0
  t.mock.method(globalThis, 'fetch', async () => { sent++; return Response.json({ ok: true }) })
  const unregister = registerConfirmationHandler(async () => false)
  t.after(unregister)
  await assert.rejects(api('/manager/users/id', { method: 'PATCH', body: { role: 'manager' } }), { code: 'ACTION_CANCELLED' })
  assert.equal(sent, 0)
})

test('accepted confirmations execute the intended request once', async t => {
  let sent = 0
  t.mock.method(globalThis, 'fetch', async () => { sent++; return Response.json({ ok: true }) })
  const unregister = registerConfirmationHandler(async () => true)
  t.after(unregister)
  assert.deepEqual(await api('/logout', { method: 'POST' }), { ok: true })
  assert.equal(sent, 1)
})

test('client profiles support an optional middle name and normalize Philippine contact formats', () => {
  const input = { firstName: 'Ariane', lastName: 'Fetalvo', phone: '0917 123 4567', street: '12 Main Street', city: 'Quezon City', postalCode: '1100' }
  assert.equal(clientProfile(input).name, 'Ariane Fetalvo')
  assert.equal(clientProfile({ ...input, phone: '+63 917 123 4567' }).phone, '+639171234567')
  assert.throws(() => clientProfile({ ...input, lastName: '' }), /required/)
  assert.throws(() => clientProfile({ ...input, phone: '1234567' }), /Philippine mobile/)
})

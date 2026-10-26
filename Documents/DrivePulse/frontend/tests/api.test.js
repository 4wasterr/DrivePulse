import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api } from '../src/api.js'

test('a non-JSON service outage explains temporary unavailability and preserves the HTTP status', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>Service Unavailable</html>', { status: 503, headers: { 'Content-Type': 'text/html' } }))
  await assert.rejects(api('/auth/forgot-password', { method: 'POST', body: { email: 'client@example.com' } }), error => {
    assert.equal(error.status, 503)
    assert.match(error.message, /temporarily unavailable/)
    return true
  })
})

test('API errors keep the server message and account-verification details', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Verify your email before signing in.', code: 'EMAIL_NOT_VERIFIED', email: 'client@example.com' }, { status: 403 }))
  await assert.rejects(api('/auth/login', { method: 'POST', body: { email: 'client@example.com', password: 'Example!123' } }), error => {
    assert.equal(error.message, 'Verify your email before signing in.')
    assert.equal(error.code, 'EMAIL_NOT_VERIFIED')
    assert.equal(error.data.email, 'client@example.com')
    return true
  })
})

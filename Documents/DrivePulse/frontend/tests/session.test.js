import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api, fetchDocument } from '../src/api.js'
import { createSessionState, sessionState } from '../src/utils/session.js'

function mockWindow(t, events) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { dispatchEvent: event => events.push(event) } })
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window })
}

test('only an active session can expire, and expiry is idempotent', () => {
  const state = createSessionState()
  assert.equal(state.expire(), false, 'anonymous login pages must not expire')
  state.restore('client')
  const revision = state.revision
  assert.equal(state.expire(revision), true)
  assert.equal(state.expire(revision), false)
  assert.equal(state.userId, null)
})

test('stale expiry and idle callbacks cannot revoke a new sign-in, including the same account', () => {
  const state = createSessionState()
  state.authenticated('client')
  const oldRevision = state.revision
  state.beginAuthentication()
  assert.equal(state.expire(oldRevision), false)
  assert.equal(state.authenticating, true)
  state.authenticated('client')
  assert.equal(state.expire(oldRevision), false)
  assert.equal(state.userId, 'client')
  assert.equal(state.authenticating, false)
})

test('SESSION_EXPIRED API errors do not reintroduce an alert on an anonymous login page', async t => {
  sessionState.clear()
  const events = []
  mockWindow(t, events)
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Session expired.', code: 'SESSION_EXPIRED' }, { status: 401 }))
  await assert.rejects(api('/sync'), { code: 'SESSION_EXPIRED' })
  await assert.rejects(fetchDocument('old-file'), { code: 'SESSION_EXPIRED' })
  assert.equal(events.length, 0)
})

test('late API and document failures from an earlier session cannot expire a successful login', async t => {
  const events = []
  mockWindow(t, events)
  sessionState.authenticated('client')
  const pending = []
  t.mock.method(globalThis, 'fetch', () => new Promise(resolve => pending.push(resolve)))
  const workspace = api('/workspace')
  const file = fetchDocument('old-file')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(pending.length, 2)
  sessionState.authenticated('client')
  pending.forEach(resolve => resolve(Response.json({ error: 'Old session expired.', code: 'SESSION_EXPIRED' }, { status: 401 })))
  await assert.rejects(workspace, { code: 'SESSION_EXPIRED' })
  await assert.rejects(file, { code: 'SESSION_EXPIRED' })
  assert.equal(events.length, 0)
  assert.equal(sessionState.userId, 'client')
  sessionState.clear()
})

test('current authenticated expiry still reaches the application with its session revision', async t => {
  sessionState.authenticated('agent')
  t.after(() => sessionState.clear())
  const events = []
  mockWindow(t, events)
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Session expired.', code: 'SESSION_EXPIRED' }, { status: 401 }))
  const revision = sessionState.revision
  await assert.rejects(api('/workspace'), { code: 'SESSION_EXPIRED' })
  assert.equal(events.length, 1)
  assert.equal(events[0].detail.revision, revision)
})

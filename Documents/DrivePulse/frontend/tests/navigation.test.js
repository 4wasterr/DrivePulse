import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getBackNavigation, readNavigationTrail, routeFromHash, hashParam } from '../src/utils/navigation.js'

test('hash route and query parameter extraction parse email recovery and verification links', () => {
  assert.equal(routeFromHash('#verify-email?token=abc-123_xyz'), 'verify-email')
  assert.equal(hashParam('token', '#verify-email?token=abc-123_xyz'), 'abc-123_xyz')
  assert.equal(routeFromHash('#reset-password?token=reset-token-456'), 'reset-password')
  assert.equal(hashParam('token', '#reset-password?token=reset-token-456'), 'reset-token-456')
  assert.equal(routeFromHash('#forgot-password'), 'forgot-password')
  assert.equal(hashParam('token', '#forgot-password'), '')
  assert.equal(routeFromHash(''), 'home')
})

test('module Back walks the visited route trail and browser history restores earlier trails', () => {
  const first = readNavigationTrail('overview', null)
  const fleet = readNavigationTrail('fleet', null, first)
  const bookings = readNavigationTrail('bookings', null, fleet)
  assert.deepEqual(getBackNavigation(bookings, 'bookings', 'client'), { page: 'fleet', delta: -1 })
  const restored = readNavigationTrail('fleet', { drivepulseNavigation: fleet }, bookings)
  assert.deepEqual(restored, ['overview', 'fleet'])
  assert.deepEqual(getBackNavigation(restored, 'fleet', 'client'), { page: 'overview', delta: -1 })
  assert.deepEqual(readNavigationTrail('fleet', null, restored), restored)
})

test('Back skips sign-in and workspaces belonging to a different role', () => {
  const trail = ['home', 'manager-analytics', 'login', 'agent-overview', 'agent-calendar']
  assert.deepEqual(getBackNavigation(trail, 'agent-calendar', 'agent'), { page: 'agent-overview', delta: -1 })
  assert.deepEqual(getBackNavigation(trail.slice(0, -1), 'agent-overview', 'agent'), { page: 'home', delta: -3 })
  assert.deepEqual(getBackNavigation(['home', 'login', 'signup'], 'signup'), { page: 'login', delta: -1 })
})

test('direct module links fall back to their own overview without leaving DrivePulse', () => {
  for (const [role, page, home] of [
    ['client', 'payments', 'overview'],
    ['agent', 'agent-reservations', 'agent-overview'],
    ['mechanic', 'mechanic-maintenance', 'mechanic-overview'],
    ['manager', 'manager-archives', 'manager-overview'],
  ]) {
    assert.deepEqual(getBackNavigation([page], page, role), { page: home, delta: 0 })
    assert.deepEqual(getBackNavigation([home], home, role), { page: 'home', delta: 0 })
  }
  assert.deepEqual(getBackNavigation(['login'], 'login'), { page: 'home', delta: 0 })
  assert.deepEqual(readNavigationTrail('payments', { drivepulseNavigation: ['home', 3] }), ['payments'])
})

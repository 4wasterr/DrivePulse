import { test } from 'node:test'
import assert from 'node:assert/strict'
import { watchInactivity, INACTIVITY_MS } from '../src/utils/inactivity.js'

function surface() {
  const listeners = new Map()
  return { addEventListener: (name, listener) => listeners.set(name, listener), removeEventListener: name => listeners.delete(name), emit: (name, event = {}) => listeners.get(name)?.({ isTrusted: true, ...event }) }
}
const storage = () => { const values = new Map(); return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } }

test('clicks, keypresses and navigation reset idle time while background focus only checks expiry', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let time = 1000000, expired = 0, synced = 0
  const target = surface()
  const stop = watchInactivity({ userId: 'one', lastActivity: time, target, storage: storage(), now: () => time, onExpire: () => expired++, onActivity: () => synced++ })
  const advance = milliseconds => { time += milliseconds; t.mock.timers.tick(milliseconds) }
  advance(INACTIVITY_MS - 1); target.emit('click'); assert.equal(expired, 0)
  advance(INACTIVITY_MS - 1); target.emit('keydown'); assert.equal(expired, 0)
  advance(INACTIVITY_MS - 1); target.emit('hashchange'); assert.equal(expired, 0)
  advance(INACTIVITY_MS - 1); target.emit('focus'); assert.equal(expired, 0)
  advance(1); assert.equal(expired, 1); assert.equal(synced, 3)
  target.emit('click'); assert.equal(expired, 1)
  stop()
})

test('continuous typing sends bounded activity updates and another tab can end the session', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let time = 1000000, expired = 0, synced = 0
  const target = surface(), values = storage()
  const stop = watchInactivity({ userId: 'one', lastActivity: time, target, storage: values, now: () => time, onExpire: () => expired++, onActivity: () => synced++ })
  for (let i = 0; i < 600; i++) { time += 100; t.mock.timers.tick(100); target.emit('keydown') }
  assert.ok(synced >= 2 && synced <= 3)
  target.emit('storage', { key: 'drivepulse:logout:someone-else', newValue: '1' }); assert.equal(expired, 0)
  target.emit('storage', { key: 'drivepulse:logout:one', newValue: '1' }); assert.equal(expired, 1)
  stop()
})

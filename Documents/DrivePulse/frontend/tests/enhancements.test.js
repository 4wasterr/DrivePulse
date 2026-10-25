import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paginate } from '../src/utils/pagination.js'
import { passwordRequirements, validPassword, suggestPassword } from '../src/utils/password.js'
import { syncVehicles, vehicles } from '../src/data.js'
import { vehicleFor } from '../src/utils/vehicles.js'

test('pagination keeps ten rows and retains access to the final partial page', () => {
  const rows = Array.from({ length: 23 }, (_, id) => id)
  assert.deepEqual(paginate(rows).items, rows.slice(0, 10))
  assert.deepEqual(paginate(rows, 2).items, rows.slice(10, 20))
  assert.deepEqual(paginate(rows, 3).items, [20, 21, 22])
  assert.equal(paginate(rows, 99).page, 3)
  assert.equal(paginate(rows.slice(0, 2), 3).page, 1)
  assert.deepEqual(paginate([], 1), { items: [], page: 1, pages: 1, total: 0 })
})

test('password requirements reject missing character classes and generators satisfy every rule', () => {
  for (const weak of ['Short!', 'lowercase!', 'UPPERCASE!', 'MissingSpecial1', 'Whitespace Only', 'Aa!'.repeat(44)]) assert.equal(validPassword(weak), false)
  assert.equal(validPassword('Abcdefg!'), true)
  assert.ok(passwordRequirements('Abcdefg!').every(rule => rule.met))
  const suggestions = Array.from({ length: 100 }, suggestPassword)
  assert.equal(new Set(suggestions).size, 100)
  assert.ok(suggestions.every(password => password.length === 16 && validPassword(password)))
})

test('saved fleet profiles populate the catalog and preserve archived booking lookups', () => {
  const original = vehicles.map(v => ({ ...v }))
  try {
    syncVehicles([...original, { id: 'new-vehicle', name: 'Toyota Hiace', fleetCode: 'CAR-NEW', image: '/api/vehicle-images/photo', rate: 3500, seats: 12, fuelType: 'Diesel' }, { id: 'old-vehicle', name: 'Retired car', archivedAt: '2026-01-01' }])
    assert.equal(vehicleFor({ vehicleId: 'new-vehicle' }).image, '/api/vehicle-images/photo')
    assert.equal(vehicleFor({ vehicleId: 'new-vehicle' }).fleetCode, 'CAR-NEW')
    assert.equal(vehicleFor({ vehicleId: 'old-vehicle' }).name, 'Retired car')
    assert.equal(vehicleFor({ vehicleId: 'removed-vehicle' }).name, 'removed-vehicle')
  } finally { syncVehicles(original) }
})

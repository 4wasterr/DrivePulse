const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renewalNotices } = require('../vehicleProfile');

test('renewal notices use PHT calendar dates and all threshold boundaries', () => {
  const at = new Date('2026-10-24T16:30:00Z'); // October 25 in Manila
  const date = days => new Date(Date.UTC(2026, 9, 25 + days)).toISOString().slice(0, 10);
  const vehicles = [31, 30, 16, 15, 8, 7, 0, -1].map(days => ({ id: String(days), name: 'Car', registrationExpiry: date(days) }));
  const notices = renewalNotices(vehicles, at);
  assert.equal(notices.length, 7);
  for (const [days, milestone] of [[30, '30'], [16, '30'], [15, '15'], [8, '15'], [7, '7'], [0, '7'], [-1, 'overdue']]) {
    const n = notices.find(n => n.vehicleId === String(days));
    assert.equal(n.days, days); assert.equal(n.milestone, milestone);
  }
  assert.match(notices.find(n => n.days === 0).message, /today/);
  assert.deepEqual(renewalNotices([{ id: 'archived', archivedAt: 'yesterday', insuranceExpiry: date(-1) }, { id: 'missing' }], at), []);
  const original = renewalNotices([{ id: 'one', registrationExpiry: date(30) }], at)[0];
  const escalation = renewalNotices([{ id: 'one', registrationExpiry: date(30) }], new Date('2026-11-08T16:30:00Z'))[0];
  assert.notEqual(original.id, escalation.id);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { SQLiteDatabase, PostgresDatabase } = require('../db');
const { createApp } = require('../application');
const { createFleet } = require('../fleet');
const { transientDatabaseFailure } = require('../database-errors');

test('PostgreSQL dashboard snapshots finish while a booking writer holds the mutation lock', async () => {
  const clients = [];
  let lockTail = Promise.resolve(), startWriter, releaseWriter;
  const started = new Promise(resolve => { startWriter = resolve; });
  const writerGate = new Promise(resolve => { releaseWriter = resolve; });
  const pool = { connect: async () => {
    let releaseLock;
    const calls = [];
    const client = { calls, released: false, query: async sql => {
      calls.push(sql);
      if (sql.includes('pg_advisory_xact_lock')) {
        const previous = lockTail;
        lockTail = new Promise(resolve => { releaseLock = resolve; });
        await previous;
      }
      if (['COMMIT', 'ROLLBACK'].includes(sql)) releaseLock?.();
      return { rows: [{ value: 'snapshot' }] };
    }, release() { this.released = true; } };
    clients.push(client);
    return client;
  } };
  const db = new PostgresDatabase(pool);
  const writing = db.transaction(async () => { startWriter(); await writerGate; return 'updated'; });
  await started;
  let readCompleted = false;
  const reading = db.readSnapshot(async () => {
    const row = await db.prepare('SELECT value FROM example').get();
    readCompleted = true;
    return row.value;
  });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(readCompleted, true, 'dashboard reads must not queue behind a booking mutation');
    assert.equal(clients[0].released, false, 'the writer is still active');
    assert.equal(clients[1].calls[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    assert.equal(await reading, 'snapshot');
  } finally { releaseWriter(); await Promise.all([writing, reading]); }
  assert.ok(clients.every(client => client.released));
  assert.ok(clients[0].calls.some(sql => sql.includes('pg_advisory_xact_lock')), 'mutations retain their booking conflict protection');
});

test('a failed dashboard snapshot rolls back and releases its database connection', async () => {
  const calls = [];
  const client = { query: async sql => { calls.push(sql); return { rows: [] }; }, release: () => calls.push('release') };
  const db = new PostgresDatabase({ connect: async () => client });
  await assert.rejects(db.readSnapshot(async () => { throw new Error('Test snapshot failure'); }), /Test snapshot failure/);
  assert.deepEqual(calls, ['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', 'ROLLBACK', 'release']);
});

test('fleet snapshots fetch vehicle states in bulk and preserve holds, rates and odometers', async () => {
  const reads = [];
  const saved = [
    { id: 'bmw-3', status: 'Available', rate: 4600, odometer: 2500, plate: 'XYZ 9876', version: 3 },
    { id: 'mercedes-c', status: 'Out of Service', archivedAt: '2026-10-27T06:00:00Z', version: 2 },
  ];
  const db = { prepare: sql => ({ all: async kind => {
    reads.push({ sql, kind });
    assert.match(sql, /WHERE kind=\?/);
    return (kind === 'vehicle' ? saved : []).map(value => ({ payload: JSON.stringify(value) }));
  } }) };
  const fleet = createFleet({ db, allBookings: async () => [{ id: 'test-rental', vehicleId: 'bmw-3', status: 'On Rental', end: '2099-01-01', endTime: '10:00' }] });
  const result = await fleet.fleet();
  assert.equal(reads.length, 2, 'one definition read and one state read, independent of fleet size');
  const vehicle = result.find(item => item.id === 'bmw-3');
  assert.equal(vehicle.rate, 4600);
  assert.equal(vehicle.odometer, 2500);
  assert.equal(vehicle.plate, 'XYZ 9876');
  assert.equal(vehicle.status, 'Rented');
  assert.equal(vehicle.bookingId, 'test-rental');
  assert.equal(result.some(item => item.id === 'mercedes-c'), false);
  assert.equal((await fleet.fleet(true)).find(item => item.id === 'mercedes-c').status, 'Decommissioned');
});

test('database connection outages return a retryable 503 without exposing connection details', async t => {
  const database = new SQLiteDatabase(':memory:');
  const { app } = await createApp({ database, seedDemo: false });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); database.close(); });
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
  let failure;
  t.mock.method(database, 'readSnapshot', async () => { throw failure; });
  for (const error of [new Error('timeout exceeded when trying to connect'), Object.assign(new Error('postgresql://secret:password@private-host/postgres'), { code: '53300' })]) {
    failure = error;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/sync`);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '1');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { error: 'DrivePulse is temporarily unavailable. Please try again shortly.', code: 'SERVICE_UNAVAILABLE' });
  }
  assert.doesNotMatch(logs.join(' '), /secret|password@|private-host/);
  assert.equal(transientDatabaseFailure(Object.assign(new Error('Wrong password'), { code: '28P01' })), false);
  assert.equal(transientDatabaseFailure(new Error('Test business validation')), false);
});

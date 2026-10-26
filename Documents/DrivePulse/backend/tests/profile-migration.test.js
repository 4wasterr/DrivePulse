const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../db');
const { profileColumns } = require('../schema');
const { testDatabase } = require('./helpers/database');

for (const adapter of ['sqlite', 'postgres']) test(`${adapter} upgrades existing profiles and security tables without losing accounts`, async t => {
  const previous = process.env.DRIVEPULSE_TEST_POSTGRES;
  let db;
  try {
    if (adapter === 'postgres') { process.env.DRIVEPULSE_TEST_POSTGRES = 'true'; db = await testDatabase(); }
    else db = createDatabase({ filename: ':memory:', env: {} });
  } finally {
    if (previous === undefined) delete process.env.DRIVEPULSE_TEST_POSTGRES;
    else process.env.DRIVEPULSE_TEST_POSTGRES = previous;
  }
  t.after(() => db.close());
  await db.initialize();
  await db.prepare('INSERT INTO users(id,email,name,role,salt,password_hash) VALUES(?,?,?,?,?,?)').run('existing', 'existing@example.com', 'Existing Account', 'client', 'existing-salt', 'existing-hash');
  await db.exec('DROP TABLE recovery_codes; DROP TABLE login_locks;');
  for (const column of profileColumns) await db.exec(`ALTER TABLE users DROP COLUMN ${column}`);
  await db.initialize();
  await db.initialize();
  const user = await db.prepare('SELECT * FROM users WHERE id=?').get('existing');
  assert.equal(user.name, 'Existing Account');
  assert.equal(user.password_hash, 'existing-hash');
  for (const column of profileColumns) assert.equal(user[column], '');
  assert.deepEqual(await db.prepare('SELECT * FROM recovery_codes').all(), []);
  assert.deepEqual(await db.prepare('SELECT * FROM login_locks').all(), []);
  if (adapter === 'postgres') {
    const secured = await db.query("SELECT COUNT(*) AS count FROM pg_class WHERE relname IN ('recovery_codes','login_locks') AND relrowsecurity");
    assert.equal(Number(secured.rows[0].count), 2);
  }
});

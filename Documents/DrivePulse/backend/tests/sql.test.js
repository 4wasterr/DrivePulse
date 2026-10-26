const { test } = require('node:test');
const assert = require('node:assert/strict');
const { preparedSql, assertBindings } = require('../sql');
const { SQLiteDatabase, PostgresDatabase } = require('../db');

test('prepared SQL counts only real placeholders and refuses stacked statements', () => {
  const sql = `SELECT '?' AS literal, "?" AS identifier, $$?$$ AS quoted, ? AS value /* ? */ -- ?\n;`;
  assert.equal(preparedSql(sql).count, 1);
  assert.match(preparedSql(sql).postgres, /\$1 AS value/);
  for (const text of ['SELECT ?; DELETE FROM users', 'SELECT ?; -- comment\nDROP TABLE users', 'SELECT ?;;']) assert.throws(() => preparedSql(text), /one SQL statement/);
  assert.throws(() => assertBindings(["' OR 1=1 --"], 0), /count/);
  for (const value of [undefined, {}, [], true, NaN, Infinity]) assert.throws(() => assertBindings([value], 1), /scalar/);
});

test('SQLite binds injection payloads as data and rejects structured parameters', t => {
  const db = new SQLiteDatabase(':memory:'); t.after(() => db.close());
  db.exec('CREATE TABLE example (id TEXT PRIMARY KEY, value TEXT)');
  const payload = "Robert'); DROP TABLE example; --";
  db.prepare('INSERT INTO example VALUES(?,?)').run('one', payload);
  assert.equal(db.prepare('SELECT value FROM example WHERE id=?').get('one').value, payload);
  assert.equal(db.prepare('SELECT * FROM example WHERE id=?').get("one' OR '1'='1"), undefined);
  assert.throws(() => db.prepare('SELECT * FROM example WHERE id=?').get({ toString: () => "' OR 1=1 --" }), /scalar/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM example').get().count, 1);
});

test('PostgreSQL keeps SQL and hostile values separate at the driver boundary', async () => {
  const calls = [], db = new PostgresDatabase({ query: async (sql, params) => { calls.push({ sql, params }); return { rows: [], rowCount: 0 }; } });
  const payload = "'; UPDATE users SET role='manager'; --";
  await db.prepare("SELECT '?' AS literal FROM users WHERE id=?").all(payload);
  assert.deepEqual(calls, [{ sql: "SELECT '?' AS literal FROM users WHERE id=$1", params: [payload] }]);
  await assert.rejects(db.prepare('SELECT * FROM users WHERE id=?').all({ id: payload }), /scalar/);
  assert.equal(calls.length, 1);
});

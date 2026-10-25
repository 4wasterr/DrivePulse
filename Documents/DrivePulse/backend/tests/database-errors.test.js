const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { databaseDiagnostic } = require('../database-errors');

test('database diagnostics explain authentication, TLS and schema failures without leaking driver details', () => {
  const secret = 'postgresql://private-user:private-password@private-host/postgres';
  for (const [code, expected] of [
    ['28P01', /password authentication failed.*28P01/],
    ['SELF_SIGNED_CERT_IN_CHAIN', /DATABASE_CA_CERT/],
    ['42P01', /db:migrate/],
    ['DATABASE_SCHEMA_MISSING', /db:migrate/],
    ['ENOTFOUND', /hostname could not be resolved/]
  ]) {
    const error = Object.assign(new Error(secret), { code, detail: secret, input: secret });
    const message = databaseDiagnostic(error);
    assert.match(message, expected);
    assert.ok(!message.includes('private-'));
  }
  assert.equal(databaseDiagnostic(Object.assign(new Error(secret), { code: secret })), databaseDiagnostic(null));
  assert.ok(!databaseDiagnostic(new AggregateError([Object.assign(new Error(secret), { code: 'EACCES' })])).includes('private-'));
  assert.match(databaseDiagnostic(new AggregateError([Object.assign(new Error(secret), { code: 'EACCES' })])), /network access was denied/);
});

test('standalone startup and migration commands diagnose a bare password without logging it', () => {
  const secret = 'not-a-url-private-password';
  for (const args of [['index.js'], ['scripts/manage-db.js', 'migrate']]) {
    const result = spawnSync(process.execPath, args, {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, NODE_ENV: 'production', ALLOW_AGENT_SIGNUP: 'false', DATABASE_URL: secret },
      timeout: 10000, encoding: 'utf8', windowsHide: true
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DATABASE_URL must be a complete postgresql:\/\/ connection URL/);
    assert.ok(!(result.stdout + result.stderr).includes(secret));
  }
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { databaseDiagnostic, databaseFailureDetails } = require('../database-errors');

test('startup details redact URLs, credentials and nested driver errors', () => {
  const env = { DATABASE_URL: 'postgresql://private-user:secret%40password@private-host/postgres', SMTP_PASS: 'private-smtp-pass', DATABASE_CA_CERT: 'private-ca-certificate', NODE_ENV: 'production' };
  const child = new Error('Failed secret@password private-user private-smtp-pass private-ca-certificate ' + env.DATABASE_URL);
  const error = new AggregateError([child], 'Connection closed unexpectedly');
  const result = databaseFailureDetails(error, env), serialized = JSON.stringify(result);
  for (const secret of ['secret@password', 'secret%40password', 'private-user', 'private-host', 'private-smtp-pass', 'private-ca-certificate']) assert.ok(!serialized.includes(secret));
  assert.match(serialized, /Connection closed unexpectedly/);
  assert.equal(result.configuration.caCertificateConfigured, true);
  assert.equal(result.configuration.productionMode, true);
});

test('database diagnostics explain authentication, TLS and schema failures without leaking driver details', () => {
  const secret = 'postgresql://private-user:private-password@private-host/postgres';
  for (const [code, expected] of [
    ['28P01', /password authentication failed.*28P01/],
    ['SELF_SIGNED_CERT_IN_CHAIN', /DATABASE_CA_CERT/],
    ['ERR_OSSL_PEM_NO_START_LINE', /not a valid PEM certificate/],
    ['ERR_OSSL_PEM_BAD_BASE64_DECODE', /not a valid PEM certificate/],
    ['ENOENT', /On Vercel, use DATABASE_CA_CERT/],
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
  assert.match(databaseDiagnostic(new Error('SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string')), /DATABASE_URL must include/);
  assert.match(databaseDiagnostic(new Error('Connection terminated due to connection timeout')), /Database connection timed out/);
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

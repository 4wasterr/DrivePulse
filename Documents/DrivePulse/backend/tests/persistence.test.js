const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createApp } = require('../application');
const { createDatabase } = require('../db');
const { validateProduction } = require('../scripts/preflight');
const { spawnSync } = require('node:child_process');

test('accounts, sessions, uploads, tickets and audits survive a local API restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'drivepulse-persistence-'));
  let runtime, server;
  t.after(async () => {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    runtime?.db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  async function start() {
    runtime = await createApp({ dbPath: join(directory, 'test.sqlite'), seedDemo: false, allowAgentSignup: false });
    server = runtime.app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    return `http://127.0.0.1:${server.address().port}/api`;
  }
  let base = await start();
  const signup = await fetch(base + '/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'client', name: 'Persistent client', firstName: 'Persistent', lastName: 'client', phone: '0917 123 4567', street: '12 Main Street', city: 'Quezon City', regionCode: '1300000000', cityCode: '1381300000', barangayCode: '1381300001', postalCode: '1100', email: 'persistent@example.com', password: 'StrongPass123!' }) });
  assert.equal(signup.status, 201);
  const cookie = signup.headers.get('set-cookie').split(';')[0];
  const file = Buffer.from('%PDF-1.7\npersisted test document');
  const upload = await fetch(base + '/documents/license', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/pdf', 'X-File-Name': 'license.pdf' }, body: file });
  assert.equal(upload.status, 201);
  const document = await upload.json();
  const support = await fetch(base + '/support', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ subject: 'Persistent query', message: 'Please keep this conversation after restart.' }) });
  assert.equal(support.status, 201);
  await new Promise(resolve => server.close(resolve));
  runtime.db.close(); runtime = null;
  base = await start();
  const workspace = await fetch(base + '/workspace', { headers: { Cookie: cookie } });
  assert.equal(workspace.status, 200);
  const data = await workspace.json();
  assert.equal(data.user.email, 'persistent@example.com');
  assert.equal(data.documents.license.id, document.id);
  assert.equal(data.tickets[0].subject, 'Persistent query');
  const download = await fetch(base + '/documents/' + document.id, { headers: { Cookie: cookie } });
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), file);
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 1);
});

test('production cannot fall back to a local database', () => {
  assert.throws(() => createDatabase({ env: { NODE_ENV: 'production' } }), /DATABASE_URL is required/);
  assert.throws(() => createDatabase({ env: { VERCEL: '1' } }), /DATABASE_URL is required/);
});

test('the manager command creates a hashed account once and preserves it on a second attempt', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'drivepulse-manager-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = { ...process.env, NODE_ENV: 'development', DATABASE_URL: '', DATABASE_PATH: join(directory, 'manager.sqlite'), BOOTSTRAP_MANAGER_NAME: 'Initial manager', BOOTSTRAP_MANAGER_EMAIL: 'owner@example.com', BOOTSTRAP_MANAGER_PASSWORD: 'PrivateManager123!' };
  const command = () => spawnSync(process.execPath, [join(__dirname, '../scripts/manage-db.js'), 'manager'], { env, timeout: 10000, encoding: 'utf8', windowsHide: true });
  const created = command();
  assert.ifError(created.error);
  assert.equal(created.status, 0, created.stderr);
  assert.ok(!created.stdout.includes(env.BOOTSTRAP_MANAGER_PASSWORD));
  const second = command();
  assert.equal(second.status, 1);
  assert.match(second.stderr, /already exists/);
  const db = createDatabase({ filename: env.DATABASE_PATH, env: {} });
  try {
    const manager = db.prepare('SELECT * FROM users WHERE email=?').get(env.BOOTSTRAP_MANAGER_EMAIL);
    assert.equal(manager.role, 'manager');
    assert.equal(manager.password_hash.length, 128);
    assert.notEqual(manager.password_hash, env.BOOTSTRAP_MANAGER_PASSWORD);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
  } finally { db.close(); }
});

test('production preflight reports missing configuration and accepts exact HTTPS origins', () => {
  assert.equal(validateProduction({}).length, 6);
  const env = { NODE_ENV: 'production', ALLOW_AGENT_SIGNUP: 'false', DATABASE_URL: 'postgresql://postgres.ref:strong-example-secret@pooler.example.com:6543/postgres', FRONTEND_ORIGIN: 'https://drivepulse.example.com', SMTP_USER: 'sender@gmail.com', SMTP_PASS: 'test-app-password' };
  assert.deepEqual(validateProduction(env), []);
  assert.ok(validateProduction({ ...env, FRONTEND_ORIGIN: 'https://drivepulse.example.com/' }).length);
  assert.ok(validateProduction({ ...env, ALLOW_AGENT_SIGNUP: 'true' }).length);
  assert.match(validateProduction({ ...env, SMTP_USER: '' }).join(' '), /SMTP_USER/);
  assert.match(validateProduction({ ...env, SMTP_PASS: '' }).join(' '), /SMTP_PASS/);
  assert.match(validateProduction({ ...env, SMTP_PORT: '25' }).join(' '), /SMTP_PORT/);
});

test('checked-in Supabase SQL matches the executable migration', () => {
  const sql = readFileSync(join(__dirname, '../supabase-schema.sql'), 'utf8');
  assert.ok(sql.includes(require('../schema').postgresSchema));
});

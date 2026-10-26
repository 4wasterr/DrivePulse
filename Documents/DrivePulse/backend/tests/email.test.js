const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../application');
const { createMailer } = require('../email');
const { testDatabase } = require('./helpers/database');

// Captures outgoing messages instead of calling Resend.
function fakeMailer() {
  const sent = [];
  return {
    sent,
    isMock: true,
    async sendVerification(message) { sent.push({ kind: 'verify', ...message }); return { id: 'test' }; },
    async sendPasswordReset(message) { sent.push({ kind: 'reset', ...message }); return { id: 'test' }; },
  };
}

async function fixture(t, mailer = fakeMailer()) {
  const { app, db } = await createApp({ database: await testDatabase(), dbPath: ':memory:', seedDemo: false, mailer });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await db.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (path, body, headers = {}) => {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const tokenFrom = url => new URL(url.replace('/#', '/?').replace('?token', '&token')).searchParams.get('token');
  return { request, mailer, db, tokenFrom };
}

const signup = { role: 'client', name: 'Rei Zenoh', email: 'reizenoh24@gmail.com', password: 'StrongPass123!' };

test('client sign-up sends a verification button link and the link signs the client in', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/session')).data.emailDelivery, true);
  const created = await f.request('/auth/signup', signup, { Origin: 'http://127.0.0.1:5173' });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.verificationRequired, true);
  assert.equal(created.cookie, undefined);
  assert.equal(f.mailer.sent.length, 1);
  assert.match(f.mailer.sent[0].verifyUrl, /^http:\/\/127\.0\.0\.1:5173\/#verify-email\?token=/);

  const blocked = await f.request('/auth/login', { email: signup.email, password: signup.password });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.code, 'EMAIL_NOT_VERIFIED');

  const token = f.tokenFrom(f.mailer.sent[0].verifyUrl);
  const stored = await f.db.prepare('SELECT token FROM auth_tokens').get();
  assert.notEqual(stored.token, token, 'only the token digest is stored');

  const verified = await f.request('/auth/verify-email', { token });
  assert.equal(verified.status, 200, JSON.stringify(verified.data));
  assert.equal(verified.data.user.emailVerified, true);
  assert.ok(verified.cookie);
  assert.equal((await f.request('/session', null, { Cookie: verified.cookie })).data.user.email, signup.email);
  assert.equal((await f.request('/auth/verify-email', { token })).status, 400, 'links are single-use');
  assert.equal((await f.request('/auth/login', { email: signup.email, password: signup.password })).status, 200);
});

test('verification can be resent without revealing whether an account exists', async t => {
  const f = await fixture(t);
  await f.request('/auth/signup', signup);
  await f.db.prepare("UPDATE auth_tokens SET issued_at='2000-01-01T00:00:00.000Z'").run();
  const known = await f.request('/auth/resend-verification', { email: signup.email });
  const unknown = await f.request('/auth/resend-verification', { email: 'nobody@example.com' });
  assert.equal(known.status, 200); assert.deepEqual(known.data, unknown.data);
  assert.equal(f.mailer.sent.length, 2);
  assert.equal((await f.request('/auth/verify-email', { token: f.tokenFrom(f.mailer.sent[0].verifyUrl) })).status, 400, 'older links are replaced');
  assert.equal((await f.request('/auth/verify-email', { token: f.tokenFrom(f.mailer.sent[1].verifyUrl) })).status, 200);
});

test('forgot password emails a single-use reset link that changes the password and revokes sessions', async t => {
  const f = await fixture(t);
  await f.request('/auth/signup', signup);
  const session = await f.request('/auth/verify-email', { token: f.tokenFrom(f.mailer.sent[0].verifyUrl) });
  const known = await f.request('/auth/forgot-password', { email: signup.email.toUpperCase() });
  const unknown = await f.request('/auth/forgot-password', { email: 'nobody@example.com' });
  assert.equal(known.status, 200); assert.deepEqual(known.data, unknown.data);
  const reset = f.mailer.sent.find(m => m.kind === 'reset');
  assert.match(reset.resetUrl, /#reset-password\?token=/);
  const token = f.tokenFrom(reset.resetUrl);
  assert.equal((await f.request('/auth/reset-password', { token, password: 'weak' })).status, 400);
  const changed = await f.request('/auth/reset-password', { token, password: 'BrandNewPass!9' });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  assert.equal((await f.request('/auth/reset-password', { token, password: 'AnotherPass!9' })).status, 400);
  assert.equal((await f.request('/session', null, { Cookie: session.cookie })).data.user, null);
  assert.equal((await f.request('/auth/login', { email: signup.email, password: signup.password })).status, 401);
  assert.equal((await f.request('/auth/login', { email: signup.email, password: 'BrandNewPass!9' })).status, 200);
  const audit = JSON.stringify(await f.db.prepare('SELECT * FROM audit_log').all());
  assert.doesNotMatch(audit, /BrandNewPass|StrongPass|token=/);
});

test('expired links are rejected and failed delivery leaves no half-created account', async t => {
  const f = await fixture(t);
  await f.request('/auth/signup', signup);
  await f.db.prepare('UPDATE auth_tokens SET expires=1').run();
  assert.equal((await f.request('/auth/verify-email', { token: f.tokenFrom(f.mailer.sent[0].verifyUrl) })).status, 400);

  const failingMailer = createMailer({ env: { RESEND_API: 'test' }, resendClient: { emails: { send: async () => ({ error: { message: 'You can only send testing emails to your own email address' } }) } } });
  failingMailer.isMock = true;
  const failing = await fixture(t, failingMailer);
  const result = await failing.request('/auth/signup', { ...signup, email: 'other@example.com' });
  assert.equal(result.status, 400);
  assert.match(result.data.error, /test mode/);
  assert.equal(await failing.db.prepare('SELECT id FROM users WHERE email=?').get('other@example.com'), undefined);
});

test('without an email provider, recovery is unavailable and sign-up keeps working', async t => {
  const { app, db } = await createApp({ database: await testDatabase(), dbPath: ':memory:', seedDemo: false, mailer: null });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await db.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('/auth/signup', signup)).status, 201);
  assert.equal((await post('/auth/forgot-password', { email: signup.email })).status, 503);
});

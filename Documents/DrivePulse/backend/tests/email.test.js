const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../application');
const { createMailer } = require('../email');
const { emailConfigurationProblems } = require('../email-config');
const nodemailer = require('nodemailer');
const { testDatabase } = require('./helpers/database');

// Captures outgoing messages without contacting an email provider.
function fakeMailer() {
  const sent = [];
  return {
    sent,
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
const smtpEnv = { SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '465', SMTP_USER: 'sender@gmail.com', SMTP_PASS: 'abcd efgh ijkl mnop' };

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

  const failingMailer = createMailer({ env: smtpEnv, smtpTransport: { async sendMail() { throw Object.assign(new Error('private SMTP response'), { code: 'EAUTH' }); } } });
  const failing = await fixture(t, failingMailer);
  const result = await failing.request('/auth/signup', { ...signup, email: 'other@example.com' });
  assert.equal(result.status, 503);
  assert.equal(result.data.code, 'EMAIL_DELIVERY_FAILED');
  assert.doesNotMatch(result.data.error, /private SMTP response/);
  assert.equal(await failing.db.prepare('SELECT id FROM users WHERE email=?').get('other@example.com'), undefined);
});

test('SMTP sends verification and reset links to the client, using the deployed site origin', async t => {
  const messages = [];
  const mailer = createMailer({ env: smtpEnv, smtpTransport: { async sendMail(message) {
    messages.push(message);
    return { accepted: [message.to], rejected: [], messageId: 'smtp-test' };
  } } });
  const f = await fixture(t, mailer);
  const created = await f.request('/auth/signup', { ...signup, email: 'customer@example.com' }, { Origin: 'http://127.0.0.1:5173' });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.verificationRequired, true, 'configured email delivery never bypasses confirmation for example domains');
  assert.equal(messages[0].to, 'customer@example.com');
  assert.equal(messages[0].from, 'DrivePulse <sender@gmail.com>');
  assert.equal(messages[0].replyTo, 'sender@gmail.com');
  assert.match(messages[0].html, /Verify email &amp; open DrivePulse/);
  const verificationUrl = messages[0].text.match(/http[^\s]+/)[0];
  const verified = await f.request('/auth/verify-email', { token: f.tokenFrom(verificationUrl) });
  assert.equal(verified.status, 200);

  const previous = process.env.FRONTEND_ORIGIN;
  process.env.FRONTEND_ORIGIN = 'https://drivepulse-production.vercel.app';
  try { assert.equal((await f.request('/auth/forgot-password', { email: 'customer@example.com' })).status, 200); }
  finally { if (previous === undefined) delete process.env.FRONTEND_ORIGIN; else process.env.FRONTEND_ORIGIN = previous; }
  assert.equal(messages[1].to, 'customer@example.com');
  const resetUrl = messages[1].text.match(/http[^\s]+/)[0];
  assert.match(resetUrl, /^https:\/\/drivepulse-production\.vercel\.app\/#reset-password\?token=/);
  assert.equal((await f.request('/auth/reset-password', { token: f.tokenFrom(resetUrl), password: 'ChangedPass!123' })).status, 200);
  assert.equal((await f.request('/auth/login', { email: 'customer@example.com', password: 'ChangedPass!123' })).status, 200);
});

test('Gmail SMTP defaults require TLS and strip App Password spaces without a provider switch', t => {
  const options = [];
  t.mock.method(nodemailer, 'createTransport', config => { options.push(config); return { sendMail: async () => ({ accepted: ['customer@example.com'] }) }; });
  createMailer({ env: smtpEnv });
  createMailer({ env: { ...smtpEnv, SMTP_PORT: '587' } });
  createMailer({ env: { SMTP_USER: smtpEnv.SMTP_USER, SMTP_PASS: smtpEnv.SMTP_PASS } });
  assert.equal(options[0].secure, true);
  assert.equal(options[1].secure, false);
  assert.ok(options.every(config => config.requireTLS));
  assert.equal(options[0].auth.pass, 'abcdefghijklmnop');
  assert.equal(options[2].host, 'smtp.gmail.com');
  assert.equal(options[2].port, 465);
  assert.equal(createMailer({ env: { ...smtpEnv, SMTP_PASS: '' } }), null);
  assert.equal(createMailer({ env: { ...smtpEnv, SMTP_PORT: '25' } }), null);
  assert.equal(createMailer({ env: {} }), null);
  assert.deepEqual(emailConfigurationProblems(smtpEnv), []);
});

test('failed SMTP delivery leaves no usable token or resend cooldown and can be retried immediately', async t => {
  let fail = false;
  const mailer = createMailer({ env: smtpEnv, smtpTransport: { async sendMail(message) {
    if (fail) throw Object.assign(new Error('private provider response'), { code: 'EAUTH' });
    return { accepted: [message.to], rejected: [], messageId: 'smtp-test' };
  } } });
  const f = await fixture(t, mailer);
  await f.request('/auth/signup', signup);
  fail = true;
  await f.db.prepare("UPDATE auth_tokens SET issued_at='2000-01-01T00:00:00.000Z'").run();
  assert.equal((await f.request('/auth/resend-verification', { email: signup.email })).status, 503);
  assert.equal(await f.db.prepare('SELECT token FROM auth_tokens').get(), undefined);
  fail = false;
  assert.equal((await f.request('/auth/resend-verification', { email: signup.email })).status, 200);
  fail = true;
  const failed = await f.request('/auth/forgot-password', { email: signup.email });
  assert.equal(failed.status, 503);
  assert.doesNotMatch(JSON.stringify(failed.data), /private provider response/);
  assert.equal(await f.db.prepare("SELECT token FROM auth_tokens WHERE kind='reset_password'").get(), undefined);
  fail = false;
  assert.equal((await f.request('/auth/forgot-password', { email: signup.email })).status, 200);
  assert.ok(await f.db.prepare("SELECT token FROM auth_tokens WHERE kind='reset_password'").get());
});

test('SMTP recipient rejection rolls back registration', async t => {
  const mailer = createMailer({ env: smtpEnv, smtpTransport: { async sendMail() { return { accepted: [], rejected: ['customer@example.com'] }; } } });
  const f = await fixture(t, mailer);
  assert.equal((await f.request('/auth/signup', signup)).status, 503);
  assert.equal(await f.db.prepare('SELECT id FROM users WHERE email=?').get(signup.email), undefined);
});

test('production never creates an already-verified client when email delivery is missing', async t => {
  const f = await fixture(t, null);
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const created = await f.request('/auth/signup', signup);
    assert.equal(created.status, 503);
    assert.equal(await f.db.prepare('SELECT id FROM users WHERE email=?').get(signup.email), undefined);
  } finally { process.env.NODE_ENV = previous; }
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

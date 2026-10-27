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
    async sendAccountUnlock(message) { sent.push({ kind: 'unlock', ...message }); return { id: 'test' }; },
  };
}

async function fixture(t, mailer = fakeMailer()) {
  const { app, db } = await createApp({ database: await testDatabase(), dbPath: ':memory:', seedDemo: false, mailer });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await db.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (path, body, headers = {}, method = body ? 'POST' : 'GET') => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const tokenFrom = url => new URL(url.replace('/#', '/?').replace('?token', '&token')).searchParams.get('token');
  return { request, mailer, db, tokenFrom };
}

const signup = { role: 'client', name: 'Rei Zenoh', firstName: 'Rei', lastName: 'Zenoh', phone: '0917 123 4567', street: '12 Main Street', city: 'Quezon City', regionCode: '1300000000', cityCode: '1381300000', barangayCode: '1381300001', postalCode: '1100', email: 'reizenoh24@gmail.com', password: 'StrongPass123!' };
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
  const [known] = await Promise.all([1, 2].map(() => f.request('/auth/resend-verification', { email: signup.email })));
  const unknown = await f.request('/auth/resend-verification', { email: 'nobody@example.com' });
  assert.equal(known.status, 200); assert.deepEqual(known.data, unknown.data);
  assert.equal(f.mailer.sent.length, 2);
  assert.equal((await f.request('/auth/verify-email', { token: f.tokenFrom(f.mailer.sent[0].verifyUrl) })).status, 400, 'older links are replaced');
  assert.equal((await f.request('/auth/verify-email', { token: f.tokenFrom(f.mailer.sent[1].verifyUrl) })).status, 200);
});

test('forgot password emails a single-use six-digit code that changes the password and revokes sessions', async t => {
  const f = await fixture(t);
  await f.request('/auth/signup', signup);
  const session = await f.request('/auth/verify-email', { token: f.tokenFrom(f.mailer.sent[0].verifyUrl) });
  const known = await f.request('/auth/forgot-password', { email: signup.email.toUpperCase() });
  const unknown = await f.request('/auth/forgot-password', { email: 'nobody@example.com' });
  assert.equal(known.status, 200); assert.equal(known.data.message, unknown.data.message);
  const reset = f.mailer.sent.find(m => m.kind === 'reset');
  assert.match(reset.resetUrl, /#reset-password\?challenge=/);
  assert.match(reset.code, /^[0-9]{6}$/);
  const code = reset.code, challengeId = known.data.challengeId;
  const stored = await f.db.prepare('SELECT * FROM recovery_codes WHERE challenge_id=?').get(challengeId);
  assert.notEqual(stored.code_hash, code);
  assert.ok(Number(stored.expires) - Date.now() <= 10 * 60000);
  assert.equal((await f.request('/auth/reset-password', { challengeId, code, password: 'weak' })).status, 400);
  const changed = await f.request('/auth/reset-password', { challengeId, code, password: 'BrandNewPass!9' });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  assert.equal((await f.request('/auth/reset-password', { challengeId, code, password: 'AnotherPass!9' })).status, 400);
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

test('SMTP sends verification links and recovery codes to the client, using the deployed site origin', async t => {
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
  assert.match(messages[0].html, /cid:drivepulse-logo/);
  assert.equal(messages[0].attachments[0].contentType, 'image/png');
  assert.equal(messages[0].attachments[0].content.subarray(1, 4).toString(), 'PNG');
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
  assert.match(resetUrl, /^https:\/\/drivepulse-production\.vercel\.app\/#reset-password\?challenge=/);
  assert.equal((await f.request('/auth/reset-password', { challengeId: new URL(resetUrl.replace('/#', '/?').replace('?challenge', '&challenge')).searchParams.get('challenge'), code: messages[1].text.match(/code is: (\d{6})/)[1], password: 'ChangedPass!123' })).status, 200);
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
  assert.equal(await f.db.prepare("SELECT challenge_id FROM recovery_codes").get(), undefined);
  fail = false;
  assert.equal((await f.request('/auth/forgot-password', { email: signup.email })).status, 200);
  assert.ok(await f.db.prepare("SELECT challenge_id FROM recovery_codes").get());
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

test('recovery codes expire, stop after five failed attempts, and cannot be reused across challenges', async t => {
  const f = await fixture(t);
  await f.request('/auth/signup', signup);
  const first = await f.request('/auth/forgot-password', { email: signup.email });
  const firstCode = f.mailer.sent.find(message => message.kind === 'reset').code;
  const repeated = await f.request('/auth/forgot-password', { email: signup.email });
  assert.equal(first.data.challengeId, repeated.data.challengeId);
  assert.equal(f.mailer.sent.filter(message => message.kind === 'reset').length, 1, 'cooldown prevents another email');
  const wrong = firstCode === '000000' ? '000001' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await f.request('/auth/reset-password', { challengeId: first.data.challengeId, code: wrong, password: 'ChangedPass!123' })).status, 400);
  assert.equal((await f.request('/auth/reset-password', { challengeId: first.data.challengeId, code: firstCode, password: 'ChangedPass!123' })).status, 400);
  assert.equal(Number((await f.db.prepare('SELECT attempts FROM recovery_codes WHERE challenge_id=?').get(first.data.challengeId)).attempts), 5);
  await f.db.prepare('UPDATE recovery_codes SET issued_at=1').run();
  const second = await f.request('/auth/forgot-password', { email: signup.email });
  assert.notEqual(first.data.challengeId, second.data.challengeId);
  const secondCode = f.mailer.sent.filter(message => message.kind === 'reset').at(-1).code;
  await f.db.prepare('UPDATE recovery_codes SET expires=1').run();
  assert.equal((await f.request('/auth/reset-password', { challengeId: second.data.challengeId, code: secondCode, password: 'ChangedPass!123' })).status, 400);
});

test('simultaneous resets consume a correct code once', async t => {
  const f = await fixture(t);
  await f.request('/auth/signup', signup);
  const issued = await f.request('/auth/forgot-password', { email: signup.email });
  const code = f.mailer.sent.find(message => message.kind === 'reset').code;
  const outcomes = await Promise.all([1, 2].map(() => f.request('/auth/reset-password', { challengeId: issued.data.challengeId, code, password: 'ChangedPass!123' })));
  assert.deepEqual(outcomes.map(result => result.status).sort(), [200, 400]);
});

test('three failed logins send one unlock email and lock even correct credentials for 60 seconds', async t => {
  const f = await fixture(t);
  await f.request('/auth/signup', signup);
  await f.request('/auth/verify-email', { token: f.tokenFrom(f.mailer.sent[0].verifyUrl) });
  for (let i = 0; i < 2; i++) assert.equal((await f.request('/auth/login', { email: signup.email, password: 'Incorrect!123' })).status, 401);
  const locked = await f.request('/auth/login', { email: signup.email, password: 'Incorrect!123' });
  assert.equal(locked.status, 429);
  assert.equal(locked.data.code, 'ACCOUNT_LOCKED');
  assert.equal(locked.data.retryAfterSeconds, 60);
  assert.equal(f.mailer.sent.filter(message => message.kind === 'unlock').length, 1);
  assert.match(f.mailer.sent.find(message => message.kind === 'unlock').loginUrl, /#login$/);
  assert.equal((await f.request('/auth/login', { email: signup.email, password: signup.password })).status, 429);
  assert.equal(f.mailer.sent.filter(message => message.kind === 'unlock').length, 1);
  await f.db.prepare('UPDATE login_locks SET locked_until=1').run();
  assert.equal((await f.request('/auth/login', { email: signup.email, password: signup.password })).status, 200, 'account automatically becomes accessible after the lock expires');
  assert.equal(await f.db.prepare('SELECT identifier FROM login_locks').get(), undefined);
});

test('signup validates and persists granular client identity without changing existing accounts', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/auth/signup', { ...signup, firstName: '' })).status, 400);
  assert.equal((await f.request('/auth/signup', { ...signup, phone: '1234567890' })).status, 400);
  assert.equal((await f.request('/auth/signup', { ...signup, postalCode: 'ABC' })).status, 400);
  const created = await f.request('/auth/signup', { ...signup, middleName: 'Pauline' });
  assert.equal(created.status, 201);
  const verified = await f.request('/auth/verify-email', { token: f.tokenFrom(f.mailer.sent[0].verifyUrl) });
  assert.equal(verified.data.user.name, 'Rei Pauline Zenoh');
  assert.equal(verified.data.user.phone, '+639171234567');
  assert.deepEqual(verified.data.user.address, { region: 'National Capital Region (NCR)', barangay: 'Alicia', street: '12 Main Street', city: 'Quezon City', regionCode: '1300000000', cityCode: '1381300000', barangayCode: '1381300001', postalCode: '1100' });
});

test('Admin client profiles persist granular fields and critical account changes revoke recovery codes', async t => {
  const f = await fixture(t);
  const admin = await f.request('/auth/signup', { role: 'manager', name: 'Account Admin', email: 'admin@example.com', password: 'AdminPass!123' });
  assert.equal(admin.status, 201);
  const headers = { Cookie: admin.cookie };
  const created = await f.request('/manager/users', signup, headers);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.firstName, signup.firstName);
  assert.equal(created.data.phone, '+639171234567');
  const issued = await f.request('/auth/forgot-password', { email: signup.email });
  const code = f.mailer.sent.find(message => message.kind === 'reset').code;
  const edited = await f.request(`/manager/users/${created.data.id}`, { ...signup, firstName: 'Updated', email: 'updated@example.com' }, headers, 'PATCH');
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.name, 'Updated Zenoh');
  assert.equal((await f.request('/auth/reset-password', { challengeId: issued.data.challengeId, code, password: 'ChangedPass!123' })).status, 400);
  await f.request('/auth/forgot-password', { email: 'updated@example.com' });
  assert.ok(await f.db.prepare('SELECT challenge_id FROM recovery_codes').get());
  assert.equal((await f.request(`/manager/users/${created.data.id}/password`, { password: 'AdminChanged!123' }, headers)).status, 200);
  assert.equal(await f.db.prepare('SELECT challenge_id FROM recovery_codes').get(), undefined);
  await f.request('/auth/forgot-password', { email: 'updated@example.com' });
  assert.equal((await f.request(`/manager/users/${created.data.id}/archive`, { reason: 'Test account deactivation' }, headers)).status, 200);
  assert.equal(await f.db.prepare('SELECT challenge_id FROM recovery_codes').get(), undefined);
});

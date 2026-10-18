const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../app');
const D = require('../domain');

async function fixture(t, options = {}) {
  const { app, db } = createApp({ dbPath: ':memory:', seedDemo: false, ...options });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { method = 'GET', body, cookie, headers = {} } = {}) {
    const binary = Buffer.isBuffer(body);
    const response = await fetch(base + '/api' + path, { method, headers: { ...(body ? { 'Content-Type': binary ? 'application/pdf' : 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? binary ? body : JSON.stringify(body) : undefined });
    const content = response.headers.get('content-type') || '';
    const data = content.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
    return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers };
  }
  const account = async (role, name = role) => {
    const result = await request('/auth/signup', { method: 'POST', body: { role, name, email: `${name}@example.com`, password: 'StrongPass123!' } });
    assert.equal(result.status, 201, JSON.stringify(result.data)); return result;
  };
  const client = await account('client', 'alex'), agent = await account('agent', 'jamie');
  const date = offset => new Date(Date.now() + 8 * 3600000 + offset * D.DAY).toISOString().slice(0, 10);
  const dates = (vehicleId = 'bmw-3', start = 2, end = 5) => ({ vehicleId, start: date(start), end: date(end), startTime: '10:00', endTime: '10:00', pickup: D.LOCATIONS[0], dropoff: D.LOCATIONS[0] });
  const upload = async (kind, cookie = client.cookie, value = kind, query = '') => {
    const result = await request(`/documents/${kind}${query}`, { method: 'POST', cookie, body: Buffer.from(`%PDF-1.7\n${value}`), headers: { 'X-File-Name': encodeURIComponent(`${kind}.pdf`) } });
    assert.equal(result.status, 201, JSON.stringify(result.data)); return result.data;
  };
  const book = async (values = dates()) => {
    for (const kind of D.REQUIRED_DOCUMENTS) await upload(kind);
    const result = await request('/bookings', { method: 'POST', cookie: client.cookie, body: { ...values, rental: 1, deposit: 0, total: 1, payment: 'Demo checkout' } });
    assert.equal(result.status, 201, JSON.stringify(result.data)); return result.data;
  };
  const action = (booking, route, extra = {}) => request(`/agent/bookings/${booking.id}/${route}`, { method: 'POST', cookie: agent.cookie, body: { version: booking.version, ...extra } });
  const verifyAll = async booking => {
    for (const doc of [...booking.documents]) {
      const result = await action(booking, 'review', { documentId: doc.id, decision: 'approved' }); assert.equal(result.status, 200, JSON.stringify(result.data)); booking = result.data;
    }
    for (const payment of [...booking.payments]) {
      const result = await action(booking, 'payment', { paymentId: payment.id, decision: 'confirmed' }); assert.equal(result.status, 200, JSON.stringify(result.data)); booking = result.data;
    }
    const result = await action(booking, 'inspection', { checks: { exterior: true, tyres: true, controls: true, fuel: true }, note: 'Inspection 101' });
    assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data;
  };
  return { request, account, client, agent, dates, date, upload, book, action, verifyAll, db };
}

test('accounts use hashed passwords, role checks, protected sessions, and origin checks', async t => {
  const f = await fixture(t);
  const session = await f.request('/session', { cookie: f.client.cookie });
  assert.equal(session.data.user.role, 'client'); assert.equal(session.data.user.name, 'alex');
  assert.ok(f.client.headers.get('set-cookie').includes('HttpOnly')); assert.ok(f.client.headers.get('set-cookie').includes('SameSite=Strict'));
  const record = f.db.prepare('SELECT * FROM users WHERE email=?').get('alex@example.com');
  assert.notEqual(record.password_hash, 'StrongPass123!'); assert.equal(record.password_hash.length, 128);
  assert.equal((await f.request('/workspace')).status, 401);
  assert.equal((await f.request('/auth/login', { method: 'POST', body: { email: 'alex@example.com', password: 'StrongPass123!', role: 'agent' } })).status, 401);
  assert.equal((await f.request('/auth/signup', { method: 'POST', body: { email: 'ALEX@example.com', password: 'StrongPass123!', role: 'client', name: 'Other' } })).status, 409);
  assert.equal((await f.request('/agent/bookings', { method: 'POST', cookie: f.client.cookie, body: f.dates() })).status, 403);
  assert.equal((await f.request('/logout', { method: 'POST', cookie: f.client.cookie, body: {}, headers: { Origin: 'https://untrusted.example' } })).status, 403);
  await f.request('/logout', { method: 'POST', cookie: f.client.cookie, body: {} });
  assert.equal((await f.request('/workspace', { cookie: f.client.cookie })).status, 401);
});

test('bookings use server prices, isolate customer files and records, and block simultaneous overlaps', async t => {
  const f = await fixture(t), booking = await f.book();
  assert.equal(booking.rental, 12600); assert.equal(booking.deposit, 5000); assert.equal(booking.total, 17600);
  const other = await f.account('client', 'taylor');
  const own = await f.request('/workspace', { cookie: other.cookie }); assert.equal(own.data.bookings.length, 0);
  assert.equal((await f.request(`/documents/${booking.documents[0].id}`, { cookie: other.cookie })).status, 404);
  assert.equal((await f.request(`/documents/${booking.documents[0].id}`)).status, 401);
  assert.equal((await f.request(`/documents/${booking.documents[0].id}`, { cookie: f.agent.cookie })).status, 200);
  const availability = await f.request('/availability'); assert.equal(availability.data.length, 1); assert.equal(availability.data[0].renter, undefined); assert.equal(availability.data[0].ownerId, undefined);
  const body = { ...f.dates('tesla-3', 7, 9), renter: { name: 'Walk-in customer', phone: '09171234567' } };
  const results = await Promise.all([1, 2].map(() => f.request('/agent/bookings', { method: 'POST', cookie: f.agent.cookie, body })));
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.equal((await f.request('/documents/license', { method: 'POST', cookie: f.client.cookie, body: Buffer.from('<html>bad</html>') })).status, 400);
});

test('dispatch requires approved distinct documents, both payment allocations, inspection, and a current version', async t => {
  const f = await fixture(t); let b = await f.book();
  assert.equal((await f.action(b, 'pass')).status, 400);
  assert.equal((await f.action(b, 'review', { documentId: b.documents[0].id, decision: 'rejected' })).status, 400);
  b = (await f.action(b, 'review', { documentId: b.documents[0].id, decision: 'rejected', reason: 'The license is unreadable.' })).data;
  assert.equal(b.verificationStatus, 'Rejected');
  assert.equal((await f.action({ ...b, version: 1 }, 'pass')).status, 409);
  assert.equal((await f.action(b, 'inspection', { checks: { exterior: true } })).status, 400);
  b = await f.verifyAll(b);
  assert.deepEqual(b.dispatchBlocks, []); assert.equal(b.billing.balance, 0);
  b = (await f.action(b, 'pass')).data; assert.equal(b.status, 'Ready for Dispatch'); assert.ok(b.dispatchPass.id);
  const oldDocument = b.documents[0].id;
  await f.upload('license', f.client.cookie, 'new readable license');
  b = (await f.request('/workspace', { cookie: f.agent.cookie })).data.bookings.find(item => item.id === b.id);
  assert.equal(b.status, 'Pending Approval'); assert.ok(b.dispatchPass.revokedAt); assert.equal(b.verificationStatus, 'Pending review');
  assert.equal((await f.action(b, 'review', { documentId: oldDocument, decision: 'approved' })).status, 409);
  b = (await f.action(b, 'review', { documentId: b.documents.find(d => d.kind === 'license').id, decision: 'approved' })).data;
  b = (await f.action(b, 'pass')).data;
  b = (await f.action(b, 'dispatch')).data; assert.equal(b.status, 'On Rental');
  assert.equal((await f.action(b, 'cancel', { reason: 'Too late' })).status, 400);
});

test('extensions check conflicts and price changes; cancellation releases availability and preserves refund accounting', async t => {
  const f = await fixture(t); let b = await f.book();
  const next = await f.request('/agent/bookings', { method: 'POST', cookie: f.agent.cookie, body: { ...f.dates('bmw-3', 7, 9), renter: { name: 'Next renter', phone: '09171234567' } } });
  assert.equal(next.status, 201);
  assert.equal((await f.action(b, 'extend', { end: f.date(8), endTime: '10:00' })).status, 409);
  b = (await f.action(b, 'extend', { end: f.date(6), endTime: '10:00', reason: 'Customer request' })).data;
  assert.equal(b.days, 4); assert.equal(b.rental, 16800); assert.equal(b.extensions[0].additionalRental, 4200);
  b = (await f.action(b, 'payment', { type: 'rental', amount: 4200, method: 'Cash', reference: 'RCPT-001' })).data;
  assert.equal(b.billing.rentalPaid, 4200);
  assert.equal((await f.action(b, 'payment', { type: 'deposit', amount: 5001, method: 'Cash', reference: 'too much' })).status, 400);
  b = (await f.action(b, 'cancel', { reason: 'Plans changed' })).data;
  assert.equal(b.status, 'Cancelled'); assert.equal(b.cancellation.refundDue, 4200); assert.equal(b.billing.totalPaid, 4200);
  assert.equal((await f.action(b, 'pass')).status, 400);
  const replacement = await f.request('/agent/bookings', { method: 'POST', cookie: f.agent.cookie, body: { ...f.dates(), renter: { name: 'Replacement renter', phone: '09171234567' } } });
  assert.equal(replacement.status, 201);
});

test('late returns bill started hours and keep additional fees payable after completion', async t => {
  const f = await fixture(t, { seedDemo: true });
  let b = (await f.request('/workspace', { cookie: f.agent.cookie })).data.bookings.find(booking => booking.status === 'On Rental');
  const time = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Manila', hour12: false, hour: '2-digit', minute: '2-digit' });
  const hours = Math.ceil((D.time(f.date(0), time) - D.time(b.end, b.endTime)) / 3600000);
  assert.equal((await f.action(b, 'return', { date: f.date(0), time, hourlyRate: -1 })).status, 400);
  const returned = await f.action(b, 'return', { date: f.date(0), time, hourlyRate: 200 });
  assert.equal(returned.status, 200, JSON.stringify(returned.data)); b = returned.data;
  assert.equal(b.status, 'Completed'); assert.equal(b.lateHours, hours); assert.equal(b.lateFee, hours * 200); assert.equal(b.billing.balance, hours * 200);
  b = (await f.action(b, 'payment', { type: 'rental', amount: b.lateFee, method: 'Cash', reference: 'LATE-001' })).data;
  assert.equal(b.billing.balance, 0); assert.equal(b.paymentStatus, 'Verified · paid');
});

test('support conversations enforce ownership, support agent resolution, and detect stale replies', async t => {
  const f = await fixture(t), booking = await f.book();
  const ticket = await f.request('/support', { method: 'POST', cookie: f.client.cookie, body: { bookingId: booking.id, category: 'Extension', subject: 'One more day?', message: 'Please extend my rental by a day.' } });
  assert.equal(ticket.status, 201); const id = ticket.data.id;
  const other = await f.account('client', 'taylor');
  assert.equal((await f.request(`/support/${id}/reply`, { method: 'POST', cookie: other.cookie, body: { message: 'Not mine', version: 1 } })).status, 404);
  const replied = await f.request(`/support/${id}/reply`, { method: 'POST', cookie: f.agent.cookie, body: { message: 'We can arrange that.', resolve: true, version: 1 } });
  assert.equal(replied.data.status, 'resolved'); assert.equal(replied.data.messages.length, 2);
  assert.equal((await f.request(`/support/${id}/reply`, { method: 'POST', cookie: f.client.cookie, body: { message: 'Stale', version: 1 } })).status, 409);
  const reopened = await f.request(`/support/${id}/reply`, { method: 'POST', cookie: f.client.cookie, body: { message: 'Thank you, one more question.', version: 2 } });
  assert.equal(reopened.data.status, 'open'); assert.equal(reopened.data.messages.length, 3);
});

test('agent self-registration can be disabled independently of client registration', async t => {
  const { app, db } = createApp({ dbPath: ':memory:', seedDemo: false, allowAgentSignup: false });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'agent', name: 'Agent', email: 'agent@example.com', password: 'StrongPass123!' }) });
  assert.equal(response.status, 403);
});

test('walk-in verification rejects reused ID files and payments cannot exceed their allocation', async t => {
  const f = await fixture(t);
  const created = await f.request('/agent/bookings', { method: 'POST', cookie: f.agent.cookie, body: { ...f.dates(), renter: { name: 'Walk-in customer', phone: '09171234567' } } });
  assert.equal(created.status, 201); let b = created.data;
  for (const kind of D.REQUIRED_DOCUMENTS) await f.upload(kind, f.agent.cookie, 'same file content', `?bookingId=${b.id}`);
  b = (await f.request('/workspace', { cookie: f.agent.cookie })).data.bookings.find(item => item.id === b.id);
  assert.equal((await f.action(b, 'review', { documentId: b.documents[0].id, decision: 'approved' })).status, 400);
  assert.equal(b.verificationStatus, 'Pending review');
  b = (await f.action(b, 'payment', { type: 'rental', amount: 0.29, method: 'Cash', reference: 'DECIMAL-001' })).data;
  assert.equal(b.billing.rentalPaid, 0.29);
  assert.equal((await f.action(b, 'payment', { type: 'rental', amount: 13000, method: 'Cash', reference: 'OVER-001' })).status, 400);
  assert.equal((await f.action(b, 'payment', { type: 'rental', amount: 0.001, method: 'Cash', reference: 'FRACTION-001' })).status, 400);
});

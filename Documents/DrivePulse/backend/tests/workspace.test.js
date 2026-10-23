const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../application');
const D = require('../domain');
const { testDatabase } = require('./helpers/database');

async function fixture(t, options = {}) {
  const { app, db } = await createApp({ dbPath: ':memory:', database: await testDatabase(), seedDemo: false, ...options });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await db.close(); });
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
  const mechanic = await account('mechanic', 'riley'), manager = await account('manager', 'sam');
  const date = offset => new Date(Date.now() + 8 * 3600000 + offset * D.DAY).toISOString().slice(0, 10);
  const dates = (vehicleId = 'bmw-3', start = 2, end = 5) => ({ vehicleId, start: date(start), end: date(end), startTime: '10:00', endTime: '10:00', pickup: D.LOCATIONS[0], dropoff: D.LOCATIONS[0] });
  const upload = async (kind, cookie = client.cookie, value = kind, query = '') => {
    const result = await request(`/documents/${kind}${query}`, { method: 'POST', cookie, body: Buffer.from(`%PDF-1.7\n${value}`), headers: { 'X-File-Name': encodeURIComponent(`${kind}.pdf`) } });
    assert.equal(result.status, 201, JSON.stringify(result.data)); return result.data;
  };
  const book = async (values = dates()) => {
    for (const kind of D.REQUIRED_DOCUMENTS) await upload(kind);
    const result = await request('/bookings', { method: 'POST', cookie: client.cookie, body: { ...values, rental: 1, deposit: 0, total: 1, payment: 'Cash' } });
    assert.equal(result.status, 201, JSON.stringify(result.data)); return result.data;
  };
  const action = (booking, route, extra = {}) => request(`/agent/bookings/${booking.id}/${route}`, { method: 'POST', cookie: agent.cookie, body: { version: booking.version, ...(route === 'payment' ? { received: true, reference: 'CASH-' + crypto.randomUUID() } : {}), ...extra } });
  const operations = async (cookie = mechanic.cookie) => (await request('/operations', { cookie })).data;
  const photo = async (vehicleId, label, cookie = mechanic.cookie) => {
    const result = await request(`/documents/condition?vehicleId=${vehicleId}`, { method: 'POST', cookie, body: Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYz0AAAAASUVORK5CYII=', 'base64'), Buffer.from(label)]), headers: { 'Content-Type': 'image/png', 'X-File-Name': `${label}.png` } });
    assert.equal(result.status, 201, JSON.stringify(result.data)); return result.data;
  };
  const inspect = async (booking, type = 'pre-dispatch', extra = {}) => {
    const vehicleId = booking.vehicleId, data = await operations();
    const photos = [];
    for (const view of ['exterior', 'interior']) photos.push({ id: (await photo(vehicleId, `${view}-${Date.now()}-${Math.random()}`)).id, view });
    return request('/mechanic/inspections', { method: 'POST', cookie: mechanic.cookie, body: { vehicleId, vehicleVersion: data.fleet.find(v => v.id === vehicleId).version, bookingId: booking.id, version: booking.version, type, odometer: 12000, fuelLevel: 85, tirePressure: { frontLeft: 33, frontRight: 33, rearLeft: 32, rearRight: 32 }, cleanliness: 'Clean', scratches: 'No visible scratches.', checks: { tyres: true, controls: true, exterior: true, interior: true, fuel: true }, photos, outcome: 'approved', ...extra } });
  };
  const verifyAll = async booking => {
    booking = (await operations(agent.cookie)).bookings.find(b => b.id === booking.id);
    for (const doc of [...booking.documents]) {
      const result = await action(booking, 'review', { documentId: doc.id, decision: 'approved' }); assert.equal(result.status, 200, JSON.stringify(result.data)); booking = result.data;
    }
    for (const payment of [...booking.payments]) {
      const result = await action(booking, 'payment', { paymentId: payment.id, decision: 'confirmed' }); assert.equal(result.status, 200, JSON.stringify(result.data)); booking = result.data;
    }
    const result = await inspect(booking);
    assert.equal(result.status, 201, JSON.stringify(result.data)); return (await operations(agent.cookie)).bookings.find(b => b.id === booking.id);
  };
  return { request, account, client, agent, mechanic, manager, operations, photo, inspect, dates, date, upload, book, action, verifyAll, db };
}

test('accounts use hashed passwords, role checks, protected sessions, and origin checks', async t => {
  const f = await fixture(t);
  const session = await f.request('/session', { cookie: f.client.cookie });
  assert.equal(session.data.user.role, 'client'); assert.equal(session.data.user.name, 'alex');
  assert.ok(f.client.headers.get('set-cookie').includes('HttpOnly')); assert.ok(f.client.headers.get('set-cookie').includes('SameSite=Strict'));
  const record = await f.db.prepare('SELECT * FROM users WHERE email=?').get('alex@example.com');
  assert.notEqual(record.password_hash, 'StrongPass123!'); assert.equal(record.password_hash.length, 128);
  assert.equal((await f.request('/workspace')).status, 401);
  assert.equal((await f.request('/auth/login', { method: 'POST', body: { email: 'alex@example.com', password: 'WrongPassword123!' } })).status, 401);
  assert.equal((await f.request('/auth/signup', { method: 'POST', body: { email: 'ALEX@example.com', password: 'StrongPass123!', role: 'client', name: 'Other' } })).status, 409);
  assert.equal((await f.request('/agent/bookings', { method: 'POST', cookie: f.client.cookie, body: f.dates() })).status, 403);
  assert.equal((await f.request('/logout', { method: 'POST', cookie: f.client.cookie, body: {}, headers: { Origin: 'https://untrusted.example' } })).status, 403);
  await f.request('/logout', { method: 'POST', cookie: f.client.cookie, body: {} });
  assert.equal((await f.request('/workspace', { cookie: f.client.cookie })).status, 401);
});

test('one sign-in endpoint identifies every account role from its credentials', async t => {
  const f = await fixture(t);
  for (const [role, email] of [['client', 'alex@example.com'], ['agent', 'jamie@example.com'], ['mechanic', 'riley@example.com'], ['manager', 'sam@example.com']]) {
    const login = await f.request('/auth/login', { method: 'POST', body: { email: email.toUpperCase(), password: 'StrongPass123!' } });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    assert.equal(login.data.user.role, role);
    assert.equal((await f.request('/session', { cookie: login.cookie })).data.user.role, role);
    assert.equal((await f.request('/operations', { cookie: login.cookie })).status, role === 'client' ? 403 : 200);
  }
  const claimedRole = await f.request('/auth/login', { method: 'POST', body: { email: 'alex@example.com', password: 'StrongPass123!', role: 'manager' } });
  assert.equal(claimedRole.status, 200);
  assert.equal(claimedRole.data.user.role, 'client');
  assert.equal((await f.request('/manager/audit', { cookie: claimedRole.cookie })).status, 403);
});

test('all four seeded demo accounts remain available through the common sign-in', async t => {
  const f = await fixture(t, { seedDemo: true });
  assert.equal((await f.request('/session')).data.demo, true);
  for (const role of ['client', 'agent', 'mechanic', 'manager']) {
    const login = await f.request('/auth/login', { method: 'POST', body: { email: `${role}@drivepulse.demo`, password: 'DrivePulse123!' } });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    assert.equal(login.data.user.role, role);
  }
});

test('bookings use server prices, isolate customer files and records, and block simultaneous overlaps', async t => {
  const f = await fixture(t), booking = await f.book();
  assert.equal(booking.rental, 12600); assert.equal(booking.deposit, 5000); assert.equal(booking.total, 17600);
  assert.ok(booking.agreement?.id);
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
  assert.equal((await f.action(b, 'inspection', { checks: { exterior: true } })).status, 403);
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
  assert.ok(b.releaseReceipt);
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
  const { app, db } = await createApp({ dbPath: ':memory:', database: await testDatabase(), seedDemo: false, allowAgentSignup: false });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await db.close(); });
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

test('mechanic and manager permissions isolate identity documents and financial decisions', async t => {
  const f = await fixture(t), b = await f.book();
  assert.equal((await f.request('/operations')).status, 401);
  assert.equal((await f.request('/operations', { cookie: f.client.cookie })).status, 403);
  const data = await f.operations();
  assert.equal(data.bookings[0].renter, undefined);
  assert.equal(data.bookings[0].payments, undefined);
  assert.equal(data.bookings[0].documents, undefined);
  assert.deepEqual(data.approvals, []);
  for (const staff of [f.mechanic, f.manager]) {
    assert.equal((await f.request(`/documents/${b.documents[0].id}`, { cookie: staff.cookie })).status, 404);
    assert.equal((await f.request(`/agent/bookings/${b.id}/review`, { method: 'POST', cookie: staff.cookie, body: { version: b.version } })).status, 403);
  }
  assert.equal((await f.request('/documents/condition?vehicleId=bmw-3', { method: 'POST', cookie: f.agent.cookie, body: Buffer.from('%PDF-file') })).status, 403);
  assert.equal((await f.request('/manager/analytics?start=2026-01-01&end=2026-01-31', { cookie: f.mechanic.cookie })).status, 403);
  assert.equal((await f.request('/mechanic/vehicles/bmw-3/status', { method: 'POST', cookie: f.manager.cookie, body: { version: 1, status: 'Available' } })).status, 403);
  assert.equal((await f.request('/workspace', { cookie: f.mechanic.cookie })).data.bookings.length, 0);
});

test('mandatory inspection readings and fresh distinct photos gate dispatch and unsafe holds', async t => {
  const f = await fixture(t); let b = await f.book();
  assert.equal((await f.inspect(b, 'pre-dispatch', { tirePressure: { frontLeft: 30 } })).status, 400);
  assert.equal((await f.inspect(b, 'pre-dispatch', { photos: [] })).status, 400);
  assert.equal((await f.inspect(b, 'pre-dispatch', { cleanliness: 'Needs cleaning' })).status, 400);
  assert.equal((await f.inspect(b, 'pre-dispatch', { fuelLevel: 101 })).status, 400);
  const sameA = await f.photo(b.vehicleId, 'same'), sameB = await f.photo(b.vehicleId, 'same');
  assert.equal((await f.inspect(b, 'pre-dispatch', { photos: [{ id: sameA.id, view: 'exterior' }, { id: sameB.id, view: 'interior' }] })).status, 400);
  const report = await f.inspect(b, 'pre-dispatch', { outcome: 'unsafe', note: 'Brake pedal loses pressure.' });
  assert.equal(report.status, 201, JSON.stringify(report.data));
  let data = await f.operations(f.agent.cookie); b = data.bookings.find(v => v.id === b.id);
  assert.equal(data.fleet.find(v => v.id === b.vehicleId).status, 'Out of Service');
  assert.ok(b.dispatchBlocks.some(reason => reason.includes('out of service')));
  const schedule = (await f.request('/availability')).data;
  assert.ok(schedule.some(v => v.vehicleId === b.vehicleId && v.blocked && v.status === 'Out of Service'));
  const walkin = { ...f.dates(b.vehicleId, 8, 9), renter: { name: 'Next driver', phone: '09171234567' } };
  assert.equal((await f.request('/agent/bookings', { method: 'POST', cookie: f.agent.cookie, body: walkin })).status, 409);
  const photoId = report.data.photos[0].id;
  assert.equal((await f.request(`/documents/${photoId}`, { cookie: f.client.cookie })).status, 404);
  assert.equal((await f.request(`/documents/${photoId}`, { cookie: f.manager.cookie })).status, 200);
  assert.equal((await f.inspect(b, 'clearance', { odometer: 11999 })).status, 400);
  assert.equal((await f.inspect(b, 'clearance', { photos: report.data.photos })).status, 400);
  assert.equal((await f.inspect(b, 'clearance', { vehicleVersion: 1 })).status, 409);
  assert.equal((await f.inspect(b, 'clearance')).status, 201);
  data = await f.operations(); assert.equal(data.fleet.find(v => v.id === b.vehicleId).status, 'Available');
  assert.equal((await f.request('/agent/bookings', { method: 'POST', cookie: f.agent.cookie, body: walkin })).status, 201);
});

test('maintenance transitions retain invoices and require a fresh clearance before rebooking', async t => {
  const f = await fixture(t), path = '/mechanic/maintenance';
  let m = (await f.request(path, { method: 'POST', cookie: f.mechanic.cookie, body: { vehicleId: 'bmw-3', type: 'Oil change', description: 'Replace engine oil and filter.', dueDate: f.date(1) } })).data;
  const update = body => f.request(`${path}/${m.id}`, { method: 'POST', cookie: f.mechanic.cookie, body: { version: m.version, note: 'Service bay record.', ...body } });
  assert.equal((await update({ status: 'Completed', cost: 1200, reference: 'INV-1' })).status, 400);
  assert.equal((await f.request(`${path}/${m.id}`, { method: 'POST', cookie: f.agent.cookie, body: {} })).status, 403);
  m = (await update({ status: 'In progress' })).data;
  assert.equal((await f.operations()).fleet.find(v => v.id === 'bmw-3').status, 'Maintenance');
  assert.equal((await update({ version: 1, status: 'Completed', cost: 1200, reference: 'INV-1' })).status, 409);
  assert.equal((await update({ status: 'Completed', cost: -10, reference: 'INV-1' })).status, 400);
  assert.equal((await f.inspect({ vehicleId: 'bmw-3' }, 'clearance')).status, 400);
  m = (await update({ status: 'Completed', cost: 1250.5, reference: 'INV-101' })).data;
  assert.equal(m.cost, 1250.5); assert.equal(m.reference, 'INV-101');
  assert.equal((await f.operations()).fleet.find(v => v.id === 'bmw-3').status, 'Under Inspection');
  assert.equal((await f.inspect({ vehicleId: 'bmw-3' }, 'clearance')).status, 201);
  assert.equal((await f.operations()).fleet.find(v => v.id === 'bmw-3').status, 'Available');
  const report = await f.request(`/manager/analytics?start=${f.date(-1)}&end=${f.date(0)}`, { cookie: f.manager.cookie });
  assert.equal(report.status, 200); assert.equal(report.data.maintenanceCost, 1250.5); assert.equal(report.data.maintenance.length, 1);
});

test('clean returns with full fuel and zero damage flags auto-release deposits without manager bottleneck', async t => {
  const f = await fixture(t, { seedDemo: true });
  let b = (await f.operations(f.agent.cookie)).bookings.find(b => b.status === 'On Rental');
  const time = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Manila', hour12: false, hour: '2-digit', minute: '2-digit' });
  b = (await f.action(b, 'return', { date: f.date(0), time, hourlyRate: 0 })).data;
  assert.equal((await f.operations()).fleet.find(v => v.id === b.vehicleId).status, 'Under Inspection');
  const inspected = await f.inspect(b, 'post-return', { fuelLevel: 100, cleanliness: 'Clean', damageFlag: false });
  assert.equal(inspected.status, 201, JSON.stringify(inspected.data));
  assert.equal(inspected.data.cleanReturn, true);
  const ops = await f.operations(f.manager.cookie);
  const autoRelease = ops.approvals.find(a => a.bookingId === b.id && a.type === 'deposit');
  assert.ok(autoRelease);
  assert.equal(autoRelease.status, 'auto-released');
  assert.equal(autoRelease.amount, 5000);
  assert.ok(autoRelease.disbursement?.receipt);
  const analytics = (await f.request(`/manager/analytics?start=${f.date(-29)}&end=${f.date(0)}`, { cookie: f.manager.cookie })).data;
  assert.equal(analytics.depositReleases, 5000);
  assert.equal(analytics.autoReleasedDeposits, 5000);
});

test('disputed/withheld deposits and cancelled booking refunds require manager exception approval', async t => {
  const f = await fixture(t, { seedDemo: true });
  let b = (await f.operations(f.agent.cookie)).bookings.find(b => b.status === 'On Rental');
  const time = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Manila', hour12: false, hour: '2-digit', minute: '2-digit' });
  b = (await f.action(b, 'return', { date: f.date(0), time, hourlyRate: 0 })).data;
  // Mechanic records post-return with 80% fuel and damageFlag, so it is NOT auto-released
  const inspected = await f.inspect(b, 'post-return', { fuelLevel: 80, damageFlag: true, scratches: 'Rear bumper scratch.' });
  assert.equal(inspected.status, 201);
  assert.equal(inspected.data.cleanReturn, false);
  const requested = await f.request('/operations/approvals', { method: 'POST', cookie: f.agent.cookie, body: { bookingId: b.id, type: 'deposit', amount: 3500, reason: 'Withheld PHP 1,500 for bumper scratch and fuel.' } });
  assert.equal(requested.status, 201);
  assert.equal(requested.data.withheldAmount, 1500);
  assert.equal(requested.data.disputed, true);
  const approve = (cookie, extra = {}) => f.request(`/manager/approvals/${requested.data.id}`, { method: 'POST', cookie, body: { version: requested.data.version, decision: 'approved', reason: 'Damage deduction confirmed.', ...extra } });
  assert.equal((await approve(f.agent.cookie)).status, 403);
  const approved = await approve(f.manager.cookie);
  assert.equal(approved.status, 200);
  assert.ok(approved.data.disbursement?.receipt);
});

test('high driver risk blocks related dispatches and manager overrides retain the decision reason', async t => {
  const f = await fixture(t); let b = await f.verifyAll(await f.book());
  b = (await f.action(b, 'pass')).data;
  const logged = await f.request('/manager/risks', { method: 'POST', cookie: f.manager.cookie, body: { bookingId: b.id, severity: 'High', description: 'Prior reckless driving incident reported by staff.' } });
  assert.equal(logged.status, 201); const r = logged.data;
  b = (await f.operations(f.agent.cookie)).bookings.find(item => item.id === b.id);
  assert.ok(b.dispatchPass.revokedAt); assert.ok(b.dispatchBlocks.some(reason => reason.includes('high risk')));
  assert.equal((await f.action(b, 'pass')).status, 400);
  const override = (cookie, reason) => f.request(`/manager/risks/${r.id}/override`, { method: 'POST', cookie, body: { version: r.version, reason } });
  assert.equal((await override(f.mechanic.cookie, 'Not permitted.')).status, 403);
  assert.equal((await override(f.manager.cookie, '')).status, 400);
  assert.equal((await override(f.manager.cookie, 'Incident reviewed with the customer and cleared.')).status, 200);
  assert.equal((await override(f.manager.cookie, 'Duplicate decision.')).status, 409);
  b = (await f.operations(f.agent.cookie)).bookings.find(item => item.id === b.id);
  assert.equal(b.dispatchBlocks.length, 0);
  assert.equal((await f.action(b, 'pass')).status, 200);
});

test('overdue alert overrides do not make an overdue vehicle available or remove its rental status', async t => {
  const f = await fixture(t, { seedDemo: true });
  const data = await f.operations(f.manager.cookie), flag = data.flags[0]; assert.ok(flag);
  const approve = (cookie, reason) => f.request(`/manager/flags/${flag.bookingId}/override`, { method: 'POST', cookie, body: { version: flag.version, reason } });
  assert.equal((await approve(f.agent.cookie, 'Customer called.')).status, 403);
  assert.equal((await approve(f.manager.cookie, '')).status, 400);
  assert.equal((await approve(f.manager.cookie, 'Customer contacted; return collection arranged.')).status, 200);
  const after = await f.operations(f.manager.cookie);
  assert.equal(after.fleet.find(v => v.id === flag.vehicleId).status, 'Overdue');
  assert.equal(after.flags[0].override.by, 'sam');
  assert.equal((await f.request('/availability')).data.find(v => v.blocked && v.vehicleId === flag.vehicleId).blocked, true);
});

test('rate modifications over 20% trigger threshold alerts and record old vs. new values in audit logs', async t => {
  const f = await fixture(t);
  const v = (await f.operations(f.manager.cookie)).fleet.find(item => item.id === 'bmw-3');
  assert.equal(v.rate, 4200);
  assert.equal((await f.request('/manager/vehicles/bmw-3/rate', { method: 'PATCH', cookie: f.agent.cookie, body: { version: v.version, rate: 5500, reason: 'Peak season' } })).status, 403);
  const updated = await f.request('/manager/vehicles/bmw-3/rate', { method: 'PATCH', cookie: f.manager.cookie, body: { version: v.version, rate: 5500, reason: 'Peak holiday pricing' } });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.rate, 5500);
  const audit = await f.request('/manager/audit?alertsOnly=true', { cookie: f.manager.cookie });
  assert.equal(audit.status, 200);
  const alert = audit.data.records.find(r => r.alert_type === 'Rate change > 20%');
  assert.ok(alert);
  assert.match(alert.old_value, /4200/);
  assert.match(alert.new_value, /5500/);
});

test('user management tracks login telemetry, provisions staff accounts, and blocks deactivated accounts', async t => {
  const f = await fixture(t);
  // Trigger a failed login attempt
  await f.request('/auth/login', { method: 'POST', body: { email: 'alex@example.com', password: 'WrongPassword123!' } });
  assert.equal((await f.request('/manager/users', { cookie: f.agent.cookie })).status, 403);
  const created = await f.request('/manager/users', { method: 'POST', cookie: f.manager.cookie, body: { name: 'New Staff', email: 'newstaff@example.com', role: 'agent', password: 'StrongPass123!' } });
  assert.equal(created.status, 201);
  const deactivated = await f.request(`/manager/users/${created.data.id}/archive`, { method: 'POST', cookie: f.manager.cookie, body: { reason: 'End of contract' } });
  assert.equal(deactivated.status, 200);
  assert.ok(deactivated.data.archivedAt);
  // Deactivated user cannot sign in
  const login = await f.request('/auth/login', { method: 'POST', body: { email: 'newstaff@example.com', password: 'StrongPass123!' } });
  assert.equal(login.status, 403);
  // Telemetry reflects active/archived counts and login attempts
  const telemetry = (await f.request('/manager/users', { cookie: f.manager.cookie })).data.telemetry;
  assert.ok(telemetry.failedLogins >= 1);
  assert.equal(telemetry.archivedCount, 1);
});

test('one-click soft deletes and data archives support restore and permanent purge with audit logging', async t => {
  const f = await fixture(t);
  let b = await f.book();
  // Active booking cannot be archived before completion/cancellation
  assert.equal((await f.request(`/bookings/${b.id}/archive`, { method: 'POST', cookie: f.agent.cookie, body: {} })).status, 400);
  b = (await f.action(b, 'cancel', { reason: 'Customer cancelled' })).data;
  const archived = await f.request(`/bookings/${b.id}/archive`, { method: 'POST', cookie: f.agent.cookie, body: { reason: 'Front desk cleanup' } });
  assert.equal(archived.status, 200);
  // Hidden from active workspace
  assert.equal((await f.request('/workspace', { cookie: f.agent.cookie })).data.bookings.length, 0);
  // Visible in manager archives
  let archives = (await f.request('/manager/archives', { cookie: f.manager.cookie })).data;
  assert.equal(archives.bookings.length, 1);
  // Mechanic requests vehicle decommission, manager confirms
  const v = (await f.operations()).fleet.find(item => item.id === 'range-rover');
  const reqDecom = await f.request('/vehicles/range-rover/decommission', { method: 'POST', cookie: f.mechanic.cookie, body: { version: v.version, reason: 'Major engine overhaul needed' } });
  assert.equal(reqDecom.status, 200);
  assert.ok(reqDecom.data.decommissionRequested);
  const confirmDecom = await f.request('/vehicles/range-rover/decommission', { method: 'POST', cookie: f.manager.cookie, body: { version: reqDecom.data.version, reason: 'Confirmed retirement' } });
  assert.equal(confirmDecom.status, 200);
  assert.equal(confirmDecom.data.status, 'Decommissioned');
  // Restore booking and vehicle
  assert.equal((await f.request(`/manager/archives/booking/${b.id}/restore`, { method: 'POST', cookie: f.manager.cookie, body: {} })).status, 200);
  assert.equal((await f.request('/manager/archives/vehicle/range-rover/restore', { method: 'POST', cookie: f.manager.cookie, body: {} })).status, 200);
  assert.equal((await f.request('/workspace', { cookie: f.agent.cookie })).data.bookings.length, 1);
  // Re-archive booking and permanently purge it
  await f.request(`/bookings/${b.id}/archive`, { method: 'POST', cookie: f.agent.cookie, body: {} });
  const purged = await f.request(`/manager/archives/booking/${b.id}`, { method: 'DELETE', cookie: f.manager.cookie, body: { reason: 'Retention period expired' } });
  assert.equal(purged.status, 200);
  archives = (await f.request('/manager/archives', { cookie: f.manager.cookie })).data;
  assert.equal(archives.bookings.length, 0);
  const audit = await f.request('/manager/audit?alertsOnly=true', { cookie: f.manager.cookie });
  assert.ok(audit.data.records.some(r => r.alert_type === 'Permanent record purge'));
});

test('central audit is manager-only, immutable, filterable, stable when paginated, and excludes secrets', async t => {
  const f = await fixture(t);
  await f.request('/auth/login', { method: 'POST', body: { email: 'alex@example.com', role: 'client', password: 'wrong-secret-password' } });
  await f.request('/profile', { method: 'PATCH', cookie: f.client.cookie, body: { name: 'Updated Alex', email: 'alex@example.com' } });
  assert.equal((await f.request('/manager/audit', { cookie: f.agent.cookie })).status, 403);
  const log = await f.request('/manager/audit', { cookie: f.manager.cookie });
  assert.equal(log.status, 200); assert.ok(log.data.records.some(r => r.action === 'Failed login attempt' && r.status === 401));
  assert.ok(log.data.records.some(r => r.action === 'Profile updated' && r.old_value && r.new_value));
  const serialized = JSON.stringify(log.data); assert.doesNotMatch(serialized, /StrongPass123|wrong-secret-password|drivepulse_session/);
  const filtered = await f.request('/manager/audit?role=client&q=Profile', { cookie: f.manager.cookie });
  assert.ok(filtered.data.records.length >= 1);
  const same = await f.request(`/manager/audit?through=${log.data.through}`, { cookie: f.manager.cookie });
  assert.deepEqual(same.data.records, log.data.records); assert.equal(same.data.total, log.data.total);
  await assert.rejects(async () => await f.db.prepare('DELETE FROM audit_log WHERE sequence=?').run(log.data.records[0].sequence), /immutable/);
});

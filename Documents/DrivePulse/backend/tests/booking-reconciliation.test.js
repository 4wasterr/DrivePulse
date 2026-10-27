const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../application');
const { testDatabase } = require('./helpers/database');

for (const engine of ['sqlite', 'postgres']) test(`${engine}: private documents, PSGC, interval booking and cancellation settlement stay consistent`, { timeout: 120000 }, async t => {
  const previous = process.env.DRIVEPULSE_TEST_POSTGRES;
  process.env.DRIVEPULSE_TEST_POSTGRES = engine === 'postgres' ? 'true' : '';
  let database;
  try { database = await testDatabase(); }
  finally { if (previous === undefined) delete process.env.DRIVEPULSE_TEST_POSTGRES; else process.env.DRIVEPULSE_TEST_POSTGRES = previous; }
  const { app, db } = await createApp({ database, dbPath: ':memory:', seedDemo: true, mailer: null });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await db.close(); });
  const request = async (path, cookie, body, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method: body ? 'POST' : 'GET', headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': Buffer.isBuffer(body) ? 'application/pdf' : 'application/json' } : {}), ...headers }, body: body ? Buffer.isBuffer(body) ? body : JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    return { status: response.status, headers: response.headers, cookie: response.headers.get('set-cookie')?.split(';')[0], data: response.headers.get('content-type')?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
  };
  const login = async username => { const result = await request('/auth/login', null, { username, password: username === 'flmechanic' ? 'mechanic' : username }); assert.equal(result.status, 200, JSON.stringify(result.data)); return result.cookie; };
  const agent = await login('bkagent'), manager = await login('opmanager'), client = await login('demo'), mechanic = await login('flmechanic');
  const branches = (await request('/locations')).data;
  assert.equal(branches[0].branchName, 'Makati Branch');
  const dates = { vehicleId: 'toyota-camry', start: '2099-01-10', end: '2099-01-12', startTime: '10:00', endTime: '10:00', pickup: branches[0].name, dropoff: branches[1].name, customerConfirmed: true, renter: { name: 'Test Customer', phone: '+639171234567', email: 'client@drivepulse.demo' } };
  for (const email of [null, '', undefined, 'bad-email']) assert.equal((await request('/agent/bookings', agent, { ...dates, renter: { ...dates.renter, email } })).status, 400);
  const created = await request('/agent/bookings', agent, dates);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  let booking = created.data;
  assert.ok(booking.ownerId, 'existing client lookup must remain active');
  assert.equal((await request('/agent/bookings', agent, { ...dates, start: '2099-01-11' })).status, 409);
  assert.equal((await request('/agent/bookings', agent, { ...dates, start: dates.end, end: '2099-01-13' })).status, 201, 'exact handover remains bookable');
  assert.equal((await request('/agent/bookings', agent, { ...dates, start: '2099-01-01', end: dates.start })).status, 201, 'free dates before another booking remain bookable');

  const bytes = Buffer.from('%PDF-1.7\nA private license');
  const uploaded = await request(`/documents/license?bookingId=${booking.id}`, agent, bytes, { 'X-File-Name': 'license.pdf' });
  assert.equal(uploaded.status, 201);
  for (const cookie of [agent, client]) {
    const opened = await request(`/documents/${uploaded.data.id}`, cookie);
    assert.equal(opened.status, 200); assert.deepEqual(opened.data, bytes); assert.match(opened.headers.get('cache-control'), /no-store/);
  }
  assert.equal((await request(`/documents/${uploaded.data.id}`, mechanic)).status, 404);
  assert.equal((await request(`/documents/${uploaded.data.id}`, manager)).status, 404);
  assert.equal((await request(`/documents/${uploaded.data.id}`)).status, 401);
  assert.equal((await request('/documents/missing', agent)).status, 404);

  const regions = (await request('/geography/regions')).data;
  assert.equal(regions.length, 18); assert.ok(regions.some(region => region.code === '1800000000'));
  const cities = (await request('/geography/regions/1300000000/cities')).data;
  const city = cities.find(city => city.name === 'Quezon City');
  assert.ok(city.postalCodes.includes('1105'));
  assert.ok(city.postalCodes.every(code => /^11\d{2}$/.test(code)), 'Quezon province must not be mixed into Quezon City ZIP suggestions');
  const barangays = (await request(`/geography/cities/${city.code}/barangays`)).data;
  assert.ok(barangays.length > 100); assert.ok(barangays.every(barangay => barangay.cityCode === city.code));
  assert.deepEqual(barangays.find(barangay => barangay.name === 'Alicia').postalCodes, ['1105']);
  const profile = { role: 'client', firstName: 'Address', lastName: 'Test', phone: '09171234567', street: '12 Test Street', regionCode: '1300000000', cityCode: city.code, barangayCode: barangays[0].code, postalCode: '1100', email: 'address@example.com', password: 'TestPassword!123' };
  assert.equal((await request('/auth/signup', null, { ...profile, regionCode: '0100000000' })).status, 400, 'city must belong to selected region');
  const account = await request('/auth/signup', null, profile);
  assert.equal(account.status, 201, JSON.stringify(account.data));
  assert.equal(account.data.user.address.barangayCode, barangays[0].code);
  assert.equal(account.data.user.address.city, city.name);

  booking = (await request('/workspace', agent)).data.bookings.find(item => item.id === booking.id);
  const pay = async (type, amount) => {
    const result = await request(`/agent/bookings/${booking.id}/payment`, agent, { version: booking.version, type, amount, received: true });
    assert.equal(result.status, 200, JSON.stringify(result.data)); booking = result.data;
  };
  await pay('rental', 3000); await pay('deposit', 5000);
  const cancelled = await request(`/agent/bookings/${booking.id}/cancel`, agent, { version: booking.version, reason: 'Customer plans changed', cancellationFee: 0 });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
  booking = cancelled.data;
  assert.equal(booking.status, 'Cancelled'); assert.equal(booking.billing.invoiceStatus, 'Cancelled');
  assert.equal(booking.cancellation.fee, 600); assert.equal(booking.cancellation.rentalRefund, 2400); assert.equal(booking.cancellation.depositRefund, 5000);
  assert.equal(booking.billing.balance, 0); assert.equal(booking.billing.depositBalance, 0); assert.equal(booking.total, 600);
  assert.equal(booking.cancellation.refundDue, 7400); assert.equal(booking.cancellation.refundStatus, 'Pending cash release');
  assert.equal(booking.refundableRental, 2400); assert.equal(booking.refundableDeposit, 5000);
  const statement = await request(`/rental-documents/${booking.cancellationStatement.id}`, agent);
  assert.match(statement.data.toString(), /Cancellation fee \(20% of verified downpayment\)/);
  const approvals = (await request('/operations', agent)).data.approvals.filter(item => item.bookingId === booking.id);
  assert.equal(approvals.length, 2);
  assert.equal((await request(`/agent/bookings/${booking.id}/cancel`, agent, { version: booking.version, reason: 'Repeat' })).status, 400);
  assert.equal((await request('/agent/bookings', agent, dates)).status, 201, 'cancellation immediately releases the exact booked interval');
  for (const approval of approvals) assert.equal((await request(`/manager/approvals/${approval.id}`, manager, { version: approval.version, decision: 'approved', reason: 'Cash released to customer' })).status, 200);
  const settled = (await request('/workspace', agent)).data.bookings.find(item => item.id === booking.id);
  assert.equal(settled.cancellation.refundOutstanding, 0); assert.equal(settled.cancellation.refundStatus, 'Released');
  assert.equal(settled.billing.totalPaid, 8000, 'original cash receipts remain intact');

  const maintenance = await request('/mechanic/maintenance', mechanic, { vehicleId: 'tesla-3', type: 'Oil change', description: 'Scheduled service', start: '2099-03-02', startTime: '09:00', end: '2099-03-03', endTime: '14:00' });
  assert.equal(maintenance.status, 201, JSON.stringify(maintenance.data));
  const attempt = period => request('/agent/bookings', agent, { ...dates, vehicleId: 'tesla-3', ...period });
  assert.equal((await attempt({ start: '2099-03-02', end: '2099-03-03', startTime: '10:00', endTime: '15:00' })).status, 409);
  assert.equal((await attempt({ start: '2099-03-03', end: '2099-03-04', startTime: '14:00' })).status, 201);

  const desktop = await request('/sync', agent, undefined, { 'User-Agent': 'Desktop' });
  const mobile = await request('/sync', agent, undefined, { 'User-Agent': 'Mobile Safari' });
  assert.equal(desktop.status, 200); assert.equal(mobile.status, 200);
  delete desktop.data.refreshedAt; delete mobile.data.refreshedAt;
  assert.deepEqual(mobile.data, desktop.data);
  assert.match(mobile.headers.get('cache-control'), /no-store/);
  assert.deepEqual(mobile.data.workspace.bookings, mobile.data.operations.bookings.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
});

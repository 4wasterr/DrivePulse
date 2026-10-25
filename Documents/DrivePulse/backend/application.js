const { asyncMap, asyncForEach } = require('./asyncCollections');
const express = require('express');
const cors = require('cors');
const { createDatabase } = require('./db');
const { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } = require('node:crypto');
const D = require('./domain');
const { createFleet } = require('./fleet');
const { createAudit } = require('./audit');
const { createRentalDocuments, DEFAULT_TERMS } = require('./rentalDocuments');
const { validPassword, PASSWORD_ERROR, isAdmin } = require('./security');
const { vehicleProfile, renewalNotices, expiryDate } = require('./vehicleProfile');
const demoAccounts = require('../shared/demoAccounts.json');
const { inputError } = require('../shared/validation.mjs');

const hash = (value) => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
function publicUser(user) {
  return {
    id: user.id, name: user.name, email: user.email, role: user.role,
    createdAt: user.created_at || null, lastLoginAt: user.last_login_at || null,
    archivedAt: user.archived_at || null, archivedBy: user.archived_by || null, archiveReason: user.archive_reason || null
  };
}
function passwordRecord(password) {
  const salt = randomBytes(16).toString('hex');
  return { salt, passwordHash: scryptSync(password, salt, 64).toString('hex') };
}
function samplePDF(label) {
  const content = `BT /F1 18 Tf 45 740 Td (DRIVEPULSE - ILLUSTRATIVE SAMPLE) Tj 0 -40 Td /F1 13 Tf (${label}) Tj 0 -30 Td (Demo review document. Not a real identity document.) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`];
  let pdf = '%PDF-1.4\n',offsets = [0];
  objects.forEach((body, index) => {offsets.push(Buffer.byteLength(pdf));pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;});
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

async function createApp({ app = express(), database = null, dbPath, seedDemo = process.env.NODE_ENV !== 'production' && !process.env.DATABASE_URL, allowAgentSignup = process.env.NODE_ENV !== 'production' && !process.env.DATABASE_URL && process.env.ALLOW_AGENT_SIGNUP !== 'false' || process.env.ALLOW_AGENT_SIGNUP === 'true' } = {}) {
  if (process.env.NODE_ENV === 'production' && (seedDemo || allowAgentSignup)) throw new Error('Demo data and staff self-registration must be disabled in production.');
  const db = database || createDatabase({ filename: dbPath });
  await db.initialize();
  await db.prepare("UPDATE documents SET owner_id='sample-owner-archive' WHERE name LIKE 'sample-%.pdf' AND owner_id<>'sample-owner-archive'").run();

  const rawBookings = async () => (await db.prepare('SELECT payload FROM bookings').all()).map((row) => JSON.parse(row.payload));
  const allBookings = async () => (await rawBookings()).filter((b) => !b.archivedAt);
  const assertCashReference = async (reference, excludeId) => {
    if ((await rawBookings()).some((b) => (b.payments || []).some((p) => p.id !== excludeId && p.status === 'confirmed' && p.reference?.toLowerCase() === reference.toLowerCase()))) D.fail('This cash receipt reference has already been used.', 409);
  };
  const getBooking = async (id, includeArchived = false) => {
    const row = await db.prepare('SELECT payload FROM bookings WHERE id=?').get(id);
    if (!row) D.fail('Reservation not found.', 404);
    const b = JSON.parse(row.payload);
    if (b.archivedAt && !includeArchived) D.fail('Reservation is archived.', 404);
    return b;
  };
  const saveBooking = async (booking) => await db.prepare('INSERT INTO bookings(id,owner_id,payload) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,owner_id=excluded.owner_id').run(booking.id, booking.ownerId || null, JSON.stringify(booking));
  const allTickets = async () => (await db.prepare('SELECT payload FROM tickets').all()).map((row) => JSON.parse(row.payload));
  const saveTicket = async (ticket) => await db.prepare('INSERT INTO tickets(id,owner_id,payload) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(ticket.id, ticket.ownerId || null, JSON.stringify(ticket));
  const meta = (doc) => ({ id: doc.id, kind: doc.kind, name: doc.name, mime: doc.mime, fingerprint: doc.fingerprint, size: doc.data.length, uploadedAt: doc.uploaded_at });
  const addUser = async (name, email, role, password) => {
    const record = passwordRecord(password),id = randomUUID(),createdAt = now();
    await db.prepare('INSERT INTO users(id,email,name,role,salt,password_hash,created_at) VALUES(?,?,?,?,?,?,?)').run(id, email, name, role, record.salt, record.passwordHash, createdAt);
    return await db.prepare('SELECT * FROM users WHERE id=?').get(id);
  };
  const systemAudit = createAudit(db);
  const audit = async (booking, user, action, note = '', extra = {}) => {
    booking.activity ||= [];
    booking.activity.push({ id: randomUUID(), at: now(), by: user.name, action, note });
    await systemAudit.write(user, action, booking.id, note, 200, extra);
  };
  const transaction = async (callback) => await db.transaction(callback);
  const rentalDocuments = createRentalDocuments({ db, getBooking, saveBooking, transaction, audit });
  const fleet = createFleet({ db, allBookings, rawBookings, getBooking, saveBooking, transaction, audit, rentalDocuments, systemAudit });
  const updateBooking = async (req, action, fn) => await transaction(async () => {
    const booking = await getBooking(req.params.id);
    if (req.body.version !== booking.version) D.fail('This reservation changed. Refresh it and try again.', 409);
    const oldSnap = { status: booking.status, end: booking.end, rental: booking.rental, lateFee: booking.lateFee };
    await fn(booking);
    booking.version += 1;
    const newSnap = { status: booking.status, end: booking.end, rental: booking.rental, lateFee: booking.lateFee };
    await audit(booking, req.user, action, req.body.reason || req.body.note || '', { oldValue: oldSnap, newValue: newSnap });
    await saveBooking(booking);
    return await fleet.present(booking);
  });

  const seedReservations = seedDemo && !(await db.prepare('SELECT id FROM users WHERE email=?').get('client@drivepulse.demo'));
  if (seedDemo) {
    await transaction(async () => {
      for (const account of demoAccounts) {
        const existing = await db.prepare('SELECT * FROM users WHERE email=?').get(account.email);
        if (!existing) await addUser(account.name, account.email, account.role, account.password);
        // Upgrade only the original demo password; preserve manager changes and deactivations.
        else if (existing.role === account.role && !existing.archived_at && timingSafeEqual(scryptSync('DrivePulse123!', existing.salt, 64), Buffer.from(existing.password_hash, 'hex'))) {
          const record = passwordRecord(account.password);
          await db.prepare('UPDATE users SET salt=?,password_hash=? WHERE id=?').run(record.salt, record.passwordHash, existing.id);
          await db.prepare('DELETE FROM sessions WHERE user_id=?').run(existing.id);
        }
      }
    });
  }
  if (seedReservations) {
    await transaction(async () => {
      const client = await db.prepare('SELECT * FROM users WHERE email=?').get('client@drivepulse.demo');
      const agent = await db.prepare('SELECT * FROM users WHERE email=?').get('agent@drivepulse.demo');
      const docs = await asyncMap(D.REQUIRED_DOCUMENTS, async (kind) => {
        const id = randomUUID(),data = samplePDF(kind);
        await db.prepare('INSERT INTO documents(id,owner_id,kind,name,mime,fingerprint,uploaded_at,data) VALUES(?,?,?,?,?,?,?,?)').run(id, 'sample-owner-archive', kind, `sample-${kind}.pdf`, 'application/pdf', hash(data), now(), data);
        return { ...meta(await db.prepare('SELECT * FROM documents WHERE id=?').get(id)), review: { status: 'pending' } };
      });
      const date = (offset) => new Date(Date.now() + 8 * 3600000 + offset * D.DAY).toISOString().slice(0, 10);
      const specifications = [
      ['DP-10248', 'bmw-3', 2, 5, 'Pending Approval', 'Online'], ['DP-10249', 'range-rover', 1, 3, 'Pending Approval', 'Walk-in'],
      ['DP-10250', 'tesla-3', 1, 4, 'Ready for Dispatch', 'Online'], ['DP-10251', 'toyota-camry', -3, -1, 'On Rental', 'Online'],
      ['DP-10182', 'mercedes-c', -10, -8, 'Completed', 'Online']];

      for (const [id, vehicleId, start, end, status, source] of specifications) {
        const dates = { vehicleId, start: date(start), end: date(end), startTime: '10:00', endTime: '10:00', pickup: D.LOCATIONS[0], dropoff: D.LOCATIONS[0] };
        const booking = { id, ...dates, ...D.quote(dates, true), ownerId: client.id, renter: { name: client.name, email: client.email, phone: 'Demo customer' }, status, source, sample: true, version: 1, documents: structuredClone(docs), payments: [], payment: 'Demo payment record', createdAt: now(), lateFee: 0, activity: [] };
        const confirmed = status !== 'Pending Approval';
        booking.payments = ['rental', 'deposit'].map((type) => ({ id: randomUUID(), type, amount: booking[type], method: 'Cash (sample)', reference: `SAMPLE-${id}-${type}`, status: confirmed ? 'confirmed' : 'pending', at: now(), simulated: true }));
        await rentalDocuments.contract(booking, agent);
        if (confirmed) {
          booking.documents.forEach((doc) => {doc.review = { status: 'approved', by: agent.name, at: now(), note: 'Illustrative sample review' };});
          booking.inspection = { status: 'approved', role: 'mechanic', by: 'Riley Cruz', at: now(), odometer: 14200, fuelLevel: 100, cleanliness: 'Clean', scratches: 'No visible scratches', tirePressure: { frontLeft: 33, frontRight: 33, rearLeft: 32, rearRight: 32 }, checks: { exterior: true, interior: true, tyres: true, controls: true, fuel: true }, photos: [{ id: 'sample-ext', view: 'exterior' }, { id: 'sample-int', view: 'interior' }], note: 'Illustrative inspection' };
          if (status !== 'Completed') booking.dispatchPass = { id: `PASS-${randomUUID().slice(0, 8).toUpperCase()}`, issuedAt: now(), issuedBy: agent.name, end: booking.end, endTime: booking.endTime };
        }
        await audit(booking, agent, 'Sample reservation created', 'Illustrative data for the development workspace.', { oldValue: null, newValue: { id, status, vehicleId } });
        await saveBooking(booking);
      }
      await saveTicket({ id: `Q-${randomUUID().slice(0, 8)}`, ownerId: client.id, bookingId: 'DP-10248', subject: 'Can I extend my rental?', category: 'Extension', status: 'open', createdAt: now(), version: 1, messages: [{ id: randomUUID(), by: client.name, role: 'client', message: 'Could you help me add one extra day to this reservation?', at: now() }] });
    });
  }

  app.disable('x-powered-by');
  // Isolate local transactions and cache repeated PostgreSQL reads per request.
  app.use((req, res, next) => {
    db.exclusive(() => new Promise(resolve => {
      res.once('finish', resolve);
      res.once('close', resolve);
      next();
    })).catch(next);
  });
  const localOrigins = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173';
  const deploymentHosts = [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL];
  if (process.env.VERCEL_ENV === 'production') deploymentHosts.push(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  const origins = [
  ...(process.env.FRONTEND_ORIGIN || localOrigins).split(',').map((origin) => origin.trim()).filter(Boolean),
  ...deploymentHosts.filter(Boolean).map((host) => `https://${host}`)];

  app.use(cors({ origin: origins, credentials: true }));
  app.use('/api', systemAudit.middleware);
  app.use('/api', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') && !origins.includes(req.get('origin'))) return res.status(403).json({ error: 'This request origin is not allowed.' });
    const cookie = req.get('cookie')?.split(';').map((c) => c.trim()).find((c) => c.startsWith('drivepulse_session='))?.slice('drivepulse_session='.length);
    if (cookie) {
      const record = await db.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token=? AND expires>? AND users.archived_at IS NULL').get(hash(cookie), Date.now());
      if (record) req.user = record;
    }
    next();
  });
  const requireUser = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Sign in to continue.' });
  const requireAgent = (req, res, next) => !req.user ? res.status(401).json({ error: 'Sign in to continue.' }) : req.user.role !== 'agent' ? res.status(403).json({ error: 'This action requires a booking-agent account.' }) : next();
  const requireManager = (req, res, next) => !req.user ? res.status(401).json({ error: 'Sign in to continue.' }) : req.user.role !== 'manager' ? res.status(403).json({ error: 'This action requires an operations-manager account.' }) : next();
  const requireAdmin = (req, res, next) => !req.user ? res.status(401).json({ error: 'Sign in to continue.' }) : !isAdmin(req.user) ? res.status(403).json({ error: 'Only an Admin can edit user profiles.' }) : next();
  const requireClient = (req, res, next) => !req.user ? res.status(401).json({ error: 'Sign in to continue.' }) : req.user.role !== 'client' ? res.status(403).json({ error: 'Use a client account to book a personal rental.' }) : next();

  app.post('/api/vehicle-images', requireManager, express.raw({ type: () => true, limit: '4mb' }), async (req, res) => {
    const mime = req.get('content-type')?.split(';')[0], data = req.body;
    if (!Buffer.isBuffer(data) || !data.length) D.fail('Choose a non-empty vehicle photo.');
    const valid = mime === 'image/png' ? data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : mime === 'image/jpeg' ? data[0] === 255 && data[1] === 216 && data[2] === 255 : mime === 'image/webp' ? data.subarray(0,4).toString() === 'RIFF' && data.subarray(8,12).toString() === 'WEBP' : false;
    if (!valid) D.fail('Upload a valid JPG, PNG, or WebP vehicle photo (up to 4 MB).');
    const id = randomUUID();
    let name;
    try { name = decodeURIComponent(req.get('x-file-name') || 'vehicle-photo'); } catch { D.fail('Invalid file name.'); }
    name = D.text(name.replace(/[\r\n/\\]/g, '_'), 'File name', 180);
    await db.prepare('INSERT INTO documents(id,owner_id,kind,name,mime,fingerprint,uploaded_at,data) VALUES(?,?,?,?,?,?,?,?)').run(id, req.user.id, 'vehicle-image', name, mime, hash(data), now(), data);
    res.status(201).json({ id, url: `/api/vehicle-images/${id}` });
  });
  app.get('/api/vehicle-images/:id', async (req, res) => {
    const doc = await db.prepare("SELECT * FROM documents WHERE id=? AND kind='vehicle-image'").get(req.params.id);
    // Only attached profile photos are public; staged uploads stay private.
    const attached = (await fleet.fleet()).some(v => v.imageId === req.params.id);
    if (!doc || !attached && (!isAdmin(req.user) || doc.owner_id !== req.user.id)) D.fail('Vehicle image not found.', 404);
    res.type(doc.mime).send(Buffer.from(doc.data));
  });

  app.post('/api/documents/:kind', requireUser, express.raw({ type: () => true, limit: '4mb' }), async (req, res) => {
    const condition = req.params.kind === 'condition';
    const kind = condition ? `condition:${req.query.vehicleId}` : req.params.kind.startsWith('payment-') ? 'payment' : req.params.kind;
    if (condition) {
      if (req.user.role !== 'mechanic') D.fail('Condition photos require a fleet-mechanic account.', 403);
      await fleet.state(req.query.vehicleId);
    } else if (![...D.REQUIRED_DOCUMENTS, 'payment'].includes(kind)) D.fail('Unsupported document category.');else
    if (!['client', 'agent'].includes(req.user.role)) D.fail('Use a client or booking-agent account for customer documents.', 403);
    const mime = req.get('content-type')?.split(';')[0],data = req.body;
    if (!Buffer.isBuffer(data) || !data.length) D.fail('Choose a non-empty file.');
    const isValid = mime === 'application/pdf' ? data.subarray(0, 5).toString() === '%PDF-' : mime === 'image/png' ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : mime === 'image/jpeg' ? data[0] === 255 && data[1] === 216 && data[2] === 255 : mime === 'image/webp' ? data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP' : false;
    if (!isValid) D.fail('Upload a valid PDF, JPG, PNG, or WebP file.');
    if (condition && !mime.startsWith('image/')) D.fail('Condition proof must be a JPG, PNG, or WebP photo.');
    let name;
    try {name = decodeURIComponent(req.get('x-file-name') || 'document');} catch {D.fail('Invalid file name.');}
    name = D.text(name.replace(/[\r\n/\\]/g, '_'), 'File name', 180);
    let booking;
    if (req.query.bookingId) {
      if (req.user.role !== 'agent') D.fail('Only agents can upload on behalf of a reservation.', 403);
      booking = await getBooking(req.query.bookingId);
      if (!['Pending Approval', 'Ready for Dispatch'].includes(booking.status)) D.fail('Documents cannot be replaced after dispatch or closure.');
    }
    const id = randomUUID(),ownerId = booking?.ownerId || (booking ? `walkin:${booking.id}` : req.user.id);
    await transaction(async () => {
      await db.prepare('INSERT INTO documents(id,owner_id,kind,name,mime,fingerprint,uploaded_at,data) VALUES(?,?,?,?,?,?,?,?)').run(id, ownerId, kind, name, mime, hash(data), now(), data);
      if (D.REQUIRED_DOCUMENTS.includes(kind)) {
        const affected = booking ? [booking] : (await allBookings()).filter((b) => b.ownerId === req.user.id && ['Pending Approval', 'Ready for Dispatch'].includes(b.status));
        await asyncForEach(affected, async (b) => {
          const prevDoc = (b.documents || []).find((d) => d.kind === kind);
          b.documents = (b.documents || []).filter((d) => d.kind !== kind);
          b.documents.push({ ...meta(await db.prepare('SELECT * FROM documents WHERE id=?').get(id)), review: { status: 'pending' } });
          D.invalidatePass(b);b.version += 1;
          await audit(b, req.user, 'Document uploaded', kind, { oldValue: prevDoc ? { kind, name: prevDoc.name } : null, newValue: { kind, name } });
          await saveBooking(b);
        });
      }
    });
    res.status(201).json(meta(await db.prepare('SELECT * FROM documents WHERE id=?').get(id)));
  });

  app.use(express.json({ limit: '100kb' }));
  app.use((req, res, next) => {req.body ??= {};next();});
  app.get('/api/health', async (req, res) => {
    await db.health();
    res.json({ ok: true });
  });
  app.get('/api/session', async (req, res) => res.json({
    user: req.user ? publicUser(req.user) : null,
    agentSignup: allowAgentSignup,
    staffSignup: allowAgentSignup,
    demo: seedDemo,
    rates: Object.fromEntries((await fleet.fleet(true)).map((v) => [v.id, v.rate]))
  }));

  const createSession = async (user, res) => {
    const token = randomBytes(32).toString('hex'),loginAt = now();
    await db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(loginAt, user.id);
    user.last_login_at = loginAt;
    await db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
    await db.prepare('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)').run(hash(token), user.id, Date.now() + 7 * D.DAY);
    res.cookie('drivepulse_session', token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 7 * D.DAY, path: '/' });
    return publicUser(user);
  };

  app.post('/api/auth/:action', async (req, res) => {
    if (!['login', 'signup'].includes(req.params.action)) D.fail('Not found.', 404);
    const address = process.env.VERCEL ? req.get('x-real-ip') || req.ip : req.ip;
    const at = Date.now(), cutoff = at - 15 * 60000;
    await db.prepare('DELETE FROM auth_attempts WHERE started_at<?').run(cutoff);
    const attempt = await db.prepare(`INSERT INTO auth_attempts(address,started_at,attempts) VALUES(?,?,1)
      ON CONFLICT(address) DO UPDATE SET
      attempts=CASE WHEN auth_attempts.started_at<? THEN 1 ELSE auth_attempts.attempts+1 END,
      started_at=CASE WHEN auth_attempts.started_at<? THEN excluded.started_at ELSE auth_attempts.started_at END
      RETURNING attempts`).get(address, at, cutoff, cutoff);
    if (attempt.attempts > 25) D.fail('Too many attempts. Please try again in 15 minutes.', 429);
    const signup = req.params.action === 'signup';
    const identifier = D.text(signup ? req.body.email : req.body.username ?? req.body.email, signup ? 'Email' : 'Email or username', 160).toLowerCase();
    const identifierError = inputError(identifier, { kind: signup ? 'email' : 'login-identifier' });
    if (identifierError) D.fail(identifierError);
    const demoAccount = !signup && seedDemo ? demoAccounts.find(account => account.username === identifier) : null;
    const email = demoAccount?.email || identifier, password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!password.trim() || password.length > 128) D.fail('Enter your password (up to 128 characters).');
    const existing = await db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (req.params.action === 'signup') {
      if (!validPassword(password)) D.fail(PASSWORD_ERROR);
      if (!['client', 'agent', 'mechanic', 'manager'].includes(req.body.role)) D.fail('Choose a valid account type.');
      if (existing) D.fail('An account already uses this email. Sign in instead.', 409);
      if (req.body.role !== 'client' && !allowAgentSignup) D.fail('Ask your administrator to create a staff account.', 403);
      const user = await addUser(D.text(req.body.name, 'Full name', 70), email, req.body.role, password);
      req.auditUser = user;
      await systemAudit.write(user, 'Account registration', `Account: ${user.email}`, `New ${user.role} account created`, 201, {
        ip: address,
        newValue: { name: user.name, email: user.email, role: user.role }
      });
      return res.status(201).json({ user: await createSession(user, res) });
    }
    const candidate = scryptSync(password, existing?.salt || 'missing-account-salt', 64);
    if (!existing || demoAccount && existing.role !== demoAccount.role || !timingSafeEqual(candidate, Buffer.from(existing.password_hash, 'hex'))) {
      await systemAudit.write(
        { id: existing?.id || null, name: email, role: existing?.role || 'anonymous' },
        'Failed login attempt',
        `Account: ${email}`,
        'Invalid username, email or password attempt',
        401,
        { ip: address, alertType: 'Failed login attempt' }
      );
      D.fail('Email, username or password is incorrect.', 401);
    }
    if (existing.archived_at) {
      await systemAudit.write(
        existing,
        'Deactivated sign-in blocked',
        `Account: ${existing.email}`,
        'Deactivated user attempted to sign in',
        403,
        { ip: address, alertType: 'Policy override' }
      );
      D.fail('This account has been deactivated by an operations manager.', 403);
    }
    await db.prepare('DELETE FROM auth_attempts WHERE address=?').run(address);
    req.auditUser = existing;
    await systemAudit.write(existing, 'User sign in', `Account: ${existing.email}`, 'Successful user authentication', 200, { ip: address });
    res.json({ user: await createSession(existing, res) });
  });

  app.post('/api/logout', async (req, res) => {
    if (req.user) {
      await systemAudit.write(req.user, 'User sign out', `Account: ${req.user.email}`, 'User logged out', 200, { ip: req.ip });
    }
    const token = req.get('cookie')?.split(';').map((c) => c.trim()).find((c) => c.startsWith('drivepulse_session='))?.slice('drivepulse_session='.length);
    if (token) await db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token));
    res.clearCookie('drivepulse_session', { path: '/', httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production' });res.json({ ok: true });
  });

  app.get('/api/availability', async (req, res) => res.json([
  ...(await allBookings()).map(({ id, vehicleId, start, end, startTime, endTime, status }) => ({ id, vehicleId, start, end, startTime, endTime, status })),
  ...(await fleet.fleet(true)).filter((v) => v.archivedAt || ['Under Inspection', 'Maintenance', 'Out of Service', 'Overdue'].includes(v.status)).map((v) => ({ id: `hold-${v.id}`, vehicleId: v.id, status: v.status, rate: v.rate, blocked: true }))]
  ));

  app.get('/api/workspace', requireUser, async (req, res) => {
    const agent = ['agent', 'manager'].includes(req.user.role),documents = {};
    (await db.prepare('SELECT * FROM documents WHERE owner_id=? ORDER BY uploaded_at ASC, rowid ASC').all(req.user.id)).filter((d) => D.REQUIRED_DOCUMENTS.includes(d.kind)).forEach((doc) => {documents[doc.kind] = meta(doc);});
    res.json({
      user: publicUser(req.user),
      bookings: (await asyncMap((await allBookings()).filter((b) => agent || b.ownerId === req.user.id), fleet.present)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      documents,
      tickets: (await allTickets()).filter((t) => req.user.role === 'agent' || t.ownerId === req.user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    });
  });

  const notificationsFor = async user => {
    const bookings = (await allBookings()).filter(b => user.role !== 'client' || b.ownerId === user.id);
    const activeFleet = await fleet.fleet();
    const notices = renewalNotices(activeFleet.filter(v => user.role !== 'client' || bookings.some(b => b.vehicleId === v.id)));
    if (user.role !== 'mechanic') {
      for (const b of bookings) {
        for (const payment of (b.payments || []).filter(p => p.type === 'deposit')) notices.push({ id: `deposit-payment:${payment.id}:${payment.status}`, category: 'deposit', severity: 'info', title: `Security Deposit · ${payment.status === 'confirmed' ? 'received' : payment.status}`, message: `${b.id} · PHP ${payment.amount} · ${payment.status === 'pending' ? 'Awaiting payment verification' : 'Payment status updated'}`, at: payment.reviewedAt || payment.at });
      }
      const approvals = (await fleet.records('approval')).filter(a => bookings.some(b => b.id === a.bookingId));
      for (const a of approvals) notices.push({ id: `deposit:${a.id}:${a.status}`, category: a.type === 'deposit' ? 'deposit' : 'system', severity: 'info', title: `${a.type === 'deposit' ? 'Security Deposit' : 'Rental payment return'} · ${a.status}`, message: `${a.bookingId} · PHP ${a.amount} · ${a.disbursement ? 'Cash release recorded' : a.status === 'pending' ? 'Awaiting approval' : 'Decision recorded'}`, at: a.reviewedAt || a.at });
    }
    if (isAdmin(user)) {
      for (const alert of await systemAudit.alerts(40)) notices.push({ id: `system:${alert.id}`, category: 'system', severity: 'warning', title: alert.alert_type || alert.action, message: `${alert.action} · ${alert.detail}`, at: alert.at });
    } else {
      for (const b of bookings.filter(b => b.status === 'On Rental' && D.time(b.end, b.endTime) < Date.now())) notices.push({ id: `overdue:${b.id}:${b.end}:${b.endTime}`, category: 'system', severity: 'urgent', title: 'Vehicle return overdue', message: `${b.id} · Scheduled return ${b.end} ${b.endTime} PHT` });
    }
    const read = await db.prepare("SELECT payload FROM fleet_records WHERE kind='notification-read' AND id=?").get(user.id);
    const ids = new Set(read ? JSON.parse(read.payload).ids : []);
    const priority = { urgent: 0, warning: 1, info: 2 };
    return notices.map(n => ({ ...n, read: ids.has(n.id) })).sort((a, b) => Number(a.read) - Number(b.read) || priority[a.severity] - priority[b.severity] || (a.days ?? Infinity) - (b.days ?? Infinity) || (b.at || '').localeCompare(a.at || ''));
  };
  app.get('/api/notifications', requireUser, async (req, res) => res.json(await notificationsFor(req.user)));
  app.post('/api/notifications/read', requireUser, async (req, res) => res.json(await transaction(async () => {
    if (!Array.isArray(req.body.ids) || req.body.ids.length > 300 || req.body.ids.some(id => typeof id !== 'string')) D.fail('Choose valid notifications.');
    const notices = await notificationsFor(req.user), allowed = new Set(notices.map(n => n.id));
    if (req.body.ids.some(id => !allowed.has(id))) D.fail('Notification not found.', 404);
    await fleet.save('notification-read', { id: req.user.id, ids: [...new Set([...notices.filter(n => n.read).map(n => n.id), ...req.body.ids])] });
    return { ok: true };
  })));

  app.patch('/api/profile', requireAdmin, async (req, res) => {
    const name = D.text(req.body.name, 'Full name', 70);
    const email = D.text(req.body.email, 'Email', 160).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) D.fail('Enter a valid email address.');
    if (await db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(email, req.user.id)) D.fail('This email is already registered.', 409);
    const oldProfile = { name: req.user.name, email: req.user.email };
    await db.prepare('UPDATE users SET name=?,email=? WHERE id=?').run(name, email, req.user.id);
    await systemAudit.write(req.user, 'Profile updated', `user:${req.user.id}`, `${oldProfile.email} → ${email}`, 200, { oldValue: oldProfile, newValue: { name, email } });
    res.json(publicUser(await db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)));
  });

  app.get('/api/documents/:id', requireUser, async (req, res) => {
    let doc = await db.prepare('SELECT * FROM documents WHERE id=?').get(req.params.id);
    if (!doc && D.REQUIRED_DOCUMENTS.includes(req.params.id)) doc = await db.prepare('SELECT * FROM documents WHERE owner_id=? AND kind=? ORDER BY uploaded_at DESC,rowid DESC LIMIT 1').get(req.user.id, req.params.id);
    if (!doc) D.fail('Document not found.', 404);
    const staffFile = doc.kind.startsWith('condition:');
    const canRead = staffFile ? ['mechanic', 'manager', 'agent'].includes(req.user.role) : req.user.role === 'agent' || doc.owner_id === req.user.id;
    if (!canRead) D.fail('Document not found.', 404);
    res.set('Content-Type', doc.mime);res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(doc.name)}`);res.send(Buffer.from(doc.data));
  });

  const agreementPreview = async (input, user) => {
    const vehicle = (await fleet.fleet()).find(v => v.id === input.vehicleId);
    if (!vehicle) D.fail('Choose an active fleet vehicle.', 404);
    const blocks = await fleet.operationalBlocks(vehicle.id);
    if (blocks.length || vehicle.status === 'Overdue') D.fail(blocks.join(' ') || 'This vehicle is overdue and unavailable.', 409);
    const quote = D.quote(input, false, vehicle.rate, vehicle);
    if (!D.available(await allBookings(), input)) D.fail('This vehicle is already reserved for those dates.', 409);
    const preview = {
      vehicle: { id: vehicle.id, fleetCode: vehicle.fleetCode, plate: vehicle.plate || '', name: vehicle.name },
      renter: { name: user.name, email: user.email },
      schedule: Object.fromEntries(['start', 'end', 'startTime', 'endTime', 'pickup', 'dropoff'].map(key => [key, input[key]])),
      quote: { ...quote, dailyRate: vehicle.rate }, terms: DEFAULT_TERMS
    };
    return { ...preview, digest: hash(JSON.stringify(preview)) };
  };
  app.post('/api/bookings/agreement-preview', requireClient, async (req, res) => res.json(await agreementPreview(req.body, req.user)));

  const createBooking = async (req, walkin) => await transaction(async () => {
    const input = req.body;
    const blocks = await fleet.operationalBlocks(input.vehicleId);
    if (blocks.length) D.fail(blocks.join(' '), 409);
    const quotation = D.quote(input, false, await fleet.vehicleRate(input.vehicleId), await fleet.vehicle(input.vehicleId));
    if (!walkin && input.agreementPreviewDigest) {
      const preview = await agreementPreview(input, req.user);
      if (input.agreementPreviewDigest !== preview.digest) D.fail('The rental agreement changed. Review the updated vehicle, dates and quotation before submitting again.', 409);
      if (input.agreed !== true) D.fail('Accept the rental terms before confirming your reservation.');
    }
    if ((await fleet.fleet()).some((v) => v.id === input.vehicleId && v.status === 'Overdue')) D.fail('This vehicle is overdue and must be returned before another reservation can be made.', 409);
    if (!D.available(await allBookings(), input)) D.fail('This vehicle is already reserved for those dates.', 409);
    let ownerId = req.user.id,renter = publicUser(req.user),docs = [];
    if (walkin) {
      renter = { name: D.text(input.renter?.name, 'Customer name', 70), email: D.text(input.renter?.email, 'Email', 160, false).toLowerCase(), phone: D.text(input.renter?.phone, 'Contact number', 40) };
      if (renter.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(renter.email)) D.fail('Enter a valid customer email.');
      ownerId = (await db.prepare("SELECT id FROM users WHERE email=? AND role='client'").get(renter.email))?.id || null;
    } else {
      docs = await asyncMap(D.REQUIRED_DOCUMENTS, async (kind) => {
        const doc = await db.prepare('SELECT * FROM documents WHERE owner_id=? AND kind=? ORDER BY uploaded_at DESC,rowid DESC LIMIT 1').get(req.user.id, kind);
        if (!doc) D.fail('Upload your license and two government IDs before booking.');
        return { ...meta(doc), review: { status: 'pending' } };
      });
      if (new Set(docs.map((d) => d.fingerprint)).size !== 3) D.fail('Your license and two IDs must be different files.');
    }
    const booking = { id: `DP-${randomUUID().slice(0, 8).toUpperCase()}`, ownerId, renter, vehicleId: input.vehicleId, start: input.start, end: input.end, startTime: input.startTime, endTime: input.endTime, pickup: input.pickup, dropoff: input.dropoff, ...quotation, source: walkin ? 'Walk-in' : 'Online', status: 'Pending Approval', version: 1, documents: docs, payments: [], lateFee: 0, createdAt: now(), activity: [], note: D.text(input.note, 'Reservation note', 1000, false), payment: 'Cash' };
    booking.dailyRate = await fleet.vehicleRate(input.vehicleId);
    const selected = (await fleet.fleet()).find(v => v.id === input.vehicleId);
    booking.vehicle = { id: selected.id, name: selected.name, fleetCode: selected.fleetCode, plate: selected.plate || '' };
    if (!walkin && input.agreementPreviewDigest) booking.agreementAcceptance = { digest: input.agreementPreviewDigest, by: req.user.id, at: now() };
    if (!walkin) {
      booking.payments = ['rental', 'deposit'].map((type) => ({ id: randomUUID(), type, amount: booking[type], status: 'pending', method: 'Cash', reference: 'Awaiting cash at the counter', at: now() }));
    }
    await rentalDocuments.contract(booking, req.user);
    booking.confirmation = await rentalDocuments.issue(booking, 'confirmation', req.user, { terms: booking.agreement.terms, agreementId: booking.agreement.id, signature: renter.name, bookingStatus: booking.status });
    await audit(booking, req.user, walkin ? 'Walk-in scheduled' : 'Online booking received', '', { oldValue: null, newValue: { id: booking.id, vehicleId: booking.vehicleId, total: booking.total } });
    await saveBooking(booking);
    return await fleet.present(booking);
  });

  app.post('/api/bookings', requireClient, async (req, res) => res.status(201).json(await createBooking(req, false)));
  app.post('/api/agent/bookings', requireAgent, async (req, res) => res.status(201).json(await createBooking(req, true)));

  app.post('/api/bookings/:id/archive', requireUser, async (req, res) => res.json(await transaction(async () => {
    if (!['agent', 'manager'].includes(req.user.role)) D.fail('Only staff can archive reservations.', 403);
    const b = await getBooking(req.params.id);
    if (!['Completed', 'Cancelled'].includes(b.status)) D.fail('Only completed or cancelled reservations can be archived.');
    b.archivedAt = now();
    b.archivedBy = req.user.name;
    b.archiveReason = D.text(req.body.reason || 'Standard one-click record cleanup', 'Archive reason', 500, false);
    b.version += 1;
    await audit(b, req.user, 'Reservation archived (soft delete)', b.archiveReason, {
      oldValue: { status: b.status, archived: false },
      newValue: { status: b.status, archived: true, archivedBy: req.user.name }
    });
    await saveBooking(b);
    return { id: b.id, archivedAt: b.archivedAt };
  })));

  app.post('/api/agent/bookings/:id/review', requireAgent, async (req, res) => res.json(await updateBooking(req, 'ID review recorded', (b) => {
    if (['Cancelled', 'Completed', 'On Rental'].includes(b.status)) D.fail('Identity review is closed for this reservation.');
    const doc = b.documents.find((d) => d.id === req.body.documentId);
    if (!doc) D.fail('This document is no longer attached. Refresh the reservation.', 409);
    if (!['approved', 'rejected'].includes(req.body.decision)) D.fail('Choose approve or reject.');
    if (req.body.decision === 'approved' && b.documents.some((other) => other.kind !== doc.kind && other.fingerprint === doc.fingerprint)) D.fail('The license and two government IDs must be three different files.');
    const note = D.text(req.body.reason, 'Review note', 1000, req.body.decision === 'rejected');
    doc.review = { status: req.body.decision, by: req.user.name, at: now(), note };
    if (req.body.decision === 'rejected') D.invalidatePass(b);
  })));

  app.post('/api/agent/bookings/:id/payment', requireAgent, async (req, res) => res.json(await updateBooking(req, 'Payment recorded', async (b) => {
    if (b.status === 'Cancelled') D.fail('Payments cannot be added to a cancelled reservation.');
    const bill = D.billing(b),pending = b.payments.find((p) => p.id === req.body.paymentId);
    if (req.body.paymentId) {
      if (!pending || pending.status !== 'pending') D.fail('This payment was already reviewed.', 409);
      if (!['confirmed', 'rejected'].includes(req.body.decision)) D.fail('Choose confirm or reject.');
      if (req.body.decision === 'confirmed') {
        if (req.body.received !== true) D.fail('Confirm that the cash was physically received.');
        pending.reference = D.text(req.body.reference, 'Cash receipt reference', 150);
        pending.method = 'Cash';
      }
      if (req.body.decision === 'confirmed' && pending.amount > (pending.type === 'deposit' ? bill.depositBalance : bill.rentalBalance)) D.fail('This payment exceeds the outstanding balance. Reject it and record the correct amount.');
      pending.status = req.body.decision;pending.reviewedBy = req.user.name;pending.reviewedAt = now();pending.reviewNote = D.text(req.body.reason, 'Review note', 1000, req.body.decision === 'rejected');
      if (pending.status === 'confirmed') {await assertCashReference(pending.reference, pending.id);await rentalDocuments.cashReceipt(b, pending, req.user);}
    } else {
      const { type, amount } = req.body;
      const validAllocations = ['rental', 'deposit', 'extension', 'late_fee', 'fuel_charge', 'cleaning_fee', 'damage_fee', 'toll_violation'];
      if (!validAllocations.includes(type) || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || Math.abs(Math.round(amount * 100) - amount * 100) > 0.000001) D.fail('Enter a valid payment amount with at most two decimal places.');
      const maxAllowed = type === 'deposit' ? bill.depositBalance : bill.rentalBalance;
      if (amount > maxAllowed) D.fail('The payment exceeds the outstanding balance.');
      if (req.body.received !== true) D.fail('Confirm that the cash was physically received.');
      const reference = D.text(req.body.reference, 'Cash receipt reference', 150);await assertCashReference(reference);
      const payment = { id: randomUUID(), type, amount, status: 'confirmed', method: 'Cash', reference, at: now(), reviewedBy: req.user.name };
      b.payments.push(payment);await rentalDocuments.cashReceipt(b, payment, req.user);
    }
  })));

  app.post('/api/agent/bookings/:id/inspection', requireAgent, (req, res) => D.fail('Mandatory digital inspections and photo proof must be recorded by a fleet mechanic.', 403));

  app.post('/api/agent/bookings/:id/pass', requireAgent, async (req, res) => res.json(await updateBooking(req, 'Digital dispatch pass issued', async (b) => {
    const blocks = await fleet.dispatchBlocks(b);if (blocks.length) D.fail(blocks.join(' '));
    b.dispatchPass = { id: `PASS-${randomUUID().slice(0, 10).toUpperCase()}`, issuedBy: req.user.name, issuedAt: now(), end: b.end, endTime: b.endTime };
    if (b.status !== 'On Rental') b.status = 'Ready for Dispatch';
  })));

  app.post('/api/agent/bookings/:id/dispatch', requireAgent, async (req, res) => res.json(await updateBooking(req, 'Vehicle dispatched', async (b) => {
    if (b.status !== 'Ready for Dispatch' || !b.dispatchPass || b.dispatchPass.revokedAt || (await fleet.dispatchBlocks(b)).length) D.fail('Issue a valid dispatch pass after all checks are complete.');
    b.releaseSignoff = { signature: b.renter.name, at: now(), by: req.user.name, actorId: req.user.id, method: 'Front-desk dispatch confirmation' };
    b.status = 'On Rental';b.dispatchedAt = now();
    await rentalDocuments.receipt(b, 'release', req.user);
  })));

  app.post('/api/agent/bookings/:id/extend', requireAgent, async (req, res) => res.json(await updateBooking(req, 'Rental extended', async (b) => {
    if (['Cancelled', 'Completed'].includes(b.status)) D.fail('Closed reservations cannot be extended.');
    const updated = { ...b, end: req.body.end, endTime: req.body.endTime };
    if (D.time(updated.end, updated.endTime) <= Math.max(D.time(b.end, b.endTime), Date.now())) D.fail('Choose a future return time later than the current return.');
    const quotation = D.quote(updated, true, await fleet.vehicleRate(b.vehicleId), await fleet.vehicle(b.vehicleId));
    if (!D.available(await allBookings(), updated, b.id)) D.fail('This extension overlaps another reservation.', 409);
    b.extensions ||= [];b.extensions.push({ oldEnd: b.end, oldEndTime: b.endTime, newEnd: updated.end, newEndTime: updated.endTime, additionalRental: quotation.rental - b.rental, by: req.user.name, at: now() });
    b.end = updated.end;b.endTime = updated.endTime;b.days = quotation.days;b.rental = quotation.rental;b.dailyRate = quotation.rental / quotation.days;
    await rentalDocuments.contract(b, req.user);
    D.invalidatePass(b);
  })));

  app.post('/api/bookings/:id/extend', requireUser, async (req, res) => res.json(await updateBooking(req, 'Rental extended (Client self-service)', async (b) => {
    if (req.user.role === 'client' && b.ownerId !== req.user.id) D.fail('You can only extend your own rentals.', 403);
    if (!['On Rental', 'Ready for Dispatch'].includes(b.status)) D.fail('Only active or ready rentals can be extended.');
    const updated = { ...b, end: req.body.end, endTime: req.body.endTime };
    if (D.time(updated.end, updated.endTime) <= Math.max(D.time(b.end, b.endTime), Date.now())) D.fail('Choose a future return time later than the current return.');
    const quotation = D.quote(updated, true, await fleet.vehicleRate(b.vehicleId), await fleet.vehicle(b.vehicleId));
    if (!D.available(await allBookings(), updated, b.id)) D.fail('This vehicle is reserved by another customer for the requested extension dates.', 409);
    b.extensions ||= [];
    b.extensions.push({
      oldEnd: b.end, oldEndTime: b.endTime,
      newEnd: updated.end, newEndTime: updated.endTime,
      additionalRental: quotation.rental - b.rental,
      by: req.user.name, at: now(), clientInitiated: req.user.role === 'client'
    });
    b.end = updated.end;b.endTime = updated.endTime;b.days = quotation.days;b.rental = quotation.rental;b.dailyRate = quotation.rental / quotation.days;
    await rentalDocuments.contract(b, req.user);
    D.invalidatePass(b);
  })));

  app.post('/api/manager/bookings/:id/escalate-overdue', requireManager, async (req, res) => res.json(await transaction(async () => {
    const b = await getBooking(req.params.id);
    if (b.status !== 'On Rental') D.fail('Only active rentals can be escalated.', 400);
    const nowTime = Date.now();
    const returnTime = D.time(b.end, b.endTime);
    if (returnTime >= nowTime) D.fail('Rental is not yet overdue.', 400);
    const overdueHours = Math.ceil((nowTime - returnTime) / 3600000);
    b.overdueEscalatedAt = now();
    b.overdueEscalationNotice = {
      issuedAt: now(),
      issuedBy: req.user.name,
      overdueHours,
      actionRequired: 'Immediate vehicle return or legal demand turnover',
      reference: `ESC-${randomUUID().slice(0, 8).toUpperCase()}`
    };
    await saveBooking(b);
    await systemAudit.write(req.user, 'Overdue return escalated', b.id, `Escalated ${overdueHours}h overdue rental. Demand notice issued.`, 200, {
      alertType: 'Policy override'
    });
    return b;
  })));

  app.get('/api/vehicles', async (req, res) => {
    res.json(await fleet.fleet(true));
  });

  app.post('/api/manager/vehicles', requireManager, async (req, res) => res.status(201).json(await transaction(async () => {
    const input = req.body;
    const existing = await fleet.fleet(true);
    const profile = vehicleProfile(input, existing);
    const imageId = await validateVehicleImage(input.imageId, req.user);
    const vehicle = {
      ...profile, id: randomUUID(), imageId,
      status: 'Available',
      createdAt: now(),
      version: 1
    };
    await reserveVehicleIdentifier('fleet-code', vehicle.fleetCode, vehicle.id);
    await reserveVehicleIdentifier('vehicle-plate', vehicle.plate, vehicle.id);
    await fleet.saveDynamicVehicle(vehicle);
    await systemAudit.write(req.user, 'Vehicle added to fleet', vehicle.id, `Added ${vehicle.name} (${vehicle.fleetCode}) at PHP ${vehicle.rate}/day`);
    return vehicle;
  })));

  async function reserveVehicleIdentifier(kind, value, vehicleId) {
    const id = value.replace(/[^a-z0-9]/gi, '').toUpperCase();
    const inserted = await db.prepare('INSERT INTO fleet_records(kind,id,payload) VALUES(?,?,?) ON CONFLICT(kind,id) DO NOTHING RETURNING id').get(kind, id, JSON.stringify({ id, vehicleId }));
    if (!inserted) {
      const row = await db.prepare('SELECT payload FROM fleet_records WHERE kind=? AND id=?').get(kind, id);
      if (JSON.parse(row.payload).vehicleId !== vehicleId) D.fail('This fleet code or plate is already assigned to another vehicle.', 409);
    }
  }

  async function validateVehicleImage(id, user, previousId) {
    if (!id) return null;
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) D.fail('Choose a valid uploaded vehicle image.');
    const doc = await db.prepare("SELECT * FROM documents WHERE id=? AND kind='vehicle-image'").get(id);
    if (!doc || doc.owner_id !== user.id && id !== previousId) D.fail('Choose a vehicle image uploaded by your account.');
    return id;
  }
  app.patch('/api/manager/vehicles/:id/profile', requireManager, async (req, res) => res.json(await transaction(async () => {
    const s = await fleet.state(req.params.id), current = (await fleet.fleet(true)).find(v => v.id === s.id);
    if (s.archivedAt) D.fail('Restore this vehicle before editing it.', 409);
    if (req.body.version !== s.version) D.fail('This vehicle changed. Refresh and try again.', 409);
    const profile = { ...current, ...req.body };
    const fleetCode = D.text(profile.fleetCode, 'Fleet code', 30).toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9 _-]{1,29}$/.test(fleetCode)) D.fail('Use 2–30 letters, numbers, spaces, hyphens or underscores for the fleet code.');
    const normalize = value => String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
    if ((await fleet.fleet(true)).some(v => v.id !== s.id && (normalize(v.fleetCode) === normalize(fleetCode) || normalize(v.id) === normalize(fleetCode)))) D.fail('This fleet code is already in use.', 409);
    const changes = { fleetCode, registrationExpiry: expiryDate(profile.registrationExpiry, 'OR/CR registration expiry'), insuranceExpiry: expiryDate(profile.insuranceExpiry, 'insurance expiry'), imageId: await validateVehicleImage(profile.imageId, req.user, current.imageId) };
    await reserveVehicleIdentifier('fleet-code', fleetCode, s.id);
    Object.assign(s, changes);
    await fleet.changeState(s, req.user, 'Vehicle profile updated', 'Fleet code, photo and renewal dates updated.', { oldValue: { fleetCode: current.fleetCode, registrationExpiry: current.registrationExpiry, insuranceExpiry: current.insuranceExpiry }, newValue: changes });
    return (await fleet.fleet()).find(v => v.id === s.id);
  })));

  app.post('/api/agent/bookings/:id/cancel', requireAgent, async (req, res) => res.json(await updateBooking(req, 'Reservation cancelled', (b) => {
    if (!['Pending Approval', 'Ready for Dispatch'].includes(b.status)) D.fail('Only reservations awaiting dispatch can be cancelled.');
    b.cancellation = { reason: D.text(req.body.reason, 'Cancellation reason', 1000), by: req.user.name, at: now(), refundDue: D.billing(b).totalPaid };
    D.invalidatePass(b);b.status = 'Cancelled';
  })));

  app.post('/api/agent/bookings/:id/return', requireAgent, async (req, res) => res.json(await updateBooking(req, 'Vehicle returned', async (b) => {
    if (b.status !== 'On Rental') D.fail('Only an active rental can be returned.');
    const returned = D.time(req.body.date, req.body.time),rate = req.body.hourlyRate;
    if (!Number.isFinite(returned) || returned < Math.max(D.time(b.start, b.startTime), Date.parse(b.dispatchedAt) || 0) || returned > Date.now() + 60000) D.fail('Return time must be after pick-up and actual dispatch and cannot be in the future.');
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 10000 || !Number.isInteger(rate)) D.fail('Enter a whole-peso hourly late fee from 0 to 10,000.');
    const lateHours = Math.max(0, Math.ceil((returned - D.time(b.end, b.endTime)) / 3600000));
    b.returnSignoff = { signature: b.renter.name, at: now(), by: req.user.name, actorId: req.user.id, method: 'Front-desk return confirmation' };
    b.lateFee = lateHours * rate;b.returnedAt = new Date(returned).toISOString();b.lateHours = lateHours;b.hourlyLateRate = rate;b.status = 'Completed';
    await fleet.recordReturn(b, req.user);await rentalDocuments.receipt(b, 'return', req.user);
  })));

  app.post('/api/support', requireClient, async (req, res) => {
    const bookingId = req.body.bookingId || null;
    if (bookingId && (await getBooking(bookingId)).ownerId !== req.user.id) D.fail('Reservation not found.', 404);
    const category = ['General', 'Extension', 'Cancellation', 'Billing', 'Documents'].includes(req.body.category) ? req.body.category : 'General';
    const ticket = { id: `Q-${randomUUID().slice(0, 8).toUpperCase()}`, ownerId: req.user.id, bookingId, category, subject: D.text(req.body.subject, 'Subject', 150), status: 'open', createdAt: now(), version: 1, messages: [{ id: randomUUID(), by: req.user.name, role: 'client', at: now(), message: D.text(req.body.message, 'Message', 3000) }] };
    await saveTicket(ticket);res.status(201).json(ticket);
  });

  app.post('/api/support/:id/reply', requireUser, async (req, res) => {
    const ticket = (await allTickets()).find((t) => t.id === req.params.id);
    if (!ticket || req.user.role !== 'agent' && ticket.ownerId !== req.user.id) D.fail('Query not found.', 404);
    if (req.body.version !== ticket.version) D.fail('This conversation changed. Refresh and try again.', 409);
    ticket.messages.push({ id: randomUUID(), by: req.user.name, role: req.user.role, at: now(), message: D.text(req.body.message, 'Reply', 3000) });
    ticket.status = req.user.role === 'agent' && req.body.resolve ? 'resolved' : 'open';ticket.version += 1;await saveTicket(ticket);res.json(ticket);
  });

  // Operations Manager: User Management & Telemetry
  app.get('/api/manager/users', requireManager, async (req, res) => {
    const rows = await db.prepare('SELECT * FROM users ORDER BY created_at DESC, rowid DESC').all();
    const activeUsers = rows.filter((u) => !u.archived_at).map(publicUser);
    const archivedUsers = rows.filter((u) => u.archived_at).map(publicUser);
    const authHistory = await db.prepare("SELECT * FROM audit_log WHERE action IN ('User sign in','Failed login attempt','Deactivated sign-in blocked','User sign out','Account registration','User account created','User account deactivated','User role updated','Profile updated','User password reset','Archived account restored') ORDER BY sequence DESC").all();
    const successfulLogins = (await db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='User sign in'").get()).count;
    const failedLogins = (await db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='Failed login attempt'").get()).count;
    res.json({
      users: activeUsers,
      archivedUsers,
      telemetry: {
        totalUsers: rows.length,
        activeCount: activeUsers.length,
        archivedCount: archivedUsers.length,
        byRole: ['client', 'agent', 'mechanic', 'manager'].reduce((acc, r) => ({ ...acc, [r]: activeUsers.filter((u) => u.role === r).length }), {}),
        successfulLogins,
        failedLogins,
        authHistory
      }
    });
  });

  app.post('/api/manager/users', requireManager, async (req, res) => res.status(201).json(await transaction(async () => {
    const name = D.text(req.body.name, 'Full name', 70);
    const email = D.text(req.body.email, 'Email', 160).toLowerCase();
    const role = req.body.role;
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) D.fail('Enter a valid email address.');
    if (!['client', 'agent', 'mechanic', 'manager'].includes(role)) D.fail('Choose a valid role.');
    if (!validPassword(password)) D.fail(PASSWORD_ERROR);
    if (await db.prepare('SELECT id FROM users WHERE email=?').get(email)) D.fail('An account already uses this email.', 409);
    const created = await addUser(name, email, role, password);
    await systemAudit.write(req.user, 'User account created', `user:${created.id}`, `${name} (${role})`, 200, { oldValue: null, newValue: { name, email, role } });
    return publicUser(created);
  })));

  app.post('/api/manager/users/:id/password', requireAdmin, async (req, res) => res.json(await transaction(async () => {
    const target = await db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!target || target.archived_at) D.fail('Active user not found.', 404);
    if (!validPassword(req.body.password)) D.fail(PASSWORD_ERROR);
    const record = passwordRecord(req.body.password);
    await db.prepare('UPDATE users SET salt=?,password_hash=? WHERE id=?').run(record.salt, record.passwordHash, target.id);
    await db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
    await systemAudit.write(req.user, 'User password reset', `user:${target.id}`, 'Password reset by Admin; active sessions revoked.');
    return { ok: true };
  })));

  app.patch('/api/manager/users/:id', requireAdmin, async (req, res) => res.json(await transaction(async () => {
    const target = await db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!target) D.fail('User not found.', 404);
    const role = req.body.role || target.role;
    const name = req.body.name === undefined ? target.name : D.text(req.body.name, 'Full name', 70);
    const email = req.body.email === undefined ? target.email : D.text(req.body.email, 'Email', 160).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) D.fail('Enter a valid email address.');
    if (await db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(email, target.id)) D.fail('This email is already registered.', 409);
    if (!['client', 'agent', 'mechanic', 'manager'].includes(role)) D.fail('Choose a valid role.');
    if (target.id === req.user.id && role !== 'manager') D.fail('You cannot remove your own operations-manager role.');
    const oldVal = { name: target.name, role: target.role, email: target.email };
    await db.prepare('UPDATE users SET name=?,role=?,email=? WHERE id=?').run(name, role, email, target.id);
    if (role !== target.role || email !== target.email) await db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
    await systemAudit.write(req.user, role !== target.role ? 'User role updated' : 'Profile updated', `user:${target.id}`, `${target.email}: ${oldVal.role} → ${role}`, 200, { oldValue: oldVal, newValue: { name, role, email } });
    return publicUser(await db.prepare('SELECT * FROM users WHERE id=?').get(target.id));
  })));

  app.post('/api/manager/users/:id/archive', requireManager, async (req, res) => res.json(await transaction(async () => {
    const target = await db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!target) D.fail('User not found.', 404);
    if (target.id === req.user.id) D.fail('You cannot deactivate your own active manager account.');
    if (target.archived_at) D.fail('This account is already deactivated.', 409);
    const reason = D.text(req.body.reason, 'Deactivation reason', 500);
    const archivedAt = now();
    await db.prepare('UPDATE users SET archived_at=?,archived_by=?,archive_reason=? WHERE id=?').run(archivedAt, req.user.name, reason, target.id);
    await db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
    await systemAudit.write(req.user, 'User account deactivated', `user:${target.id}`, `${target.email}: ${reason}`, 200, {
      oldValue: { status: 'active', role: target.role },
      newValue: { status: 'archived', archivedBy: req.user.name, reason }
    });
    return publicUser(await db.prepare('SELECT * FROM users WHERE id=?').get(target.id));
  })));

  // Operations Manager: Data Archives (Restore & Permanent Purge)
  app.get('/api/manager/archives', requireManager, async (req, res) => {
    const allVehicles = await fleet.fleet(true);
    const archivedUsers = (await db.prepare('SELECT * FROM users WHERE archived_at IS NOT NULL ORDER BY archived_at DESC').all()).map(publicUser);
    res.json({
      bookings: await asyncMap((await rawBookings()).filter((b) => b.archivedAt), fleet.present),
      vehicles: allVehicles.filter((v) => v.archivedAt),
      pendingDecommissions: allVehicles.filter((v) => v.decommissionRequested && !v.archivedAt),
      users: archivedUsers
    });
  });

  app.post('/api/manager/archives/:kind/:id/restore', requireManager, async (req, res) => res.json(await transaction(async () => {
    const { kind, id } = req.params;
    if (kind === 'booking') {
      const b = await getBooking(id, true);
      if (!b.archivedAt) D.fail('Reservation is not archived.', 409);
      delete b.archivedAt;delete b.archivedBy;delete b.archiveReason;b.version += 1;
      await audit(b, req.user, 'Reservation restored from archive', '', { oldValue: { archived: true }, newValue: { archived: false } });
      await saveBooking(b);
      return await fleet.present(b);
    }
    if (kind === 'vehicle') {
      const s = await fleet.state(id);
      if (!s.archivedAt) D.fail('Vehicle is not archived.', 409);
      s.status = 'Available';s.archivedAt = null;s.archivedBy = null;s.archiveReason = null;s.decommissionRequested = null;s.version += 1;
      await fleet.save('vehicle', s);
      await systemAudit.write(req.user, 'Vehicle restored from archive', `vehicle:${id}`, 'Restored to active fleet', 200, { oldValue: { status: 'Decommissioned', archived: true }, newValue: { status: 'Available', archived: false } });
      return (await fleet.fleet(true)).find((v) => v.id === id);
    }
    if (kind === 'user') {
      const u = await db.prepare('SELECT * FROM users WHERE id=?').get(id);
      if (!u || !u.archived_at) D.fail('Archived user not found.', 404);
      await db.prepare('UPDATE users SET archived_at=NULL,archived_by=NULL,archive_reason=NULL WHERE id=?').run(id);
      await systemAudit.write(req.user, 'User account restored', `user:${id}`, u.email, 200, { oldValue: { status: 'archived' }, newValue: { status: 'active' } });
      return publicUser(await db.prepare('SELECT * FROM users WHERE id=?').get(id));
    }
    D.fail('Unsupported archive category.');
  })));

  app.delete('/api/manager/archives/:kind/:id', requireManager, async (req, res) => res.json(await transaction(async () => {
    const { kind, id } = req.params;
    const reason = D.text(req.body.reason || 'Confirmed permanent purge by manager', 'Purge reason', 500);
    if (kind === 'booking') {
      const b = await getBooking(id, true);
      if (!b.archivedAt) D.fail('Soft-delete the reservation before permanently purging it.', 409);
      await db.prepare('DELETE FROM bookings WHERE id=?').run(id);
      await systemAudit.write(req.user, 'Booking permanently purged', `booking:${id}`, reason, 200, {
        oldValue: { id: b.id, renter: b.renter.name, status: b.status },
        newValue: 'PERMANENTLY_PURGED',
        alertType: 'Permanent record purge'
      });
      return { purged: id, kind };
    }
    if (kind === 'user') {
      const u = await db.prepare('SELECT * FROM users WHERE id=?').get(id);
      if (!u || !u.archived_at) D.fail('Deactivate the user account before permanently purging it.', 409);
      await db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      await db.prepare("DELETE FROM documents WHERE owner_id=? AND kind<>'vehicle-image'").run(id);
      await db.prepare('DELETE FROM tickets WHERE owner_id=?').run(id);
      await db.prepare('UPDATE bookings SET owner_id=NULL WHERE owner_id=?').run(id);
      await db.prepare('DELETE FROM users WHERE id=?').run(id);
      await systemAudit.write(req.user, 'User permanently purged', `user:${id}`, `${u.email}: ${reason}`, 200, {
        oldValue: { email: u.email, name: u.name, role: u.role },
        newValue: 'PERMANENTLY_PURGED',
        alertType: 'Permanent record purge'
      });
      return { purged: id, kind };
    }
    if (kind === 'vehicle') {
      const s = await fleet.state(id);
      if (!s.archivedAt) D.fail('Decommission the vehicle before purging its archive record.', 409);
      s.activity = [];s.archivePurgedAt = now();
      await fleet.save('vehicle', s);
      await systemAudit.write(req.user, 'Decommissioned vehicle history purged', `vehicle:${id}`, reason, 200, {
        oldValue: { id, archivedAt: s.archivedAt },
        newValue: 'PERMANENTLY_PURGED',
        alertType: 'Permanent record purge'
      });
      return { purged: id, kind };
    }
    D.fail('Unsupported archive category.');
  })));

  fleet.register(app);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const duplicate = error.code === '23505' || error.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed/.test(error.message);
    const status = error.type === 'entity.too.large' ? 413 : duplicate ? 409 : error.status || 500;
    if (status >= 500) console.error('DrivePulse request failed:', error.message);
    res.status(status).json({ error: duplicate ? 'This record already exists. Refresh and try again.' : status === 413 ? 'Files must be 4 MB or smaller.' : status >= 500 ? 'The request could not be completed. Please try again.' : error.message });
  });
  return { app, db };
}
module.exports = { createApp };

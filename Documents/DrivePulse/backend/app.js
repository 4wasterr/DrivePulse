const express = require('express');
const cors = require('cors');
const { createDatabase } = require('./db');
const { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } = require('node:crypto');
const D = require('./domain');
const { createFleet } = require('./fleet');
const { createAudit } = require('./audit');
const { createRentalDocuments } = require('./rentalDocuments');

const hash = value => createHash('sha256').update(value).digest('hex');
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
  let pdf = '%PDF-1.4\n', offsets = [0];
  objects.forEach((body, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

function createApp({ database = null, seedDemo = process.env.NODE_ENV !== 'production', allowAgentSignup = process.env.NODE_ENV !== 'production' || process.env.ALLOW_AGENT_SIGNUP === 'true' } = {}) {
  const db = database || createDatabase();
  db.exec(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
      salt TEXT NOT NULL, password_hash TEXT NOT NULL, saved TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT '', last_login_at TEXT NOT NULL DEFAULT '',
      archived_at TEXT, archived_by TEXT, archive_reason TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS bookings (id TEXT PRIMARY KEY, owner_id TEXT, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, fingerprint TEXT NOT NULL, uploaded_at TEXT NOT NULL, data BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, owner_id TEXT, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS vehicles (id TEXT PRIMARY KEY, model TEXT NOT NULL, brand TEXT NOT NULL, category TEXT NOT NULL, rate REAL NOT NULL, plate TEXT NOT NULL, transmission TEXT NOT NULL, seats INTEGER NOT NULL, fuel_type TEXT NOT NULL, tank_capacity INTEGER NOT NULL, mileage INTEGER NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL);`);
  db.prepare("UPDATE documents SET owner_id='sample-owner-archive' WHERE name LIKE 'sample-%.pdf' AND owner_id<>'sample-owner-archive'").run();

  const rawBookings = () => db.prepare('SELECT payload FROM bookings').all().map(row => JSON.parse(row.payload));
  const allBookings = () => rawBookings().filter(b => !b.archivedAt);
  const assertCashReference = (reference, excludeId) => {
    if (rawBookings().some(b => (b.payments || []).some(p => p.id !== excludeId && p.status === 'confirmed' && p.reference?.toLowerCase() === reference.toLowerCase()))) D.fail('This cash receipt reference has already been used.', 409);
  };
  const getBooking = (id, includeArchived = false) => {
    const row = db.prepare('SELECT payload FROM bookings WHERE id=?').get(id);
    if (!row) D.fail('Reservation not found.', 404);
    const b = JSON.parse(row.payload);
    if (b.archivedAt && !includeArchived) D.fail('Reservation is archived.', 404);
    return b;
  };
  const saveBooking = booking => db.prepare('INSERT INTO bookings(id,owner_id,payload) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,owner_id=excluded.owner_id').run(booking.id, booking.ownerId || null, JSON.stringify(booking));
  const allTickets = () => db.prepare('SELECT payload FROM tickets').all().map(row => JSON.parse(row.payload));
  const saveTicket = ticket => db.prepare('INSERT INTO tickets(id,owner_id,payload) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(ticket.id, ticket.ownerId || null, JSON.stringify(ticket));
  const meta = doc => ({ id: doc.id, kind: doc.kind, name: doc.name, mime: doc.mime, fingerprint: doc.fingerprint, size: doc.data.length, uploadedAt: doc.uploaded_at });
  const addUser = (name, email, role, password) => {
    const record = passwordRecord(password), id = randomUUID(), createdAt = now();
    db.prepare('INSERT INTO users(id,email,name,role,salt,password_hash,created_at) VALUES(?,?,?,?,?,?,?)').run(id, email, name, role, record.salt, record.passwordHash, createdAt);
    return db.prepare('SELECT * FROM users WHERE id=?').get(id);
  };
  const systemAudit = createAudit(db);
  const audit = (booking, user, action, note = '', extra = {}) => {
    booking.activity ||= [];
    booking.activity.push({ id: randomUUID(), at: now(), by: user.name, action, note });
    systemAudit.write(user, action, booking.id, note, 200, extra);
  };
  const transaction = callback => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = callback(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const rentalDocuments = createRentalDocuments({ db, getBooking, saveBooking, transaction, audit });
  const fleet = createFleet({ db, allBookings, rawBookings, getBooking, saveBooking, transaction, audit, rentalDocuments, systemAudit });
  const updateBooking = (req, action, fn) => transaction(() => {
    const booking = getBooking(req.params.id);
    if (req.body.version !== booking.version) D.fail('This reservation changed. Refresh it and try again.', 409);
    const oldSnap = { status: booking.status, end: booking.end, rental: booking.rental, lateFee: booking.lateFee };
    fn(booking);
    booking.version += 1;
    const newSnap = { status: booking.status, end: booking.end, rental: booking.rental, lateFee: booking.lateFee };
    audit(booking, req.user, action, req.body.reason || req.body.note || '', { oldValue: oldSnap, newValue: newSnap });
    saveBooking(booking);
    return fleet.present(booking);
  });

  if (seedDemo && !db.prepare('SELECT id FROM users WHERE email=?').get('client@drivepulse.demo')) {
    transaction(() => {
      const client = addUser('Alex Morgan', 'client@drivepulse.demo', 'client', 'DrivePulse123!');
      const agent = addUser('Jamie Santos', 'agent@drivepulse.demo', 'agent', 'DrivePulse123!');
      const docs = D.REQUIRED_DOCUMENTS.map(kind => {
        const id = randomUUID(), data = samplePDF(kind);
        db.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?,?)').run(id, 'sample-owner-archive', kind, `sample-${kind}.pdf`, 'application/pdf', hash(data), now(), data);
        return { ...meta(db.prepare('SELECT * FROM documents WHERE id=?').get(id)), review: { status: 'pending' } };
      });
      const date = offset => new Date(Date.now() + 8 * 3600000 + offset * D.DAY).toISOString().slice(0, 10);
      const specifications = [
        ['DP-10248', 'bmw-3', 2, 5, 'Pending Approval', 'Online'], ['DP-10249', 'range-rover', 1, 3, 'Pending Approval', 'Walk-in'],
        ['DP-10250', 'tesla-3', 1, 4, 'Ready for Dispatch', 'Online'], ['DP-10251', 'toyota-camry', -3, -1, 'On Rental', 'Online'],
        ['DP-10182', 'mercedes-c', -10, -8, 'Completed', 'Online'],
      ];
      for (const [id, vehicleId, start, end, status, source] of specifications) {
        const dates = { vehicleId, start: date(start), end: date(end), startTime: '10:00', endTime: '10:00', pickup: D.LOCATIONS[0], dropoff: D.LOCATIONS[0] };
        const booking = { id, ...dates, ...D.quote(dates, true), ownerId: client.id, renter: { name: client.name, email: client.email, phone: 'Demo customer' }, status, source, sample: true, version: 1, documents: structuredClone(docs), payments: [], payment: 'Demo payment record', createdAt: now(), lateFee: 0, activity: [] };
        const confirmed = status !== 'Pending Approval';
        booking.payments = ['rental', 'deposit'].map(type => ({ id: randomUUID(), type, amount: booking[type], method: 'Cash (sample)', reference: `SAMPLE-${id}-${type}`, status: confirmed ? 'confirmed' : 'pending', at: now(), simulated: true }));
        rentalDocuments.contract(booking, agent);
        if (confirmed) {
          booking.documents.forEach(doc => { doc.review = { status: 'approved', by: agent.name, at: now(), note: 'Illustrative sample review' }; });
          booking.inspection = { status: 'approved', role: 'mechanic', by: 'Riley Cruz', at: now(), odometer: 14200, fuelLevel: 100, cleanliness: 'Clean', scratches: 'No visible scratches', tirePressure: { frontLeft: 33, frontRight: 33, rearLeft: 32, rearRight: 32 }, checks: { exterior: true, interior: true, tyres: true, controls: true, fuel: true }, photos: [{ id: 'sample-ext', view: 'exterior' }, { id: 'sample-int', view: 'interior' }], note: 'Illustrative inspection' };
          if (status !== 'Completed') booking.dispatchPass = { id: `PASS-${randomUUID().slice(0, 8).toUpperCase()}`, issuedAt: now(), issuedBy: agent.name, end: booking.end, endTime: booking.endTime };
        }
        audit(booking, agent, 'Sample reservation created', 'Illustrative data for the development workspace.', { oldValue: null, newValue: { id, status, vehicleId } });
        saveBooking(booking);
      }
      saveTicket({ id: `Q-${randomUUID().slice(0, 8)}`, ownerId: client.id, bookingId: 'DP-10248', subject: 'Can I extend my rental?', category: 'Extension', status: 'open', createdAt: now(), version: 1, messages: [{ id: randomUUID(), by: client.name, role: 'client', message: 'Could you help me add one extra day to this reservation?', at: now() }] });
    });
  }

  if (seedDemo) {
    for (const [role, name] of [['mechanic', 'Riley Cruz'], ['manager', 'Sam Reyes']]) {
      if (!db.prepare('SELECT id FROM users WHERE email=?').get(`${role}@drivepulse.demo`)) addUser(name, `${role}@drivepulse.demo`, role, 'DrivePulse123!');
    }
  }

  const app = express();
  app.disable('x-powered-by');
  const origins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173').split(',');
  app.use(cors({ origin: origins, credentials: true }));
  app.use('/api', systemAudit.middleware);
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') && !origins.includes(req.get('origin'))) return res.status(403).json({ error: 'This request origin is not allowed.' });
    const cookie = req.get('cookie')?.split(';').map(c => c.trim()).find(c => c.startsWith('drivepulse_session='))?.slice('drivepulse_session='.length);
    if (cookie) {
      const record = db.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token=? AND expires>? AND users.archived_at IS NULL').get(hash(cookie), Date.now());
      if (record) req.user = record;
    }
    next();
  });
  const requireUser = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Sign in to continue.' });
  const requireAgent = (req, res, next) => !req.user ? res.status(401).json({ error: 'Sign in to continue.' }) : req.user.role !== 'agent' ? res.status(403).json({ error: 'This action requires a booking-agent account.' }) : next();
  const requireManager = (req, res, next) => !req.user ? res.status(401).json({ error: 'Sign in to continue.' }) : req.user.role !== 'manager' ? res.status(403).json({ error: 'This action requires an operations-manager account.' }) : next();
  const requireClient = (req, res, next) => !req.user ? res.status(401).json({ error: 'Sign in to continue.' }) : req.user.role !== 'client' ? res.status(403).json({ error: 'Use a client account to book a personal rental.' }) : next();

  app.post('/api/documents/:kind', requireUser, express.raw({ type: () => true, limit: '5mb' }), (req, res) => {
    const condition = req.params.kind === 'condition';
    const kind = condition ? `condition:${req.query.vehicleId}` : req.params.kind.startsWith('payment-') ? 'payment' : req.params.kind;
    if (condition) {
      if (req.user.role !== 'mechanic') D.fail('Condition photos require a fleet-mechanic account.', 403);
      fleet.state(req.query.vehicleId);
    } else if (![...D.REQUIRED_DOCUMENTS, 'payment'].includes(kind)) D.fail('Unsupported document category.');
    else if (!['client', 'agent'].includes(req.user.role)) D.fail('Use a client or booking-agent account for customer documents.', 403);
    const mime = req.get('content-type')?.split(';')[0], data = req.body;
    if (!Buffer.isBuffer(data) || !data.length) D.fail('Choose a non-empty file.');
    const isValid = mime === 'application/pdf' ? data.subarray(0, 5).toString() === '%PDF-' : mime === 'image/png' ? data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : mime === 'image/jpeg' ? data[0] === 255 && data[1] === 216 && data[2] === 255 : mime === 'image/webp' ? data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP' : false;
    if (!isValid) D.fail('Upload a valid PDF, JPG, PNG, or WebP file.');
    if (condition && !mime.startsWith('image/')) D.fail('Condition proof must be a JPG, PNG, or WebP photo.');
    let name;
    try { name = decodeURIComponent(req.get('x-file-name') || 'document'); } catch { D.fail('Invalid file name.'); }
    name = D.text(name.replace(/[\r\n/\\]/g, '_'), 'File name', 180);
    let booking;
    if (req.query.bookingId) {
      if (req.user.role !== 'agent') D.fail('Only agents can upload on behalf of a reservation.', 403);
      booking = getBooking(req.query.bookingId);
      if (!['Pending Approval', 'Ready for Dispatch'].includes(booking.status)) D.fail('Documents cannot be replaced after dispatch or closure.');
    }
    const id = randomUUID(), ownerId = booking?.ownerId || (booking ? `walkin:${booking.id}` : req.user.id);
    transaction(() => {
      db.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?,?)').run(id, ownerId, kind, name, mime, hash(data), now(), data);
      if (D.REQUIRED_DOCUMENTS.includes(kind)) {
        const affected = booking ? [booking] : allBookings().filter(b => b.ownerId === req.user.id && ['Pending Approval', 'Ready for Dispatch'].includes(b.status));
        affected.forEach(b => {
          const prevDoc = (b.documents || []).find(d => d.kind === kind);
          b.documents = (b.documents || []).filter(d => d.kind !== kind);
          b.documents.push({ ...meta(db.prepare('SELECT * FROM documents WHERE id=?').get(id)), review: { status: 'pending' } });
          D.invalidatePass(b); b.version += 1;
          audit(b, req.user, 'Document uploaded', kind, { oldValue: prevDoc ? { kind, name: prevDoc.name } : null, newValue: { kind, name } });
          saveBooking(b);
        });
      }
    });
    res.status(201).json(meta(db.prepare('SELECT * FROM documents WHERE id=?').get(id)));
  });

  app.use(express.json({ limit: '100kb' }));
  app.use((req, res, next) => { req.body ??= {}; next(); });
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.get('/api/session', (req, res) => res.json({
    user: req.user ? publicUser(req.user) : null,
    agentSignup: allowAgentSignup,
    staffSignup: allowAgentSignup,
    demo: seedDemo,
    rates: Object.fromEntries(fleet.fleet(true).map(v => [v.id, v.rate]))
  }));

  const createSession = (user, res) => {
    const token = randomBytes(32).toString('hex'), loginAt = now();
    db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(loginAt, user.id);
    user.last_login_at = loginAt;
    db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token), user.id, Date.now() + 7 * D.DAY);
    res.cookie('drivepulse_session', token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 7 * D.DAY, path: '/' });
    return publicUser(user);
  };

  const attempts = new Map();
  app.post('/api/auth/:action', (req, res) => {
    if (!['login', 'signup'].includes(req.params.action)) D.fail('Not found.', 404);
    const address = req.ip, attempt = attempts.get(address);
    if (attempt && Date.now() - attempt.at < 15 * 60000 && attempt.count >= 25) D.fail('Too many attempts. Please try again in 15 minutes.', 429);
    attempts.set(address, { at: attempt && Date.now() - attempt.at < 15 * 60000 ? attempt.at : Date.now(), count: attempt && Date.now() - attempt.at < 15 * 60000 ? attempt.count + 1 : 1 });
    const email = D.text(req.body.email, 'Email', 160).toLowerCase(), password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) D.fail('Enter a valid email address.');
    if (password.length < 8 || password.length > 128) D.fail('Use a password between 8 and 128 characters.');
    const existing = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (req.params.action === 'signup') {
      if (!['client', 'agent', 'mechanic', 'manager'].includes(req.body.role)) D.fail('Choose a valid account type.');
      if (existing) D.fail('An account already uses this email. Sign in instead.', 409);
      if (req.body.role !== 'client' && !allowAgentSignup) D.fail('Ask your administrator to create a staff account.', 403);
      const user = addUser(D.text(req.body.name, 'Full name', 70), email, req.body.role, password);
      req.auditUser = user;
      systemAudit.write(user, 'Account registration', `Account: ${user.email}`, `New ${user.role} account created`, 201, {
        ip: address,
        newValue: { name: user.name, email: user.email, role: user.role }
      });
      return res.status(201).json({ user: createSession(user, res) });
    }
    const candidate = scryptSync(password, existing?.salt || 'missing-account-salt', 64);
    if (!existing || !timingSafeEqual(candidate, Buffer.from(existing.password_hash, 'hex'))) {
      systemAudit.write(
        { id: existing?.id || null, name: email, role: existing?.role || 'anonymous' },
        'Failed login attempt',
        `Account: ${email}`,
        'Invalid email or password attempt',
        401,
        { ip: address, alertType: 'Failed login attempt' }
      );
      D.fail('Email or password is incorrect.', 401);
    }
    if (existing.archived_at) {
      systemAudit.write(
        existing,
        'Deactivated sign-in blocked',
        `Account: ${existing.email}`,
        'Deactivated user attempted to sign in',
        403,
        { ip: address, alertType: 'Policy override' }
      );
      D.fail('This account has been deactivated by an operations manager.', 403);
    }
    attempts.delete(address);
    req.auditUser = existing;
    systemAudit.write(existing, 'User sign in', `Account: ${existing.email}`, 'Successful user authentication', 200, { ip: address });
    res.json({ user: createSession(existing, res) });
  });

  app.post('/api/logout', (req, res) => {
    if (req.user) {
      systemAudit.write(req.user, 'User sign out', `Account: ${req.user.email}`, 'User logged out', 200, { ip: req.ip });
    }
    const token = req.get('cookie')?.split(';').map(c => c.trim()).find(c => c.startsWith('drivepulse_session='))?.slice('drivepulse_session='.length);
    if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token));
    res.clearCookie('drivepulse_session', { path: '/', httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production' }); res.json({ ok: true });
  });

  app.get('/api/availability', (req, res) => res.json([
    ...allBookings().map(({ id, vehicleId, start, end, startTime, endTime, status }) => ({ id, vehicleId, start, end, startTime, endTime, status })),
    ...fleet.fleet(true).filter(v => v.archivedAt || ['Under Inspection', 'Maintenance', 'Out of Service', 'Overdue'].includes(v.status)).map(v => ({ id: `hold-${v.id}`, vehicleId: v.id, status: v.status, rate: v.rate, blocked: true }))
  ]));

  app.get('/api/workspace', requireUser, (req, res) => {
    const agent = ['agent', 'manager'].includes(req.user.role), documents = {};
    db.prepare('SELECT * FROM documents WHERE owner_id=? ORDER BY uploaded_at ASC, rowid ASC').all(req.user.id).filter(d => D.REQUIRED_DOCUMENTS.includes(d.kind)).forEach(doc => { documents[doc.kind] = meta(doc); });
    res.json({
      user: publicUser(req.user),
      bookings: allBookings().filter(b => agent || b.ownerId === req.user.id).map(fleet.present).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      documents,
      tickets: allTickets().filter(t => req.user.role === 'agent' || t.ownerId === req.user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    });
  });

  app.patch('/api/profile', requireUser, (req, res) => {
    const name = D.text(req.body.name, 'Full name', 70);
    const email = D.text(req.body.email, 'Email', 160).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) D.fail('Enter a valid email address.');
    if (db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(email, req.user.id)) D.fail('This email is already registered.', 409);
    const oldProfile = { name: req.user.name, email: req.user.email };
    db.prepare('UPDATE users SET name=?,email=? WHERE id=?').run(name, email, req.user.id);
    systemAudit.write(req.user, 'Profile updated', `user:${req.user.id}`, `${oldProfile.email} → ${email}`, 200, { oldValue: oldProfile, newValue: { name, email } });
    res.json(publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)));
  });

  app.get('/api/documents/:id', requireUser, (req, res) => {
    let doc = db.prepare('SELECT * FROM documents WHERE id=?').get(req.params.id);
    if (!doc && D.REQUIRED_DOCUMENTS.includes(req.params.id)) doc = db.prepare('SELECT * FROM documents WHERE owner_id=? AND kind=? ORDER BY uploaded_at DESC,rowid DESC LIMIT 1').get(req.user.id, req.params.id);
    if (!doc) D.fail('Document not found.', 404);
    const staffFile = doc.kind.startsWith('condition:');
    const canRead = staffFile ? ['mechanic', 'manager', 'agent'].includes(req.user.role) : req.user.role === 'agent' || doc.owner_id === req.user.id;
    if (!canRead) D.fail('Document not found.', 404);
    res.set('Content-Type', doc.mime); res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(doc.name)}`); res.send(Buffer.from(doc.data));
  });

  const createBooking = (req, walkin) => transaction(() => {
    const input = req.body;
    const blocks = fleet.operationalBlocks(input.vehicleId);
    if (blocks.length) D.fail(blocks.join(' '), 409);
    const quotation = D.quote(input, false, fleet.vehicleRate(input.vehicleId));
    if (fleet.fleet().some(v => v.id === input.vehicleId && v.status === 'Overdue')) D.fail('This vehicle is overdue and must be returned before another reservation can be made.', 409);
    if (!D.available(allBookings(), input)) D.fail('This vehicle is already reserved for those dates.', 409);
    let ownerId = req.user.id, renter = publicUser(req.user), docs = [];
    if (walkin) {
      renter = { name: D.text(input.renter?.name, 'Customer name', 70), email: D.text(input.renter?.email, 'Email', 160, false).toLowerCase(), phone: D.text(input.renter?.phone, 'Contact number', 40) };
      if (renter.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(renter.email)) D.fail('Enter a valid customer email.');
      ownerId = db.prepare("SELECT id FROM users WHERE email=? AND role='client'").get(renter.email)?.id || null;
    } else {
      docs = D.REQUIRED_DOCUMENTS.map(kind => {
        const doc = db.prepare('SELECT * FROM documents WHERE owner_id=? AND kind=? ORDER BY uploaded_at DESC,rowid DESC LIMIT 1').get(req.user.id, kind);
        if (!doc) D.fail('Upload your license and two government IDs before booking.');
        return { ...meta(doc), review: { status: 'pending' } };
      });
      if (new Set(docs.map(d => d.fingerprint)).size !== 3) D.fail('Your license and two IDs must be different files.');
    }
    const booking = { id: `DP-${randomUUID().slice(0, 8).toUpperCase()}`, ownerId, renter, vehicleId: input.vehicleId, start: input.start, end: input.end, startTime: input.startTime, endTime: input.endTime, pickup: input.pickup, dropoff: input.dropoff, ...quotation, source: walkin ? 'Walk-in' : 'Online', status: 'Pending Approval', version: 1, documents: docs, payments: [], lateFee: 0, createdAt: now(), activity: [], note: D.text(input.note, 'Reservation note', 1000, false), payment: 'Cash' };
    if (!walkin) {
      booking.payments = ['rental', 'deposit'].map(type => ({ id: randomUUID(), type, amount: booking[type], status: 'pending', method: 'Cash', reference: 'Awaiting cash at the counter', at: now() }));
    }
    rentalDocuments.contract(booking, req.user);
    audit(booking, req.user, walkin ? 'Walk-in scheduled' : 'Online booking received', '', { oldValue: null, newValue: { id: booking.id, vehicleId: booking.vehicleId, total: booking.total } });
    saveBooking(booking);
    return fleet.present(booking);
  });

  app.post('/api/bookings', requireClient, (req, res) => res.status(201).json(createBooking(req, false)));
  app.post('/api/agent/bookings', requireAgent, (req, res) => res.status(201).json(createBooking(req, true)));

  app.post('/api/bookings/:id/archive', requireUser, (req, res) => res.json(transaction(() => {
    if (!['agent', 'manager'].includes(req.user.role)) D.fail('Only staff can archive reservations.', 403);
    const b = getBooking(req.params.id);
    if (!['Completed', 'Cancelled'].includes(b.status)) D.fail('Only completed or cancelled reservations can be archived.');
    b.archivedAt = now();
    b.archivedBy = req.user.name;
    b.archiveReason = D.text(req.body.reason || 'Standard one-click record cleanup', 'Archive reason', 500, false);
    b.version += 1;
    audit(b, req.user, 'Reservation archived (soft delete)', b.archiveReason, {
      oldValue: { status: b.status, archived: false },
      newValue: { status: b.status, archived: true, archivedBy: req.user.name }
    });
    saveBooking(b);
    return { id: b.id, archivedAt: b.archivedAt };
  })));

  app.post('/api/agent/bookings/:id/review', requireAgent, (req, res) => res.json(updateBooking(req, 'ID review recorded', b => {
    if (['Cancelled', 'Completed', 'On Rental'].includes(b.status)) D.fail('Identity review is closed for this reservation.');
    const doc = b.documents.find(d => d.id === req.body.documentId);
    if (!doc) D.fail('This document is no longer attached. Refresh the reservation.', 409);
    if (!['approved', 'rejected'].includes(req.body.decision)) D.fail('Choose approve or reject.');
    if (req.body.decision === 'approved' && b.documents.some(other => other.kind !== doc.kind && other.fingerprint === doc.fingerprint)) D.fail('The license and two government IDs must be three different files.');
    const note = D.text(req.body.reason, 'Review note', 1000, req.body.decision === 'rejected');
    doc.review = { status: req.body.decision, by: req.user.name, at: now(), note };
    if (req.body.decision === 'rejected') D.invalidatePass(b);
  })));

  app.post('/api/agent/bookings/:id/payment', requireAgent, (req, res) => res.json(updateBooking(req, 'Payment recorded', b => {
    if (b.status === 'Cancelled') D.fail('Payments cannot be added to a cancelled reservation.');
    const bill = D.billing(b), pending = b.payments.find(p => p.id === req.body.paymentId);
    if (req.body.paymentId) {
      if (!pending || pending.status !== 'pending') D.fail('This payment was already reviewed.', 409);
      if (!['confirmed', 'rejected'].includes(req.body.decision)) D.fail('Choose confirm or reject.');
      if (req.body.decision === 'confirmed') {
        if (req.body.received !== true) D.fail('Confirm that the cash was physically received.');
        pending.reference = D.text(req.body.reference, 'Cash receipt reference', 150);
        pending.method = 'Cash';
      }
      if (req.body.decision === 'confirmed' && pending.amount > (pending.type === 'deposit' ? bill.depositBalance : bill.rentalBalance)) D.fail('This payment exceeds the outstanding balance. Reject it and record the correct amount.');
      pending.status = req.body.decision; pending.reviewedBy = req.user.name; pending.reviewedAt = now(); pending.reviewNote = D.text(req.body.reason, 'Review note', 1000, req.body.decision === 'rejected');
      if (pending.status === 'confirmed') { assertCashReference(pending.reference, pending.id); rentalDocuments.cashReceipt(b, pending, req.user); }
    } else {
      const { type, amount } = req.body;
      const validAllocations = ['rental', 'deposit', 'extension', 'late_fee', 'fuel_charge', 'cleaning_fee', 'damage_fee', 'toll_violation'];
      if (!validAllocations.includes(type) || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || Math.abs(Math.round(amount * 100) - amount * 100) > 0.000001) D.fail('Enter a valid payment amount with at most two decimal places.');
      const maxAllowed = type === 'deposit' ? bill.depositBalance : bill.rentalBalance;
      if (amount > maxAllowed) D.fail('The payment exceeds the outstanding balance.');
      if (req.body.received !== true) D.fail('Confirm that the cash was physically received.');
      const reference = D.text(req.body.reference, 'Cash receipt reference', 150); assertCashReference(reference);
      const payment = { id: randomUUID(), type, amount, status: 'confirmed', method: 'Cash', reference, at: now(), reviewedBy: req.user.name };
      b.payments.push(payment); rentalDocuments.cashReceipt(b, payment, req.user);
    }
  })));

  app.post('/api/agent/bookings/:id/inspection', requireAgent, (req, res) => D.fail('Mandatory digital inspections and photo proof must be recorded by a fleet mechanic.', 403));

  app.post('/api/agent/bookings/:id/pass', requireAgent, (req, res) => res.json(updateBooking(req, 'Digital dispatch pass issued', b => {
    const blocks = fleet.dispatchBlocks(b); if (blocks.length) D.fail(blocks.join(' '));
    b.dispatchPass = { id: `PASS-${randomUUID().slice(0, 10).toUpperCase()}`, issuedBy: req.user.name, issuedAt: now(), end: b.end, endTime: b.endTime };
    if (b.status !== 'On Rental') b.status = 'Ready for Dispatch';
  })));

  app.post('/api/agent/bookings/:id/dispatch', requireAgent, (req, res) => res.json(updateBooking(req, 'Vehicle dispatched', b => {
    if (b.status !== 'Ready for Dispatch' || !b.dispatchPass || b.dispatchPass.revokedAt || fleet.dispatchBlocks(b).length) D.fail('Issue a valid dispatch pass after all checks are complete.');
    b.releaseSignoff = { signature: b.renter.name, at: now(), by: req.user.name, actorId: req.user.id, method: 'Front-desk dispatch confirmation' };
    b.status = 'On Rental'; b.dispatchedAt = now();
    rentalDocuments.receipt(b, 'release', req.user);
  })));

  app.post('/api/agent/bookings/:id/extend', requireAgent, (req, res) => res.json(updateBooking(req, 'Rental extended', b => {
    if (['Cancelled', 'Completed'].includes(b.status)) D.fail('Closed reservations cannot be extended.');
    const updated = { ...b, end: req.body.end, endTime: req.body.endTime };
    if (D.time(updated.end, updated.endTime) <= Math.max(D.time(b.end, b.endTime), Date.now())) D.fail('Choose a future return time later than the current return.');
    const quotation = D.quote(updated, true, fleet.vehicleRate(b.vehicleId));
    if (!D.available(allBookings(), updated, b.id)) D.fail('This extension overlaps another reservation.', 409);
    b.extensions ||= []; b.extensions.push({ oldEnd: b.end, oldEndTime: b.endTime, newEnd: updated.end, newEndTime: updated.endTime, additionalRental: quotation.rental - b.rental, by: req.user.name, at: now() });
    b.end = updated.end; b.endTime = updated.endTime; b.days = quotation.days; b.rental = quotation.rental;
    rentalDocuments.contract(b, req.user);
    D.invalidatePass(b);
  })));

  app.post('/api/bookings/:id/extend', requireUser, (req, res) => res.json(updateBooking(req, 'Rental extended (Client self-service)', b => {
    if (req.user.role === 'client' && b.ownerId !== req.user.id) D.fail('You can only extend your own rentals.', 403);
    if (!['On Rental', 'Ready for Dispatch'].includes(b.status)) D.fail('Only active or ready rentals can be extended.');
    const updated = { ...b, end: req.body.end, endTime: req.body.endTime };
    if (D.time(updated.end, updated.endTime) <= Math.max(D.time(b.end, b.endTime), Date.now())) D.fail('Choose a future return time later than the current return.');
    const quotation = D.quote(updated, true, fleet.vehicleRate(b.vehicleId));
    if (!D.available(allBookings(), updated, b.id)) D.fail('This vehicle is reserved by another customer for the requested extension dates.', 409);
    b.extensions ||= [];
    b.extensions.push({
      oldEnd: b.end, oldEndTime: b.endTime,
      newEnd: updated.end, newEndTime: updated.endTime,
      additionalRental: quotation.rental - b.rental,
      by: req.user.name, at: now(), clientInitiated: req.user.role === 'client'
    });
    b.end = updated.end; b.endTime = updated.endTime; b.days = quotation.days; b.rental = quotation.rental;
    rentalDocuments.contract(b, req.user);
    D.invalidatePass(b);
  })));

  app.post('/api/manager/bookings/:id/escalate-overdue', requireManager, (req, res) => res.json(transaction(() => {
    const b = getBooking(req.params.id);
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
    saveBooking(b);
    systemAudit.write(req.user, 'Overdue return escalated', b.id, `Escalated ${overdueHours}h overdue rental. Demand notice issued.`, 200, {
      alertType: 'Policy override'
    });
    return b;
  })));

  app.get('/api/vehicles', (req, res) => {
    res.json(fleet.fleet(true));
  });

  app.post('/api/manager/vehicles', requireManager, (req, res) => res.status(201).json(transaction(() => {
    const input = req.body;
    const model = D.text(input.model, 'Vehicle model');
    const brand = D.text(input.brand, 'Vehicle brand');
    const category = D.text(input.category || 'Sedan', 'Vehicle category');
    const rate = Number(input.rate);
    if (!Number.isFinite(rate) || rate < 500 || rate > 100000) D.fail('Daily rate must be between PHP 500 and PHP 100,000.');
    const plate = D.text(input.plate, 'License plate number');
    const id = (input.id || `${brand.toLowerCase()}-${model.toLowerCase()}`).replace(/[^a-z0-9_-]/g, '-').slice(0, 40);
    
    const existing = fleet.fleet(true);
    if (existing.some(v => v.id === id || v.plate?.toLowerCase() === plate.toLowerCase())) {
      D.fail('A vehicle with this ID or license plate already exists.', 409);
    }
    const vehicle = {
      id, name: `${brand} ${model}`, model, brand, category, rate, plate,
      transmission: input.transmission || 'Automatic',
      seats: Number(input.seats || 5),
      fuelType: input.fuelType || 'Gasoline',
      tankCapacity: Number(input.tankCapacity || 50),
      mileage: Number(input.mileage || 0),
      status: 'Available',
      createdAt: now(),
      version: 1
    };
    fleet.saveDynamicVehicle(vehicle);
    systemAudit.write(req.user, 'Vehicle added to fleet', id, `Added ${brand} ${model} (${plate}) at PHP ${rate}/day`);
    return vehicle;
  })));

  app.post('/api/agent/bookings/:id/cancel', requireAgent, (req, res) => res.json(updateBooking(req, 'Reservation cancelled', b => {
    if (!['Pending Approval', 'Ready for Dispatch'].includes(b.status)) D.fail('Only reservations awaiting dispatch can be cancelled.');
    b.cancellation = { reason: D.text(req.body.reason, 'Cancellation reason', 1000), by: req.user.name, at: now(), refundDue: D.billing(b).totalPaid };
    D.invalidatePass(b); b.status = 'Cancelled';
  })));

  app.post('/api/agent/bookings/:id/return', requireAgent, (req, res) => res.json(updateBooking(req, 'Vehicle returned', b => {
    if (b.status !== 'On Rental') D.fail('Only an active rental can be returned.');
    const returned = D.time(req.body.date, req.body.time), rate = req.body.hourlyRate;
    if (!Number.isFinite(returned) || returned < Math.max(D.time(b.start, b.startTime), Date.parse(b.dispatchedAt) || 0) || returned > Date.now() + 60000) D.fail('Return time must be after pick-up and actual dispatch and cannot be in the future.');
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 10000 || !Number.isInteger(rate)) D.fail('Enter a whole-peso hourly late fee from 0 to 10,000.');
    const lateHours = Math.max(0, Math.ceil((returned - D.time(b.end, b.endTime)) / 3600000));
    b.returnSignoff = { signature: b.renter.name, at: now(), by: req.user.name, actorId: req.user.id, method: 'Front-desk return confirmation' };
    b.lateFee = lateHours * rate; b.returnedAt = new Date(returned).toISOString(); b.lateHours = lateHours; b.hourlyLateRate = rate; b.status = 'Completed';
    fleet.recordReturn(b, req.user); rentalDocuments.receipt(b, 'return', req.user);
  })));

  app.post('/api/support', requireClient, (req, res) => {
    const bookingId = req.body.bookingId || null;
    if (bookingId && getBooking(bookingId).ownerId !== req.user.id) D.fail('Reservation not found.', 404);
    const category = ['General', 'Extension', 'Cancellation', 'Billing', 'Documents'].includes(req.body.category) ? req.body.category : 'General';
    const ticket = { id: `Q-${randomUUID().slice(0, 8).toUpperCase()}`, ownerId: req.user.id, bookingId, category, subject: D.text(req.body.subject, 'Subject', 150), status: 'open', createdAt: now(), version: 1, messages: [{ id: randomUUID(), by: req.user.name, role: 'client', at: now(), message: D.text(req.body.message, 'Message', 3000) }] };
    saveTicket(ticket); res.status(201).json(ticket);
  });

  app.post('/api/support/:id/reply', requireUser, (req, res) => {
    const ticket = allTickets().find(t => t.id === req.params.id);
    if (!ticket || (req.user.role !== 'agent' && ticket.ownerId !== req.user.id)) D.fail('Query not found.', 404);
    if (req.body.version !== ticket.version) D.fail('This conversation changed. Refresh and try again.', 409);
    ticket.messages.push({ id: randomUUID(), by: req.user.name, role: req.user.role, at: now(), message: D.text(req.body.message, 'Reply', 3000) });
    ticket.status = req.user.role === 'agent' && req.body.resolve ? 'resolved' : 'open'; ticket.version += 1; saveTicket(ticket); res.json(ticket);
  });

  // Operations Manager: User Management & Telemetry
  app.get('/api/manager/users', requireManager, (req, res) => {
    const rows = db.prepare('SELECT * FROM users ORDER BY created_at DESC, rowid DESC').all();
    const activeUsers = rows.filter(u => !u.archived_at).map(publicUser);
    const archivedUsers = rows.filter(u => u.archived_at).map(publicUser);
    const authHistory = db.prepare("SELECT * FROM audit_log WHERE action IN ('User sign in','Failed login attempt','Deactivated sign-in blocked','User sign out','Account registration','User account created','User account deactivated','User role updated') ORDER BY sequence DESC LIMIT 40").all();
    const successfulLogins = db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='User sign in'").get().count;
    const failedLogins = db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='Failed login attempt'").get().count;
    res.json({
      users: activeUsers,
      archivedUsers,
      telemetry: {
        totalUsers: rows.length,
        activeCount: activeUsers.length,
        archivedCount: archivedUsers.length,
        byRole: ['client', 'agent', 'mechanic', 'manager'].reduce((acc, r) => ({ ...acc, [r]: activeUsers.filter(u => u.role === r).length }), {}),
        successfulLogins,
        failedLogins,
        authHistory
      }
    });
  });

  app.post('/api/manager/users', requireManager, (req, res) => res.status(201).json(transaction(() => {
    const name = D.text(req.body.name, 'Full name', 70);
    const email = D.text(req.body.email, 'Email', 160).toLowerCase();
    const role = req.body.role;
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) D.fail('Enter a valid email address.');
    if (!['client', 'agent', 'mechanic', 'manager'].includes(role)) D.fail('Choose a valid role.');
    if (password.length < 8 || password.length > 128) D.fail('Use a password between 8 and 128 characters.');
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) D.fail('An account already uses this email.', 409);
    const created = addUser(name, email, role, password);
    systemAudit.write(req.user, 'User account created', `user:${created.id}`, `${name} (${role})`, 200, { oldValue: null, newValue: { name, email, role } });
    return publicUser(created);
  })));

  app.patch('/api/manager/users/:id', requireManager, (req, res) => res.json(transaction(() => {
    const target = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!target) D.fail('User not found.', 404);
    const role = req.body.role || target.role;
    const name = req.body.name ? D.text(req.body.name, 'Full name', 70) : target.name;
    if (!['client', 'agent', 'mechanic', 'manager'].includes(role)) D.fail('Choose a valid role.');
    if (target.id === req.user.id && role !== 'manager') D.fail('You cannot remove your own operations-manager role.');
    const oldVal = { name: target.name, role: target.role };
    db.prepare('UPDATE users SET name=?,role=? WHERE id=?').run(name, role, target.id);
    systemAudit.write(req.user, 'User role updated', `user:${target.id}`, `${target.email}: ${oldVal.role} → ${role}`, 200, { oldValue: oldVal, newValue: { name, role } });
    return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(target.id));
  })));

  app.post('/api/manager/users/:id/archive', requireManager, (req, res) => res.json(transaction(() => {
    const target = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!target) D.fail('User not found.', 404);
    if (target.id === req.user.id) D.fail('You cannot deactivate your own active manager account.');
    if (target.archived_at) D.fail('This account is already deactivated.', 409);
    const reason = D.text(req.body.reason, 'Deactivation reason', 500);
    const archivedAt = now();
    db.prepare('UPDATE users SET archived_at=?,archived_by=?,archive_reason=? WHERE id=?').run(archivedAt, req.user.name, reason, target.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
    systemAudit.write(req.user, 'User account deactivated', `user:${target.id}`, `${target.email}: ${reason}`, 200, {
      oldValue: { status: 'active', role: target.role },
      newValue: { status: 'archived', archivedBy: req.user.name, reason }
    });
    return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(target.id));
  })));

  // Operations Manager: Data Archives (Restore & Permanent Purge)
  app.get('/api/manager/archives', requireManager, (req, res) => {
    const allVehicles = fleet.fleet(true);
    const archivedUsers = db.prepare('SELECT * FROM users WHERE archived_at IS NOT NULL ORDER BY archived_at DESC').all().map(publicUser);
    res.json({
      bookings: rawBookings().filter(b => b.archivedAt).map(fleet.present),
      vehicles: allVehicles.filter(v => v.archivedAt),
      pendingDecommissions: allVehicles.filter(v => v.decommissionRequested && !v.archivedAt),
      users: archivedUsers
    });
  });

  app.post('/api/manager/archives/:kind/:id/restore', requireManager, (req, res) => res.json(transaction(() => {
    const { kind, id } = req.params;
    if (kind === 'booking') {
      const b = getBooking(id, true);
      if (!b.archivedAt) D.fail('Reservation is not archived.', 409);
      delete b.archivedAt; delete b.archivedBy; delete b.archiveReason; b.version += 1;
      audit(b, req.user, 'Reservation restored from archive', '', { oldValue: { archived: true }, newValue: { archived: false } });
      saveBooking(b);
      return fleet.present(b);
    }
    if (kind === 'vehicle') {
      const s = fleet.state(id);
      if (!s.archivedAt) D.fail('Vehicle is not archived.', 409);
      s.status = 'Available'; s.archivedAt = null; s.archivedBy = null; s.archiveReason = null; s.decommissionRequested = null; s.version += 1;
      fleet.save('vehicle', s);
      systemAudit.write(req.user, 'Vehicle restored from archive', `vehicle:${id}`, 'Restored to active fleet', 200, { oldValue: { status: 'Decommissioned', archived: true }, newValue: { status: 'Available', archived: false } });
      return fleet.fleet(true).find(v => v.id === id);
    }
    if (kind === 'user') {
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      if (!u || !u.archived_at) D.fail('Archived user not found.', 404);
      db.prepare('UPDATE users SET archived_at=NULL,archived_by=NULL,archive_reason=NULL WHERE id=?').run(id);
      systemAudit.write(req.user, 'User account restored', `user:${id}`, u.email, 200, { oldValue: { status: 'archived' }, newValue: { status: 'active' } });
      return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
    }
    D.fail('Unsupported archive category.');
  })));

  app.delete('/api/manager/archives/:kind/:id', requireManager, (req, res) => res.json(transaction(() => {
    const { kind, id } = req.params;
    const reason = D.text(req.body.reason || 'Confirmed permanent purge by manager', 'Purge reason', 500);
    if (kind === 'booking') {
      const b = getBooking(id, true);
      if (!b.archivedAt) D.fail('Soft-delete the reservation before permanently purging it.', 409);
      db.prepare('DELETE FROM bookings WHERE id=?').run(id);
      systemAudit.write(req.user, 'Booking permanently purged', `booking:${id}`, reason, 200, {
        oldValue: { id: b.id, renter: b.renter.name, status: b.status },
        newValue: 'PERMANENTLY_PURGED',
        alertType: 'Permanent record purge'
      });
      return { purged: id, kind };
    }
    if (kind === 'user') {
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      if (!u || !u.archived_at) D.fail('Deactivate the user account before permanently purging it.', 409);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      db.prepare('DELETE FROM documents WHERE owner_id=?').run(id);
      db.prepare('DELETE FROM tickets WHERE owner_id=?').run(id);
      db.prepare('UPDATE bookings SET owner_id=NULL WHERE owner_id=?').run(id);
      db.prepare('DELETE FROM users WHERE id=?').run(id);
      systemAudit.write(req.user, 'User permanently purged', `user:${id}`, `${u.email}: ${reason}`, 200, {
        oldValue: { email: u.email, name: u.name, role: u.role },
        newValue: 'PERMANENTLY_PURGED',
        alertType: 'Permanent record purge'
      });
      return { purged: id, kind };
    }
    if (kind === 'vehicle') {
      const s = fleet.state(id);
      if (!s.archivedAt) D.fail('Decommission the vehicle before purging its archive record.', 409);
      s.activity = []; s.archivePurgedAt = now();
      fleet.save('vehicle', s);
      systemAudit.write(req.user, 'Decommissioned vehicle history purged', `vehicle:${id}`, reason, 200, {
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
    const status = error.type === 'entity.too.large' ? 413 : error.status || 500;
    if (status >= 500) console.error('DrivePulse request failed:', error.message);
    res.status(status).json({ error: status === 413 ? 'Files must be 5 MB or smaller.' : status >= 500 ? 'The request could not be completed. Please try again.' : error.message });
  });
  return { app, db };
}
module.exports = { createApp };

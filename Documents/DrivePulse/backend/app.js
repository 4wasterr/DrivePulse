const express = require('express');
const cors = require('cors');
const { DatabaseSync } = require('node:sqlite');
const { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } = require('node:crypto');
const { mkdirSync } = require('node:fs');
const { dirname, join } = require('node:path');
const D = require('./domain');

const hash = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
function publicUser(user) { return { id: user.id, name: user.name, email: user.email, role: user.role }; }
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

function createApp({ dbPath = process.env.DB_PATH || join(__dirname, 'data', 'drivepulse.sqlite'), seedDemo = process.env.NODE_ENV !== 'production', allowAgentSignup = process.env.NODE_ENV !== 'production' || process.env.ALLOW_AGENT_SIGNUP === 'true' } = {}) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL, saved TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS bookings (id TEXT PRIMARY KEY, owner_id TEXT, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, fingerprint TEXT NOT NULL, uploaded_at TEXT NOT NULL, data BLOB NOT NULL);
    CREATE INDEX IF NOT EXISTS document_owner ON documents(owner_id, kind, uploaded_at);
    CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, owner_id TEXT, payload TEXT NOT NULL);`);
  const allBookings = () => db.prepare('SELECT payload FROM bookings').all().map(row => JSON.parse(row.payload));
  const getBooking = id => { const row = db.prepare('SELECT payload FROM bookings WHERE id=?').get(id); if (!row) D.fail('Reservation not found.', 404); return JSON.parse(row.payload); };
  const saveBooking = booking => db.prepare('INSERT INTO bookings(id,owner_id,payload) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,owner_id=excluded.owner_id').run(booking.id, booking.ownerId || null, JSON.stringify(booking));
  const allTickets = () => db.prepare('SELECT payload FROM tickets').all().map(row => JSON.parse(row.payload));
  const saveTicket = ticket => db.prepare('INSERT INTO tickets(id,owner_id,payload) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(ticket.id, ticket.ownerId || null, JSON.stringify(ticket));
  const meta = doc => ({ id: doc.id, kind: doc.kind, name: doc.name, mime: doc.mime, fingerprint: doc.fingerprint, size: doc.data.length, uploadedAt: doc.uploaded_at });
  const addUser = (name, email, role, password) => {
    const record = passwordRecord(password), id = randomUUID();
    db.prepare('INSERT INTO users(id,email,name,role,salt,password_hash) VALUES(?,?,?,?,?,?)').run(id, email, name, role, record.salt, record.passwordHash);
    return db.prepare('SELECT * FROM users WHERE id=?').get(id);
  };
  const audit = (booking, user, action, note = '') => { booking.activity ||= []; booking.activity.push({ id: randomUUID(), at: now(), by: user.name, action, note }); };
  const transaction = callback => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = callback(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const updateBooking = (req, action, fn) => transaction(() => {
    const booking = getBooking(req.params.id);
    if (req.body.version !== booking.version) D.fail('This reservation changed. Refresh it and try again.', 409);
    fn(booking); booking.version += 1; audit(booking, req.user, action, req.body.reason || req.body.note || ''); saveBooking(booking); return D.present(booking);
  });

  if (seedDemo && !db.prepare('SELECT id FROM users WHERE email=?').get('client@drivepulse.demo')) {
    transaction(() => {
      const client = addUser('Alex Morgan', 'client@drivepulse.demo', 'client', 'DrivePulse123!');
      const agent = addUser('Jamie Santos', 'agent@drivepulse.demo', 'agent', 'DrivePulse123!');
      const docs = D.REQUIRED_DOCUMENTS.map(kind => {
        const id = randomUUID(), data = samplePDF(kind);
        db.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?,?)').run(id, client.id, kind, `sample-${kind}.pdf`, 'application/pdf', hash(data), now(), data);
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
        booking.payments = ['rental', 'deposit'].map(type => ({ id: randomUUID(), type, amount: booking[type], method: 'Simulated checkout', reference: 'DEMO', status: confirmed ? 'confirmed' : 'pending', at: now(), simulated: true }));
        if (confirmed) {
          booking.documents.forEach(doc => { doc.review = { status: 'approved', by: agent.name, at: now(), note: 'Illustrative sample review' }; });
          booking.inspection = { status: 'approved', by: agent.name, at: now(), checks: { exterior: true, tyres: true, controls: true, fuel: true }, note: 'Illustrative inspection' };
          if (status !== 'Completed') booking.dispatchPass = { id: `PASS-${randomUUID().slice(0, 8).toUpperCase()}`, issuedAt: now(), issuedBy: agent.name, end: booking.end, endTime: booking.endTime };
        }
        audit(booking, agent, 'Sample reservation created', 'Illustrative data for the development workspace.'); saveBooking(booking);
      }
      saveTicket({ id: `Q-${randomUUID().slice(0, 8)}`, ownerId: client.id, bookingId: 'DP-10248', subject: 'Can I extend my rental?', category: 'Extension', status: 'open', createdAt: now(), version: 1, messages: [{ id: randomUUID(), by: client.name, role: 'client', message: 'Could you help me add one extra day to this reservation?', at: now() }] });
    });
  }

  const app = express();
  app.disable('x-powered-by');
  const origins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173').split(',');
  app.use(cors({ origin: origins, credentials: true }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') && !origins.includes(req.get('origin'))) return res.status(403).json({ error: 'This request origin is not allowed.' });
    const cookie = req.get('cookie')?.split(';').map(c => c.trim()).find(c => c.startsWith('drivepulse_session='))?.slice('drivepulse_session='.length);
    if (cookie) {
      const record = db.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token=? AND expires>?').get(hash(cookie), Date.now());
      if (record) req.user = record;
    }
    next();
  });
  const requireUser = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Sign in to continue.' });
  const requireAgent = (req, res, next) => !req.user ? res.status(401).json({ error: 'Sign in to continue.' }) : req.user.role !== 'agent' ? res.status(403).json({ error: 'This action requires a booking-agent account.' }) : next();
  const requireClient = (req, res, next) => !req.user ? res.status(401).json({ error: 'Sign in to continue.' }) : req.user.role !== 'client' ? res.status(403).json({ error: 'Use a client account to book a personal rental.' }) : next();

  app.post('/api/documents/:kind', requireUser, express.raw({ type: () => true, limit: '5mb' }), (req, res) => {
    const kind = req.params.kind.startsWith('payment-') ? 'payment' : req.params.kind;
    if (![...D.REQUIRED_DOCUMENTS, 'payment'].includes(kind)) D.fail('Unsupported document category.');
    const mime = req.get('content-type')?.split(';')[0], data = req.body;
    if (!Buffer.isBuffer(data) || !data.length) D.fail('Choose a non-empty file.');
    const isValid = mime === 'application/pdf' ? data.subarray(0, 5).toString() === '%PDF-' : mime === 'image/png' ? data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : mime === 'image/jpeg' ? data[0] === 255 && data[1] === 216 && data[2] === 255 : mime === 'image/webp' ? data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP' : false;
    if (!isValid) D.fail('Upload a valid PDF, JPG, PNG, or WebP file.');
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
          b.documents = (b.documents || []).filter(d => d.kind !== kind);
          b.documents.push({ ...meta(db.prepare('SELECT * FROM documents WHERE id=?').get(id)), review: { status: 'pending' } });
          D.invalidatePass(b); b.version += 1; audit(b, req.user, 'Document uploaded', kind); saveBooking(b);
        });
      }
    });
    res.status(201).json(meta(db.prepare('SELECT * FROM documents WHERE id=?').get(id)));
  });
  app.use(express.json({ limit: '100kb' }));
  app.use((req, res, next) => { req.body ??= {}; next(); });
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.get('/api/session', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null, agentSignup: allowAgentSignup, demo: seedDemo }));
  const createSession = (user, res) => {
    const token = randomBytes(32).toString('hex');
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
    if (!['client', 'agent'].includes(req.body.role)) D.fail('Choose client or booking agent.');
    if (password.length < 8 || password.length > 128) D.fail('Use a password between 8 and 128 characters.');
    const existing = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (req.params.action === 'signup') {
      if (existing) D.fail('An account already uses this email. Sign in instead.', 409);
      if (req.body.role === 'agent' && !allowAgentSignup) D.fail('Ask your administrator to create a booking-agent account.', 403);
      const user = addUser(D.text(req.body.name, 'Full name', 70), email, req.body.role, password);
      return res.status(201).json({ user: createSession(user, res) });
    }
    const candidate = scryptSync(password, existing?.salt || 'missing-account-salt', 64);
    if (!existing || existing.role !== req.body.role || !timingSafeEqual(candidate, Buffer.from(existing.password_hash, 'hex'))) D.fail('Email, password, or selected account type is incorrect.', 401);
    attempts.delete(address);
    res.json({ user: createSession(existing, res) });
  });
  app.post('/api/logout', (req, res) => {
    const token = req.get('cookie')?.split(';').map(c => c.trim()).find(c => c.startsWith('drivepulse_session='))?.slice('drivepulse_session='.length);
    if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token));
    res.clearCookie('drivepulse_session', { path: '/', httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production' }); res.json({ ok: true });
  });
  app.get('/api/availability', (req, res) => res.json(allBookings().map(({ id, vehicleId, start, end, startTime, endTime, status }) => ({ id, vehicleId, start, end, startTime, endTime, status }))));
  app.get('/api/workspace', requireUser, (req, res) => {
    const agent = req.user.role === 'agent', documents = {};
    db.prepare('SELECT * FROM documents WHERE owner_id=? ORDER BY uploaded_at ASC, rowid ASC').all(req.user.id).filter(d => D.REQUIRED_DOCUMENTS.includes(d.kind)).forEach(doc => { documents[doc.kind] = meta(doc); });
    res.json({ user: publicUser(req.user), bookings: allBookings().filter(b => agent || b.ownerId === req.user.id).map(D.present).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), documents, saved: JSON.parse(req.user.saved), tickets: allTickets().filter(t => agent || t.ownerId === req.user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
  });
  app.patch('/api/profile', requireUser, (req, res) => {
    const name = D.text(req.body.name, 'Full name', 70);
    const email = D.text(req.body.email, 'Email', 160).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) D.fail('Enter a valid email address.');
    if (db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(email, req.user.id)) D.fail('This email is already registered.', 409);
    db.prepare('UPDATE users SET name=?,email=? WHERE id=?').run(name, email, req.user.id);
    res.json(publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)));
  });
  app.put('/api/saved', requireClient, (req, res) => {
    if (!Array.isArray(req.body.ids) || req.body.ids.some(id => !D.FLEET.some(v => v.id === id))) D.fail('Choose valid fleet vehicles.');
    const ids = [...new Set(req.body.ids)]; db.prepare('UPDATE users SET saved=? WHERE id=?').run(JSON.stringify(ids), req.user.id); res.json(ids);
  });
  app.get('/api/documents/:id', requireUser, (req, res) => {
    let doc = db.prepare('SELECT * FROM documents WHERE id=?').get(req.params.id);
    if (!doc && D.REQUIRED_DOCUMENTS.includes(req.params.id)) doc = db.prepare('SELECT * FROM documents WHERE owner_id=? AND kind=? ORDER BY uploaded_at DESC,rowid DESC LIMIT 1').get(req.user.id, req.params.id);
    if (!doc) D.fail('Document not found.', 404);
    if (req.user.role !== 'agent' && doc.owner_id !== req.user.id) D.fail('Document not found.', 404);
    res.set('Content-Type', doc.mime); res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(doc.name)}`); res.send(Buffer.from(doc.data));
  });
  const createBooking = (req, walkin) => transaction(() => {
    const input = req.body, quotation = D.quote(input);
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
    const booking = { id: `DP-${randomUUID().slice(0, 8).toUpperCase()}`, ownerId, renter, vehicleId: input.vehicleId, start: input.start, end: input.end, startTime: input.startTime, endTime: input.endTime, pickup: input.pickup, dropoff: input.dropoff, ...quotation, source: walkin ? 'Walk-in' : 'Online', status: 'Pending Approval', version: 1, documents: docs, payments: [], lateFee: 0, createdAt: now(), activity: [], note: D.text(input.note, 'Reservation note', 1000, false), payment: walkin ? 'Front-desk payment' : input.payment === 'Payment proof' ? 'Payment proof' : 'Simulated checkout' };
    if (!walkin) {
      let proof;
      if (input.payment === 'Payment proof') {
        proof = db.prepare("SELECT * FROM documents WHERE id=? AND owner_id=? AND kind='payment'").get(input.proofId, req.user.id);
        if (!proof) D.fail('Upload a valid payment proof.');
        booking.proofId = proof.id;
      }
      booking.payments = ['rental', 'deposit'].map(type => ({ id: randomUUID(), type, amount: booking[type], status: 'pending', method: booking.payment, proofId: proof?.id || null, simulated: !proof, reference: 'Client submission', at: now() }));
    }
    audit(booking, req.user, walkin ? 'Walk-in scheduled' : 'Online booking received'); saveBooking(booking); return D.present(booking);
  });
  app.post('/api/bookings', requireClient, (req, res) => res.status(201).json(createBooking(req, false)));
  app.post('/api/agent/bookings', requireAgent, (req, res) => res.status(201).json(createBooking(req, true)));
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
      if (req.body.decision === 'confirmed' && pending.amount > (pending.type === 'deposit' ? bill.depositBalance : bill.rentalBalance)) D.fail('This payment exceeds the outstanding balance. Reject it and record the correct amount.');
      pending.status = req.body.decision; pending.reviewedBy = req.user.name; pending.reviewedAt = now(); pending.reviewNote = D.text(req.body.reason, 'Review note', 1000, req.body.decision === 'rejected');
    } else {
      const { type, amount } = req.body;
      if (!['rental', 'deposit'].includes(type) || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || Math.abs(Math.round(amount * 100) - amount * 100) > 0.000001) D.fail('Enter a valid payment amount with at most two decimal places.');
      if (amount > (type === 'deposit' ? bill.depositBalance : bill.rentalBalance)) D.fail('The payment exceeds the outstanding balance.');
      b.payments.push({ id: randomUUID(), type, amount, status: 'confirmed', method: D.text(req.body.method, 'Payment method', 50), reference: D.text(req.body.reference, 'Receipt or transaction reference', 150), at: now(), reviewedBy: req.user.name });
    }
  })));
  app.post('/api/agent/bookings/:id/inspection', requireAgent, (req, res) => res.json(updateBooking(req, 'Inspection approved', b => {
    if (!['Pending Approval', 'Ready for Dispatch'].includes(b.status)) D.fail('Inspection approval is only available before dispatch.');
    const checks = req.body.checks;
    if (!['exterior', 'tyres', 'controls', 'fuel'].every(key => checks?.[key] === true)) D.fail('Complete every inspection check before approving.');
    b.inspection = { status: 'approved', checks, note: D.text(req.body.note, 'Inspection notes', 1000, false), by: req.user.name, at: now() };
  })));
  app.post('/api/agent/bookings/:id/pass', requireAgent, (req, res) => res.json(updateBooking(req, 'Digital dispatch pass issued', b => {
    const blocks = D.dispatchBlocks(b); if (blocks.length) D.fail(blocks.join(' '));
    b.dispatchPass = { id: `PASS-${randomUUID().slice(0, 10).toUpperCase()}`, issuedBy: req.user.name, issuedAt: now(), end: b.end, endTime: b.endTime };
    if (b.status !== 'On Rental') b.status = 'Ready for Dispatch';
  })));
  app.post('/api/agent/bookings/:id/dispatch', requireAgent, (req, res) => res.json(updateBooking(req, 'Vehicle dispatched', b => {
    if (b.status !== 'Ready for Dispatch' || !b.dispatchPass || b.dispatchPass.revokedAt || D.dispatchBlocks(b).length) D.fail('Issue a valid dispatch pass after all checks are complete.');
    b.status = 'On Rental'; b.dispatchedAt = now();
  })));
  app.post('/api/agent/bookings/:id/extend', requireAgent, (req, res) => res.json(updateBooking(req, 'Rental extended', b => {
    if (['Cancelled', 'Completed'].includes(b.status)) D.fail('Closed reservations cannot be extended.');
    const updated = { ...b, end: req.body.end, endTime: req.body.endTime };
    if (D.time(updated.end, updated.endTime) <= Math.max(D.time(b.end, b.endTime), Date.now())) D.fail('Choose a future return time later than the current return.');
    const quotation = D.quote(updated, true);
    if (!D.available(allBookings(), updated, b.id)) D.fail('This extension overlaps another reservation.', 409);
    b.extensions ||= []; b.extensions.push({ oldEnd: b.end, oldEndTime: b.endTime, newEnd: updated.end, newEndTime: updated.endTime, additionalRental: quotation.rental - b.rental, by: req.user.name, at: now() });
    b.end = updated.end; b.endTime = updated.endTime; b.days = quotation.days; b.rental = quotation.rental;
    D.invalidatePass(b);
  })));
  app.post('/api/agent/bookings/:id/cancel', requireAgent, (req, res) => res.json(updateBooking(req, 'Reservation cancelled', b => {
    if (!['Pending Approval', 'Ready for Dispatch'].includes(b.status)) D.fail('Only reservations awaiting dispatch can be cancelled.');
    b.cancellation = { reason: D.text(req.body.reason, 'Cancellation reason', 1000), by: req.user.name, at: now(), refundDue: D.billing(b).totalPaid };
    D.invalidatePass(b); b.status = 'Cancelled';
  })));
  app.post('/api/agent/bookings/:id/return', requireAgent, (req, res) => res.json(updateBooking(req, 'Vehicle returned', b => {
    if (b.status !== 'On Rental') D.fail('Only an active rental can be returned.');
    const returned = D.time(req.body.date, req.body.time), rate = req.body.hourlyRate;
    if (!Number.isFinite(returned) || returned < D.time(b.start, b.startTime) || returned > Date.now() + 60000) D.fail('Return time must be after pick-up and cannot be in the future.');
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 10000 || !Number.isInteger(rate)) D.fail('Enter a whole-peso hourly late fee from 0 to 10,000.');
    const lateHours = Math.max(0, Math.ceil((returned - D.time(b.end, b.endTime)) / 3600000));
    b.lateFee = lateHours * rate; b.returnedAt = new Date(returned).toISOString(); b.lateHours = lateHours; b.hourlyLateRate = rate; b.status = 'Completed';
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

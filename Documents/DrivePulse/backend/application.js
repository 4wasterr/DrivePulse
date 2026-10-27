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
const { createMailer } = require('./email');
const demoAccounts = require('../shared/demoAccounts.json');
const { inputError } = require('../shared/validation.mjs');
const { clientProfile } = require('../shared/clientProfile.mjs');
const { createAccountSecurity } = require('./account-security');
const { cancellationSettlement } = require('../shared/cancellation.mjs');
const { geographicAddress, registerGeography } = require('./geography');

const hash = (value) => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const VERIFY_TOKEN_TTL = 24 * 3600000;
const EMAIL_RESEND_COOLDOWN = 60000;
const SESSION_IDLE_MS = 15 * 60000;
const sessionCookieOptions = { path: '/', httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production' };
function publicUser(user) {
  return {
    id: user.id, name: user.name, email: user.email, role: user.role,
    emailVerified: Boolean(user.email_verified_at),
    firstName: user.first_name || '', middleName: user.middle_name || '', lastName: user.last_name || '', phone: user.phone || '',
    address: { street: user.address_street || '', city: user.address_city || '', postalCode: user.address_postal || '', ...(user.address_geography ? JSON.parse(user.address_geography) : {}) },
    createdAt: user.created_at || null, lastLoginAt: user.last_login_at || null,
    archivedAt: user.archived_at || null, archivedBy: user.archived_by || null, archiveReason: user.archive_reason || null
  };
}
function passwordRecord(password) {
  const salt = randomBytes(16).toString('hex');
  return { salt, passwordHash: scryptSync(password, salt, 64).toString('hex') };
}

async function createApp({ app = express(), database = null, dbPath, mailer = createMailer(), seedDemo = process.env.ENABLE_DEMO_ACCOUNTS === 'true' || process.env.NODE_ENV !== 'production' && !process.env.DATABASE_URL, allowAgentSignup = process.env.NODE_ENV !== 'production' && !process.env.DATABASE_URL && process.env.ALLOW_AGENT_SIGNUP !== 'false' || process.env.ALLOW_AGENT_SIGNUP === 'true' } = {}) {
  if (process.env.NODE_ENV === 'production' && (allowAgentSignup || seedDemo && process.env.ENABLE_DEMO_ACCOUNTS !== 'true')) throw new Error('Demo data and staff self-registration must be disabled in production.');
  const db = database || createDatabase({ filename: dbPath });
  await db.initialize();

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
  const readClientProfile = input => { try { const geography = geographicAddress(input); return { ...clientProfile({ ...input, city: geography.city }), geography }; } catch (error) { D.fail(error.message); } };
  const writeProfile = async (id, profile) => db.prepare('UPDATE users SET first_name=?,middle_name=?,last_name=?,phone=?,address_street=?,address_city=?,address_postal=?,address_geography=? WHERE id=?').run(profile.firstName || '', profile.middleName || '', profile.lastName || '', profile.phone || '', profile.street || '', profile.city || '', profile.postalCode || '', profile.geography ? JSON.stringify(profile.geography) : '', id);
  const addUser = async (name, email, role, password, { verified = true, profile = {} } = {}) => {
    const record = passwordRecord(password),id = randomUUID(),createdAt = now();
    await db.prepare('INSERT INTO users(id,email,name,role,salt,password_hash,created_at,email_verified_at) VALUES(?,?,?,?,?,?,?,?)').run(id, email, name, role, record.salt, record.passwordHash, createdAt, verified ? createdAt : '');
    await writeProfile(id, profile);
    return await db.prepare('SELECT * FROM users WHERE id=?').get(id);
  };
  const systemAudit = createAudit(db);
  const audit = async (booking, user, action, note = '', extra = {}) => {
    booking.activity ||= [];
    booking.activity.push({ id: randomUUID(), at: now(), by: user.name, action, note });
    await systemAudit.write(user, action, booking.id, note, 200, extra);
  };
  const transaction = async (callback) => await db.transaction(callback);
  const accountSecurity = createAccountSecurity({ db, transaction, mailer, passwordRecord });
  const revokeRecovery = async user => {
    await db.prepare('DELETE FROM auth_tokens WHERE user_id=?').run(user.id);
    await db.prepare('DELETE FROM recovery_codes WHERE user_id=?').run(user.id);
    await db.prepare('DELETE FROM login_locks WHERE identifier=?').run(hash(user.email));
  };
  const rentalDocuments = createRentalDocuments({ db, getBooking, saveBooking, transaction, audit });
  const fleet = createFleet({ db, allBookings, rawBookings, getBooking, saveBooking, transaction, audit, rentalDocuments, systemAudit });
  await fleet.initializePlates();
  // Branch records can be maintained without shipping a new frontend bundle.
  if (!(await fleet.records('location')).length) await transaction(async () => {
    for (const [index, name] of D.LOCATIONS.entries()) await fleet.save('location', { id: `branch-${index + 1}`, name, active: true, type: name.includes('NAIA') ? 'Airport hub' : 'Branch' });
  });
  const defaultBranchNames = { 'branch-1': 'Makati Branch', 'branch-2': 'BGC Branch', 'branch-3': 'NAIA Terminal 3 Branch', 'branch-4': 'Quezon City Branch' };
  const pickupLocations = async () => (await fleet.records('location')).filter(location => location.active !== false).map(location => ({ ...location, branchName: location.branchName || defaultBranchNames[location.id] || location.name })).sort((a, b) => a.id.localeCompare(b.id));
  const locationNames = async () => (await pickupLocations()).map(location => location.name);
  const transactionReference = async () => {
    const existing = new Set((await rawBookings()).map(b => b.transactionReference));
    let reference;
    do { reference = `DP-TXN-${randomBytes(8).toString('hex').toUpperCase()}`; } while (existing.has(reference));
    return reference;
  };
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
      const token = hash(cookie);
      const record = await db.prepare('SELECT users.*, sessions.last_activity, sessions.expires FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token=? AND users.archived_at IS NULL').get(token);
      if (record && Number(record.expires) > Date.now() && Date.now() - Number(record.last_activity) < SESSION_IDLE_MS) { req.user = record; req.sessionToken = token; }
      else {
        await db.prepare('DELETE FROM sessions WHERE token=?').run(token);
        res.clearCookie('drivepulse_session', sessionCookieOptions);
        req.sessionExpired = true;
        if (!['/session', '/logout'].includes(req.path) && !req.path.startsWith('/auth/')) return res.status(401).json({ error: 'Your session expired after 15 minutes of inactivity. Please sign in again.', code: 'SESSION_EXPIRED' });
      }
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
  const sessionFor = async req => ({
    user: req.user ? publicUser(req.user) : null,
    sessionExpired: Boolean(req.sessionExpired),
    lastActivity: req.user ? Number(req.user.last_activity) : null,
    inactivityTimeout: SESSION_IDLE_MS,
    agentSignup: allowAgentSignup,
    staffSignup: allowAgentSignup,
    demo: seedDemo,
    emailDelivery: Boolean(mailer),
    rates: Object.fromEntries((await fleet.fleet(true)).map((v) => [v.id, v.rate]))
  });
  app.get('/api/session', async (req, res) => res.json(await sessionFor(req)));

  // Only explicit user activity renews idle time. Polling reads never extend it.
  app.post('/api/session/activity', requireUser, async (req, res) => {
    const at = Date.now();
    await db.prepare('UPDATE sessions SET last_activity=? WHERE token=?').run(at, req.sessionToken);
    res.json({ lastActivity: at });
  });

  const createSession = async (user, res) => {
    const token = randomBytes(32).toString('hex'),loginAt = now();
    await db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(loginAt, user.id);
    user.last_login_at = loginAt;
    await db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
    await db.prepare('INSERT INTO sessions(token,user_id,expires,last_activity) VALUES(?,?,?,?)').run(hash(token), user.id, Date.now() + 7 * D.DAY, Date.now());
    res.cookie('drivepulse_session', token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 7 * D.DAY, path: '/' });
    return publicUser(user);
  };

  // Shared per-address throttle for every unauthenticated account endpoint.
  const throttle = async (req) => {
    const address = process.env.VERCEL ? req.get('x-real-ip') || req.ip : req.ip;
    const at = Date.now(), cutoff = at - 15 * 60000;
    await db.prepare('DELETE FROM auth_attempts WHERE started_at<?').run(cutoff);
    const attempt = await db.prepare(`INSERT INTO auth_attempts(address,started_at,attempts) VALUES(?,?,1)
      ON CONFLICT(address) DO UPDATE SET
      attempts=CASE WHEN auth_attempts.started_at<? THEN 1 ELSE auth_attempts.attempts+1 END,
      started_at=CASE WHEN auth_attempts.started_at<? THEN excluded.started_at ELSE auth_attempts.started_at END
      RETURNING attempts`).get(address, at, cutoff, cutoff);
    if (attempt.attempts > 25) D.fail('Too many attempts. Please try again in 15 minutes.', 429);
    return address;
  };

  // Email links return to the same DrivePulse site the request came from (already origin-checked).
  const appOrigin = (req) => {
    const origin = req.get('origin');
    if (origin && origins.includes(origin)) return origin;
    const configured = (process.env.FRONTEND_ORIGIN || '').split(',').map(value => value.trim()).find(Boolean);
    if (configured) return configured;
    const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
    if (vercelHost) return `https://${vercelHost}`;
    return 'http://127.0.0.1:5173';
  };

  // Only a SHA-256 digest of each single-use link token is stored.
  const issueToken = async (user, kind, ttl) => {
    const recent = await db.prepare('SELECT issued_at FROM auth_tokens WHERE user_id=? AND kind=? ORDER BY issued_at DESC LIMIT 1').get(user.id, kind);
    if (recent?.issued_at && Date.now() - Date.parse(recent.issued_at) < EMAIL_RESEND_COOLDOWN) return null;
    const token = randomBytes(32).toString('base64url');
    await db.prepare('DELETE FROM auth_tokens WHERE (user_id=? AND kind=?) OR expires<=?').run(user.id, kind, Date.now());
    await db.prepare('INSERT INTO auth_tokens(token,user_id,kind,expires,issued_at) VALUES(?,?,?,?,?)').run(hash(token), user.id, kind, Date.now() + ttl, now());
    return token;
  };
  const consumeToken = async (token, kind) => {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
    const record = await db.prepare('SELECT auth_tokens.user_id, auth_tokens.expires FROM auth_tokens JOIN users ON users.id=auth_tokens.user_id WHERE auth_tokens.token=? AND auth_tokens.kind=?').get(hash(token), kind);
    if (!record) return null;
    await db.prepare('DELETE FROM auth_tokens WHERE token=?').run(hash(token));
    if (Number(record.expires) <= Date.now()) return null;
    return await db.prepare('SELECT * FROM users WHERE id=?').get(record.user_id);
  };
  const requireMailer = () => {
    if (!mailer) D.fail('Email delivery is not configured. Ask your administrator to configure Gmail SMTP.', 503);
  };
  const sendVerification = async (user, req) => {
    const token = await transaction(() => issueToken(user, 'verify_email', VERIFY_TOKEN_TTL));
    if (!token) return false;
    try {
      await mailer.sendVerification({ to: user.email, name: user.name, verifyUrl: `${appOrigin(req)}/#verify-email?token=${token}` });
    } catch (error) {
      await db.prepare('DELETE FROM auth_tokens WHERE token=?').run(hash(token));
      throw error;
    }
    return true;
  };
  const accountEmail = (value) => {
    const email = D.text(value, 'Email', 160).toLowerCase();
    const error = inputError(email, { kind: 'email' });
    if (error) D.fail(error);
    return email;
  };
  // Identical responses for known and unknown addresses prevent account discovery.
  const quietly = async (work) => {
    try { await work(); }
    catch (error) { if (process.env.NODE_ENV !== 'production' && error.expose) throw error; if (error.expose) console.error('DrivePulse email request failed:', error.message); else throw error; }
  };

  app.post('/api/auth/verify-email', async (req, res) => {
    const address = await throttle(req);
    const user = await transaction(async () => await consumeToken(req.body.token, 'verify_email'));
    if (!user) D.fail('This verification link is invalid or has expired. Request a new one from the sign-in page.', 400);
    if (user.archived_at) D.fail('This account has been deactivated by an operations manager.', 403);
    if (!user.email_verified_at) {
      user.email_verified_at = now();
      await db.prepare('UPDATE users SET email_verified_at=? WHERE id=?').run(user.email_verified_at, user.id);
      await db.prepare("DELETE FROM auth_tokens WHERE user_id=? AND kind='verify_email'").run(user.id);
      await systemAudit.write(user, 'Email verified', `Account: ${user.email}`, 'Client confirmed their email address', 200, { ip: address });
    }
    req.auditUser = user;
    res.json({ user: await createSession(user, res) });
  });

  app.post('/api/auth/resend-verification', async (req, res) => {
    requireMailer();
    await throttle(req);
    const email = accountEmail(req.body.email);
    await quietly(async () => {
      const user = await db.prepare('SELECT * FROM users WHERE email=?').get(email);
      if (user && !user.email_verified_at && !user.archived_at) await sendVerification(user, req);
    });
    res.json({ ok: true, retryAfterSeconds: 60, message: 'If this account still needs verification, a new link is on its way. Check your inbox and spam folder.' });
  });

  app.post('/api/auth/forgot-password', async (req, res) => {
    requireMailer();
    const address = await throttle(req);
    const email = accountEmail(req.body.email);
    let recovery;
    await quietly(async () => {
      const user = await db.prepare('SELECT * FROM users WHERE email=?').get(email);
      recovery = await accountSecurity.issueRecovery(user, email, appOrigin(req));
      if (user && !user.archived_at) await systemAudit.write(user, 'Password reset requested', `Account: ${user.email}`, 'Password recovery code requested', 200, { ip: address });
    });
    // A failed send has the same public response shape as other recovery requests.
    res.json({ ok: true, challengeId: recovery?.challengeId || randomBytes(24).toString('base64url'), retryAfterSeconds: recovery?.retryAfterSeconds || 60, message: 'If an account uses this email, a six-digit verification code is on its way. It expires in 10 minutes.' });
  });

  app.post('/api/auth/reset-password', async (req, res) => {
    const address = await throttle(req);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!validPassword(password)) D.fail(PASSWORD_ERROR);
    const user = await accountSecurity.completeRecovery(req.body.challengeId, req.body.code, password);
    if (!user) D.fail('The verification code is invalid, expired, or has reached its attempt limit. Request a new code.', 400);
    req.auditUser = user;
    await systemAudit.write(user, 'User password reset', `user:${user.id}`, 'Password reset through emailed verification code; active sessions revoked.', 200, { ip: address });
    res.json({ ok: true, email: user.email });
  });

  app.post('/api/auth/:action', async (req, res) => {
    if (!['login', 'signup'].includes(req.params.action)) D.fail('Not found.', 404);
    const address = await throttle(req);
    const signup = req.params.action === 'signup';
    const identifier = D.text(signup ? req.body.email : req.body.username ?? req.body.email, signup ? 'Email' : 'Email or username', 160).toLowerCase();
    const identifierError = inputError(identifier, { kind: signup ? 'email' : 'login-identifier' });
    if (identifierError) D.fail(identifierError);
    const demoAccount = !signup ? demoAccounts.find(account => account.username === identifier) : null;
    const email = demoAccount?.email || identifier, password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!password.trim() || password.length > 128) D.fail('Enter your password (up to 128 characters).');
    const existing = await db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (req.params.action === 'signup') {
      if (!validPassword(password)) D.fail(PASSWORD_ERROR);
      if (!['client', 'agent', 'mechanic', 'manager'].includes(req.body.role)) D.fail('Choose a valid account type.');
      if (existing) D.fail('An account already uses this email. Sign in instead.', 409);
      if (req.body.role !== 'client' && !allowAgentSignup) D.fail('Ask your administrator to create a staff account.', 403);
      // Public production accounts always require inbox confirmation.
      const verify = req.body.role === 'client' && (Boolean(mailer) || process.env.NODE_ENV === 'production');
      if (verify) requireMailer();
      const profile = req.body.role === 'client' ? readClientProfile(req.body) : {};
      const user = await transaction(() => addUser(profile.name || D.text(req.body.name, 'Full name', 70), email, req.body.role, password, { verified: !verify, profile }));
      req.auditUser = user;
      if (verify) {
        try { await sendVerification(user, req); }
        catch (error) {
          // Never leave an unreachable, unverifiable account behind.
          await db.prepare('DELETE FROM users WHERE id=?').run(user.id);
          throw error;
        }
      }
      await systemAudit.write(user, 'Account registration', `Account: ${user.email}`, verify ? `New ${user.role} account created; verification email sent` : `New ${user.role} account created`, 201, {
        ip: address,
        newValue: { name: user.name, email: user.email, role: user.role }
      });
      if (verify) return res.status(201).json({ verificationRequired: true, email: user.email, retryAfterSeconds: 60 });
      return res.status(201).json({ user: await createSession(user, res) });
    }
    const candidate = scryptSync(password, existing?.salt || 'missing-account-salt', 64);
    const lockError = (lock) => {
      const seconds = Math.max(1, Math.ceil((lock.lockedUntil - Date.now()) / 1000));
      res.set('Retry-After', String(seconds));
      const error = new Error(`Too many unsuccessful sign-in attempts. Try again in ${seconds} seconds.`);
      error.status = 429; error.publicCode = 'ACCOUNT_LOCKED'; error.publicData = { retryAfterSeconds: seconds };
      throw error;
    };
    const currentLock = await accountSecurity.loginLock(email);
    if (currentLock.locked) lockError(currentLock);
    if (!existing || demoAccount && existing.role !== demoAccount.role || !timingSafeEqual(candidate, Buffer.from(existing.password_hash, 'hex'))) {
      const lock = await accountSecurity.loginLock(email, { failed: true });
      if (lock.newlyLocked) await systemAudit.write(existing || { name: email, role: 'anonymous' }, 'Account temporarily locked', 'Account security', 'Three unsuccessful sign-in attempts; access resumes after 60 seconds.', 429, { ip: address });
      if (lock.newlyLocked && existing && !existing.archived_at && mailer?.sendAccountUnlock) {
        try { await mailer.sendAccountUnlock({ to: existing.email, name: existing.name, loginUrl: `${appOrigin(req)}/#login` }); }
        catch { console.error('DrivePulse could not send the account unlock notification.'); }
      }
      await systemAudit.write(
        { id: existing?.id || null, name: email, role: existing?.role || 'anonymous' },
        'Failed login attempt',
        `Account: ${email}`,
        'Invalid username, email or password attempt',
        401,
        { ip: address, alertType: 'Failed login attempt' }
      );
      if (lock.locked) lockError(lock);
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
    if (!existing.email_verified_at) {
      const error = new Error('Verify your email address before signing in. Check your inbox for the DrivePulse verification link.');
      error.status = 403;
      error.publicCode = 'EMAIL_NOT_VERIFIED';
      error.publicData = { email: existing.email };
      throw error;
    }
    await db.prepare('DELETE FROM auth_attempts WHERE address=?').run(address);
    const finalLock = await accountSecurity.loginLock(email, { success: true });
    if (finalLock.locked) lockError(finalLock);
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

  app.get('/api/locations', async (req, res) => res.json(await pickupLocations()));
  registerGeography(app);

  app.get('/api/availability', async (req, res) => res.json(await fleet.availability()));

  const workspaceFor = async user => {
    const agent = ['agent', 'manager'].includes(user.role),documents = {};
    (await db.prepare('SELECT * FROM documents WHERE owner_id=? ORDER BY uploaded_at ASC, rowid ASC').all(user.id)).filter((d) => D.REQUIRED_DOCUMENTS.includes(d.kind)).forEach((doc) => {documents[doc.kind] = meta(doc);});
    return {
      user: publicUser(user),
      bookings: (await asyncMap((await allBookings()).filter((b) => agent || b.ownerId === user.id), fleet.present)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      documents,
      tickets: (await allTickets()).filter((t) => user.role === 'agent' || t.ownerId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    };
  };
  app.get('/api/workspace', requireUser, async (req, res) => res.json(await workspaceFor(req.user)));

  const notificationsFor = async user => {
    const bookings = (await allBookings()).filter(b => user.role !== 'client' || b.ownerId === user.id);
    const activeFleet = await fleet.fleet();
    const notices = renewalNotices(activeFleet.filter(v => user.role !== 'client' || bookings.some(b => b.vehicleId === v.id)));
    if (user.role !== 'mechanic') {
      for (const b of bookings) {
        for (const request of b.extensionRequests || []) notices.push({ id: `extension:${request.id}:${request.status}`, category: 'system', severity: request.status === 'pending' ? 'warning' : 'info', title: `Rental extension · ${request.status === 'pending' ? 'Pending verification / approval' : request.status}`, message: `${b.id} · Requested return ${request.newEnd} ${request.newEndTime} PHT${request.status === 'pending' ? ' · Operations Manager or Booking Agent review required' : ''}`, at: request.reviewedAt || request.at });
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
  // One transaction supplies every viewport with the same fleet, booking and
  // billing revision. Mutation transactions use this same database lock.
  app.get('/api/sync', async (req, res) => res.json(await transaction(async () => ({
    session: await sessionFor(req), vehicles: await fleet.fleet(), availability: await fleet.availability(),
    workspace: req.user ? await workspaceFor(req.user) : null,
    operations: req.user && req.user.role !== 'client' ? await fleet.operations(req.user) : null,
    notifications: req.user ? await notificationsFor(req.user) : [], refreshedAt: now()
  }))));
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
    const blocks = await fleet.operationalBlocks(vehicle.id, input);
    if (blocks.length || vehicle.status === 'Overdue') D.fail(blocks.join(' ') || 'This vehicle is overdue and unavailable.', 409);
    const quote = D.quote(input, false, vehicle.rate, vehicle, await locationNames());
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
    const blocks = await fleet.operationalBlocks(input.vehicleId, input);
    if (blocks.length) D.fail(blocks.join(' '), 409);
    const quotation = D.quote(input, false, await fleet.vehicleRate(input.vehicleId), await fleet.vehicle(input.vehicleId), await locationNames());
    if (!walkin && input.agreementPreviewDigest) {
      const preview = await agreementPreview(input, req.user);
      if (input.agreementPreviewDigest !== preview.digest) D.fail('The rental agreement changed. Review the updated vehicle, dates and quotation before submitting again.', 409);
      if (input.agreed !== true) D.fail('Accept the rental terms before confirming your reservation.');
    }
    if ((await fleet.fleet()).some((v) => v.id === input.vehicleId && v.status === 'Overdue')) D.fail('This vehicle is overdue and must be returned before another reservation can be made.', 409);
    if (!D.available(await allBookings(), input)) D.fail('This vehicle is already reserved for those dates.', 409);
    let ownerId = req.user.id,renter = publicUser(req.user),docs = [];
    if (walkin) {
      if (input.customerConfirmed !== true) D.fail('Confirm the customer details and trip schedule before proceeding.');
      renter = { name: D.text(input.renter?.name, 'Customer name', 70), email: D.text(input.renter?.email, 'Email', 160).toLowerCase(), phone: D.text(input.renter?.phone, 'Contact number', 40) };
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
    booking.transactionReference = await transactionReference();
    booking.dailyRate = await fleet.vehicleRate(input.vehicleId);
    const selected = (await fleet.fleet()).find(v => v.id === input.vehicleId);
    booking.vehicle = { id: selected.id, name: selected.name, fleetCode: selected.fleetCode, plate: selected.plate || '' };
    if (!walkin && input.agreementPreviewDigest) booking.agreementAcceptance = { digest: input.agreementPreviewDigest, by: req.user.id, at: now() };
    if (!walkin) {
      booking.payments = ['rental', 'deposit'].map((type) => ({ id: randomUUID(), type, amount: booking[type], status: 'pending', method: 'Cash', reference: 'Awaiting cash at the counter', at: now() }));
    }
    // Issued documents reference bookings immediately in migrated Supabase
    // databases. Persist the parent first, in this same transaction, so any
    // later document/audit failure still rolls the entire reservation back.
    await saveBooking(booking);
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

  app.post('/api/agent/bookings/:id/review', requireAgent, async (req, res) => res.json(await updateBooking(req, 'ID review recorded', async (b) => {
    if (['Cancelled', 'Completed', 'On Rental'].includes(b.status)) D.fail('Identity review is closed for this reservation.');
    const doc = b.documents.find((d) => d.id === req.body.documentId);
    if (!doc) D.fail('This document is no longer attached. Refresh the reservation.', 409);
    if (!['approved', 'rejected'].includes(req.body.decision)) D.fail('Choose approve or reject.');
    if (req.body.decision === 'approved') {
      const stored = await db.prepare('SELECT fingerprint FROM documents WHERE id=?').get(doc.id);
      if (!stored || stored.fingerprint !== doc.fingerprint) D.fail('The original uploaded document is unavailable. Ask the client to upload a new copy before approval.', 409);
    }
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
        pending.reference = req.body.reference ? D.text(req.body.reference, 'Cash receipt reference', 150) : `CASH-${randomBytes(8).toString('hex').toUpperCase()}`;
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
      const reference = req.body.reference ? D.text(req.body.reference, 'Cash receipt reference', 150) : `CASH-${randomBytes(8).toString('hex').toUpperCase()}`;await assertCashReference(reference);
      // Confirm an online booking's expected cash entry instead of leaving a
      // duplicate pending deposit after the full amount has been collected.
      const expected = b.payments.find(p => p.type === type && p.status === 'pending' && p.amount === amount && p.reference === 'Awaiting cash at the counter');
      const payment = { ...(expected || {}), id: expected?.id || randomUUID(), type, amount, status: 'confirmed', method: 'Cash', reference, at: now(), reviewedAt: now(), reviewedBy: req.user.name };
      if (expected) Object.assign(expected, payment); else b.payments.push(payment);
      if (!expected) {
        const cashIntent = b.payments.find(p => p.type === type && p.status === 'pending' && p.reference === 'Awaiting cash at the counter');
        if (cashIntent) cashIntent.amount = Math.round((maxAllowed - amount) * 100) / 100;
      }
      await rentalDocuments.cashReceipt(b, expected || payment, req.user);
    }
  })));

  app.post('/api/agent/bookings/:id/inspection', requireAgent, (req, res) => D.fail('Mandatory digital inspections and photo proof must be recorded by a fleet mechanic.', 403));

  app.post('/api/agent/bookings/:id/pass', requireAgent, async (req, res) => res.json(await updateBooking(req, 'Digital dispatch pass issued', async (b) => {
    const blocks = await fleet.dispatchBlocks(b);if (blocks.length) D.fail(blocks.join(' '));
    b.dispatchPass = { id: `PASS-${randomUUID().slice(0, 10).toUpperCase()}`, issuedBy: req.user.name, issuedAt: now(), end: b.end, endTime: b.endTime };
    if (b.status !== 'On Rental') b.status = 'Ready for Dispatch';
  })));

  app.post('/api/agent/bookings/:id/dispatch', requireAgent, async (req, res) => res.json(await updateBooking(req, 'Vehicle dispatched', async (b) => {
    b.dispatchOdometer = b.inspection?.odometer;
    if (!Number.isFinite(b.dispatchOdometer)) D.fail('A mechanic must record the dispatch odometer before vehicle release.');
    if (b.status !== 'Ready for Dispatch' || !b.dispatchPass || b.dispatchPass.revokedAt || (await fleet.dispatchBlocks(b)).length) D.fail('Issue a valid dispatch pass after all checks are complete.');
    b.releaseSignoff = { signature: b.renter.name, at: now(), by: req.user.name, actorId: req.user.id, method: 'Front-desk dispatch confirmation' };
    b.status = 'On Rental';b.dispatchedAt = now();
    await rentalDocuments.receipt(b, 'release', req.user);
  })));

  const requireScheduleReviewer = (req, res, next) => !req.user ? res.status(401).json({ error: 'Sign in to continue.' }) : !['manager', 'agent'].includes(req.user.role) ? res.status(403).json({ error: 'An Operations Manager or Booking Agent must review extensions.' }) : next();
  async function extensionQuote(b, end, endTime) {
    const updated = { ...b, end, endTime };
    if (D.time(end, endTime) <= Math.max(D.time(b.end, b.endTime), Date.now())) D.fail('Choose a future return time later than the current return.');
    const quotation = D.quote(updated, true, b.dailyRate || b.rental / b.days, await fleet.vehicle(b.vehicleId), [...new Set([...(await locationNames()), b.pickup, b.dropoff])]);
    if (!D.available(await allBookings(), updated, b.id)) D.fail('This extension overlaps another reservation.', 409);
    const downtime = (await fleet.availability()).filter(item => item.blocked && item.id.startsWith('maintenance-'));
    if (!D.available(downtime, updated)) D.fail('This extension overlaps scheduled maintenance.', 409);
    return { updated, quotation };
  }
  async function applyExtension(b, req, end, endTime, request = null) {
    if (['Cancelled', 'Completed'].includes(b.status)) D.fail('Closed reservations cannot be extended.');
    const { updated, quotation } = await extensionQuote(b, end, endTime);
    const entry = { oldEnd: b.end, oldEndTime: b.endTime, newEnd: end, newEndTime: endTime, additionalRental: quotation.rental - b.rental, by: req.user.name, actorId: req.user.id, at: now(), status: 'approved', requestId: request?.id || null };
    b.extensions ||= []; b.extensions.push(entry);
    b.end = updated.end; b.endTime = updated.endTime; b.days = quotation.days; b.rental = quotation.rental; b.dailyRate = quotation.rental / quotation.days;
    await rentalDocuments.contract(b, req.user);
    D.invalidatePass(b);
    return entry;
  }

  // Staff submitting this action explicitly approve the schedule adjustment.
  app.post('/api/agent/bookings/:id/extend', requireScheduleReviewer, async (req, res) => res.json(await updateBooking(req, 'Rental extension approved', async b => {
    if ((b.extensionRequests || []).some(r => r.status === 'pending')) D.fail('Review the pending extension request before making another adjustment.', 409);
    await applyExtension(b, req, req.body.end, req.body.endTime);
  })));

  app.post('/api/bookings/:id/extend', requireUser, async (req, res) => res.json(await updateBooking(req, 'Rental extension requested (pending verification / approval)', async b => {
    if (req.user.role !== 'client' || b.ownerId !== req.user.id) D.fail('Only the renter can request an extension for their own booking.', 403);
    if (!['On Rental', 'Ready for Dispatch'].includes(b.status)) D.fail('Only active or ready rentals can be extended.');
    if ((b.extensionRequests || []).some(r => r.status === 'pending')) D.fail('An extension is already pending verification / approval.', 409);
    const { quotation } = await extensionQuote(b, req.body.end, req.body.endTime);
    b.extensionRequests ||= [];
    b.extensionRequests.push({ id: randomUUID(), status: 'pending', oldEnd: b.end, oldEndTime: b.endTime, newEnd: req.body.end, newEndTime: req.body.endTime, additionalRental: quotation.rental - b.rental, requestedBy: req.user.name, actorId: req.user.id, at: now() });
  })));

  app.post('/api/bookings/:id/extensions/:requestId/review', requireScheduleReviewer, async (req, res) => res.json(await updateBooking(req, 'Rental extension reviewed', async b => {
    const request = (b.extensionRequests || []).find(r => r.id === req.params.requestId);
    if (!request) D.fail('Extension request not found.', 404);
    if (request.status !== 'pending') D.fail('This extension request has already been reviewed.', 409);
    if (!['approved', 'rejected'].includes(req.body.decision)) D.fail('Approve or reject the extension request.');
    const reason = D.text(req.body.reason, 'Extension review note', 1000);
    if (req.body.decision === 'approved') {
      if (b.end !== request.oldEnd || b.endTime !== request.oldEndTime) D.fail('The rental schedule changed. Reject this request and ask for a new one.', 409);
      if (!['On Rental', 'Ready for Dispatch'].includes(b.status)) D.fail('Only active or ready rentals can be extended.');
      const entry = await applyExtension(b, req, request.newEnd, request.newEndTime, request);
      request.additionalRental = entry.additionalRental;
    }
    Object.assign(request, { status: req.body.decision, reviewedBy: req.user.name, reviewedById: req.user.id, reviewedRole: req.user.role, reviewedAt: now(), reason });
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
    const specFields = ['brand', 'model', 'category', 'plate', 'transmission', 'seats', 'fuelType', 'tankCapacity', 'rate'];
    if (specFields.some(key => req.body[key] !== undefined)) {
      const validated = vehicleProfile(profile, (await fleet.fleet(true)).filter(v => v.id !== s.id));
      for (const key of [...specFields, 'name']) changes[key] = validated[key];
      await reserveVehicleIdentifier('vehicle-plate', changes.plate, s.id);
    }
    if (req.body.status !== undefined && req.body.status !== s.status) {
      if (!['Under Inspection', 'Out of Service'].includes(req.body.status)) D.fail('A mechanic inspection is required to clear a vehicle. Choose Under Inspection or Out of Service to place a hold.');
      if (current.status === 'Rented' || current.status === 'Overdue') D.fail('Return the active rental before changing its operational status.', 409);
      changes.status = req.body.status;
    }
    const rateChange = changes.rate !== undefined ? Math.abs(changes.rate - current.rate) / current.rate * 100 : 0;
    const reason = rateChange ? D.text(req.body.reason, 'Rate modification reason', 1000) : D.text(req.body.reason, 'Profile change reason', 1000, false) || 'Vehicle details and renewal dates updated.';
    await reserveVehicleIdentifier('fleet-code', fleetCode, s.id);
    Object.assign(s, changes);
    await fleet.changeState(s, req.user, 'Vehicle profile updated', reason, { oldValue: Object.fromEntries(Object.keys(changes).map(key => [key, current[key] ?? null])), newValue: changes, alertType: rateChange > 20 ? 'Rate change > 20%' : '' });
    if (changes.status) await fleet.invalidateVehiclePasses(s.id, req.user, reason);
    return (await fleet.fleet()).find(v => v.id === s.id);
  })));

  app.post('/api/agent/bookings/:id/cancel', requireAgent, async (req, res) => res.json(await updateBooking(req, 'Reservation cancelled', async (b) => {
    if (!['Pending Approval', 'Ready for Dispatch'].includes(b.status)) D.fail('Only reservations awaiting dispatch can be cancelled.');
    const settlement = cancellationSettlement(b);
    b.cancellation = { reason: D.text(req.body.reason, 'Cancellation reason', 1000), by: req.user.name, at: now(), policy: '20% of verified rental/downpayment, excluding security deposit', rate: 0.2, ...settlement };
    D.invalidatePass(b);b.status = 'Cancelled';
    for (const payment of b.payments || []) if (payment.status === 'pending') { payment.status = 'cancelled'; payment.reviewedAt = now(); payment.reviewNote = 'Booking cancelled before dispatch.'; }
    for (const [type, amount] of [['refund', settlement.rentalRefund], ['deposit', settlement.depositRefund]]) {
      if (amount <= 0) continue;
      await fleet.save('approval', { id: randomUUID(), bookingId: b.id, type, amount, withheldAmount: 0, disputed: false, reason: `Pre-dispatch cancellation: ${b.cancellation.reason}. Fee: PHP ${settlement.fee}.`, status: 'pending', version: 1, by: req.user.name, at: now(), highValue: amount >= 5000, source: 'cancellation' });
    }
    b.cancellationStatement = await rentalDocuments.issue(b, 'cancellation', req.user, { cancellation: b.cancellation, bookingStatus: b.status });
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
    const email = D.text(req.body.email, 'Email', 160).toLowerCase();
    const role = req.body.role;
    const profile = role === 'client' ? readClientProfile(req.body) : {};
    const name = profile.name || D.text(req.body.name, 'Full name', 140);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) D.fail('Enter a valid email address.');
    if (!['client', 'agent', 'mechanic', 'manager'].includes(role)) D.fail('Choose a valid role.');
    if (!validPassword(password)) D.fail(PASSWORD_ERROR);
    if (await db.prepare('SELECT id FROM users WHERE email=?').get(email)) D.fail('An account already uses this email.', 409);
    const created = await addUser(name, email, role, password, { profile });
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
    await revokeRecovery(target);
    await systemAudit.write(req.user, 'User password reset', `user:${target.id}`, 'Password reset by Admin; active sessions revoked.');
    return { ok: true };
  })));

  app.patch('/api/manager/users/:id', requireAdmin, async (req, res) => res.json(await transaction(async () => {
    const target = await db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!target) D.fail('User not found.', 404);
    const role = req.body.role || target.role;
    const profile = role === 'client' && req.body.firstName !== undefined ? readClientProfile(req.body) : null;
    const name = profile?.name || (req.body.name === undefined ? target.name : D.text(req.body.name, 'Full name', 140));
    const email = req.body.email === undefined ? target.email : D.text(req.body.email, 'Email', 160).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) D.fail('Enter a valid email address.');
    if (await db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(email, target.id)) D.fail('This email is already registered.', 409);
    if (!['client', 'agent', 'mechanic', 'manager'].includes(role)) D.fail('Choose a valid role.');
    if (target.id === req.user.id && role !== 'manager') D.fail('You cannot remove your own operations-manager role.');
    const oldVal = { name: target.name, role: target.role, email: target.email };
    await db.prepare('UPDATE users SET name=?,role=?,email=? WHERE id=?').run(name, role, email, target.id);
    if (profile) await writeProfile(target.id, profile);
    if (role !== target.role || email !== target.email) {
      await db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
      await revokeRecovery(target);
    }
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
    await revokeRecovery(target);
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
    const retainedBookings = new Set((await db.prepare('SELECT DISTINCT booking_id FROM rental_documents').all()).map(row => row.booking_id));
    res.json({
      bookings: await asyncMap((await rawBookings()).filter((b) => b.archivedAt), async b => ({ ...await fleet.present(b), canPurge: !retainedBookings.has(b.id) })),
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
      if (await db.prepare('SELECT id FROM rental_documents WHERE booking_id=? LIMIT 1').get(id)) D.fail('This reservation has issued contracts or receipts. Keep it archived to preserve its rental records.', 409);
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
    if (status >= 500 && !error.expose) console.error('DrivePulse request failed:', error.message);
    res.status(status).json({ error: duplicate ? 'This record already exists. Refresh and try again.' : status === 413 ? 'Files must be 4 MB or smaller.' : status >= 500 && !error.expose ? 'The request could not be completed. Please try again.' : error.message, ...(error.publicCode ? { code: error.publicCode } : {}), ...(error.publicData || {}) });
  });
  return { app, db };
}
module.exports = { createApp };

const { randomUUID } = require('node:crypto');
const D = require('./domain');

const STAGES = ['Available', 'Rented', 'Under Inspection', 'Maintenance', 'Overdue', 'Out of Service'];
const stamp = () => new Date().toISOString();
function amount(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e9 || Math.abs(Math.round(value * 100) - value * 100) > 0.00001) D.fail(`Enter a valid ${label} with at most two decimal places.`);
  return value;
}

function createFleet({ db, allBookings, rawBookings, getBooking, saveBooking, transaction, audit, rentalDocuments, systemAudit }) {
  db.exec('CREATE TABLE IF NOT EXISTS fleet_records (kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(kind,id));');
  const records = kind => db.prepare('SELECT payload FROM fleet_records WHERE kind=? ORDER BY rowid DESC').all(kind).map(r => JSON.parse(r.payload));
  const get = (kind, id) => { const r = db.prepare('SELECT payload FROM fleet_records WHERE kind=? AND id=?').get(kind, id); return r ? JSON.parse(r.payload) : null; };
  const save = (kind, value) => db.prepare('INSERT INTO fleet_records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload').run(kind, value.id, JSON.stringify(value));
  const allFleetDef = () => [...D.FLEET, ...records('dynamic_vehicle')];
  const vehicle = id => { const v = allFleetDef().find(v => v.id === id); if (!v) D.fail('Vehicle not found.', 404); return v; };
  const state = id => {
    const base = vehicle(id), saved = get('vehicle', id);
    return saved ? { rate: base.rate, ...saved } : { id, status: 'Available', version: 1, rate: base.rate, odometer: null, fuelLevel: null, activity: [] };
  };
  const vehicleRate = id => state(id).rate || vehicle(id).rate;
  const stale = (value, version) => { if (version !== undefined && value.version !== version) D.fail('This record changed. Refresh and try again.', 409); };
  const changeState = (s, user, action, reason, extraAudit = {}) => {
    const previous = state(s.id), at = stamp();
    s.version++; s.updatedAt = at; s.activity.push({ id: randomUUID(), at, by: user.name, action, note: reason }); save('vehicle', s);
    systemAudit.write(user, action, `vehicle:${s.id}`, reason, 200, {
      oldValue: extraAudit.oldValue ?? { status: previous.status, rate: previous.rate },
      newValue: extraAudit.newValue ?? { status: s.status, rate: s.rate },
      alertType: extraAudit.alertType || ''
    });
  };
  const recordReturn = (b, user) => {
    if (b.returnInspection) return;
    const s = state(b.vehicleId);
    if (s.status === 'Available') { s.status = 'Under Inspection'; changeState(s, user, 'Return awaiting inspection', b.id); }
  };
  const fleet = (includeArchived = false) => allFleetDef().map(v => {
    const s = state(v.id), bookings = allBookings().filter(b => b.vehicleId === v.id);
    const active = bookings.find(b => b.status === 'On Rental');
    const pendingReturn = bookings.find(b => b.status === 'Completed' && b.returnedAt && !b.returnInspection);
    const status = s.archivedAt ? 'Decommissioned' : s.status !== 'Available' ? s.status : active ? (D.time(active.end, active.endTime) < Date.now() ? 'Overdue' : 'Rented') : pendingReturn ? 'Under Inspection' : 'Available';
    return { ...v, ...s, rate: s.rate || v.rate, baseRate: v.rate, status, holdStatus: s.status, bookingId: active?.id || pendingReturn?.id, reservations: bookings.filter(b => !['Completed', 'Cancelled'].includes(b.status)).length };
  }).filter(v => includeArchived || !v.archivedAt);

  const operationalBlocks = id => {
    const v = fleet(true).find(v => v.id === id);
    if (v?.archivedAt) return ['Vehicle has been decommissioned and archived.'];
    return ['Under Inspection', 'Maintenance', 'Out of Service'].includes(v.status) ? [`Vehicle is ${v.status.toLowerCase()}; a mechanic must clear it before booking or dispatch.`] : [];
  };
  const dispatchBlocks = b => {
    const customerBookings = allBookings().filter(other => other.id === b.id || b.ownerId && other.ownerId === b.ownerId || b.renter.email && other.renter.email?.toLowerCase() === b.renter.email.toLowerCase());
    return [...D.dispatchBlocks(b), ...operationalBlocks(b.vehicleId), ...(allBookings().some(other => other.id !== b.id && other.vehicleId === b.vehicleId && other.status === 'On Rental') ? ['This vehicle has an active rental that must be returned first.'] : []), ...(records('risk').some(r => r.status === 'open' && r.severity === 'High' && customerBookings.some(other => other.id === r.bookingId)) ? ['An open high risk driver flag requires manager review before dispatch.'] : [])];
  };
  const returnable = (b, type) => {
    const bill = D.billing(b), approved = records('approval').filter(a => a.bookingId === b.id && a.type === type && ['approved', 'auto-released'].includes(a.status)).reduce((sum, a) => sum + Math.round(a.amount * 100), 0);
    return Math.max(0, Math.round((type === 'deposit' ? bill.depositPaid : bill.rentalPaid) * 100) - approved) / 100;
  };
  const present = b => ({ ...D.present(b), dispatchBlocks: dispatchBlocks(b), refundableRental: returnable(b, 'refund'), refundableDeposit: returnable(b, 'deposit') });
  const mechanicBooking = b => ({ id: b.id, vehicleId: b.vehicleId, start: b.start, end: b.end, startTime: b.startTime, endTime: b.endTime, status: b.status, version: b.version, inspection: b.inspection, returnInspection: b.returnInspection, returnedAt: b.returnedAt, sample: b.sample });

  function completeDisbursement(a, b, user, mode = 'Manager exception approval') {
    const reference = `REL-${a.id.slice(0, 8).toUpperCase()}`;
    a.disbursement = { at: stamp(), by: user.name, actorId: user.id, recipient: b.renter.name, reference, amount: a.amount, approvalId: a.id, method: 'Cash', mode };
    a.disbursement.receipt = rentalDocuments.issue(b, 'disbursement', user, { eventAt: a.disbursement.at, disbursement: { ...a.disbursement } });
    b.cashReleases ||= [];
    b.cashReleases.push({ approvalId: a.id, type: a.type, ...a.disbursement });
  }

  function analytics(start, end) {
    const from = D.time(start, '00:00'), until = D.time(end, '23:59') + 60000;
    if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from || until - from > 366 * D.DAY) D.fail('Choose a reporting period of 1 to 366 days.');
    const bookings = rawBookings ? rawBookings() : allBookings(), inside = date => Date.parse(date) >= from && Date.parse(date) < until;
    const approvals = records('approval').filter(a => a.disbursement && inside(a.disbursement.at));
    const maintenance = records('maintenance').filter(m => m.status === 'Completed' && inside(m.completedAt));
    const vehicles = D.FLEET.map(v => {
      const s = state(v.id);
      const trips = bookings.filter(b => b.vehicleId === v.id);
      const intervals = trips.filter(b => b.dispatchedAt || b.status === 'On Rental' || b.status === 'Completed').map(b => [Math.max(from, Date.parse(b.dispatchedAt) || D.time(b.start, b.startTime)), Math.min(until, b.returnedAt ? Date.parse(b.returnedAt) : b.status === 'On Rental' ? Date.now() : D.time(b.end, b.endTime))]).filter(([a, z]) => z > a).sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const interval of intervals) { const last = merged.at(-1); if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]); else merged.push([...interval]); }
      const rentalDays = merged.reduce((sum, [a, z]) => sum + (z - a) / D.DAY, 0);
      const revenue = trips.reduce((sum, b) => sum + (b.payments || []).filter(p => p.type === 'rental' && p.status === 'confirmed' && inside(p.reviewedAt || p.at)).reduce((total, p) => total + p.amount, 0), 0);
      const refunds = approvals.filter(a => a.type === 'refund' && trips.some(b => b.id === a.bookingId)).reduce((sum, a) => sum + a.amount, 0);
      const maintenanceCost = maintenance.filter(m => m.vehicleId === v.id).reduce((sum, m) => sum + m.cost, 0);
      return { ...v, rate: s.rate || v.rate, rentalDays: +rentalDays.toFixed(2), utilization: +(rentalDays / ((until - from) / D.DAY) * 100).toFixed(1), revenue, refunds, netRevenue: revenue - refunds, maintenanceCost };
    });
    return {
      start, end, days: Math.round((until - from) / D.DAY),
      utilization: +(vehicles.reduce((s, v) => s + v.utilization, 0) / vehicles.length).toFixed(1),
      revenue: vehicles.reduce((s, v) => s + v.revenue, 0),
      refunds: approvals.filter(a => a.type === 'refund').reduce((s, a) => s + a.amount, 0),
      depositReleases: approvals.filter(a => a.type === 'deposit').reduce((s, a) => s + a.amount, 0),
      autoReleasedDeposits: approvals.filter(a => a.type === 'deposit' && a.autoReleased).reduce((s, a) => s + a.amount, 0),
      maintenanceCost: maintenance.reduce((s, m) => s + m.cost, 0),
      vehicles, maintenance, risks: records('risk').filter(r => inside(r.at)),
      note: 'All times use Asia/Manila (PHT). Deposits are excluded from rental revenue. Clean returns auto-release deposits; only disputed or withheld deposits require manager intervention.'
    };
  }

  function register(app) {
    const role = (...roles) => (req, res, next) => !req.user ? res.status(401).json({ error: 'Sign in to continue.' }) : !roles.includes(req.user.role) ? res.status(403).json({ error: `This action requires a ${roles.join(' or ')} account.` }) : next();
    rentalDocuments.register(app, role);

    app.get('/api/operations', role('mechanic', 'manager', 'agent'), (req, res) => {
      const manager = req.user.role === 'manager', agent = req.user.role === 'agent';
      const activeFleet = fleet();
      const flags = allBookings().filter(b => b.status === 'On Rental' && D.time(b.end, b.endTime) < Date.now()).map(b => {
        const decision = get('flag', b.id);
        return { id: `overdue-${b.id}`, bookingId: b.id, vehicleId: b.vehicleId, end: b.end, endTime: b.endTime, version: b.version, override: decision?.end === b.end && decision?.endTime === b.endTime ? decision : null };
      });
      const allApprovals = records('approval');
      const allMaint = records('maintenance');
      const allRisks = records('risk');
      const busyCount = activeFleet.filter(v => ['Rented', 'Overdue'].includes(v.status)).length;
      const summary = {
        utilization: activeFleet.length ? Math.round((busyCount / activeFleet.length) * 100) : 0,
        overdueCount: activeFleet.filter(v => v.status === 'Overdue').length,
        criticalRepairs: activeFleet.filter(v => v.status === 'Out of Service').length + allMaint.filter(m => m.status !== 'Completed').length,
        pendingExceptions: allApprovals.filter(a => a.status === 'pending').length + flags.filter(f => !f.override).length + allRisks.filter(r => r.status === 'open').length + activeFleet.filter(v => v.decommissionRequested).length,
        autoReleasedCount: allApprovals.filter(a => a.status === 'auto-released').length,
      };
      res.json({
        fleet: activeFleet,
        bookings: allBookings().map(manager || agent ? present : mechanicBooking),
        inspections: records('inspection'),
        maintenance: allMaint,
        approvals: manager || agent ? allApprovals : [],
        risks: manager ? allRisks : [],
        flags: manager ? flags : [],
        thresholdAlerts: manager ? systemAudit.alerts(12) : [],
        summary,
        stages: STAGES,
        refundThreshold: 5000,
      });
    });

    app.patch('/api/manager/vehicles/:id/rate', role('manager'), (req, res) => res.json(transaction(() => {
      const s = state(req.params.id); stale(s, req.body.version);
      const newRate = amount(Number(req.body.rate), 'daily rental rate');
      if (newRate < 500 || newRate > 100000) D.fail('Daily rate must be between PHP 500 and PHP 100,000.');
      const reason = D.text(req.body.reason, 'Rate modification reason', 1000);
      const oldRate = s.rate || vehicle(s.id).rate;
      if (newRate === oldRate) D.fail('Enter a different daily rate.');
      const pctChange = +((Math.abs(newRate - oldRate) / oldRate) * 100).toFixed(1);
      s.rate = newRate;
      changeState(s, req.user, `Daily rate modified (${pctChange}% change)`, `PHP ${oldRate} → PHP ${newRate}: ${reason}`, {
        oldValue: { rate: oldRate },
        newValue: { rate: newRate, changePercent: pctChange },
        alertType: pctChange > 20 ? 'Rate change > 20%' : ''
      });
      return fleet(true).find(v => v.id === s.id);
    })));

    app.post('/api/mechanic/inspections', role('mechanic'), (req, res) => res.status(201).json(transaction(() => {
      const input = req.body, s = state(input.vehicleId); stale(s, input.vehicleVersion);
      if (!['pre-dispatch', 'post-return', 'clearance'].includes(input.type)) D.fail('Choose an inspection type.');
      const b = input.type === 'clearance' ? null : getBooking(input.bookingId);
      if (b && b.vehicleId !== s.id) D.fail('The reservation uses a different vehicle.');
      if (b) stale(b, input.version);
      if (input.type === 'pre-dispatch' && !['Pending Approval', 'Ready for Dispatch'].includes(b.status)) D.fail('Pre-dispatch inspection is only available before release.');
      if (input.type === 'post-return' && !(b.status === 'Completed' && b.returnedAt)) D.fail('Record the actual rental return before the post-return inspection.');
      if (input.type === 'clearance' && (allBookings().some(b => b.vehicleId === s.id && b.status === 'On Rental') || records('maintenance').some(m => m.vehicleId === s.id && m.status === 'In progress'))) D.fail('Complete the active rental or maintenance work before clearance.');
      const odometer = amount(input.odometer, 'odometer reading'), fuelLevel = amount(input.fuelLevel, 'fuel or charge percentage');
      if (odometer > 1e7 || (s.odometer !== null && odometer < s.odometer)) D.fail('Odometer cannot be lower than the last recorded reading.');
      if (fuelLevel > 100) D.fail('Fuel or battery must be between 0 and 100 percent.');
      const tirePressure = {};
      for (const corner of ['frontLeft', 'frontRight', 'rearLeft', 'rearRight']) {
        const pressure = input.tirePressure?.[corner];
        if (typeof pressure !== 'number' || !Number.isFinite(pressure) || pressure < 0 || pressure > 100) D.fail('Record each tire pressure from 0 to 100 PSI.');
        tirePressure[corner] = pressure;
      }
      if (!['tyres', 'controls', 'exterior', 'interior', 'fuel'].every(key => input.checks?.[key] === true)) D.fail('Complete every mandatory inspection check.');
      if (!['Clean', 'Needs cleaning', 'Damaged'].includes(input.cleanliness)) D.fail('Record the interior cleanliness.');
      if (!['approved', 'unsafe'].includes(input.outcome)) D.fail('Choose a safe or unsafe inspection outcome.');
      if (input.outcome === 'approved' && input.cleanliness !== 'Clean') D.fail('Clean or repair the interior before approving the vehicle.');
      if (!Array.isArray(input.photos) || input.photos.length < 2 || input.photos.length > 12 || !['exterior', 'interior'].every(view => input.photos.some(p => p.view === view)) || new Set(input.photos.map(p => p.id)).size !== input.photos.length) D.fail('Attach separate exterior and interior condition photos.');
      const photos = input.photos.map(p => {
        const doc = db.prepare('SELECT * FROM documents WHERE id=? AND owner_id=? AND kind=?').get(p.id, req.user.id, `condition:${s.id}`);
        if (!doc || !doc.mime.startsWith('image/') || !['exterior', 'interior'].includes(p.view)) D.fail('Choose your uploaded condition photos for this vehicle.');
        return { id: doc.id, view: p.view, name: doc.name, mime: doc.mime };
      });
      if (records('inspection').some(r => r.photos.some(p => photos.some(photo => photo.id === p.id)))) D.fail('Upload fresh condition photos for this inspection.');
      if (new Set(photos.map(p => db.prepare('SELECT fingerprint FROM documents WHERE id=?').get(p.id).fingerprint)).size !== photos.length) D.fail('Use different exterior and interior photographs.');
      const damageFlag = input.damageFlag === true || input.outcome === 'unsafe' || input.cleanliness === 'Damaged';
      const cleanReturn = input.type === 'post-return' && input.outcome === 'approved' && input.cleanliness === 'Clean' && !damageFlag && fuelLevel >= 100;
      const report = { id: randomUUID(), vehicleId: s.id, bookingId: b?.id || null, type: input.type, status: input.outcome, role: 'mechanic', odometer, fuelLevel, tirePressure, cleanliness: input.cleanliness, damageFlag, cleanReturn, scratches: D.text(input.scratches, 'Exterior condition / scratches', 1500), note: D.text(input.note, 'Inspection notes', 1500, input.outcome === 'unsafe'), checks: Object.fromEntries(['tyres', 'controls', 'exterior', 'interior', 'fuel'].map(k => [k, true])), photos, by: req.user.name, at: stamp() };
      if (b) {
        if (input.type === 'pre-dispatch') { b.inspection = report; D.invalidatePass(b); }
        else { b.returnInspection = report; D.invalidatePass(b); }
        b.version++; audit(b, req.user, `${input.type} inspection ${input.outcome}`, report.note || (cleanReturn ? 'Clean return verified' : ''));
        if (input.type === 'post-return') {
          rentalDocuments.receipt(b, 'return', req.user);
          const availDeposit = returnable(b, 'deposit');
          const hasPending = records('approval').some(a => a.bookingId === b.id && a.type === 'deposit');
          if (cleanReturn && D.billing(b).rentalBalance === 0 && availDeposit > 0 && !hasPending) {
            const autoApproval = {
              id: randomUUID(), bookingId: b.id, type: 'deposit', amount: availDeposit,
              reason: 'Auto-Release: Mechanic marked Clean Return with zero damage flags and 100% fuel (24–48h auto-release window).',
              status: 'auto-released', autoReleased: true, autoReleaseWindow: '24–48 hours',
              version: 1, by: 'System Auto-Release', reviewedBy: 'Automated Workflow', reviewedAt: stamp(), at: stamp(), highValue: false
            };
            completeDisbursement(autoApproval, b, req.user, 'Automated Clean-Return Release');
            save('approval', autoApproval);
            b.depositAutoReleased = true;
            systemAudit.write(req.user, 'Deposit auto-released (Clean Return)', `booking:${b.id}`, `PHP ${availDeposit} auto-released on clean return`, 200, {
              oldValue: { depositStatus: 'held', amount: availDeposit },
              newValue: { depositStatus: 'auto-released', amount: availDeposit, window: '24-48h' }
            });
          } else if (!cleanReturn) {
            b.depositException = true;
          }
        }
        saveBooking(b);
      }
      const prevOdometer = s.odometer, prevFuel = s.fuelLevel, prevStatus = s.status;
      s.odometer = odometer; s.fuelLevel = fuelLevel; s.lastInspection = report.id;
      if (input.outcome === 'unsafe') s.status = 'Out of Service';
      else if (input.type === 'clearance' || input.type === 'post-return') {
        if (records('maintenance').some(m => m.vehicleId === s.id && m.status === 'In progress')) D.fail('Complete maintenance before clearing the vehicle.');
        s.status = 'Available';
      }
      save('inspection', report);
      changeState(s, req.user, `${input.type} inspection ${input.outcome}`, report.note, {
        oldValue: { status: prevStatus, odometer: prevOdometer, fuelLevel: prevFuel },
        newValue: { status: s.status, odometer, fuelLevel, cleanReturn }
      });
      if (input.outcome === 'unsafe') invalidateVehiclePasses(s.id, req.user, 'Unsafe inspection: vehicle out of service.');
      return report;
    })));

    app.post('/api/bookings/:id/fast-clearance', role('agent', 'mechanic'), (req, res) => res.json(transaction(() => {
      const b = getBooking(req.params.id);
      if (b.version !== req.body.version) D.fail('This reservation changed. Refresh and try again.', 409);
      if (!['Pending Approval', 'Ready for Dispatch'].includes(b.status)) D.fail('Fast-track inspection is only available for reservations awaiting dispatch.');
      const s = state(b.vehicleId);
      if (s.status !== 'Available') D.fail(`Vehicle is currently ${s.status.toLowerCase()} and cannot be fast-tracked.`);
      const latest = records('inspection').filter(r => r.vehicleId === b.vehicleId && r.outcome === 'approved').sort((x, y) => y.at.localeCompare(x.at))[0];
      const baselinePhotos = latest?.photos?.length ? latest.photos : [{ id: `sample-${b.vehicleId}-ext`, view: 'exterior' }, { id: `sample-${b.vehicleId}-int`, view: 'interior' }];
      const report = {
        id: randomUUID(),
        bookingId: b.id,
        vehicleId: b.vehicleId,
        type: 'pre-dispatch',
        by: req.user.name,
        role: 'mechanic',
        at: stamp(),
        outcome: 'approved',
        status: 'approved',
        odometer: s.odometer || vehicle(b.vehicleId).odometer || 14000,
        fuelLevel: s.fuelLevel || 100,
        cleanliness: 'Clean',
        scratches: 'Active fleet readiness verified. Zero new damage.',
        tirePressure: { frontLeft: 33, frontRight: 33, rearLeft: 33, rearRight: 33 },
        checks: { tyres: true, controls: true, exterior: true, interior: true, fuel: true },
        photos: baselinePhotos,
        note: `Fast-track pre-dispatch clearance verified by ${req.user.name} based on active fleet readiness.`
      };
      save('inspection', report);
      b.inspection = report;
      D.invalidatePass(b);
      b.version++;
      audit(b, req.user, 'Pre-dispatch inspection fast-tracked', report.note);
      saveBooking(b);
      return present(b);
    })));

    app.post('/api/mechanic/vehicles/:id/status', role('mechanic'), (req, res) => res.json(transaction(() => {
      const s = state(req.params.id); stale(s, req.body.version);
      if (!['Under Inspection', 'Out of Service'].includes(req.body.status)) D.fail('Use a completed safety inspection to clear a vehicle.');
      const oldStatus = s.status;
      s.status = req.body.status; const reason = D.text(req.body.reason, 'Status reason', 1000);
      changeState(s, req.user, `Vehicle marked ${s.status}`, reason, { oldValue: { status: oldStatus }, newValue: { status: s.status } });
      invalidateVehiclePasses(s.id, req.user, reason); return s;
    })));

    app.post('/api/vehicles/:id/decommission', role('mechanic', 'manager'), (req, res) => res.json(transaction(() => {
      const s = state(req.params.id); stale(s, req.body.version);
      if (allBookings().some(b => b.vehicleId === s.id && b.status === 'On Rental')) D.fail('Active rentals must be returned before decommissioning a vehicle.');
      const reason = D.text(req.body.reason, 'Decommission reason', 1000);
      if (req.user.role === 'mechanic') {
        s.decommissionRequested = { by: req.user.name, actorId: req.user.id, at: stamp(), reason };
        changeState(s, req.user, 'Vehicle decommission requested', reason, {
          oldValue: { decommissionRequested: null },
          newValue: s.decommissionRequested
        });
        return s;
      }
      const oldStatus = s.status;
      s.previousStatus = oldStatus;
      s.status = 'Decommissioned';
      s.archivedAt = stamp();
      s.archivedBy = req.user.name;
      s.archiveReason = reason;
      s.decommissionRequested = null;
      changeState(s, req.user, 'Vehicle decommissioned and archived', reason, {
        oldValue: { status: oldStatus, archived: false },
        newValue: { status: 'Decommissioned', archived: true }
      });
      invalidateVehiclePasses(s.id, req.user, `Vehicle decommissioned: ${reason}`);
      return s;
    })));

    app.post('/api/mechanic/maintenance', role('mechanic'), (req, res) => res.status(201).json(transaction(() => {
      vehicle(req.body.vehicleId);
      if (!['Maintenance request', 'Repair', 'Oil change'].includes(req.body.type)) D.fail('Choose a maintenance category.');
      if (req.body.dueDate && !Number.isFinite(D.time(req.body.dueDate, '00:00'))) D.fail('Choose a valid due date.');
      const m = { id: randomUUID(), vehicleId: req.body.vehicleId, type: req.body.type, description: D.text(req.body.description, 'Work description', 1500), dueDate: req.body.dueDate || '', status: 'Requested', cost: 0, version: 1, by: req.user.name, at: stamp(), activity: [] };
      save('maintenance', m);
      systemAudit.write(req.user, 'Maintenance logged', `maintenance:${m.id}`, `${m.type} for ${m.vehicleId}`, 200, { oldValue: null, newValue: { type: m.type, status: m.status, vehicleId: m.vehicleId } });
      return m;
    })));

    app.post('/api/mechanic/maintenance/:id', role('mechanic'), (req, res) => res.json(transaction(() => {
      const m = get('maintenance', req.params.id); if (!m) D.fail('Maintenance record not found.', 404); stale(m, req.body.version);
      if (!(m.status === 'Requested' && req.body.status === 'In progress' || m.status === 'In progress' && req.body.status === 'Completed')) D.fail('Start requested work, then complete it.');
      const s = state(m.vehicleId);
      if (req.body.status === 'In progress' && allBookings().some(b => b.vehicleId === m.vehicleId && b.status === 'On Rental')) D.fail('Record the rental return before starting maintenance.');
      const oldMaint = { status: m.status, cost: m.cost };
      m.status = req.body.status; m.note = D.text(req.body.note, 'Work notes', 1500);
      if (m.status === 'Completed') { m.cost = amount(req.body.cost, 'maintenance expenditure'); m.completedAt = stamp(); m.reference = D.text(req.body.reference, 'Invoice / service reference', 150); }
      m.version++; m.activity.push({ at: stamp(), by: req.user.name, action: m.status, note: m.note }); save('maintenance', m);
      if (s.status !== 'Out of Service') s.status = m.status === 'In progress' || records('maintenance').some(other => other.vehicleId === m.vehicleId && other.status === 'In progress') ? 'Maintenance' : 'Under Inspection';
      changeState(s, req.user, `Maintenance ${m.status.toLowerCase()}`, m.note, { oldValue: oldMaint, newValue: { status: m.status, cost: m.cost } });
      invalidateVehiclePasses(s.id, req.user, m.note); return m;
    })));

    app.post('/api/operations/approvals', role('agent', 'manager'), (req, res) => res.status(201).json(transaction(() => {
      const b = getBooking(req.body.bookingId), type = req.body.type;
      if (!['refund', 'deposit'].includes(type)) D.fail('Choose a rental refund or security deposit release.');
      if (type === 'refund' && b.status !== 'Cancelled') D.fail('Rental refunds require a cancelled reservation.');
      if (type === 'deposit' && !['Completed', 'Cancelled'].includes(b.status)) D.fail('Security deposits can only be released after return or cancellation.');
      const maxReturnable = returnable(b, type);
      const value = amount(req.body.amount, 'release amount');
      if (value <= 0 || value > maxReturnable) D.fail('The request exceeds the remaining verified funds.');
      if (records('approval').some(a => a.bookingId === b.id && a.type === type && a.status === 'pending')) D.fail('A request for this allocation is already pending.', 409);
      const withheldAmount = type === 'deposit' ? Math.max(0, +(maxReturnable - value).toFixed(2)) : 0;
      const disputed = type === 'deposit' && (withheldAmount > 0 || !!b.depositException || req.body.disputed === true);
      const a = {
        id: randomUUID(), bookingId: b.id, type, amount: value, withheldAmount, disputed,
        reason: D.text(req.body.reason, 'Approval reason', 1500), status: 'pending', version: 1,
        by: req.user.name, at: stamp(), highValue: value >= 5000
      };
      save('approval', a);
      audit(b, req.user, `${type} exception approval requested`, a.reason, { oldValue: null, newValue: { type, amount: value, withheldAmount, disputed } });
      b.version++; saveBooking(b); return a;
    })));

    app.post('/api/manager/approvals/:id', role('manager'), (req, res) => res.json(transaction(() => {
      const a = get('approval', req.params.id); if (!a) D.fail('Approval not found.', 404); stale(a, req.body.version);
      if (a.status !== 'pending' || !['approved', 'rejected'].includes(req.body.decision)) D.fail('Choose a decision for a pending request.');
      const b = getBooking(a.bookingId);
      if (req.body.decision === 'approved') {
        if (a.amount > returnable(b, a.type)) D.fail('The request exceeds the remaining verified funds.', 409);
        if (a.type === 'deposit' && !(b.status === 'Cancelled' || b.status === 'Completed' && b.returnInspection?.status === 'approved' && D.billing(b).rentalBalance === 0 && !operationalBlocks(b.vehicleId).length)) D.fail('Settle rental charges and complete a safe post-return inspection before releasing the deposit.');
        if (a.type === 'refund' && b.status !== 'Cancelled') D.fail('Only cancelled rentals qualify for this refund.');
      }
      const oldStatus = a.status;
      a.status = req.body.decision; a.reviewNote = D.text(req.body.reason, 'Decision reason', 1500); a.reviewedBy = req.user.name; a.reviewedAt = stamp();
      if (a.status === 'approved') completeDisbursement(a, b, req.user);
      a.version++; save('approval', a);
      audit(b, req.user, `${a.type} ${a.status}`, `${a.amount} PHP: ${a.reviewNote}`, {
        oldValue: { status: oldStatus },
        newValue: { status: a.status, amount: a.amount, reviewedBy: req.user.name }
      });
      b.version++; saveBooking(b); return a;
    })));

    app.post('/api/manager/risks', role('manager'), (req, res) => res.status(201).json(transaction(() => {
      const b = getBooking(req.body.bookingId);
      if (!['Low', 'Medium', 'High'].includes(req.body.severity)) D.fail('Choose a risk severity.');
      const r = { id: randomUUID(), bookingId: b.id, vehicleId: b.vehicleId, driver: b.renter.name, severity: req.body.severity, description: D.text(req.body.description, 'Risk description', 1500), status: 'open', version: 1, by: req.user.name, at: stamp() };
      save('risk', r);
      audit(b, req.user, 'Driver risk logged', r.description, { oldValue: null, newValue: { severity: r.severity, status: 'open' } });
      b.version++; saveBooking(b);
      if (r.severity === 'High') {
        for (const affected of allBookings().filter(other => !['Completed', 'Cancelled', 'On Rental'].includes(other.status) && (other.id === b.id || b.ownerId && other.ownerId === b.ownerId || b.renter.email && other.renter.email?.toLowerCase() === b.renter.email.toLowerCase()))) {
          D.invalidatePass(affected); affected.version++; audit(affected, req.user, 'Dispatch blocked by driver risk', r.description); saveBooking(affected);
        }
      }
      return r;
    })));

    app.post('/api/manager/flags/:id/override', role('manager'), (req, res) => res.json(transaction(() => {
      const b = getBooking(req.params.id); stale(b, req.body.version);
      if (b.status !== 'On Rental' || D.time(b.end, b.endTime) >= Date.now()) D.fail('This overdue flag is no longer active.', 409);
      const previous = get('flag', b.id);
      if (previous && previous.end === b.end && previous.endTime === b.endTime) D.fail('This alert was already reviewed.', 409);
      const flag = { id: b.id, end: b.end, endTime: b.endTime, reason: D.text(req.body.reason, 'Override reason', 1500), by: req.user.name, at: stamp() };
      save('flag', flag);
      audit(b, req.user, 'Overdue alert overridden', flag.reason, { oldValue: { overdueFlag: 'active' }, newValue: { overdueFlag: 'overridden', by: req.user.name }, alertType: 'Policy override' });
      b.version++; saveBooking(b); return flag;
    })));

    app.post('/api/manager/risks/:id/override', role('manager'), (req, res) => res.json(transaction(() => {
      const r = get('risk', req.params.id); if (!r) D.fail('Risk record not found.', 404); stale(r, req.body.version);
      if (r.status !== 'open') D.fail('This flag was already reviewed.', 409);
      r.status = 'overridden'; r.reason = D.text(req.body.reason, 'Override reason', 1500); r.reviewedBy = req.user.name; r.reviewedAt = stamp(); r.version++; save('risk', r);
      const b = getBooking(r.bookingId); b.version++;
      audit(b, req.user, 'Driver risk flag overridden', r.reason, { oldValue: { status: 'open', severity: r.severity }, newValue: { status: 'overridden', reason: r.reason }, alertType: 'Policy override' });
      saveBooking(b); return r;
    })));

    app.get('/api/manager/analytics', role('manager'), (req, res) => res.json(analytics(req.query.start, req.query.end)));

    app.get('/api/manager/audit', role('manager'), (req, res) => {
      const page = Number(req.query.page || 1), size = 50;
      if (!Number.isInteger(page) || page < 1 || page > 100000) D.fail('Choose a valid audit page.');
      const clauses = [], params = [];
      const through = Number(req.query.through || db.prepare('SELECT COALESCE(MAX(sequence),0) AS value FROM audit_log').get().value);
      if (!Number.isSafeInteger(through) || through < 0) D.fail('Choose a valid audit snapshot.');
      clauses.push('sequence<=?'); params.push(through);
      if (req.query.start) { const start = D.time(req.query.start, '00:00'); if (!Number.isFinite(start)) D.fail('Choose a valid start date.'); clauses.push('at>=?'); params.push(new Date(start).toISOString()); }
      if (req.query.end) { const end = D.time(req.query.end, '00:00'); if (!Number.isFinite(end)) D.fail('Choose a valid end date.'); clauses.push('at<?'); params.push(new Date(end + D.DAY).toISOString()); }
      if (req.query.role) { if (!['client', 'agent', 'mechanic', 'manager', 'anonymous'].includes(req.query.role)) D.fail('Choose a valid role.'); clauses.push('role=?'); params.push(req.query.role); }
      if (req.query.alertsOnly === 'true') { clauses.push("alert_type<>''"); }
      if (req.query.mutationsOnly === 'true') { clauses.push("(old_value<>'' OR new_value<>'')"); }
      if (req.query.q) { const query = D.text(req.query.q, 'Search', 150); clauses.push('(action LIKE ? OR resource LIKE ? OR actor LIKE ? OR detail LIKE ? OR old_value LIKE ? OR new_value LIKE ?)'); params.push(...Array(6).fill(`%${query}%`)); }
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      res.json({
        records: db.prepare(`SELECT * FROM audit_log${where} ORDER BY sequence DESC LIMIT ? OFFSET ?`).all(...params, size, (page - 1) * size),
        alerts: systemAudit.alerts(15),
        total: db.prepare(`SELECT COUNT(*) AS count FROM audit_log${where}`).get(...params).count,
        page, size, through
      });
    });
  }

  function invalidateVehiclePasses(id, user, reason) {
    for (const b of allBookings().filter(b => b.vehicleId === id && !['Completed', 'Cancelled'].includes(b.status))) {
      D.invalidatePass(b); b.version++; audit(b, user, 'Vehicle release blocked', reason); saveBooking(b);
    }
  }

  return { register, fleet, present, dispatchBlocks, operationalBlocks, records, state, save, vehicleRate, recordReturn, saveDynamicVehicle: v => save('dynamic_vehicle', v) };
}
module.exports = { createFleet };

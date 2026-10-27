const { asyncMap } = require('./asyncCollections');
const { randomUUID } = require('node:crypto');
const D = require('./domain');
const inspectionChecklist = require('../shared/inspectionChecklist.json');
const { normalizeConditions, conditionProblem } = require('../shared/inspection.mjs');
const { renewalNotices } = require('./vehicleProfile');
const { mileageConsumption } = require('../shared/mileage.mjs');

const STAGES = ['Available', 'Rented', 'Under Inspection', 'Maintenance', 'Overdue', 'Out of Service'];
const stamp = () => new Date().toISOString();
function amount(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e9 || Math.abs(Math.round(value * 100) - value * 100) > 0.00001) D.fail(`Enter a valid ${label} with at most two decimal places.`);
  return value;
}

function createFleet({ db, allBookings, rawBookings, getBooking, saveBooking, transaction, audit, rentalDocuments, systemAudit }) {
  const records = async (kind) => (await db.prepare('SELECT payload FROM fleet_records WHERE kind=? ORDER BY rowid DESC').all(kind)).map((r) => JSON.parse(r.payload));
  const get = async (kind, id) => {const r = await db.prepare('SELECT payload FROM fleet_records WHERE kind=? AND id=?').get(kind, id);return r ? JSON.parse(r.payload) : null;};
  const save = async (kind, value) => await db.prepare('INSERT INTO fleet_records(kind,id,payload) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload').run(kind, value.id, JSON.stringify(value));
  const allFleetDef = async () => [...D.FLEET, ...(await records('dynamic_vehicle'))];
  const vehicle = async (id) => {const v = (await allFleetDef()).find((v) => v.id === id);if (!v) D.fail('Vehicle not found.', 404);return v;};
  const state = async (id) => {
    const base = await vehicle(id),saved = await get('vehicle', id);
    return saved ? { rate: base.rate, ...saved } : { id, status: 'Available', version: 1, rate: base.rate, odometer: base.mileage ?? null, fuelLevel: null, activity: [] };
  };
  const vehicleRate = async (id) => (await state(id)).rate || (await vehicle(id)).rate;
  const initializePlates = () => transaction(async () => {
    const definitions = await allFleetDef(), saved = await records('vehicle');
    const known = new Set(D.FLEET.map(vehicle => vehicle.id));
    const used = new Set([
      ...saved.map(vehicle => vehicle.plate),
      ...definitions.filter(vehicle => !known.has(vehicle.id)).map(vehicle => vehicle.plate)
    ].filter(Boolean).map(plate => plate.replace(/[^a-z0-9]/gi, '').toUpperCase()));
    for (const definition of D.FLEET) {
      const current = saved.find(vehicle => vehicle.id === definition.id);
      if (current?.plate) continue;
      let plate = definition.plate, suffix = 2000;
      while (used.has(plate.replace(/[^a-z0-9]/gi, '').toUpperCase())) plate = `NDP ${suffix++}`;
      used.add(plate.replace(/[^a-z0-9]/gi, '').toUpperCase());
      const updated = current || await state(definition.id);
      updated.plate = plate;
      if (current) updated.version += 1;
      await save('vehicle', updated);
    }
  });
  const stale = (value, version) => {if (version !== undefined && value.version !== version) D.fail('This record changed. Refresh and try again.', 409);};
  const changeState = async (s, user, action, reason, extraAudit = {}) => {
    const previous = await state(s.id),at = stamp();
    s.version++;s.updatedAt = at;s.activity.push({ id: randomUUID(), at, by: user.name, action, note: reason });await save('vehicle', s);
    await systemAudit.write(user, action, `vehicle:${s.id}`, reason, 200, {
      oldValue: extraAudit.oldValue ?? { status: previous.status, rate: previous.rate },
      newValue: extraAudit.newValue ?? { status: s.status, rate: s.rate },
      alertType: extraAudit.alertType || ''
    });
  };
  const recordReturn = async (b, user) => {
    if (b.returnInspection) return;
    const s = await state(b.vehicleId);
    if (s.status === 'Available') {s.status = 'Under Inspection';await changeState(s, user, 'Return awaiting inspection', b.id);}
  };
  const fleet = async (includeArchived = false) => (await asyncMap(await allFleetDef(), async (v) => {
    const s = await state(v.id),bookings = (await allBookings()).filter((b) => b.vehicleId === v.id);
    const active = bookings.find((b) => b.status === 'On Rental');
    const pendingReturn = bookings.find((b) => b.status === 'Completed' && b.returnedAt && !b.returnInspection);
    const status = s.archivedAt ? 'Decommissioned' : s.status !== 'Available' ? s.status : active ? D.time(active.end, active.endTime) < Date.now() ? 'Overdue' : 'Rented' : pendingReturn ? 'Under Inspection' : 'Available';
    return { ...v, fleetCode: v.fleetCode || `CAR-${String(D.FLEET.findIndex(x => x.id === v.id) + 1).padStart(5, '0')}`, ...s, image: s.imageId || v.imageId ? `/api/vehicle-images/${s.imageId || v.imageId}` : v.image, rate: s.rate || v.rate, baseRate: v.rate, status, holdStatus: s.status, bookingId: active?.id || pendingReturn?.id, reservations: bookings.filter((b) => !['Completed', 'Cancelled'].includes(b.status)).length };
  })).filter((v) => includeArchived || !v.archivedAt);

  const availability = async () => {
    const bookings = await allBookings(), vehicles = await fleet(true);
    const openMaintenance = (await records('maintenance')).filter(item => !item.archivedAt && item.status !== 'Completed');
    const maintenance = openMaintenance.filter(item => item.start && item.end);
    const scheduled = maintenance.map(item => ({ id: `maintenance-${item.id}`, vehicleId: item.vehicleId, status: 'Maintenance', blocked: true, start: item.start, startTime: item.startTime, end: item.end, endTime: item.endTime }));
    const holds = vehicles.filter(v => v.archivedAt || ['Under Inspection', 'Maintenance', 'Out of Service', 'Overdue'].includes(v.status)).flatMap(v => {
      // A known maintenance window is reservable before and after its interval.
      // An overdue work order or an undated safety hold needs manual clearance.
      const windows = openMaintenance.filter(item => item.vehicleId === v.id && item.status === 'In progress');
      if (!v.archivedAt && v.status === 'Maintenance' && windows.length && windows.every(item => item.start && item.end && D.time(item.end, item.endTime) > Date.now())) return [];
      return [{ id: `hold-${v.id}`, vehicleId: v.id, status: v.archivedAt ? 'Decommissioned' : v.status, blocked: true }];
    });
    return [...bookings.map(({ id, vehicleId, start, end, startTime, endTime, status }) => ({ id, vehicleId, start, end, startTime, endTime, status })), ...scheduled, ...holds];
  };
  const operationalBlocks = async (id, dates) => {
    const holds = (await availability()).filter(item => item.vehicleId === id && item.blocked);
    return holds.filter(item => dates ? !D.available([item], { ...dates, vehicleId: id }) : (!item.start || D.time(item.start, item.startTime) <= Date.now()) && (!item.end || D.time(item.end, item.endTime) > Date.now())).map(item => `Vehicle is ${item.status.toLowerCase()} during this period; a mechanic must clear it before dispatch.`);
  };
  const dispatchBlocks = async (b) => {
    const customerBookings = (await allBookings()).filter((other) => other.id === b.id || b.ownerId && other.ownerId === b.ownerId || b.renter.email && other.renter.email?.toLowerCase() === b.renter.email.toLowerCase());
    return [...D.dispatchBlocks(b), ...(await operationalBlocks(b.vehicleId)), ...((await allBookings()).some((other) => other.id !== b.id && other.vehicleId === b.vehicleId && other.status === 'On Rental') ? ['This vehicle has an active rental that must be returned first.'] : []), ...((await records('risk')).some((r) => r.status === 'open' && r.severity === 'High' && customerBookings.some((other) => other.id === r.bookingId)) ? ['An open high risk driver flag requires manager review before dispatch.'] : [])];
  };
  const returnable = async (b, type) => {
    const bill = D.billing(b),approved = (await records('approval')).filter((a) => a.bookingId === b.id && a.type === type && ['approved', 'auto-released'].includes(a.status)).reduce((sum, a) => sum + Math.round(a.amount * 100), 0);
    const allocation = b.status === 'Cancelled' ? type === 'deposit' ? bill.depositRefund : bill.rentalRefund : type === 'deposit' ? bill.depositPaid : bill.rentalPaid;
    return Math.max(0, Math.round(allocation * 100) - approved) / 100;
  };
  const present = async (b) => {
    const refundableRental = await returnable(b, 'refund'), refundableDeposit = await returnable(b, 'deposit');
    return { ...D.present(b), ...(b.cancellation ? { cancellation: { ...b.cancellation, refundOutstanding: +(refundableRental + refundableDeposit).toFixed(2), refundStatus: refundableRental + refundableDeposit > 0 ? 'Pending cash release' : b.cancellation.refundDue > 0 ? 'Released' : 'No refund due' } } : {}), dispatchBlocks: await dispatchBlocks(b), refundableRental, refundableDeposit };
  };
  const mechanicBooking = (b) => ({ id: b.id, vehicleId: b.vehicleId, start: b.start, end: b.end, startTime: b.startTime, endTime: b.endTime, status: b.status, version: b.version, inspection: b.inspection, dispatchOdometer: b.dispatchOdometer, mileageConsumption: b.mileageConsumption, returnInspection: b.returnInspection, returnedAt: b.returnedAt, sample: b.sample, driverName: b.renter?.name, verificationStatus: D.verification(b) });

  async function completeDisbursement(a, b, user, mode = 'Manager exception approval') {
    const reference = `REL-${a.id.slice(0, 8).toUpperCase()}`;
    a.disbursement = { at: stamp(), by: user.name, actorId: user.id, recipient: b.renter.name, reference, amount: a.amount, approvalId: a.id, method: 'Cash', mode };
    a.disbursement.receipt = await rentalDocuments.issue(b, 'disbursement', user, { eventAt: a.disbursement.at, disbursement: { ...a.disbursement } });
    b.cashReleases ||= [];
    b.cashReleases.push({ approvalId: a.id, type: a.type, ...a.disbursement });
  }

  async function analytics(start, end) {
    const from = D.time(start, '00:00'),until = D.time(end, '23:59') + 60000;
    if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from || until - from > 366 * D.DAY) D.fail('Choose a reporting period of 1 to 366 days.');
    const bookings = rawBookings ? await rawBookings() : await allBookings(),inside = (date) => Date.parse(date) >= from && Date.parse(date) < until;
    const approvals = (await records('approval')).filter((a) => a.disbursement && inside(a.disbursement.at));
    const maintenance = (await records('maintenance')).filter((m) => m.status === 'Completed' && inside(m.completedAt));
    const vehicles = await asyncMap(await allFleetDef(), async (v) => {
      const s = await state(v.id);
      const trips = bookings.filter((b) => b.vehicleId === v.id);
      const intervals = trips.filter((b) => b.dispatchedAt || b.status === 'On Rental' || b.status === 'Completed').map((b) => [Math.max(from, Date.parse(b.dispatchedAt) || D.time(b.start, b.startTime)), Math.min(until, b.returnedAt ? Date.parse(b.returnedAt) : b.status === 'On Rental' ? Date.now() : D.time(b.end, b.endTime))]).filter(([a, z]) => z > a).sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const interval of intervals) {const last = merged.at(-1);if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);else merged.push([...interval]);}
      const rentalDays = merged.reduce((sum, [a, z]) => sum + (z - a) / D.DAY, 0);
      const revenue = trips.reduce((sum, b) => sum + (b.payments || []).filter((p) => p.type === 'rental' && p.status === 'confirmed' && inside(p.reviewedAt || p.at)).reduce((total, p) => total + p.amount, 0), 0);
      const refunds = approvals.filter((a) => a.type === 'refund' && trips.some((b) => b.id === a.bookingId)).reduce((sum, a) => sum + a.amount, 0);
      const maintenanceCost = maintenance.filter((m) => m.vehicleId === v.id).reduce((sum, m) => sum + m.cost, 0);
      return { ...v, fleetCode: s.fleetCode || v.fleetCode || `CAR-${String(D.FLEET.findIndex(x => x.id === v.id) + 1).padStart(5, '0')}`, rate: s.rate || v.rate, rentalDays: +rentalDays.toFixed(2), utilization: +(rentalDays / ((until - from) / D.DAY) * 100).toFixed(1), revenue, refunds, netRevenue: revenue - refunds, maintenanceCost };
    });
    return {
      start, end, days: Math.round((until - from) / D.DAY),
      utilization: +(vehicles.reduce((s, v) => s + v.utilization, 0) / vehicles.length).toFixed(1),
      revenue: vehicles.reduce((s, v) => s + v.revenue, 0),
      refunds: approvals.filter((a) => a.type === 'refund').reduce((s, a) => s + a.amount, 0),
      depositReleases: approvals.filter((a) => a.type === 'deposit').reduce((s, a) => s + a.amount, 0),
      autoReleasedDeposits: approvals.filter((a) => a.type === 'deposit' && a.autoReleased).reduce((s, a) => s + a.amount, 0),
      maintenanceCost: maintenance.reduce((s, m) => s + m.cost, 0),
      vehicles, maintenance, risks: (await records('risk')).filter((r) => inside(r.at)),
      note: 'All times use Asia/Manila (PHT). Deposits are excluded from rental revenue. Clean returns auto-release deposits; only disputed or withheld deposits require manager intervention.'
    };
  }

  const operations = async user => {
      const manager = user.role === 'manager',agent = user.role === 'agent';
      const activeFleet = await fleet();
      const flags = await asyncMap((await allBookings()).filter((b) => b.status === 'On Rental' && D.time(b.end, b.endTime) < Date.now()), async (b) => {
        const decision = await get('flag', b.id);
        return { id: `overdue-${b.id}`, bookingId: b.id, vehicleId: b.vehicleId, end: b.end, endTime: b.endTime, version: b.version, override: decision?.end === b.end && decision?.endTime === b.endTime ? decision : null };
      });
      const allApprovals = await records('approval');
      const allMaint = await records('maintenance');
      const allRisks = await records('risk');
      const busyCount = activeFleet.filter((v) => ['Rented', 'Overdue'].includes(v.status)).length;
      const summary = {
        utilization: activeFleet.length ? Math.round(busyCount / activeFleet.length * 100) : 0,
        overdueCount: activeFleet.filter((v) => v.status === 'Overdue').length,
        criticalRepairs: activeFleet.filter((v) => v.status === 'Out of Service').length + allMaint.filter((m) => m.status !== 'Completed').length,
        pendingExceptions: allApprovals.filter((a) => a.status === 'pending').length + flags.filter((f) => !f.override).length + allRisks.filter((r) => r.status === 'open').length + activeFleet.filter((v) => v.decommissionRequested).length,
        autoReleasedCount: allApprovals.filter((a) => a.status === 'auto-released').length
      };
      return {
        fleet: activeFleet,
        bookings: await asyncMap(await allBookings(), manager || agent ? present : mechanicBooking),
        inspections: await records('inspection'),
        maintenance: allMaint,
        approvals: manager || agent ? allApprovals : [],
        risks: manager ? allRisks : [],
        flags: manager ? flags : [],
        thresholdAlerts: manager ? await systemAudit.alerts(12) : [],
        renewalNotices: renewalNotices(activeFleet),
        summary,
        stages: STAGES,
        refundThreshold: 5000
      };
  };

  function register(app) {
    const role = (...roles) => (req, res, next) => !req.user ? res.status(401).json({ error: 'Sign in to continue.' }) : !roles.includes(req.user.role) ? res.status(403).json({ error: `This action requires a ${roles.join(' or ')} account.` }) : next();
    rentalDocuments.register(app, role);

    app.get('/api/operations', role('mechanic', 'manager', 'agent'), async (req, res) => res.json(await operations(req.user)));

    app.patch('/api/manager/vehicles/:id/rate', role('manager'), async (req, res) => res.json(await transaction(async () => {
      const s = await state(req.params.id);stale(s, req.body.version);
      const newRate = amount(Number(req.body.rate), 'daily rental rate');
      if (newRate < 500 || newRate > 100000) D.fail('Daily rate must be between PHP 500 and PHP 100,000.');
      const reason = D.text(req.body.reason, 'Rate modification reason', 1000);
      const oldRate = s.rate || (await vehicle(s.id)).rate;
      if (newRate === oldRate) D.fail('Enter a different daily rate.');
      const pctChange = +(Math.abs(newRate - oldRate) / oldRate * 100).toFixed(1);
      s.rate = newRate;
      await changeState(s, req.user, `Daily rate modified (${pctChange}% change)`, `PHP ${oldRate} → PHP ${newRate}: ${reason}`, {
        oldValue: { rate: oldRate },
        newValue: { rate: newRate, changePercent: pctChange },
        alertType: pctChange > 20 ? 'Rate change > 20%' : ''
      });
      return (await fleet(true)).find((v) => v.id === s.id);
    })));

    app.post('/api/mechanic/inspections', role('mechanic'), async (req, res) => res.status(201).json(await transaction(async () => {
      const input = req.body,s = await state(input.vehicleId);stale(s, input.vehicleVersion);
      if (!['pre-dispatch', 'post-return', 'clearance'].includes(input.type)) D.fail('Choose an inspection type.');
      const b = input.type === 'clearance' ? null : await getBooking(input.bookingId);
      if (b && b.vehicleId !== s.id) D.fail('The reservation uses a different vehicle.');
      if (b) stale(b, input.version);
      if (input.type === 'pre-dispatch' && !['Pending Approval', 'Ready for Dispatch'].includes(b.status)) D.fail('Pre-dispatch inspection is only available before release.');
      if (input.type === 'post-return' && !(b.status === 'Completed' && b.returnedAt)) D.fail('Record the actual rental return before the post-return inspection.');
      if (input.type === 'clearance' && ((await allBookings()).some((b) => b.vehicleId === s.id && b.status === 'On Rental') || (await records('maintenance')).some((m) => m.vehicleId === s.id && m.status === 'In progress'))) D.fail('Complete the active rental or maintenance work before clearance.');
      if (input.type === 'clearance' && (await allBookings()).some(booking => booking.vehicleId === s.id && booking.status === 'Completed' && booking.returnedAt && !booking.returnInspection)) D.fail('Complete the post-return inspection and mileage calculation before safety clearance.');
      const odometer = amount(input.odometer, 'odometer reading'),fuelLevel = amount(input.fuelLevel, 'fuel or charge percentage');
      if (odometer > 1e7 || s.odometer !== null && odometer < s.odometer) D.fail('Odometer cannot be lower than the last recorded reading.');
      const dispatchOdometer = input.type === 'post-return' ? b.dispatchOdometer ?? b.inspection?.odometer : null;
      let tripMileage = null;
      if (input.type === 'post-return') {
        try { tripMileage = mileageConsumption(dispatchOdometer, odometer); } catch (error) { D.fail(error.message); }
      }
      if (fuelLevel > 100) D.fail('Fuel or battery must be between 0 and 100 percent.');
      const tirePressure = {};
      for (const corner of ['frontLeft', 'frontRight', 'rearLeft', 'rearRight']) {
        const pressure = input.tirePressure?.[corner];
        if (typeof pressure !== 'number' || !Number.isFinite(pressure) || pressure < 0 || pressure > 100) D.fail('Record each tire pressure from 0 to 100 PSI.');
        tirePressure[corner] = pressure;
      }
      const checks = normalizeConditions(input.checks, inspectionChecklist);
      const conditionError = conditionProblem(checks, inspectionChecklist, input.outcome);
      if (conditionError) D.fail(conditionError);
      if (input.driverVerification !== (input.type === 'clearance' ? 'not-applicable' : 'matched')) D.fail('Complete individual / driver verification before the condition record.');
      if (!['Clean', 'Needs cleaning', 'Damaged'].includes(input.cleanliness)) D.fail('Record the interior cleanliness.');
      if (!['approved', 'unsafe'].includes(input.outcome)) D.fail('Choose a safe or unsafe inspection outcome.');
      if (input.outcome === 'approved' && input.cleanliness !== 'Clean') D.fail('Clean or repair the interior before approving the vehicle.');
      if (!Array.isArray(input.photos) || input.photos.length < 2 || input.photos.length > 12 || !['exterior', 'interior'].every((view) => input.photos.some((p) => p.view === view)) || new Set(input.photos.map((p) => p.id)).size !== input.photos.length) D.fail('Attach separate exterior and interior condition photos.');
      const photos = await asyncMap(input.photos, async (p) => {
        const doc = await db.prepare('SELECT * FROM documents WHERE id=? AND owner_id=? AND kind=?').get(p.id, req.user.id, `condition:${s.id}`);
        if (!doc || !doc.mime.startsWith('image/') || !['exterior', 'interior'].includes(p.view)) D.fail('Choose your uploaded condition photos for this vehicle.');
        return { id: doc.id, view: p.view, name: doc.name, mime: doc.mime };
      });
      if ((await records('inspection')).some((r) => (r.photos || []).some((p) => photos.some((photo) => photo.id === p.id)))) D.fail('Upload fresh condition photos for this inspection.');
      if (new Set(await asyncMap(photos, async (p) => (await db.prepare('SELECT fingerprint FROM documents WHERE id=?').get(p.id)).fingerprint)).size !== photos.length) D.fail('Use different exterior and interior photographs.');
      const damageFlag = input.damageFlag === true || input.outcome === 'unsafe' || input.cleanliness === 'Damaged' || Object.values(checks).some(value => ['Damaged', 'Needs Repair'].includes(value));
      const cleanReturn = input.type === 'post-return' && input.outcome === 'approved' && input.cleanliness === 'Clean' && !damageFlag && fuelLevel >= 100;
      const inspectedVehicle = (await fleet()).find(v => v.id === s.id);
      const report = { id: randomUUID(), vehicle: { id: s.id, name: inspectedVehicle.name, fleetCode: inspectedVehicle.fleetCode, plate: inspectedVehicle.plate || '' }, vehicleId: s.id, bookingId: b?.id || null, type: input.type, status: input.outcome, role: 'mechanic', odometer, fuelLevel, tirePressure, cleanliness: input.cleanliness, damageFlag, cleanReturn, scratches: D.text(input.scratches, 'Exterior condition / scratches', 1500), note: D.text(input.note, 'Inspection notes', 1500, input.outcome === 'unsafe'), checks, driverVerification: input.driverVerification || null, driverName: b?.renter?.name || null, photos, by: req.user.name, at: stamp() };
      if (tripMileage !== null) Object.assign(report, { dispatchOdometer, mileageConsumption: tripMileage });
      if (b) {
        if (input.type === 'pre-dispatch') {b.inspection = report;D.invalidatePass(b);} else
        {b.returnInspection = report;D.invalidatePass(b);}
        b.version++;await audit(b, req.user, `${input.type} inspection ${input.outcome}`, report.note || (cleanReturn ? 'Clean return verified' : ''));
        if (input.type === 'post-return') {
          b.mileageConsumption = tripMileage;
          await rentalDocuments.receipt(b, 'return', req.user);
          const availDeposit = await returnable(b, 'deposit');
          const hasPending = (await records('approval')).some((a) => a.bookingId === b.id && a.type === 'deposit');
          if (cleanReturn && D.billing(b).rentalBalance === 0 && availDeposit > 0 && !hasPending) {
            const autoApproval = {
              id: randomUUID(), bookingId: b.id, type: 'deposit', amount: availDeposit,
              reason: 'Auto-Release: Mechanic marked Clean Return with zero damage flags and 100% fuel (24–48h auto-release window).',
              status: 'auto-released', autoReleased: true, autoReleaseWindow: '24–48 hours',
              version: 1, by: 'System Auto-Release', reviewedBy: 'Automated Workflow', reviewedAt: stamp(), at: stamp(), highValue: false
            };
            await completeDisbursement(autoApproval, b, req.user, 'Automated Clean-Return Release');
            await save('approval', autoApproval);
            b.depositAutoReleased = true;
            await systemAudit.write(req.user, 'Deposit auto-released (Clean Return)', `booking:${b.id}`, `PHP ${availDeposit} auto-released on clean return`, 200, {
              oldValue: { depositStatus: 'held', amount: availDeposit },
              newValue: { depositStatus: 'auto-released', amount: availDeposit, window: '24-48h' }
            });
          } else if (!cleanReturn) {
            b.depositException = true;
          }
        }
        await saveBooking(b);
      }
      const prevOdometer = s.odometer,prevFuel = s.fuelLevel,prevStatus = s.status;
      s.odometer = odometer;s.fuelLevel = fuelLevel;s.lastInspection = report.id;
      if (input.outcome === 'unsafe') s.status = 'Out of Service';else
      if (input.type === 'clearance' || input.type === 'post-return') {
        if ((await records('maintenance')).some((m) => m.vehicleId === s.id && m.status === 'In progress')) D.fail('Complete maintenance before clearing the vehicle.');
        s.status = 'Available';
      }
      await save('inspection', report);
      await changeState(s, req.user, `${input.type} inspection ${input.outcome}`, report.note, {
        oldValue: { status: prevStatus, odometer: prevOdometer, fuelLevel: prevFuel },
        newValue: { status: s.status, odometer, fuelLevel, cleanReturn, ...(tripMileage !== null ? { dispatchOdometer, mileageConsumption: tripMileage } : {}) }
      });
      if (input.outcome === 'unsafe') await invalidateVehiclePasses(s.id, req.user, 'Unsafe inspection: vehicle out of service.');
      return report;
    })));

    app.post('/api/bookings/:id/fast-clearance', role('agent', 'mechanic'), (req, res) => D.fail('Complete the individual mechanic checklist with fresh photo proof to save an inspection.', 403));

    app.post('/api/mechanic/vehicles/:id/status', role('mechanic'), async (req, res) => res.json(await transaction(async () => {
      const s = await state(req.params.id);stale(s, req.body.version);
      if (!['Under Inspection', 'Out of Service'].includes(req.body.status)) D.fail('Use a completed safety inspection to clear a vehicle.');
      const oldStatus = s.status;
      s.status = req.body.status;const reason = D.text(req.body.reason, 'Status reason', 1000);
      await changeState(s, req.user, `Vehicle marked ${s.status}`, reason, { oldValue: { status: oldStatus }, newValue: { status: s.status } });
      await invalidateVehiclePasses(s.id, req.user, reason);return s;
    })));

    app.post('/api/vehicles/:id/decommission', role('mechanic', 'manager'), async (req, res) => res.json(await transaction(async () => {
      const s = await state(req.params.id);stale(s, req.body.version);
      if ((await allBookings()).some((b) => b.vehicleId === s.id && b.status === 'On Rental')) D.fail('Active rentals must be returned before decommissioning a vehicle.');
      const reason = D.text(req.body.reason, 'Decommission reason', 1000);
      if (req.user.role === 'mechanic') {
        s.decommissionRequested = { by: req.user.name, actorId: req.user.id, at: stamp(), reason };
        await changeState(s, req.user, 'Vehicle decommission requested', reason, {
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
      await changeState(s, req.user, 'Vehicle decommissioned and archived', reason, {
        oldValue: { status: oldStatus, archived: false },
        newValue: { status: 'Decommissioned', archived: true }
      });
      await invalidateVehiclePasses(s.id, req.user, `Vehicle decommissioned: ${reason}`);
      return s;
    })));

    app.post('/api/mechanic/maintenance', role('mechanic'), async (req, res) => res.status(201).json(await transaction(async () => {
      await vehicle(req.body.vehicleId);
      if (!['Maintenance request', 'Repair', 'Oil change'].includes(req.body.type)) D.fail('Choose a maintenance category.');
      if (req.body.dueDate && !Number.isFinite(D.time(req.body.dueDate, '00:00'))) D.fail('Choose a valid due date.');
      const schedule = Object.fromEntries(['start', 'end', 'startTime', 'endTime'].map(key => [key, req.body[key] || '']));
      if (Object.values(schedule).some(Boolean)) {
        if (!Number.isFinite(D.time(schedule.start, schedule.startTime)) || !Number.isFinite(D.time(schedule.end, schedule.endTime)) || D.time(schedule.end, schedule.endTime) <= D.time(schedule.start, schedule.startTime)) D.fail('Enter a complete maintenance window with end after start.');
        if (!D.available(await availability(), { ...schedule, vehicleId: req.body.vehicleId })) D.fail('This maintenance window overlaps a reservation or existing vehicle hold.', 409);
      }
      const m = { id: randomUUID(), workOrderCode: `WO-${randomUUID().slice(0, 8).toUpperCase()}`, mechanic: req.user.name, mechanicId: req.user.id, vehicleId: req.body.vehicleId, type: req.body.type, description: D.text(req.body.description, 'Work description', 1500), dueDate: req.body.dueDate || '', status: 'Requested', cost: 0, version: 1, by: req.user.name, at: stamp(), activity: [] };
      if (schedule.start) Object.assign(m, schedule);
      await save('maintenance', m);
      await systemAudit.write(req.user, 'Maintenance logged', `maintenance:${m.id}`, `${m.type} for ${m.vehicleId}`, 200, { oldValue: null, newValue: { type: m.type, status: m.status, vehicleId: m.vehicleId } });
      return m;
    })));

    app.post('/api/mechanic/maintenance/:id', role('mechanic'), async (req, res) => res.json(await transaction(async () => {
      const m = await get('maintenance', req.params.id);if (!m) D.fail('Maintenance record not found.', 404);stale(m, req.body.version);
      if (m.archivedAt) D.fail('Restore this work order before updating it.', 409);
      if (!(m.status === 'Requested' && req.body.status === 'In progress' || m.status === 'In progress' && req.body.status === 'Completed')) D.fail('Start requested work, then complete it.');
      const s = await state(m.vehicleId);
      if (req.body.status === 'In progress' && (await allBookings()).some((b) => b.vehicleId === m.vehicleId && b.status === 'On Rental')) D.fail('Record the rental return before starting maintenance.');
      const oldMaint = { status: m.status, cost: m.cost };
      m.status = req.body.status;m.mechanic = req.user.name;m.mechanicId = req.user.id;m.note = D.text(req.body.note, 'Work notes', 1500);
      if (m.status === 'Completed') {m.cost = amount(req.body.cost, 'maintenance expenditure');m.completedAt = stamp();m.reference = D.text(req.body.reference, 'Invoice / service reference', 150);}
      m.version++;m.activity.push({ at: stamp(), by: req.user.name, action: m.status, note: m.note });await save('maintenance', m);
      if (s.status !== 'Out of Service') s.status = m.status === 'In progress' || (await records('maintenance')).some((other) => other.vehicleId === m.vehicleId && other.status === 'In progress') ? 'Maintenance' : 'Under Inspection';
      await changeState(s, req.user, `Maintenance ${m.status.toLowerCase()}`, m.note, { oldValue: oldMaint, newValue: { status: m.status, cost: m.cost } });
      await invalidateVehiclePasses(s.id, req.user, m.note);return m;
    })));

    for (const action of ['archive', 'restore']) app.post(`/api/mechanic/maintenance/:id/${action}`, role('mechanic', 'manager'), async (req, res) => res.json(await transaction(async () => {
      const m = await get('maintenance', req.params.id);
      if (!m) D.fail('Work order not found.', 404);
      if (!Number.isInteger(req.body.version)) D.fail('Supply the current work order version.');
      stale(m, req.body.version);
      if (action === 'archive' && (m.status !== 'Completed' || m.archivedAt)) D.fail('Only completed, active work orders can be archived.', 409);
      if (action === 'restore' && !m.archivedAt) D.fail('This work order is not archived.', 409);
      const oldValue = { status: m.status, archivedAt: m.archivedAt || null };
      if (action === 'archive') { m.archivedAt = stamp(); m.archivedBy = req.user.name; }
      else { delete m.archivedAt; delete m.archivedBy; }
      m.version++; m.activity ||= []; m.activity.push({ id: randomUUID(), at: stamp(), by: req.user.name, action, note: `Work order ${action}d` });
      await save('maintenance', m);
      await systemAudit.write(req.user, action === 'archive' ? 'Work order archived' : 'Work order restored', `maintenance:${m.id}`, m.workOrderCode || m.id, 200, { oldValue, newValue: { status: m.status, archivedAt: m.archivedAt || null } });
      return m;
    })));

    app.post('/api/operations/approvals', role('agent', 'manager'), async (req, res) => res.status(201).json(await transaction(async () => {
      const b = await getBooking(req.body.bookingId),type = req.body.type;
      if (!['refund', 'deposit'].includes(type)) D.fail('Choose a rental payment return or Security Deposit release.');
      if (type === 'refund' && b.status !== 'Cancelled') D.fail('Rental payment returns require a cancelled reservation.');
      if (type === 'deposit' && !['Completed', 'Cancelled'].includes(b.status)) D.fail('Security deposits can only be released after return or cancellation.');
      const maxReturnable = await returnable(b, type);
      const value = amount(req.body.amount, 'release amount');
      if (value <= 0 || value > maxReturnable) D.fail('The request exceeds the remaining verified funds.');
      if ((await records('approval')).some((a) => a.bookingId === b.id && a.type === type && a.status === 'pending')) D.fail('A request for this allocation is already pending.', 409);
      const withheldAmount = type === 'deposit' ? Math.max(0, +(maxReturnable - value).toFixed(2)) : 0;
      const disputed = type === 'deposit' && (withheldAmount > 0 || !!b.depositException || req.body.disputed === true);
      const a = {
        id: randomUUID(), bookingId: b.id, type, amount: value, withheldAmount, disputed,
        reason: D.text(req.body.reason, 'Approval reason', 1500), status: 'pending', version: 1,
        by: req.user.name, at: stamp(), highValue: value >= 5000
      };
      await save('approval', a);
      await audit(b, req.user, `${type} exception approval requested`, a.reason, { oldValue: null, newValue: { type, amount: value, withheldAmount, disputed } });
      b.version++;await saveBooking(b);return a;
    })));

    app.post('/api/manager/approvals/:id', role('manager'), async (req, res) => res.json(await transaction(async () => {
      const a = await get('approval', req.params.id);if (!a) D.fail('Approval not found.', 404);stale(a, req.body.version);
      if (a.status !== 'pending' || !['approved', 'rejected'].includes(req.body.decision)) D.fail('Choose a decision for a pending request.');
      const b = await getBooking(a.bookingId);
      if (req.body.decision === 'approved') {
        if (a.amount > (await returnable(b, a.type))) D.fail('The request exceeds the remaining verified funds.', 409);
        if (a.type === 'deposit' && !(b.status === 'Cancelled' || b.status === 'Completed' && b.returnInspection?.status === 'approved' && D.billing(b).rentalBalance === 0 && !(await operationalBlocks(b.vehicleId)).length)) D.fail('Settle rental charges and complete a safe post-return inspection before releasing the deposit.');
        if (a.type === 'refund' && b.status !== 'Cancelled') D.fail('Only cancelled rentals qualify for this payment return.');
      }
      const oldStatus = a.status;
      a.status = req.body.decision;a.reviewNote = D.text(req.body.reason, 'Decision reason', 1500);a.reviewedBy = req.user.name;a.reviewedAt = stamp();
      if (a.status === 'approved') await completeDisbursement(a, b, req.user);
      a.version++;await save('approval', a);
      await audit(b, req.user, `${a.type} ${a.status}`, `${a.amount} PHP: ${a.reviewNote}`, {
        oldValue: { status: oldStatus },
        newValue: { status: a.status, amount: a.amount, reviewedBy: req.user.name }
      });
      b.version++;await saveBooking(b);return a;
    })));

    app.post('/api/manager/risks', role('manager'), async (req, res) => res.status(201).json(await transaction(async () => {
      const b = await getBooking(req.body.bookingId);
      if (!['Low', 'Medium', 'High'].includes(req.body.severity)) D.fail('Choose a risk severity.');
      const r = { id: randomUUID(), bookingId: b.id, vehicleId: b.vehicleId, driver: b.renter.name, severity: req.body.severity, description: D.text(req.body.description, 'Risk description', 1500), status: 'open', version: 1, by: req.user.name, at: stamp() };
      await save('risk', r);
      await audit(b, req.user, 'Driver risk logged', r.description, { oldValue: null, newValue: { severity: r.severity, status: 'open' } });
      b.version++;await saveBooking(b);
      if (r.severity === 'High') {
        for (const affected of (await allBookings()).filter((other) => !['Completed', 'Cancelled', 'On Rental'].includes(other.status) && (other.id === b.id || b.ownerId && other.ownerId === b.ownerId || b.renter.email && other.renter.email?.toLowerCase() === b.renter.email.toLowerCase()))) {
          D.invalidatePass(affected);affected.version++;await audit(affected, req.user, 'Dispatch blocked by driver risk', r.description);await saveBooking(affected);
        }
      }
      return r;
    })));

    app.post('/api/manager/flags/:id/override', role('manager'), async (req, res) => res.json(await transaction(async () => {
      const b = await getBooking(req.params.id);stale(b, req.body.version);
      if (b.status !== 'On Rental' || D.time(b.end, b.endTime) >= Date.now()) D.fail('This overdue flag is no longer active.', 409);
      const previous = await get('flag', b.id);
      if (previous && previous.end === b.end && previous.endTime === b.endTime) D.fail('This alert was already reviewed.', 409);
      const flag = { id: b.id, end: b.end, endTime: b.endTime, reason: D.text(req.body.reason, 'Override reason', 1500), by: req.user.name, at: stamp() };
      await save('flag', flag);
      await audit(b, req.user, 'Overdue alert overridden', flag.reason, { oldValue: { overdueFlag: 'active' }, newValue: { overdueFlag: 'overridden', by: req.user.name }, alertType: 'Policy override' });
      b.version++;await saveBooking(b);return flag;
    })));

    app.post('/api/manager/risks/:id/override', role('manager'), async (req, res) => res.json(await transaction(async () => {
      const r = await get('risk', req.params.id);if (!r) D.fail('Risk record not found.', 404);stale(r, req.body.version);
      if (r.status !== 'open') D.fail('This flag was already reviewed.', 409);
      r.status = 'overridden';r.reason = D.text(req.body.reason, 'Override reason', 1500);r.reviewedBy = req.user.name;r.reviewedAt = stamp();r.version++;await save('risk', r);
      const b = await getBooking(r.bookingId);b.version++;
      await audit(b, req.user, 'Driver risk flag overridden', r.reason, { oldValue: { status: 'open', severity: r.severity }, newValue: { status: 'overridden', reason: r.reason }, alertType: 'Policy override' });
      await saveBooking(b);return r;
    })));

    app.get('/api/manager/analytics', role('manager'), async (req, res) => res.json(await analytics(req.query.start, req.query.end)));

    app.get('/api/manager/audit', role('manager'), async (req, res) => {
      const page = Number(req.query.page || 1),size = 10;
      if (!Number.isInteger(page) || page < 1 || page > 100000) D.fail('Choose a valid audit page.');
      const clauses = [],params = [];
      const through = Number(req.query.through || (await db.prepare('SELECT COALESCE(MAX(sequence),0) AS value FROM audit_log').get()).value);
      if (!Number.isSafeInteger(through) || through < 0) D.fail('Choose a valid audit snapshot.');
      clauses.push('sequence<=?');params.push(through);
      if (req.query.start) {const start = D.time(req.query.start, '00:00');if (!Number.isFinite(start)) D.fail('Choose a valid start date.');clauses.push('at>=?');params.push(new Date(start).toISOString());}
      if (req.query.end) {const end = D.time(req.query.end, '00:00');if (!Number.isFinite(end)) D.fail('Choose a valid end date.');clauses.push('at<?');params.push(new Date(end + D.DAY).toISOString());}
      if (req.query.role) {if (!['client', 'agent', 'mechanic', 'manager', 'anonymous'].includes(req.query.role)) D.fail('Choose a valid role.');clauses.push('role=?');params.push(req.query.role);}
      if (req.query.alertsOnly === 'true') {clauses.push("alert_type<>''");}
      if (req.query.mutationsOnly === 'true') {clauses.push("(old_value<>'' OR new_value<>'')");}
      if (req.query.q) {const query = D.text(req.query.q, 'Search', 150);clauses.push('(action LIKE ? OR resource LIKE ? OR actor LIKE ? OR detail LIKE ? OR old_value LIKE ? OR new_value LIKE ?)');params.push(...Array(6).fill(`%${query}%`));}
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      res.json({
        records: await db.prepare(`SELECT * FROM audit_log${where} ORDER BY sequence DESC LIMIT ? OFFSET ?`).all(...params, size, (page - 1) * size),
        alerts: await systemAudit.alerts(15),
        total: (await db.prepare(`SELECT COUNT(*) AS count FROM audit_log${where}`).get(...params)).count,
        page, size, through
      });
    });
  }

  async function invalidateVehiclePasses(id, user, reason) {
    for (const b of (await allBookings()).filter((b) => b.vehicleId === id && !['Completed', 'Cancelled'].includes(b.status))) {
      D.invalidatePass(b);b.version++;await audit(b, user, 'Vehicle release blocked', reason);await saveBooking(b);
    }
  }

  return { register, operations, fleet, availability, present, dispatchBlocks, operationalBlocks, records, state, save, vehicleRate, vehicle, changeState, recordReturn, invalidateVehiclePasses, initializePlates, saveDynamicVehicle: async (v) => await save('dynamic_vehicle', v) };
}
module.exports = { createFleet };

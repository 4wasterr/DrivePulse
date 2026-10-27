const { randomUUID, createHash } = require('node:crypto');
const D = require('./domain');
const { conditionLabel } = require('../shared/inspection.mjs');
const inspectionChecklist = require('../shared/inspectionChecklist.json');
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const stamp = () => new Date().toISOString();
const money = (n) => `PHP ${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
const fmt = (value) => value ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) + ' PHT' : 'Pending';
const DEFAULT_TERMS = `1. AUTHORIZED OPERATION: The vehicle shall be operated solely by the verified renter named herein. Driving under the influence, unauthorized subleasing, racing, or transporting contraband is strictly prohibited under Philippine law.

2. FUEL & CLEANLINESS POLICY: The vehicle is dispatched with a 100% full tank / full charge and a clean interior. The renter agrees to return the vehicle with 100% full fuel / charge and in a clean condition.

3. SECURITY DEPOSIT AUTO-RELEASE & WITHHOLDING: A refundable security deposit of PHP 5,000 is collected in cash. 
- Clean Return Guarantee: If the fleet mechanic verifies an approved clean return with zero damage flags and 100% fuel, the security deposit is automatically scheduled for release within 24–48 hours.
- Disputed / Withheld Deposits: Any fuel shortfall, deep interior cleaning fee, documented body scratches/dents, or unpaid late return hours will be deducted from the deposit under formal Operations Manager approval.

4. EXTENSIONS & LATE RETURN SURCHARGES: Rental charges are computed per started 24-hour period. Extensions must be confirmed with DrivePulse prior to scheduled return. Unscheduled late returns accrue hourly late fees as specified in the booking summary.

5. ACCIDENTS & ROAD INCIDENTS: In the event of any collision, mechanical malfunction, or traffic incident, the renter must notify DrivePulse within two (2) hours and secure an official police report.

6. PRE-DISPATCH CANCELLATION: Cancelling before vehicle dispatch incurs a fee equal to 20% of the verified rental/downpayment received. The remaining 80% and the full verified security deposit are refundable, subject to recorded approval and cash release. Pending, unverified payments are cancelled. No fee is charged against the security deposit.`;

function createRentalDocuments({ db, getBooking, saveBooking, transaction, audit }) {
  async function issue(b, kind, user, extra = {}) {
    const row = await db.prepare("SELECT payload FROM fleet_records WHERE kind='dynamic_vehicle' AND id=?").get(b.vehicleId);
    const definition = row ? JSON.parse(row.payload) : D.FLEET.find(v => v.id === b.vehicleId);
    const stateRow = await db.prepare("SELECT payload FROM fleet_records WHERE kind='vehicle' AND id=?").get(b.vehicleId);
    const state = stateRow ? JSON.parse(stateRow.payload) : {};
    const vehicleProfile = { ...definition };
    for (const key of ['name', 'brand', 'model', 'category', 'plate', 'transmission', 'seats', 'fuelType', 'tankCapacity']) if (state[key] !== undefined) vehicleProfile[key] = state[key];
    const document = { id: `${kind.toUpperCase()}-${randomUUID().slice(0, 10).toUpperCase()}`, kind, bookingId: b.id, transactionReference: b.transactionReference || b.id, createdAt: stamp(), by: user.name, actorId: user.id, sample: !!b.sample,
      renter: structuredClone(b.renter), vehicle: { ...vehicleProfile, fleetCode: state.fleetCode || definition?.fleetCode || `CAR-${String(D.FLEET.findIndex(v => v.id === b.vehicleId) + 1).padStart(5, '0')}` },
      schedule: { start: b.start, startTime: b.startTime, end: b.end, endTime: b.endTime, pickup: b.pickup, dropoff: b.dropoff },
      billing: { ...D.billing(b), rental: b.rental, deposit: b.deposit, lateFee: b.lateFee || 0, days: b.days, dailyRate: b.dailyRate || b.rental / b.days, total: b.status === 'Cancelled' ? D.billing(b).fee : b.rental + b.deposit + (b.lateFee || 0) }, ...extra };
    document.digest = createHash('sha256').update(JSON.stringify(document)).digest('hex');
    await db.prepare('INSERT INTO rental_documents(id,booking_id,kind,created_at,payload) VALUES(?,?,?,?,?)').run(document.id, b.id, kind, document.createdAt, JSON.stringify(document));
    return { id: document.id, kind, createdAt: document.createdAt, by: user.name, digest: document.digest };
  }
  async function contract(b, user, customTerms = DEFAULT_TERMS) {
    const revision = (b.agreement?.revision || 0) + 1;
    b.agreement = { ...(await issue(b, 'agreement', user, { terms: customTerms, signature: b.renter.name, consent: true, signatureMethod: 'System-issued rental contract', revision, supersedes: b.agreement?.id || null })), revision, terms: customTerms };
    delete b.agreementInvalidatedAt;
    return b.agreement;
  }
  async function receipt(b, kind, user) {
    if (kind === 'return' && (!b.returnedAt || !b.returnInspection)) return;
    if (kind === 'release' && b.releaseReceipt || kind === 'return' && b.returnReceipt?.inspectionId === b.returnInspection.id) return;
    const inspection = kind === 'release' ? b.inspection : b.returnInspection;
    const previous = b[kind === 'release' ? 'releaseReceipt' : 'returnReceipt'];
    b[kind === 'release' ? 'releaseReceipt' : 'returnReceipt'] = { ...(await issue(b, kind, user, { eventAt: kind === 'release' ? b.dispatchedAt : b.returnedAt, inspection: structuredClone(inspection), agreementId: b.agreement?.id || null, lateHours: b.lateHours || 0, hourlyLateRate: b.hourlyLateRate || 0, supersedes: previous?.id || null })), inspectionId: inspection?.id || null };
  }
  async function cashReceipt(b, payment, user) {
    payment.receipt = await issue(b, 'cash', user, { payment: { id: payment.id, amount: payment.amount, type: payment.type, method: payment.method, reference: payment.reference, at: payment.reviewedAt || payment.at }, eventAt: payment.reviewedAt || payment.at });
  }
  function register(app, role) {
    app.post('/api/agent/bookings/:id/agreement', role('agent'), async (req, res) => res.status(201).json(await transaction(async () => {
      const b = await getBooking(req.params.id);
      if (b.version !== req.body.version) D.fail('This reservation changed. Refresh and try again.', 409);
      if (['Completed', 'Cancelled'].includes(b.status)) D.fail('Closed reservations cannot receive a new agreement.');
      const terms = D.text(req.body.terms || DEFAULT_TERMS, 'Rental terms', 6000);
      await contract(b, req.user, terms);
      b.version++;await audit(b, req.user, 'Rental contract issued', `Revision ${b.agreement.revision}`);await saveBooking(b);return b;
    })));
    app.get('/api/rental-documents/:id', role('client', 'agent', 'manager'), async (req, res) => {
      const row = await db.prepare('SELECT * FROM rental_documents WHERE id=?').get(req.params.id);
      if (!row) D.fail('Issued document not found.', 404);
      const b = await getBooking(row.booking_id);
      if (req.user.role === 'client' && b.ownerId !== req.user.id) D.fail('Issued document not found.', 404);
      const d = JSON.parse(row.payload);
      res.set('Content-Disposition', `${req.query.view === 'inline' ? 'inline' : 'attachment'}; filename="${d.id}.html"`).type('html').send(render(d));
    });
    app.get('/api/agreement-terms', role('agent', 'client'), (req, res) => res.json({ terms: DEFAULT_TERMS }));
  }
  return { register, contract, receipt, cashReceipt, issue };
}
function render(d) {
  const isAgreement = d.kind === 'agreement';
  const title = {
    agreement: 'Official Vehicle Rental Agreement & Terms',
    confirmation: 'Reservation Confirmation & Booking Summary',
    release: 'Vehicle Release & Handover Receipt',
    return: 'Vehicle Return & Post-Inspection Receipt',
    cash: 'Official Cash Payment Receipt',
    disbursement: 'Security Deposit Release Receipt',
    cancellation: 'Booking Cancellation & Settlement Statement'
  }[d.kind] || 'DrivePulse Issued Document';

  const fields = [
  ['Document Reference', d.id],
  ['Reservation ID', d.bookingId],
  ['Renter', `${d.renter.name} · ${d.renter.email || 'In-Person Customer'}`],
  ['Vehicle Description', `${d.vehicle.name} (${d.vehicle.category || 'Standard'})`],
  ['Unique Vehicle ID / Fleet Code', d.vehicle.fleetCode || d.vehicle.id || '—'],
  ['Scheduled Pick-up', `${d.schedule.start} at ${d.schedule.startTime} PHT (${d.schedule.pickup})`],
  ['Scheduled Return', `${d.schedule.end} at ${d.schedule.endTime} PHT (${d.schedule.dropoff})`],
  ['Issuing Officer', d.by],
  ['Date & Time Issued', fmt(d.createdAt)]];
  if (d.bookingStatus) fields.push(['Reservation Status', d.bookingStatus]);
  if (d.cancellation) fields.push(['Cancellation reason', d.cancellation.reason], ['Cancellation fee (20% of verified downpayment)', money(d.cancellation.fee)], ['Rental / downpayment refund', money(d.cancellation.rentalRefund)], ['Security deposit refund', money(d.cancellation.depositRefund)], ['Total refund pending cash release', money(d.cancellation.refundDue)], ['Cancellation fee balance', money(d.cancellation.balanceDue)]);

  if (d.eventAt) fields.push(['Actual Event Timestamp', fmt(d.eventAt)]);
  const i = d.inspection;
  if (i) {
    fields.push(
      ['Mechanic Sign-off', `${i.by} · ${fmt(i.at)} (${i.status})`],
      ['Odometer Reading', `${i.odometer?.toLocaleString() || 'N/A'} km`],
      ...(i.mileageConsumption != null ? [['Dispatch Odometer', `${i.dispatchOdometer.toLocaleString()} km`], ['Total Mileage Consumption', `${i.mileageConsumption.toLocaleString()} km`]] : []),
      ['Fuel / Battery Charge', `${i.fuelLevel}%`],
      ['Interior Condition', i.cleanliness || 'Clean'],
      ['Exterior Condition', i.scratches || 'No visible damage'],
      ['Tire Pressure (PSI)', Object.entries(i.tirePressure || {}).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'Verified']
    );
    fields.push(...inspectionChecklist.map(({ key, label }) => [`Condition rating: ${label}`, conditionLabel(i.conditionRatings?.[key] ?? i.checks?.[key])]), ['Damage status', i.damageFlag ? 'Damage / repair required' : 'No damage observed'], ['Mechanic dispatch decision', i.dispatchDecision || (i.status === 'approved' ? 'Approved by mechanic' : 'Do not dispatch')]);
  }
  if (d.payment) {
    fields.push(
      ['Payment Amount', money(d.payment.amount)],
      ['Allocation Category', d.payment.type],
      ['Payment Mode', `${d.payment.method} (Counter Verified)`],
      ['Cash Reference', d.payment.reference],
      ['Booking Transaction', d.transactionReference || d.bookingId]
    );
  }
  if (d.disbursement) {
    fields.push(
      ['Released Amount', money(d.disbursement.amount)],
      ['Recipient', d.disbursement.recipient],
      ['Voucher Reference', d.disbursement.reference],
      ['Authorization', d.disbursement.mode || 'Operations Manager Approved']
    );
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · ${escape(d.id)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1f2937; background: #fff; max-width: 860px; margin: 30px auto; padding: 32px; border: 1px solid #e5e7eb; border-radius: 8px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111827; padding-bottom: 20px; margin-bottom: 24px; }
  .brand { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; color: #111827; }
  .brand span { color: #f97316; }
  .doc-badge { background: #f3f4f6; border: 1px solid #d1d5db; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: #374151; }
  h1 { font-size: 22px; font-weight: 700; color: #111827; margin-bottom: 6px; }
  .doc-sub { font-size: 13px; color: #6b7280; margin-bottom: 24px; }
  .summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 18px; margin-bottom: 24px; }
  .summary-grid dt { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; font-weight: 600; margin-bottom: 2px; }
  .summary-grid dd { font-size: 14px; color: #111827; font-weight: 500; word-break: break-word; }
  .billing-card { border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; margin-bottom: 24px; }
  .billing-header { background: #f3f4f6; padding: 10px 16px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #374151; }
  .billing-table { width: 100%; border-collapse: collapse; }
  .billing-table td { padding: 10px 16px; border-top: 1px solid #f3f4f6; font-size: 13px; }
  .billing-table tr:last-child td { font-weight: 700; background: #fafafa; border-top: 2px solid #e5e7eb; font-size: 14px; }
  .billing-table td:last-child { text-align: right; }
  .terms-card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 20px; background: #fff; margin-bottom: 24px; }
  .terms-card h2 { font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #111827; margin-bottom: 12px; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; }
  .terms-text { font-size: 12px; line-height: 1.8; color: #374151; white-space: pre-wrap; margin-bottom: 16px; }
  .signature-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #4b5563; }
  .signature-box { border: 1px dashed #d1d5db; border-radius: 4px; padding: 12px; background: #f9fafb; }
  .signature-box strong { display: block; font-size: 13px; color: #111827; margin-top: 4px; }
  footer { border-top: 1px solid #e5e7eb; padding-top: 16px; font-size: 11px; color: #9ca3af; display: flex; justify-content: space-between; align-items: center; }
  .digest { font-family: monospace; font-size: 10px; color: #6b7280; }
  @media print {
    body { border: none; padding: 0; margin: 0; max-width: 100%; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
  <button type="button" class="no-print" onclick="window.print()" style="padding:10px 16px;margin-bottom:20px;cursor:pointer">Print / Save as PDF</button>
  <header>
    <div>
      <div class="brand">drivepulse<span>.</span></div>
      <small style="color: #6b7280;">DrivePulse Philippines Car Rentals · Metro Manila</small>
    </div>
    <div class="doc-badge">${d.sample ? 'SAMPLE · ' : ''}${escape(d.kind.toUpperCase())} RECORD</div>
  </header>

  <h1>${escape(title)}</h1>
  <p class="doc-sub">${isAgreement ? `Binding rental contract (Revision ${d.revision || 1}) governing vehicle release, daily rates, and clean-return deposit release.` : 'Official operational document recorded in DrivePulse central system.'}</p>

  <dl class="summary-grid">
    ${fields.map(([k, v]) => `<div><dt>${escape(k)}</dt><dd>${escape(v)}</dd></div>`).join('')}
  </dl>

  <div class="billing-card">
    <div class="billing-header">Rental Charges & Cash Balance Schedule</div>
    <table class="billing-table">
      ${d.billing.dailyRate ? `<tr><td>Daily Rate × Rental Days</td><td>${escape(money(d.billing.dailyRate))} × ${escape(d.billing.days)}</td></tr>` : ''}
      <tr><td>Base Rental Charges</td><td>${escape(money(d.billing.rental ?? d.billing.rentalDue))}</td></tr>
      <tr><td>Late Return Surcharges (if applicable)</td><td>${escape(money(d.billing.lateFee))}</td></tr>
      <tr><td>Verified Cash Rental Payments</td><td>${escape(money(d.billing.rentalPaid))}</td></tr>
      <tr><td>Security Deposit (Cash at Counter)</td><td>${escape(money(d.billing.depositPaid))} / ${escape(money(d.billing.deposit))}</td></tr>
      ${d.billing.total != null ? `<tr><td>Total Rental Quotation</td><td>${escape(money(d.billing.total))}</td></tr>` : ''}
      <tr><td>Remaining Security Deposit Balance</td><td>${escape(money(d.billing.depositBalance))}</td></tr>
      <tr><td>Remaining Rental Balance Due</td><td>${escape(money(d.billing.rentalBalance))}</td></tr>
    </table>
  </div>

  ${d.terms ? `
  <div class="terms-card">
    <h2>Official Rental Terms & Operational Conditions</h2>
    <div class="terms-text">${escape(d.terms)}</div>
    <div class="signature-row">
      <div class="signature-box">
        <span>Verified Lessee / Authorized Renter</span>
        <strong>${escape(d.signature || d.renter.name)}</strong>
        <small>Agreed via digital booking submission</small>
      </div>
      <div class="signature-box">
        <span>Authorized DrivePulse Representative</span>
        <strong>${escape(d.by)}</strong>
        <small>Digitally verified & issued</small>
      </div>
    </div>
  </div>
  ` : ''}

  <footer>
    <div>
      <span>DrivePulse Philippines · Immutable Issued Document</span><br>
      <span class="digest">SHA-256 Digest: ${escape(d.digest)}</span>
    </div>
    <div class="no-print">
      <span>Print / PDF (Ctrl+P)</span>
    </div>
  </footer>
</body>
</html>`;
}
module.exports = { createRentalDocuments, DEFAULT_TERMS };

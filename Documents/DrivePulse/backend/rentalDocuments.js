const { randomUUID, createHash } = require('node:crypto');
const D = require('./domain');
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const stamp = () => new Date().toISOString();
const money = n => `PHP ${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
const fmt = value => value ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) + ' PHT' : 'Pending';
const DEFAULT_TERMS = 'Rental is charged for each started 24-hour period. The renter must return the vehicle at the agreed time and location. Only the approved driver may operate it. Fuel, tolls, fines, extensions, late fees, and documented damage are settled separately. Clean returns with zero damage flags and full fuel automatically qualify for deposit release within 24–48 hours; disputed or withheld deposits require Operations Manager approval.';

function createRentalDocuments({ db, getBooking, saveBooking, transaction, audit }) {
  db.exec(`CREATE TABLE IF NOT EXISTS rental_documents (id TEXT PRIMARY KEY, booking_id TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS rental_document_booking ON rental_documents(booking_id);
    CREATE TRIGGER IF NOT EXISTS rental_document_no_update BEFORE UPDATE ON rental_documents BEGIN SELECT RAISE(ABORT,'Issued documents are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS rental_document_no_delete BEFORE DELETE ON rental_documents BEGIN SELECT RAISE(ABORT,'Issued documents are immutable'); END;`);
  function issue(b, kind, user, extra = {}) {
    const document = { id: `${kind.toUpperCase()}-${randomUUID().slice(0, 10).toUpperCase()}`, kind, bookingId: b.id, createdAt: stamp(), by: user.name, actorId: user.id, sample: !!b.sample,
      renter: structuredClone(b.renter), vehicle: { ...D.FLEET.find(v => v.id === b.vehicleId) },
      schedule: { start: b.start, startTime: b.startTime, end: b.end, endTime: b.endTime, pickup: b.pickup, dropoff: b.dropoff },
      billing: { ...D.billing(b), rental: b.rental, deposit: b.deposit, lateFee: b.lateFee || 0 }, ...extra };
    document.digest = createHash('sha256').update(JSON.stringify(document)).digest('hex');
    db.prepare('INSERT INTO rental_documents VALUES(?,?,?,?,?)').run(document.id, b.id, kind, document.createdAt, JSON.stringify(document));
    return { id: document.id, kind, createdAt: document.createdAt, by: user.name, digest: document.digest };
  }
  function contract(b, user, customTerms = DEFAULT_TERMS) {
    const revision = (b.agreement?.revision || 0) + 1;
    b.agreement = { ...issue(b, 'agreement', user, { terms: customTerms, signature: b.renter.name, consent: true, signatureMethod: 'System-issued rental contract', revision, supersedes: b.agreement?.id || null }), revision, terms: customTerms };
    delete b.agreementInvalidatedAt;
    return b.agreement;
  }
  function receipt(b, kind, user) {
    if (kind === 'return' && (!b.returnedAt || !b.returnInspection)) return;
    if (kind === 'release' && b.releaseReceipt || kind === 'return' && b.returnReceipt?.inspectionId === b.returnInspection.id) return;
    const inspection = kind === 'release' ? b.inspection : b.returnInspection;
    const previous = b[kind === 'release' ? 'releaseReceipt' : 'returnReceipt'];
    b[kind === 'release' ? 'releaseReceipt' : 'returnReceipt'] = { ...issue(b, kind, user, { eventAt: kind === 'release' ? b.dispatchedAt : b.returnedAt, inspection: structuredClone(inspection), agreementId: b.agreement?.id || null, lateHours: b.lateHours || 0, hourlyLateRate: b.hourlyLateRate || 0, supersedes: previous?.id || null }), inspectionId: inspection?.id || null };
  }
  function cashReceipt(b, payment, user) {
    payment.receipt = issue(b, 'cash', user, { payment: { id: payment.id, amount: payment.amount, type: payment.type, method: payment.method, reference: payment.reference, at: payment.reviewedAt || payment.at }, eventAt: payment.reviewedAt || payment.at });
  }
  function register(app, role) {
    app.post('/api/agent/bookings/:id/agreement', role('agent'), (req, res) => res.status(201).json(transaction(() => {
      const b = getBooking(req.params.id);
      if (b.version !== req.body.version) D.fail('This reservation changed. Refresh and try again.', 409);
      if (['Completed', 'Cancelled'].includes(b.status)) D.fail('Closed reservations cannot receive a new agreement.');
      const terms = D.text(req.body.terms || DEFAULT_TERMS, 'Rental terms', 6000);
      contract(b, req.user, terms);
      b.version++; audit(b, req.user, 'Rental contract issued', `Revision ${b.agreement.revision}`); saveBooking(b); return b;
    })));
    app.get('/api/rental-documents/:id', role('client', 'agent', 'manager'), (req, res) => {
      const row = db.prepare('SELECT * FROM rental_documents WHERE id=?').get(req.params.id);
      if (!row) D.fail('Issued document not found.', 404);
      const b = getBooking(row.booking_id);
      if (req.user.role === 'client' && b.ownerId !== req.user.id) D.fail('Issued document not found.', 404);
      const d = JSON.parse(row.payload);
      res.set('Content-Disposition', `attachment; filename="${d.id}.html"`).type('html').send(render(d));
    });
    app.get('/api/agreement-terms', role('agent'), (req, res) => res.json({ terms: DEFAULT_TERMS }));
  }
  return { register, contract, receipt, cashReceipt, issue };
}
function render(d) {
  const title = { agreement: 'Rental contract', release: 'Vehicle release receipt', return: 'Vehicle return receipt', cash: 'Cash payment receipt', disbursement: 'Deposit / refund release receipt' }[d.kind];
  const fields = [['Document reference', d.id], ['Reservation', d.bookingId], ['Renter', `${d.renter.name} · ${d.renter.email || ''}`], ['Vehicle', d.vehicle.name], ['Pickup', `${d.schedule.start} ${d.schedule.startTime} PHT · ${d.schedule.pickup}`], ['Agreed return', `${d.schedule.end} ${d.schedule.endTime} PHT · ${d.schedule.dropoff}`], ['Issued by', d.by], ['Issued at', fmt(d.createdAt)]];
  if (d.eventAt) fields.push(['Actual event', fmt(d.eventAt)]);
  const i = d.inspection;
  if (i) fields.push(['Mechanic sign-off', `${i.by} · ${fmt(i.at)} · ${i.status}`], ['Odometer', `${i.odometer} km`], ['Fuel / battery', `${i.fuelLevel}%`], ['Interior', i.cleanliness], ['Exterior / damage', i.scratches], ['Tire pressures (PSI)', Object.entries(i.tirePressure || {}).map(([k, v]) => `${k}: ${v}`).join(' · ')]);
  if (d.payment) fields.push(['Payment amount', money(d.payment.amount)], ['Allocation', d.payment.type], ['Method', d.payment.method], ['Cash reference', d.payment.reference]);
  if (d.disbursement) fields.push(['Released amount', money(d.disbursement.amount)], ['Recipient', d.disbursement.recipient], ['Reference', d.disbursement.reference], ['Release mode', d.disbursement.mode || 'Manager approved']);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)} · ${escape(d.id)}</title><style>body{font:15px/1.6 system-ui,sans-serif;color:#171717;max-width:800px;margin:40px auto;padding:24px}header{display:flex;justify-content:space-between;border-bottom:2px solid;padding-bottom:16px}h1{font-size:32px}dl{display:grid;grid-template-columns:1fr 1fr;gap:20px}dt{color:#666;font-size:12px}dd{margin:4px 0;overflow-wrap:anywhere}section{background:#f5f5f5;padding:20px;margin-top:24px;white-space:pre-wrap}footer{border-top:1px solid #ccc;margin-top:28px;padding-top:16px;font-size:12px;overflow-wrap:anywhere}@media print{body{margin:0}}@media(max-width:500px){dl{grid-template-columns:1fr}}</style><header><strong>drivepulse.</strong><span>${d.sample ? 'SAMPLE · ' : ''}ISSUED RECORD</span></header><h1>${escape(title)}</h1><dl>${fields.map(([k, v]) => `<div><dt>${escape(k)}</dt><dd>${escape(v)}</dd></div>`).join('')}</dl>${d.terms ? `<section><h2>Agreed terms · revision ${d.revision}</h2>${escape(d.terms)}<p>Renter: ${escape(d.signature)}</p></section>` : ''}<section>Rental charges: ${escape(money(d.billing.rentalDue))}
Late fees included: ${escape(money(d.billing.lateFee))}
Verified rental payments: ${escape(money(d.billing.rentalPaid))}
Security deposit received: ${escape(money(d.billing.depositPaid))}
Rental balance: ${escape(money(d.billing.rentalBalance))}</section><footer>Snapshot of the issued record.<br>SHA-256: ${escape(d.digest)}<br>Print → Save as PDF to save a PDF copy.</footer></html>`;
}
module.exports = { createRentalDocuments, DEFAULT_TERMS };

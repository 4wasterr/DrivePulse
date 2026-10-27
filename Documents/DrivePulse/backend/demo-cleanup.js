const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { randomUUID } = require('node:crypto');

const marked = value => value.sample === true || value.test === true || value.mock === true || value.simulated === true;
const operationalKinds = new Set(['approval', 'maintenance', 'inspection', 'risk', 'flag']);

async function cleanDemoData(db, { apply = false, backupDir = resolve(__dirname, 'data', 'backups'), bookingIds = [], maintenanceIds = [] } = {}) {
  return db.transaction(async () => {
    const bookings = await db.prepare('SELECT * FROM bookings').all();
    const selected = bookings.filter(row => marked(JSON.parse(row.payload)) || bookingIds.includes(row.id));
    const ids = new Set(selected.map(row => row.id));
    if (bookingIds.some(id => !ids.has(id))) throw new Error('An explicitly selected booking no longer exists.');
    const fleet = await db.prepare('SELECT * FROM fleet_records').all();
    const records = fleet.filter(row => {
      const record = JSON.parse(row.payload);
      return operationalKinds.has(row.kind) && (marked(record) || ids.has(record.bookingId) || row.kind === 'maintenance' && maintenanceIds.includes(row.id));
    });
    const tickets = (await db.prepare('SELECT * FROM tickets').all()).filter(row => marked(JSON.parse(row.payload)) || ids.has(JSON.parse(row.payload).bookingId));
    const rentalDocuments = (await db.prepare('SELECT * FROM rental_documents').all()).filter(row => ids.has(row.booking_id));
    const retainedReferences = JSON.stringify([
      ...bookings.filter(row => !ids.has(row.id)),
      ...fleet.filter(row => !records.includes(row)),
      ...(await db.prepare('SELECT payload FROM rental_documents').all()).filter(row => !marked(JSON.parse(row.payload)) && !ids.has(JSON.parse(row.payload).bookingId))
    ]);
    const documentIds = new Set(selected.flatMap(row => (JSON.parse(row.payload).documents || []).map(document => document.id)));
    const documents = (await db.prepare('SELECT * FROM documents').all()).filter(row =>
      (documentIds.has(row.id) || row.owner_id === 'sample-owner-archive' || /^sample-.*\.pdf$/i.test(row.name)) && !retainedReferences.includes(row.id));
    const recordIds = [...ids, ...records.map(row => row.id), ...tickets.map(row => row.id)];
    const audits = (await db.prepare('SELECT * FROM audit_log').all()).filter(row => /sample reservation created|illustrative data/i.test(row.action + ' ' + row.detail) || recordIds.some(id => row.resource === id || row.resource.endsWith(':' + id)));
    const beforeAccounts = await db.prepare('SELECT id,email,role,password_hash,archived_at FROM users ORDER BY id').all();
    const beforeFleet = fleet.filter(row => ['vehicle', 'dynamic_vehicle'].includes(row.kind));
    const summary = { bookings: selected.length, transactions: selected.reduce((count, row) => count + (JSON.parse(row.payload).payments || []).length, 0), operationalRecords: records.length, tickets: tickets.length, documents: documents.length, rentalDocuments: rentalDocuments.length, sampleLogs: audits.length, preservedBookings: bookings.length - selected.length, preservedAccounts: beforeAccounts.length };
    if (!apply || !Object.values(summary).some(Boolean) || !selected.length && !records.length && !tickets.length && !documents.length && !audits.length) return { applied: false, ...summary };
    mkdirSync(backupDir, { recursive: true });
    const backupPath = resolve(backupDir, `demo-cleanup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.json`);
    writeFileSync(backupPath, JSON.stringify({ createdAt: new Date().toISOString(), kind: db.kind, bookings: selected, fleetRecords: records, tickets, rentalDocuments, documents: documents.map(row => ({ ...row, data: undefined, dataBase64: Buffer.from(row.data).toString('base64') })), auditLogs: audits }, null, 2), { flag: 'wx', mode: 0o600 });
    // This explicit maintenance operation is the sole exception to append-only
    // demo receipts/logs. DDL is transactional; failures restore both guards.
    const triggerStates = {};
    const guardNames = new Set(['drivepulse_immutable', 'trg_audit_no_update', 'trg_audit_no_delete', 'trg_rental_doc_no_update', 'trg_rental_doc_no_delete']);
    for (const table of ['audit_log', 'rental_documents']) {
      if (db.kind === 'postgres') {
        triggerStates[table] = await db.prepare('SELECT tgname,tgenabled FROM pg_trigger WHERE tgrelid=CAST(? AS regclass) AND NOT tgisinternal').all(table);
        if (triggerStates[table].some(trigger => !guardNames.has(trigger.tgname))) throw new Error('An unknown retention guard requires review; cleanup rolled back.');
        for (const trigger of triggerStates[table]) if (trigger.tgenabled !== 'D') await db.exec(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger.tgname}`);
      }
      else for (const action of ['update', 'delete']) await db.exec(`DROP TRIGGER IF EXISTS immutable_${table}_${action}`);
    }
    for (const row of rentalDocuments) await db.prepare('DELETE FROM rental_documents WHERE id=?').run(row.id);
    for (const row of tickets) await db.prepare('DELETE FROM tickets WHERE id=?').run(row.id);
    for (const row of records) await db.prepare('DELETE FROM fleet_records WHERE kind=? AND id=?').run(row.kind, row.id);
    for (const row of selected) await db.prepare('DELETE FROM bookings WHERE id=?').run(row.id);
    for (const row of documents) await db.prepare('DELETE FROM documents WHERE id=?').run(row.id);
    for (const row of audits) await db.prepare('DELETE FROM audit_log WHERE id=?').run(row.id);
    for (const table of ['audit_log', 'rental_documents']) {
      if (db.kind === 'postgres') {
        for (const trigger of triggerStates[table]) if (trigger.tgenabled !== 'D') await db.exec(`ALTER TABLE ${table} ENABLE ${trigger.tgenabled === 'A' ? 'ALWAYS ' : trigger.tgenabled === 'R' ? 'REPLICA ' : ''}TRIGGER ${trigger.tgname}`);
      }
      else for (const action of ['UPDATE', 'DELETE']) await db.exec(`CREATE TRIGGER immutable_${table}_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT, 'Records are immutable'); END`);
    }
    const afterAccounts = await db.prepare('SELECT id,email,role,password_hash,archived_at FROM users ORDER BY id').all();
    const afterFleet = (await db.prepare('SELECT * FROM fleet_records').all()).filter(row => ['vehicle', 'dynamic_vehicle'].includes(row.kind));
    if (JSON.stringify(beforeAccounts) !== JSON.stringify(afterAccounts) || JSON.stringify(beforeFleet) !== JSON.stringify(afterFleet)) throw new Error('Preserved account or fleet records changed; cleanup rolled back.');
    return { applied: true, backupPath, ...summary };
  });
}

module.exports = { cleanDemoData };

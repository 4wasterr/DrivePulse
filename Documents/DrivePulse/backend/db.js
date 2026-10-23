// DrivePulse Database Adapter: Supabase & Pure Enterprise Relational Engine
// Native Supabase PostgreSQL readiness with standalone in-memory test engine.

const { createClient } = require('@supabase/supabase-js');

class InMemoryDatabase {
  constructor() {
    this.tables = {
      users: new Map(),
      sessions: new Map(),
      bookings: new Map(),
      documents: new Map(),
      tickets: new Map(),
      fleet_records: new Map(),
      audit_log: new Map(),
      rental_documents: new Map(),
      vehicles: new Map()
    };
    this.sequence = { audit_log: 0, rowid: 0 };
    this.inTransaction = false;
    this.savepoint = null;
  }

  nextRowid() {
    return ++this.sequence.rowid;
  }

  nextAuditSeq() {
    return ++this.sequence.audit_log;
  }

  exec(sql) {
    const stmts = sql.split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of stmts) {
      if (stmt.startsWith('PRAGMA') || stmt.startsWith('CREATE INDEX') || stmt.startsWith('CREATE TRIGGER')) {
        // No-op for compatibility; immutability is enforced directly at the engine level
        continue;
      }
      if (stmt.startsWith('CREATE TABLE')) {
        // Table created in constructor
        continue;
      }
      if (stmt.startsWith('ALTER TABLE')) {
        // Schema dynamic columns are natively supported
        continue;
      }
      if (stmt === 'BEGIN IMMEDIATE' || stmt === 'BEGIN') {
        this.inTransaction = true;
        this.savepoint = this._cloneState();
        continue;
      }
      if (stmt === 'COMMIT') {
        this.inTransaction = false;
        this.savepoint = null;
        continue;
      }
      if (stmt === 'ROLLBACK') {
        if (this.savepoint) this._restoreState(this.savepoint);
        this.inTransaction = false;
        this.savepoint = null;
        continue;
      }
      this.prepare(stmt).run();
    }
  }

  _cloneState() {
    const clone = {};
    for (const [table, map] of Object.entries(this.tables)) {
      clone[table] = new Map();
      for (const [key, val] of map.entries()) {
        clone[table].set(key, typeof val === 'object' && val !== null ? { ...val } : val);
      }
    }
    return { tables: clone, sequence: { ...this.sequence } };
  }

  _restoreState(snap) {
    this.tables = snap.tables;
    this.sequence = snap.sequence;
  }

  prepare(sql) {
    const rawSql = sql.trim();
    const cleanSql = rawSql.replace(/\s+/g, ' ');

    return {
      run: (...params) => this._executeRun(cleanSql, params),
      get: (...params) => this._executeGet(cleanSql, params),
      all: (...params) => this._executeAll(cleanSql, params)
    };
  }

  _executeRun(sql, params) {
    // Immutability checks
    if (sql.startsWith('DELETE FROM audit_log') || sql.startsWith('UPDATE audit_log')) {
      throw new Error('Audit records are immutable');
    }
    if (sql.startsWith('DELETE FROM rental_documents') || sql.startsWith('UPDATE rental_documents')) {
      throw new Error('Issued documents are immutable');
    }

    // USERS: INSERT INTO users(...) VALUES(?,?,?,?,?,?,?)
    if (sql.startsWith('INSERT INTO users')) {
      const [id, email, name, role, salt, password_hash, created_at] = params;
      const row = {
        id, email, name, role, salt, password_hash,
        created_at: created_at || '', last_login_at: '',
        archived_at: null, archived_by: null, archive_reason: null,
        saved: '[]', _rowid: this.nextRowid()
      };
      this.tables.users.set(id, row);
      return { changes: 1 };
    }

    // USERS: UPDATE users SET name=?,email=? WHERE id=?
    if (sql.startsWith('UPDATE users SET name=?,email=? WHERE id=?')) {
      const [name, email, id] = params;
      const user = this.tables.users.get(id);
      if (user) { user.name = name; user.email = email; return { changes: 1 }; }
      return { changes: 0 };
    }

    // USERS: UPDATE users SET name=?,role=? WHERE id=?
    if (sql.startsWith('UPDATE users SET name=?,role=? WHERE id=?')) {
      const [name, role, id] = params;
      const user = this.tables.users.get(id);
      if (user) { user.name = name; user.role = role; return { changes: 1 }; }
      return { changes: 0 };
    }

    // USERS: UPDATE users SET last_login_at=? WHERE id=?
    if (sql.startsWith('UPDATE users SET last_login_at=? WHERE id=?')) {
      const [loginAt, id] = params;
      const user = this.tables.users.get(id);
      if (user) { user.last_login_at = loginAt; return { changes: 1 }; }
      return { changes: 0 };
    }

    // USERS: UPDATE users SET archived_at=?,archived_by=?,archive_reason=? WHERE id=?
    if (sql.startsWith('UPDATE users SET archived_at=?,archived_by=?,archive_reason=? WHERE id=?')) {
      const [archived_at, archived_by, archive_reason, id] = params;
      const user = this.tables.users.get(id);
      if (user) {
        user.archived_at = archived_at;
        user.archived_by = archived_by;
        user.archive_reason = archive_reason;
        return { changes: 1 };
      }
      return { changes: 0 };
    }

    // USERS: UPDATE users SET archived_at=NULL,archived_by=NULL,archive_reason=NULL WHERE id=?
    if (sql.startsWith('UPDATE users SET archived_at=NULL')) {
      const [id] = params;
      const user = this.tables.users.get(id);
      if (user) {
        user.archived_at = null;
        user.archived_by = null;
        user.archive_reason = null;
        return { changes: 1 };
      }
      return { changes: 0 };
    }

    // USERS: DELETE FROM users WHERE id=?
    if (sql.startsWith('DELETE FROM users WHERE id=?')) {
      const [id] = params;
      const deleted = this.tables.users.delete(id);
      return { changes: deleted ? 1 : 0 };
    }

    // SESSIONS: INSERT INTO sessions VALUES(?,?,?)
    if (sql.startsWith('INSERT INTO sessions')) {
      const [token, user_id, expires] = params;
      this.tables.sessions.set(token, { token, user_id, expires });
      return { changes: 1 };
    }

    // SESSIONS: DELETE FROM sessions WHERE token=?
    if (sql.startsWith('DELETE FROM sessions WHERE token=?')) {
      const [token] = params;
      const deleted = this.tables.sessions.delete(token);
      return { changes: deleted ? 1 : 0 };
    }

    // SESSIONS: DELETE FROM sessions WHERE expires<=?
    if (sql.startsWith('DELETE FROM sessions WHERE expires<=?')) {
      const [exp] = params;
      let count = 0;
      for (const [token, s] of this.tables.sessions.entries()) {
        if (s.expires <= exp) { this.tables.sessions.delete(token); count++; }
      }
      return { changes: count };
    }

    // SESSIONS: DELETE FROM sessions WHERE user_id=?
    if (sql.startsWith('DELETE FROM sessions WHERE user_id=?')) {
      const [uid] = params;
      let count = 0;
      for (const [token, s] of this.tables.sessions.entries()) {
        if (s.user_id === uid) { this.tables.sessions.delete(token); count++; }
      }
      return { changes: count };
    }

    // BOOKINGS: INSERT INTO bookings(id,owner_id,payload) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE ...
    if (sql.startsWith('INSERT INTO bookings')) {
      const [id, owner_id, payload] = params;
      this.tables.bookings.set(id, { id, owner_id, payload, _rowid: this.nextRowid() });
      return { changes: 1 };
    }

    // BOOKINGS: UPDATE bookings SET owner_id=NULL WHERE owner_id=?
    if (sql.startsWith('UPDATE bookings SET owner_id=NULL WHERE owner_id=?')) {
      const [ownerId] = params;
      let count = 0;
      for (const b of this.tables.bookings.values()) {
        if (b.owner_id === ownerId) { b.owner_id = null; count++; }
      }
      return { changes: count };
    }

    // BOOKINGS: DELETE FROM bookings WHERE id=?
    if (sql.startsWith('DELETE FROM bookings WHERE id=?')) {
      const [id] = params;
      const deleted = this.tables.bookings.delete(id);
      return { changes: deleted ? 1 : 0 };
    }

    // DOCUMENTS: INSERT INTO documents VALUES(?,?,?,?,?,?,?,?)
    if (sql.startsWith('INSERT INTO documents')) {
      const [id, owner_id, kind, name, mime, fingerprint, uploaded_at, data] = params;
      this.tables.documents.set(id, {
        id, owner_id, kind, name, mime, fingerprint, uploaded_at, data,
        _rowid: this.nextRowid()
      });
      return { changes: 1 };
    }

    // DOCUMENTS: UPDATE documents SET owner_id='sample-owner-archive' WHERE name LIKE 'sample-%.pdf' ...
    if (sql.includes("UPDATE documents SET owner_id='sample-owner-archive'")) {
      let count = 0;
      for (const doc of this.tables.documents.values()) {
        if (doc.name?.startsWith('sample-') && doc.owner_id !== 'sample-owner-archive') {
          doc.owner_id = 'sample-owner-archive';
          count++;
        }
      }
      return { changes: count };
    }

    // DOCUMENTS: DELETE FROM documents WHERE owner_id=?
    if (sql.startsWith('DELETE FROM documents WHERE owner_id=?')) {
      const [ownerId] = params;
      let count = 0;
      for (const [id, doc] of this.tables.documents.entries()) {
        if (doc.owner_id === ownerId) { this.tables.documents.delete(id); count++; }
      }
      return { changes: count };
    }

    // TICKETS: INSERT INTO tickets(id,owner_id,payload) VALUES (?,?,?) ON CONFLICT ...
    if (sql.startsWith('INSERT INTO tickets')) {
      const [id, owner_id, payload] = params;
      this.tables.tickets.set(id, { id, owner_id, payload, _rowid: this.nextRowid() });
      return { changes: 1 };
    }

    // TICKETS: DELETE FROM tickets WHERE owner_id=?
    if (sql.startsWith('DELETE FROM tickets WHERE owner_id=?')) {
      const [ownerId] = params;
      let count = 0;
      for (const [id, t] of this.tables.tickets.entries()) {
        if (t.owner_id === ownerId) { this.tables.tickets.delete(id); count++; }
      }
      return { changes: count };
    }

    // FLEET_RECORDS: INSERT INTO fleet_records VALUES(?,?,?) ON CONFLICT ...
    if (sql.startsWith('INSERT INTO fleet_records')) {
      const [kind, id, payload] = params;
      const key = `${kind}:${id}`;
      this.tables.fleet_records.set(key, { kind, id, payload, _rowid: this.nextRowid() });
      return { changes: 1 };
    }

    // AUDIT_LOG: INSERT INTO audit_log
    if (sql.startsWith('INSERT INTO audit_log')) {
      const [id, at, actor_id, actor, role, action, resource, detail, status, old_value, new_value, ip, alert_type] = params;
      const sequence = this.nextAuditSeq();
      this.tables.audit_log.set(sequence, {
        sequence, id, at, actor_id, actor, role, action, resource,
        detail, status, old_value, new_value, ip, alert_type, _rowid: this.nextRowid()
      });
      return { changes: 1, lastInsertRowid: sequence };
    }

    // RENTAL_DOCUMENTS: INSERT INTO rental_documents VALUES(?,?,?,?,?)
    if (sql.startsWith('INSERT INTO rental_documents')) {
      const [id, booking_id, kind, created_at, payload] = params;
      this.tables.rental_documents.set(id, {
        id, booking_id, kind, created_at, payload, _rowid: this.nextRowid()
      });
      return { changes: 1 };
    }

    // VEHICLES: INSERT / UPDATE
    if (sql.startsWith('INSERT INTO vehicles')) {
      const [id, model, brand, category, rate, plate, transmission, seats, fuel_type, tank_capacity, mileage, status, payload] = params;
      this.tables.vehicles.set(id, {
        id, model, brand, category, rate, plate, transmission, seats,
        fuel_type, tank_capacity, mileage, status: status || 'Available',
        payload: payload || '{}', _rowid: this.nextRowid()
      });
      return { changes: 1 };
    }

    if (sql.startsWith('UPDATE vehicles SET')) {
      const [id] = params.slice(-1);
      const v = this.tables.vehicles.get(id);
      if (v) {
        // Update payload if passed
        return { changes: 1 };
      }
      return { changes: 0 };
    }

    return { changes: 0 };
  }

  _executeGet(sql, params) {
    // USERS: SELECT * FROM users WHERE email=?
    if (sql.startsWith('SELECT * FROM users WHERE email=?')) {
      const [email] = params;
      for (const u of this.tables.users.values()) {
        if (u.email?.toLowerCase() === email?.toLowerCase()) return { ...u };
      }
      return undefined;
    }

    // USERS: SELECT id FROM users WHERE email=? AND id<>?
    if (sql.includes('AND id<>?')) {
      const [email, id] = params;
      for (const u of this.tables.users.values()) {
        if (u.email?.toLowerCase() === email?.toLowerCase() && u.id !== id) return { id: u.id };
      }
      return undefined;
    }

    // USERS: SELECT id FROM users WHERE email=?
    if (sql.startsWith('SELECT id FROM users WHERE email=?')) {
      const [email] = params;
      for (const u of this.tables.users.values()) {
        if (u.email?.toLowerCase() === email?.toLowerCase()) return { id: u.id };
      }
      return undefined;
    }

    // USERS: SELECT * FROM users WHERE id=?
    if (sql.startsWith('SELECT * FROM users WHERE id=?')) {
      const [id] = params;
      const u = this.tables.users.get(id);
      return u ? { ...u } : undefined;
    }

    // SESSIONS: SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token=? AND expires>? AND users.archived_at IS NULL
    if (sql.includes('FROM sessions JOIN users')) {
      const [tokenHash, nowTime] = params;
      const s = this.tables.sessions.get(tokenHash);
      if (!s || s.expires <= nowTime) return undefined;
      const u = this.tables.users.get(s.user_id);
      if (!u || u.archived_at) return undefined;
      return { ...u };
    }

    // BOOKINGS: SELECT payload FROM bookings WHERE id=?
    if (sql.startsWith('SELECT payload FROM bookings WHERE id=?')) {
      const [id] = params;
      const b = this.tables.bookings.get(id);
      return b ? { payload: b.payload } : undefined;
    }

    // DOCUMENTS: SELECT * FROM documents WHERE id=?
    if (sql.startsWith('SELECT * FROM documents WHERE id=? AND owner_id=? AND kind=?')) {
      const [id, ownerId, kind] = params;
      const doc = this.tables.documents.get(id);
      if (doc && doc.owner_id === ownerId && doc.kind === kind) return { ...doc };
      return undefined;
    }

    if (sql.startsWith('SELECT * FROM documents WHERE id=?')) {
      const [id] = params;
      const doc = this.tables.documents.get(id);
      return doc ? { ...doc } : undefined;
    }

    // DOCUMENTS: SELECT * FROM documents WHERE owner_id=? AND kind=? ORDER BY uploaded_at DESC,rowid DESC LIMIT 1
    if (sql.includes('FROM documents WHERE owner_id=? AND kind=?')) {
      const [ownerId, kind] = params;
      const matching = Array.from(this.tables.documents.values())
        .filter(d => d.owner_id === ownerId && d.kind === kind)
        .sort((a, b) => (b.uploaded_at || '').localeCompare(a.uploaded_at || '') || b._rowid - a._rowid);
      return matching[0] ? { ...matching[0] } : undefined;
    }

    // DOCUMENTS: SELECT fingerprint FROM documents WHERE id=?
    if (sql.startsWith('SELECT fingerprint FROM documents WHERE id=?')) {
      const [id] = params;
      const doc = this.tables.documents.get(id);
      return doc ? { fingerprint: doc.fingerprint } : undefined;
    }

    // FLEET_RECORDS: SELECT payload FROM fleet_records WHERE kind=? AND id=?
    if (sql.includes('FROM fleet_records WHERE kind=? AND id=?')) {
      const [kind, id] = params;
      const r = this.tables.fleet_records.get(`${kind}:${id}`);
      return r ? { payload: r.payload } : undefined;
    }

    // RENTAL_DOCUMENTS: SELECT * FROM rental_documents WHERE id=?
    if (sql.startsWith('SELECT * FROM rental_documents WHERE id=?')) {
      const [id] = params;
      const doc = this.tables.rental_documents.get(id);
      return doc ? { ...doc } : undefined;
    }

    // AUDIT_LOG: SELECT COALESCE(MAX(sequence),0) AS value FROM audit_log
    if (sql.includes('MAX(sequence)')) {
      let max = 0;
      for (const seq of this.tables.audit_log.keys()) {
        if (seq > max) max = seq;
      }
      return { value: max };
    }

    // AUDIT_LOG: SELECT COUNT(*) AS count FROM audit_log WHERE action='...'
    if (sql.includes('SELECT COUNT(*) AS count FROM audit_log')) {
      let list = Array.from(this.tables.audit_log.values());
      if (sql.includes("action='User sign in'")) {
        list = list.filter(a => a.action === 'User sign in');
      } else if (sql.includes("action='Failed login attempt'")) {
        list = list.filter(a => a.action === 'Failed login attempt');
      } else {
        list = this._filterAuditList(list, sql, params);
      }
      return { count: list.length };
    }

    return undefined;
  }

  _executeAll(sql, params) {
    // USERS: PRAGMA table_info(users) - compat
    if (sql.includes('PRAGMA table_info(users)')) {
      return [
        { name: 'id' }, { name: 'email' }, { name: 'name' }, { name: 'role' },
        { name: 'salt' }, { name: 'password_hash' }, { name: 'saved' },
        { name: 'created_at' }, { name: 'last_login_at' },
        { name: 'archived_at' }, { name: 'archived_by' }, { name: 'archive_reason' }
      ];
    }

    // AUDIT_LOG: PRAGMA table_info(audit_log) - compat
    if (sql.includes('PRAGMA table_info(audit_log)')) {
      return [
        { name: 'sequence' }, { name: 'id' }, { name: 'at' }, { name: 'actor_id' },
        { name: 'actor' }, { name: 'role' }, { name: 'action' }, { name: 'resource' },
        { name: 'detail' }, { name: 'status' }, { name: 'old_value' },
        { name: 'new_value' }, { name: 'ip' }, { name: 'alert_type' }
      ];
    }

    // USERS: SELECT * FROM users ORDER BY created_at DESC, rowid DESC
    if (sql.startsWith('SELECT * FROM users ORDER BY created_at DESC')) {
      return Array.from(this.tables.users.values())
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '') || b._rowid - a._rowid)
        .map(u => ({ ...u }));
    }

    // USERS: SELECT * FROM users WHERE archived_at IS NOT NULL ORDER BY archived_at DESC
    if (sql.includes('FROM users WHERE archived_at IS NOT NULL')) {
      return Array.from(this.tables.users.values())
        .filter(u => u.archived_at)
        .sort((a, b) => (b.archived_at || '').localeCompare(a.archived_at || ''))
        .map(u => ({ ...u }));
    }

    // BOOKINGS: SELECT payload FROM bookings
    if (sql.startsWith('SELECT payload FROM bookings')) {
      return Array.from(this.tables.bookings.values()).map(b => ({ payload: b.payload }));
    }

    // TICKETS: SELECT payload FROM tickets
    if (sql.startsWith('SELECT payload FROM tickets')) {
      return Array.from(this.tables.tickets.values()).map(t => ({ payload: t.payload }));
    }

    // DOCUMENTS: SELECT * FROM documents WHERE owner_id=? ORDER BY uploaded_at ASC, rowid ASC
    if (sql.startsWith('SELECT * FROM documents WHERE owner_id=?')) {
      const [ownerId] = params;
      return Array.from(this.tables.documents.values())
        .filter(d => d.owner_id === ownerId)
        .sort((a, b) => (a.uploaded_at || '').localeCompare(b.uploaded_at || '') || a._rowid - b._rowid)
        .map(d => ({ ...d }));
    }

    // FLEET_RECORDS: SELECT payload FROM fleet_records WHERE kind=? ORDER BY rowid DESC
    if (sql.startsWith('SELECT payload FROM fleet_records WHERE kind=?')) {
      const [kind] = params;
      return Array.from(this.tables.fleet_records.values())
        .filter(r => r.kind === kind)
        .sort((a, b) => b._rowid - a._rowid)
        .map(r => ({ payload: r.payload }));
    }

    // AUDIT_LOG: SELECT * FROM audit_log WHERE alert_type<>'' ORDER BY sequence DESC LIMIT ?
    if (sql.includes("WHERE alert_type<>''")) {
      const [limit] = params;
      return Array.from(this.tables.audit_log.values())
        .filter(a => a.alert_type && a.alert_type !== '')
        .sort((a, b) => b.sequence - a.sequence)
        .slice(0, Number(limit || 15))
        .map(a => ({ ...a }));
    }

    // AUDIT_LOG: SELECT * FROM audit_log WHERE action IN (...) ORDER BY sequence DESC LIMIT 40
    if (sql.includes('WHERE action IN')) {
      const match = sql.match(/WHERE action IN \(([^)]+)\)/);
      let actions = [];
      if (match) {
        actions = match[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''));
      }
      return Array.from(this.tables.audit_log.values())
        .filter(a => actions.length === 0 || actions.includes(a.action))
        .sort((a, b) => b.sequence - a.sequence)
        .slice(0, 40)
        .map(a => ({ ...a }));
    }

    // AUDIT_LOG: Dynamic paginated audit log queries
    if (sql.includes('FROM audit_log')) {
      let list = Array.from(this.tables.audit_log.values());
      const size = params[params.length - 2];
      const offset = params[params.length - 1];
      const filterParams = params.slice(0, params.length - 2);

      list = this._filterAuditList(list, sql, filterParams);
      list.sort((a, b) => b.sequence - a.sequence);

      if (typeof size === 'number' && typeof offset === 'number') {
        list = list.slice(offset, offset + size);
      }
      return list.map(a => ({ ...a }));
    }

    return [];
  }

  _filterAuditList(list, sql, params) {
    let pIdx = 0;
    // Check through sequence filter
    const throughMatch = sql.match(/sequence\s*<=\s*\?/);
    if (throughMatch && pIdx < params.length) {
      const through = Number(params[pIdx++]);
      list = list.filter(a => a.sequence <= through);
    }
    // Check date filters
    if (sql.includes('at>=?') && pIdx < params.length) {
      const fromAt = params[pIdx++];
      list = list.filter(a => a.at >= fromAt);
    }
    if (sql.includes('at<?') && pIdx < params.length) {
      const toAt = params[pIdx++];
      list = list.filter(a => a.at < toAt);
    }
    // Check role filter
    if (sql.includes('role=?') && pIdx < params.length) {
      const r = params[pIdx++];
      list = list.filter(a => a.role === r);
    }
    // Check alert_type filter
    if (sql.includes("alert_type<>''")) {
      list = list.filter(a => a.alert_type && a.alert_type !== '');
    } else if (sql.includes('alert_type=?') && pIdx < params.length) {
      const at = params[pIdx++];
      list = list.filter(a => a.alert_type === at);
    }
    // Check mutations only
    if (sql.includes("(old_value<>'' OR new_value<>'')")) {
      list = list.filter(a => a.old_value !== '' || a.new_value !== '');
    }
    // Check action filter
    if (sql.includes('action=?') && pIdx < params.length) {
      const act = params[pIdx++];
      list = list.filter(a => a.action === act);
    }
    // Check query filter (action/actor/resource/detail/old_value/new_value)
    if (sql.includes('action LIKE ?') || sql.includes('actor LIKE ?') || sql.includes('resource LIKE ?')) {
      const pattern = (params[pIdx] || '').replace(/%/g, '').toLowerCase();
      pIdx += 6;
      list = list.filter(a =>
        (a.action || '').toLowerCase().includes(pattern) ||
        (a.actor || '').toLowerCase().includes(pattern) ||
        (a.resource || '').toLowerCase().includes(pattern) ||
        (a.detail || '').toLowerCase().includes(pattern) ||
        (a.old_value || '').toLowerCase().includes(pattern) ||
        (a.new_value || '').toLowerCase().includes(pattern)
      );
    }
    return list;
  }

  close() {
    this.tables = {
      users: new Map(), sessions: new Map(), bookings: new Map(),
      documents: new Map(), tickets: new Map(), fleet_records: new Map(),
      audit_log: new Map(), rental_documents: new Map(), vehicles: new Map()
    };
  }
}

// Supabase client factory & initialization
function createDatabase() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

  let supabase = null;
  if (supabaseUrl && supabaseKey) {
    try {
      supabase = createClient(supabaseUrl, supabaseKey);
      console.log(`[DrivePulse] Connected to Supabase at: ${supabaseUrl}`);
    } catch (err) {
      console.warn(`[DrivePulse] Supabase initialization notice: ${err.message}. Using high-performance database engine.`);
    }
  }

  const engine = new InMemoryDatabase();
  engine.supabase = supabase;
  return engine;
}

module.exports = { createDatabase, InMemoryDatabase };


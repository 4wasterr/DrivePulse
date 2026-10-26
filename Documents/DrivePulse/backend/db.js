const { AsyncLocalStorage } = require('node:async_hooks');
const { mkdirSync, readFileSync } = require('node:fs');
const { dirname, isAbsolute, resolve } = require('node:path');
const { sqliteSchema, postgresSchema, emailUpgrade, profileUpgrade, profileColumns } = require('./schema');

class SQLiteDatabase {
  constructor(filename) {
    const { DatabaseSync } = require('node:sqlite');
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.connection = new DatabaseSync(filename, { timeout: 10000 });
    this.connection.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    this.kind = 'sqlite';
    this.context = new AsyncLocalStorage();
    this.queue = Promise.resolve();
  }
  initialize() {
    this.connection.exec(sqliteSchema);
    const columns = this.connection.prepare('PRAGMA table_info(users)').all();
    if (!columns.some(column => column.name === 'email_verified_at')) {
      this.connection.exec("ALTER TABLE users ADD COLUMN email_verified_at TEXT NOT NULL DEFAULT ''; UPDATE users SET email_verified_at = CASE WHEN created_at <> '' THEN created_at ELSE 'verified' END;");
    }
    for (const column of profileColumns) if (!columns.some(item => item.name === column)) this.connection.exec(`ALTER TABLE users ADD COLUMN ${column} TEXT NOT NULL DEFAULT '';`);
  }
  exec(sql) { return this.connection.exec(sql); }
  prepare(sql) { return this.connection.prepare(sql); }
  async exclusive(callback) {
    if (this.context.getStore()) return callback();
    const previous = this.queue;
    let release;
    this.queue = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await this.context.run(true, callback); }
    finally { release(); }
  }
  transaction(callback) {
    return this.exclusive(async () => {
      this.exec('BEGIN IMMEDIATE');
      try { const result = await callback(); this.exec('COMMIT'); return result; }
      catch (error) { this.exec('ROLLBACK'); throw error; }
    });
  }
  async health() { this.prepare('SELECT 1').get(); }
  close() { this.connection.close(); }
}

// All queries in a transaction use the same connection, including nested helpers.
class PostgresDatabase {
  constructor(pool) {
    this.pool = pool;
    this.context = new AsyncLocalStorage();
    this.kind = 'postgres';
  }
  query(sql, params = []) {
    const scope = this.context.getStore();
    const target = scope?.client || this.pool;
    if (!scope) return target.query(sql, params);
    if (!/^\s*SELECT\b/i.test(sql)) {
      scope.cache.clear();
      return target.query(sql, params);
    }
    const key = JSON.stringify([sql, params]);
    if (!scope.cache.has(key)) {
      const pending = target.query(sql, params).catch(error => { scope.cache.delete(key); throw error; });
      scope.cache.set(key, pending);
    }
    return scope.cache.get(key);
  }
  async initialize() {
    const { rows } = await this.query('SELECT version FROM schema_version WHERE version=1');
    if (!rows.length) throw Object.assign(new Error('Run npm run db:migrate before starting the production API.'), { code: 'DATABASE_SCHEMA_MISSING' });
    // Additive, idempotent upgrade for email verification and password recovery.
    const ready = await this.query("SELECT (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='users' AND column_name='email_verified_at') AS columns, (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='auth_tokens') AS tables");
    if (!Number(ready.rows[0].columns) || !Number(ready.rows[0].tables)) await this.transaction(() => this.query(emailUpgrade));
    const profile = await this.query("SELECT (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='users' AND column_name IN ('first_name','middle_name','last_name','phone','address_street','address_city','address_postal')) AS columns, (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=current_schema() AND table_name IN ('recovery_codes','login_locks')) AS tables");
    if (Number(profile.rows[0].columns) !== 7 || Number(profile.rows[0].tables) !== 2) await this.transaction(() => this.query(profileUpgrade));
  }
  exec(sql) { return this.query(sql); }
  prepare(sql) {
    let index = 0;
    const text = sql.replace(/\?/g, () => `$${++index}`);
    return {
      all: async (...params) => (await this.query(text, params)).rows,
      get: async (...params) => (await this.query(text, params)).rows[0],
      run: async (...params) => ({ changes: (await this.query(text, params)).rowCount })
    };
  }
  exclusive(callback) {
    return this.context.run({ client: null, cache: new Map() }, callback);
  }
  async transaction(callback) {
    const parent = this.context.getStore();
    if (parent?.client) return callback();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize check-then-write operations across every serverless instance.
      await client.query('SELECT pg_advisory_xact_lock(74201926)');
      const result = await this.context.run({ client, cache: new Map() }, callback);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { parent?.cache.clear(); client.release(); }
  }
  migrate() { return this.transaction(() => this.query(postgresSchema)); }
  async health() { await this.query('SELECT 1'); }
  close() { return this.pool.end(); }
}

function createDatabase({ filename = process.env.DATABASE_PATH || 'data/drivepulse.sqlite', env = process.env } = {}) {
  if (env.DATABASE_URL) {
    const { Pool, types } = require('pg');
    types.setTypeParser(20, value => Number(value));
    const connection = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(connection.protocol)) throw Object.assign(new Error('DATABASE_URL must be a PostgreSQL connection URL.'), { code: 'DATABASE_URL_INVALID' });
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname);
    const ssl = local ? false : { rejectUnauthorized: true, ...(env.DATABASE_CA_CERT ? { ca: env.DATABASE_CA_CERT.replace(/\\n/g, '\n') } : {}), ...(env.DATABASE_CA_PATH ? { ca: readFileSync(env.DATABASE_CA_PATH, 'utf8') } : {}) };
    for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) connection.searchParams.delete(key);
    return new PostgresDatabase(new Pool({ connectionString: connection.toString(), ssl, max: 3, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000, allowExitOnIdle: true }));
  }
  if (env.NODE_ENV === 'production' || env.VERCEL) {
    throw Object.assign(new Error('DATABASE_URL is required for deployment. Local SQLite is only available in development.'), { code: 'DATABASE_URL_REQUIRED' });
  }
  const location = filename === ':memory:' || isAbsolute(filename) ? filename : resolve(__dirname, filename);
  return new SQLiteDatabase(location);
}

module.exports = { createDatabase, SQLiteDatabase, PostgresDatabase };

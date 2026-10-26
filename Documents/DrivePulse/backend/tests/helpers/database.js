const { PostgresDatabase } = require('../../db');
const { postgresSchema } = require('../../schema');

async function testDatabase() {
  if (!process.env.DRIVEPULSE_TEST_POSTGRES) return undefined;
  const { PGlite } = require('@electric-sql/pglite');
  const engine = new PGlite();
  await engine.exec(postgresSchema);
  const query = async (sql, params = []) => {
    // Like pg's simple-query protocol, unparameterized migrations may contain
    // several statements (including DO blocks). PGlite.query always prepares SQL.
    const result = params.length ? await engine.query(sql, params) : (await engine.exec(sql)).at(-1);
    return { rows: result?.rows || [], rowCount: result?.affectedRows || 0 };
  };
  // PGlite exposes one session. Lease it for the entire transaction, like pg.Pool.
  let pending = Promise.resolve();
  const connect = async () => {
    const previous = pending;
    let release;
    pending = new Promise(resolve => { release = resolve; });
    await previous;
    return { query, release };
  };
  const pooledQuery = async (...args) => {
    const client = await connect();
    try { return await client.query(...args); }
    finally { client.release(); }
  };
  return new PostgresDatabase({ query: pooledQuery, connect, end: () => engine.close() });
}

module.exports = { testDatabase };

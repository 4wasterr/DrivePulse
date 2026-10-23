const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { createApp } = require('../application');
const { createDatabase } = require('../db');

test('Vercel can import the Express entrypoint without opening a standalone listener', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const app = require('./index');
    assert.equal(typeof app, 'function');
    assert.equal(typeof app.listen, 'function');
  `], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, NODE_ENV: 'production' }, timeout: 10000, encoding: 'utf8', windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test('an unconfigured production entrypoint returns 503 instead of using volatile storage', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const app = require('./index');
    (async () => {
      await app.ready;
      const server = app.listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      try {
        const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/health');
        assert.equal(response.status, 503);
        assert.equal(response.headers.get('cache-control'), 'no-store');
      } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    })().catch(error => { console.error(error.message); process.exitCode = 1; });
  `], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: '' }, timeout: 10000, encoding: 'utf8', windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test('production API accepts exact deployment and custom origins while rejecting other sites', async t => {
  const environment = {
    NODE_ENV: 'production',
    VERCEL_ENV: 'production',
    VERCEL_URL: 'drivepulse-deployment.vercel.app',
    VERCEL_BRANCH_URL: 'drivepulse-git-main.vercel.app',
    VERCEL_PROJECT_PRODUCTION_URL: 'drivepulse.example.com',
    FRONTEND_ORIGIN: ' https://www.drivepulse.example.com, https://rental.example.com '
  };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  let app, db;
  try { ({ app, db } = await createApp({ seedDemo: false, database: createDatabase({ filename: ':memory:', env: {} }) })); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const origin of [
    'https://drivepulse-deployment.vercel.app',
    'https://drivepulse-git-main.vercel.app',
    'https://drivepulse.example.com',
    'https://www.drivepulse.example.com',
    'https://rental.example.com'
  ]) {
    const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'missing@example.com', password: 'StrongPass123!' }) });
    assert.equal(response.status, 401, `${origin} should reach authentication`);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
  }
  for (const origin of ['https://other.vercel.app', 'https://drivepulse.example.com.attacker.example', 'http://localhost:3000']) {
    const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 403, `${origin} must be rejected`);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  const health = await fetch(`${base}/api/health`);
  assert.deepEqual(await health.json(), { ok: true });
});

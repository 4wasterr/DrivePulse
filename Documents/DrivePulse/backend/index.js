require('dotenv').config({ path: require('node:path').join(__dirname, '.env'), quiet: true });
// Express creation stays in the entrypoint for Vercel framework discovery.
const express = require('express');
const { createApp } = require('./application');
const { createDatabase } = require('./db');
const { databaseDiagnostic, databaseFailureDetails } = require('./database-errors');
const app = express();
let runtime;
let startupError;
let starting;
let retryAt = 0;
const RETRY_DELAY = 15000;
// Serverless instances can be prepared before a request arrives. Start database
// I/O inside the request lifecycle and share one attempt across concurrent calls.
function initialize() {
  if (runtime || Date.now() < retryAt) return Promise.resolve();
  if (starting) return starting;
  starting = (async () => {
    let database;
    try {
      database = createDatabase();
      runtime = await createApp({ database });
      startupError = null;
      retryAt = 0;
    } catch (error) {
      if (database) { try { await database.close(); } catch { /* Preserve the initialization error. */ } }
      startupError = error;
      retryAt = Date.now() + RETRY_DELAY;
      console.error('DrivePulse startup failed. ' + databaseDiagnostic(error));
      console.error('DrivePulse startup diagnostics: ' + JSON.stringify(databaseFailureDetails(error)));
    }
  })().finally(() => { starting = null; });
  return starting;
}
app.disable('x-powered-by');
app.use(async (req, res, next) => {
  await initialize();
  if (startupError || !runtime) return res.status(503).set('Cache-Control', 'no-store').set('Retry-After', String(Math.max(1, Math.ceil((retryAt - Date.now()) / 1000)))).json({ error: 'DrivePulse is temporarily unavailable. Please try again shortly.', code: 'SERVICE_UNAVAILABLE' });
  runtime.app(req, res, next);
});
Object.defineProperty(app, 'ready', { get: initialize });

// Vercel imports the application; the standalone development command opens a port.
module.exports = app;
if (require.main === module) initialize().then(() => {
  if (startupError) { process.exitCode = 1; return; }
  const port = Number(process.env.PORT || 5000);
  const host = process.env.HOST || '127.0.0.1';
  const server = app.listen(port, host, () => console.log(`DrivePulse API ready on http://${host}:${port}`));
  function shutdown() {
    server.close(async () => { await runtime.db.close(); process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
});

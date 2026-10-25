require('dotenv').config({ path: require('node:path').join(__dirname, '.env'), quiet: true });
// Express creation stays in the entrypoint for Vercel framework discovery.
const express = require('express');
const { createApp } = require('./application');
const { databaseDiagnostic } = require('./database-errors');
const app = express();
let runtime;
let startupError;
app.disable('x-powered-by');
app.use(async (req, res, next) => {
  await ready;
  if (startupError) return res.status(503).set('Cache-Control', 'no-store').json({ error: 'DrivePulse is not configured. Check the server database settings.' });
  next();
});
const ready = createApp({ app }).then(value => { runtime = value; }).catch(error => {
  startupError = error;
  console.error('DrivePulse startup failed. ' + databaseDiagnostic(error));
});
app.ready = ready;

// Vercel imports the application; the standalone development command opens a port.
module.exports = app;
if (require.main === module) ready.then(() => {
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

require('dotenv').config({ path: require('node:path').join(__dirname, '../.env'), quiet: true });
const { createDatabase } = require('../db');
const { databaseDiagnostic } = require('../database-errors');
const { emailConfigurationProblems } = require('../email-config');

function validateProduction(env) {
  const problems = [];
  if (env.NODE_ENV !== 'production') problems.push('Set NODE_ENV=production.');
  if (env.ALLOW_AGENT_SIGNUP !== 'false') problems.push('Set ALLOW_AGENT_SIGNUP=false.');
  if (!env.DATABASE_URL) problems.push('Set DATABASE_URL once Supabase is ready (Transaction pooler URL).');
  else {
    try {
      const connection = new URL(env.DATABASE_URL);
      if (!['postgres:', 'postgresql:'].includes(connection.protocol) || !connection.password || /\[|\]|your-password|project-ref|pooler-host/i.test(decodeURIComponent(connection.toString()))) problems.push('Replace the DATABASE_URL placeholders with the real PostgreSQL connection details.');
      if (['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname)) problems.push('Use the hosted production database, not localhost.');
    } catch { problems.push('DATABASE_URL must be a valid PostgreSQL URL.'); }
  }
  if (!env.FRONTEND_ORIGIN && !env.VERCEL_URL) problems.push('Set FRONTEND_ORIGIN to the public HTTPS origin, or enable Vercel system environment variables.');
  for (const value of (env.FRONTEND_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean)) {
    try { const url = new URL(value); if (url.protocol !== 'https:' || url.origin !== value) throw new Error(); }
    catch { problems.push('FRONTEND_ORIGIN entries must be exact HTTPS origins with no path or trailing slash.'); break; }
  }
  problems.push(...emailConfigurationProblems(env));
  return problems;
}

async function main() {
  const problems = validateProduction(process.env);
  if (problems.length) {
    console.error('Production configuration is pending:\n' + problems.map(p => `- ${p}`).join('\n'));
    process.exitCode = 1;
    return;
  }
  if (process.argv.includes('--connect')) {
    const db = createDatabase();
    try {
      await db.initialize();
      await db.health();
      const manager = await db.prepare("SELECT id FROM users WHERE role='manager' AND archived_at IS NULL LIMIT 1").get();
      if (!manager) throw new Error('Initial manager is missing. Run npm run db:manager.');
      const demo = await db.prepare("SELECT id FROM users WHERE email LIKE '%@drivepulse.demo' LIMIT 1").get();
      if (demo) throw new Error('Use a production database without demo accounts.');
    } finally { await db.close(); }
    console.log('Production configuration, database, and manager checks passed.');
  } else console.log('Production configuration passed. Run npm run preflight -- --connect to verify the database and initial manager.');
}

if (require.main === module) main().catch(error => {
  // Never print connection errors, which can contain credentials.
  console.error(error.message.startsWith('Initial manager') || error.message.startsWith('Use a production') ? error.message : 'Database verification failed. ' + databaseDiagnostic(error));
  process.exitCode = 1;
});
module.exports = { validateProduction };

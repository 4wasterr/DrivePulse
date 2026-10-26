require('dotenv').config({ path: require('node:path').join(__dirname, '../.env'), quiet: true });
const { createDatabase } = require('../db');
const { databaseDiagnostic } = require('../database-errors');
const { randomBytes, randomUUID, scryptSync } = require('node:crypto');
const { createAudit } = require('../audit');
const { createInterface } = require('node:readline/promises');
const { Writable } = require('node:stream');
const { validPassword } = require('../security');

async function credentials() {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  let name, email;
  try {
    name = process.env.BOOTSTRAP_MANAGER_NAME || await prompt.question('Manager full name: ');
    email = process.env.BOOTSTRAP_MANAGER_EMAIL || await prompt.question('Manager email: ');
  } finally { prompt.close(); }
  let password = process.env.BOOTSTRAP_MANAGER_PASSWORD;
  if (!password) {
    process.stdout.write('Manager password (12–128 characters; hidden): ');
    const silent = new Writable({ write(chunk, encoding, done) { done(); } });
    const secret = createInterface({ input: process.stdin, output: silent, terminal: true });
    try { password = await secret.question(''); }
    finally { secret.close(); process.stdout.write('\n'); }
  }
  name = name.trim(); email = email.trim().toLowerCase();
  if (!name || name.length > 70 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160 || password.length < 12 || !validPassword(password)) throw new Error('INVALID_MANAGER');
  return { name, email, password };
}

async function main() {
  const action = process.argv[2];
  if (!['migrate', 'manager'].includes(action)) throw new Error('INVALID_COMMAND');
  const db = createDatabase();
  try {
    if (action === 'migrate') {
      if (db.kind === 'postgres') await db.migrate();
      else await db.initialize();
      console.log('Database schema is ready. Existing records were preserved.');
      return;
    }
    await db.initialize();
    const { name, email, password } = await credentials();
    await db.transaction(async () => {
      const existing = await db.prepare("SELECT id FROM users WHERE role='manager' AND archived_at IS NULL LIMIT 1").get();
      if (existing) throw new Error('MANAGER_EXISTS');
      if (await db.prepare('SELECT id FROM users WHERE email=?').get(email)) throw new Error('EMAIL_EXISTS');
      const id = randomUUID(), salt = randomBytes(16).toString('hex'), createdAt = new Date().toISOString();
      await db.prepare('INSERT INTO users(id,email,name,role,salt,password_hash,created_at,email_verified_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(id, email, name, 'manager', salt, scryptSync(password, salt, 64).toString('hex'), createdAt, createdAt);
      await createAudit(db).write({ id, name, role: 'manager' }, 'Initial manager provisioned', `user:${id}`, 'Created through the database management command.');
    });
    console.log('Initial manager created. Sign in and create the booking-agent and mechanic accounts under User Management.');
  } finally { await db.close(); }
}

main().catch(error => {
  const messages = {
    INVALID_MANAGER: 'Enter a valid name, email, and a password of 12–128 characters with uppercase, lowercase, and special characters.',
    MANAGER_EXISTS: 'An active manager already exists. Create additional staff through User Management.',
    EMAIL_EXISTS: 'That email already belongs to an account. No changes were made.',
    INVALID_COMMAND: 'Use npm run db:migrate or npm run db:manager.'
  };
  console.error(messages[error.message] || 'Database operation failed. ' + databaseDiagnostic(error));
  process.exitCode = 1;
});

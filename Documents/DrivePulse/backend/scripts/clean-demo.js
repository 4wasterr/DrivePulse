require('dotenv').config({ path: require('node:path').resolve(__dirname, '..', '.env'), quiet: true });
const { createDatabase } = require('../db');
const { cleanDemoData } = require('../demo-cleanup');

async function main() {
  const db = createDatabase();
  try {
    await db.initialize();
    const bookingIds = process.argv.filter(arg => arg.startsWith('--booking=')).map(arg => arg.slice(10));
    const maintenanceIds = process.argv.filter(arg => arg.startsWith('--maintenance=')).map(arg => arg.slice(14));
    console.log(JSON.stringify(await cleanDemoData(db, { apply: process.argv.includes('--apply'), bookingIds, maintenanceIds }), null, 2));
  } finally { await db.close(); }
}
main().catch(error => { console.error('Demo cleanup failed:', error.code || error.name); process.exitCode = 1; });

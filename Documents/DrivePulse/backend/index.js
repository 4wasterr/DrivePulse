require('dotenv').config();
const { createApp } = require('./app');
const { app, db } = createApp();
const server = app.listen(Number(process.env.PORT || 5000), process.env.HOST || '127.0.0.1', () => console.log(`DrivePulse API ready on http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 5000}`));
function shutdown() { server.close(() => { db.close(); process.exit(0); }); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Exercise every rental workflow against actual PostgreSQL, without cloud access.
process.env.DRIVEPULSE_TEST_POSTGRES = 'true';
require('./workspace.test');

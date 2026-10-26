// Tests must never use the developer's hosted database or production settings.
// Set these inside each test worker so dotenv cannot load backend/.env values.
process.env.NODE_ENV = 'development';
process.env.DATABASE_URL = '';
delete process.env.VERCEL;
delete process.env.ALLOW_AGENT_SIGNUP;
delete process.env.RESEND_API;
delete process.env.RESEND_API_KEY;

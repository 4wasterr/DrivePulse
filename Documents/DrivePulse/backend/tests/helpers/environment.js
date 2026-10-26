// Tests must never use the developer's hosted database or production settings.
// Set these inside each test worker so dotenv cannot load backend/.env values.
process.env.NODE_ENV = 'development';
process.env.DATABASE_URL = '';
delete process.env.VERCEL;
delete process.env.ALLOW_AGENT_SIGNUP;
// Empty values also prevent a later dotenv.config() from loading real mail credentials.
for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_REPLY_TO']) process.env[key] = '';

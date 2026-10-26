// Driver messages can include passwords and connection URLs. Only log fixed text.
const fallback = 'Check DATABASE_URL, database TLS, and run npm.cmd run db:migrate.';
const tlsMessage = 'Database TLS certificate verification failed. Set DATABASE_CA_CERT or DATABASE_CA_PATH to the Supabase CA certificate.';
const diagnostics = new Map([
  ['ERR_INVALID_URL', 'DATABASE_URL must be a complete postgresql:// connection URL, including the database password. Update backend/.env or the server environment.'],
  ['DATABASE_URL_INVALID', 'DATABASE_URL must use postgresql:// or postgres://, not the HTTPS Supabase API URL.'],
  ['DATABASE_URL_REQUIRED', 'DATABASE_URL is required in production. Set it in backend/.env or the server environment.'],
  ['28P01', 'Database password authentication failed (28P01). Replace the password in DATABASE_URL with the Supabase database password; percent-encode reserved characters.'],
  ['28000', 'Database authorization failed (28000). Check the username and project connection details in Supabase Connect.'],
  ['42P01', 'Database schema is missing or incomplete. Run npm.cmd run db:migrate before starting the API.'],
  ['DATABASE_SCHEMA_MISSING', 'Database schema is missing or incomplete. Run npm.cmd run db:migrate before starting the API.'],
  ['ENOTFOUND', 'Database hostname could not be resolved. Copy the exact host from Supabase Connect and check your network.'],
  ['EAI_AGAIN', 'Database DNS lookup failed temporarily. Check your network and try again.'],
  ['ECONNREFUSED', 'Database connection was refused. Check the host, port, firewall, and whether the Supabase project is running.'],
  ['ETIMEDOUT', 'Database connection timed out. Check your network and whether the Supabase project is running.'],
  ['EACCES', 'Database network access was denied. Check firewall and process network permissions.'],
  ['EPERM', 'Database network access was denied. Check firewall and process network permissions.'],
  ['ENOENT', 'The configured database CA file could not be found. On Vercel, use DATABASE_CA_CERT with the PEM certificate contents.'],
  ['ERR_OSSL_PEM_NO_START_LINE', 'DATABASE_CA_CERT is not a valid PEM certificate. Paste the complete Supabase CA certificate, including its BEGIN and END CERTIFICATE lines.'],
  ['ERR_OSSL_PEM_BAD_BASE64_DECODE', 'DATABASE_CA_CERT is not a valid PEM certificate. Paste the complete Supabase CA certificate, including its BEGIN and END CERTIFICATE lines.'],
  ['53300', 'The database connection limit was reached. Check the Supabase connection pool and retry.'],
  ['57P03', 'The database is not accepting connections yet. Check whether the Supabase project is running and retry.'],
  ...['SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].map(code => [code, tlsMessage]),
  ['CERT_HAS_EXPIRED', 'Database TLS certificate has expired. Check the certificate configuration and system clock.'],
  ['ERR_TLS_CERT_ALTNAME_INVALID', 'Database TLS hostname verification failed. Copy the exact host from Supabase Connect.']
]);

function databaseDiagnostic(error) {
  if (error instanceof AggregateError) {
    return error.errors.map(databaseDiagnostic).find(message => message !== fallback) || fallback;
  }
  if (/Demo data and staff self-registration must be disabled in production/.test(error?.message || '')) return 'Production account configuration is invalid. Set ALLOW_AGENT_SIGNUP=false and check ENABLE_DEMO_ACCOUNTS.';
  if (/SASL.*password.*string/i.test(error?.message || '')) return 'DATABASE_URL must include the Supabase database password in the complete PostgreSQL connection URL.';
  const known = diagnostics.get(error?.code);
  if (known) return known;
  // Driver codes identify failures without exposing connection strings or raw messages.
  const code = typeof error?.code === 'string' && /^(?:ERR_[A-Z0-9_]{2,60}|[0-9A-Z]{5})$/.test(error.code) ? error.code : '';
  return code ? `${fallback} Diagnostic code: ${code}.` : fallback;
}

module.exports = { databaseDiagnostic };

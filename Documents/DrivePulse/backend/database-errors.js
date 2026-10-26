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
  if (/connection (?:terminated due to connection timeout|terminated unexpectedly)|connection timeout/i.test(error?.message || '')) return 'Database connection timed out or closed during startup. Retry the request and check the Supabase pooler connection.';
  if (error?.cause) {
    const cause = databaseDiagnostic(error.cause);
    if (cause !== fallback) return cause;
  }
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

// Private startup logs need enough context to diagnose unclassified driver
// failures. Redact configured credentials and URLs before emitting messages.
function databaseFailureDetails(error, env = process.env) {
  const secrets = Object.entries(env).filter(([key, value]) => /PASSWORD|PASS|SECRET|TOKEN|DATABASE_URL|DATABASE_CA_CERT/i.test(key) && typeof value === 'string' && value.length > 3).map(([, value]) => value);
  try {
    const connection = new URL(env.DATABASE_URL);
    for (const value of [connection.password, decodeURIComponent(connection.password), connection.username, decodeURIComponent(connection.username)]) if (value.length > 3) secrets.push(value);
  } catch { /* An invalid URL is already covered by the normal diagnostic. */ }
  const clean = value => {
    let message = String(value || '').replace(/[a-z][a-z\d+.-]*:\/\/[^\s"'<>]+/gi, '[redacted URL]');
    for (const secret of secrets.sort((a, b) => b.length - a.length)) message = message.split(secret).join('[redacted]');
    return message.replace(/[\r\n\x00-\x1f]+/g, ' ').slice(0, 300);
  };
  const describe = (value, depth = 0) => ({ name: clean(value?.name), code: clean(value?.code), message: clean(value?.message), ...(depth < 2 && value?.cause ? { cause: describe(value.cause, depth + 1) } : {}), ...(depth < 2 && value instanceof AggregateError ? { errors: [...value.errors].slice(0, 4).map(child => describe(child, depth + 1)) } : {}) });
  let databaseHostType = 'not configured';
  try { const host = new URL(env.DATABASE_URL).hostname; databaseHostType = host.includes('.pooler.supabase.com') ? 'Supabase pooler' : host.startsWith('db.') && host.endsWith('.supabase.co') ? 'Supabase direct' : 'other PostgreSQL host'; } catch { /* Keep the configuration summary credential-free. */ }
  return { error: describe(error), configuration: { databaseHostType, caCertificateConfigured: Boolean(env.DATABASE_CA_CERT), caFileConfigured: Boolean(env.DATABASE_CA_PATH), productionMode: env.NODE_ENV === 'production' } };
}

module.exports = { databaseDiagnostic, databaseFailureDetails };

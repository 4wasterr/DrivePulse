function emailConfig(env = process.env) {
  const smtpUser = (env.SMTP_USER || '').trim();
  const configuredFrom = (env.SMTP_FROM || smtpUser).trim();
  const senderAddress = configuredFrom.match(/<([^>]+)>/)?.[1] || configuredFrom;
  return {
    from: senderAddress ? `DrivePulse <${senderAddress}>` : '',
    replyTo: (env.SMTP_REPLY_TO || smtpUser).trim(),
    smtp: {
      host: (env.SMTP_HOST || 'smtp.gmail.com').trim(),
      port: Number(env.SMTP_PORT || 465),
      user: smtpUser,
      pass: (env.SMTP_PASS || '').trim(),
    },
  };
}

function emailConfigurationProblems(env = process.env) {
  const config = emailConfig(env);
  const problems = [];
  if (!config.smtp.host) problems.push('Set SMTP_HOST to smtp.gmail.com.');
  if (![465, 587].includes(config.smtp.port)) problems.push('Set SMTP_PORT to 465 (TLS) or 587 (STARTTLS).');
  if (!config.smtp.user) problems.push('Set SMTP_USER to the sending Gmail address.');
  if (!config.smtp.pass) problems.push('Set SMTP_PASS to the Google App Password.');
  return problems;
}

module.exports = { emailConfig, emailConfigurationProblems };

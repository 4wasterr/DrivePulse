const nodemailer = require('nodemailer');
const { emailConfig, emailConfigurationProblems } = require('./email-config');

// Delivery problems are shown to the user (not hidden behind a generic 500).
function deliveryError(message, status = 503) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  error.publicCode = 'EMAIL_DELIVERY_FAILED';
  return error;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderEmailLayout({ eyebrow, heading, greeting, body, actionLabel, actionUrl, expiryNote, footerNote }) {
  const safeUrl = escapeHtml(actionUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#171717;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f5f5f5;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background-color:#ffffff;border:1px solid #e4e4e4;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:36px 36px 12px 36px;">
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="width:36px;height:36px;background-color:#111111;border-radius:9px;text-align:center;vertical-align:middle;color:#ffffff;font-weight:800;font-size:18px;line-height:36px;">D</td>
                  <td style="padding-left:10px;font-size:22px;font-weight:700;letter-spacing:-0.8px;color:#111111;">drivepulse.</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 36px 36px 36px;">
              <p style="margin:0 0 10px 0;font-size:11px;font-weight:600;letter-spacing:1.6px;text-transform:uppercase;color:#737373;">${escapeHtml(eyebrow)}</p>
              <h1 style="margin:0 0 16px 0;font-size:28px;line-height:1.25;font-weight:700;letter-spacing:-0.8px;color:#111111;">${escapeHtml(heading)}</h1>
              <p style="margin:0 0 12px 0;font-size:15px;line-height:1.7;color:#404040;">${escapeHtml(greeting)}</p>
              <p style="margin:0 0 28px 0;font-size:15px;line-height:1.7;color:#525252;">${escapeHtml(body)}</p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 28px 0;">
                <tr>
                  <td align="center" style="border-radius:9px;background-color:#111111;">
                    <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:15px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:9px;">${escapeHtml(actionLabel)} &rarr;</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 20px 0;font-size:13px;line-height:1.65;color:#737373;">${escapeHtml(expiryNote)}</p>
              <div style="border-top:1px solid #eaeaea;padding-top:18px;">
                <p style="margin:0 0 6px 0;font-size:12px;line-height:1.6;color:#8a8a8a;">If the button above does not open automatically, copy and paste this link into your browser:</p>
                <p style="margin:0 0 14px 0;font-size:12px;line-height:1.6;word-break:break-all;"><a href="${safeUrl}" style="color:#171717;text-decoration:underline;">${safeUrl}</a></p>
                <p style="margin:0;font-size:12px;line-height:1.6;color:#8a8a8a;">${escapeHtml(footerNote)}</p>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function createMailer({ env = process.env, smtpTransport = null } = {}) {
  if (emailConfigurationProblems(env).length) return null;
  const { from, replyTo, smtp } = emailConfig(env);
  const transport = smtpTransport || nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    requireTLS: true,
    auth: { user: smtp.user, pass: smtp.host.toLowerCase() === 'smtp.gmail.com' ? smtp.pass.replace(/\s/g, '') : smtp.pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  async function deliver({ to, subject, html, text }) {
    try {
      const message = {
        from,
        to,
        ...(replyTo ? { replyTo } : {}),
        subject,
        html,
        text,
      };
      const result = await transport.sendMail(message);
      if (!result.accepted?.length || result.rejected?.length) throw deliveryError('We could not deliver the email. Please try again in a moment.');
      return { id: result.messageId || null };
    } catch (error) {
      if (error.expose) throw error;
      if (error.code === 'EAUTH') {
        console.error('DrivePulse SMTP authentication failed. Check SMTP_USER and SMTP_PASS in the backend environment.');
      }
      throw deliveryError('We could not reach the email service. Please try again in a moment.');
    }
  }

  return {
    providerEmail: replyTo,
    async sendVerification({ to, name, verifyUrl }) {
      const displayName = name || 'there';
      const subject = 'Verify your DrivePulse client account';
      const html = renderEmailLayout({
        eyebrow: 'Verify Your Email',
        heading: 'Confirm your client account.',
        greeting: `Hi ${displayName},`,
        body: 'Welcome to DrivePulse. Click the button below to verify your email address and proceed directly back into your client workspace.',
        actionLabel: 'Verify email & open DrivePulse',
        actionUrl: verifyUrl,
        expiryNote: 'For your security, this verification link expires in 24 hours.',
        footerNote: 'If you did not create a DrivePulse account, you can safely ignore this message.',
      });
      const text = `Hi ${displayName},\n\nWelcome to DrivePulse. Verify your client account by opening this link:\n${verifyUrl}\n\nThis verification link expires in 24 hours. If you did not create a DrivePulse account, you can ignore this email.`;
      return deliver({ to, subject, html, text });
    },
    async sendPasswordReset({ to, name, resetUrl }) {
      const displayName = name || 'there';
      const subject = 'Reset your DrivePulse password';
      const html = renderEmailLayout({
        eyebrow: 'Password Recovery',
        heading: 'Reset your password.',
        greeting: `Hi ${displayName},`,
        body: 'We received a request to reset the password for your DrivePulse account. Click the button below to set a new password and return to DrivePulse.',
        actionLabel: 'Reset password',
        actionUrl: resetUrl,
        expiryNote: 'This password recovery link expires in 30 minutes and can only be used once.',
        footerNote: 'If you did not request a password reset, you can safely ignore this email—your current password will remain unchanged.',
      });
      const text = `Hi ${displayName},\n\nReset your DrivePulse password by opening this link:\n${resetUrl}\n\nThis link expires in 30 minutes and can only be used once. If you did not request a password reset, you can ignore this email.`;
      return deliver({ to, subject, html, text });
    },
  };
}

module.exports = { createMailer, renderEmailLayout };

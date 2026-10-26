const { randomBytes, randomInt, scryptSync, timingSafeEqual, createHash } = require('node:crypto');

const CODE_TTL = 10 * 60000;
const COOLDOWN = 60000;
const MAX_CODE_ATTEMPTS = 5;
const digest = value => createHash('sha256').update(value).digest('hex');

function createAccountSecurity({ db, transaction, mailer, passwordRecord }) {
  async function issueRecovery(user, email, origin) {
    const issued = await transaction(async () => {
      const at = Date.now();
      await db.prepare('DELETE FROM recovery_codes WHERE expires<=?').run(at);
      const previous = await db.prepare('SELECT * FROM recovery_codes WHERE email=? ORDER BY issued_at DESC LIMIT 1').get(email);
      if (previous && at - Number(previous.issued_at) < COOLDOWN) return { challengeId: previous.challenge_id, retryAfterSeconds: Math.ceil((COOLDOWN - at + Number(previous.issued_at)) / 1000) };
      const challengeId = randomBytes(24).toString('base64url');
      const code = String(randomInt(0, 1000000)).padStart(6, '0');
      const salt = randomBytes(16).toString('hex');
      const codeHash = scryptSync(code, salt, 32).toString('hex');
      await db.prepare('DELETE FROM recovery_codes WHERE email=?').run(email);
      await db.prepare('INSERT INTO recovery_codes(challenge_id,email,user_id,salt,code_hash,expires,issued_at) VALUES(?,?,?,?,?,?,?)').run(challengeId, email, user && !user.archived_at ? user.id : null, salt, codeHash, at + CODE_TTL, at);
      return { challengeId, retryAfterSeconds: 60, code };
    });
    if (issued.code && user && !user.archived_at) {
      try {
        await mailer.sendPasswordReset({ to: user.email, name: user.name, code: issued.code, resetUrl: `${origin}/#reset-password?challenge=${issued.challengeId}` });
      } catch (error) {
        await db.prepare('DELETE FROM recovery_codes WHERE challenge_id=?').run(issued.challengeId);
        throw error;
      }
    }
    return { challengeId: issued.challengeId, retryAfterSeconds: issued.retryAfterSeconds };
  }

  async function completeRecovery(challengeId, code, password) {
    if (typeof challengeId !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(challengeId) || typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
    return transaction(async () => {
      const challenge = await db.prepare('SELECT * FROM recovery_codes WHERE challenge_id=?').get(challengeId);
      if (!challenge || Number(challenge.expires) <= Date.now() || Number(challenge.attempts) >= MAX_CODE_ATTEMPTS) return null;
      const matches = timingSafeEqual(scryptSync(code, challenge.salt, 32), Buffer.from(challenge.code_hash, 'hex'));
      // Invalid attempts must commit instead of being rolled back by a thrown HTTP error.
      await db.prepare('UPDATE recovery_codes SET attempts=attempts+1 WHERE challenge_id=?').run(challengeId);
      const user = challenge.user_id ? await db.prepare('SELECT * FROM users WHERE id=?').get(challenge.user_id) : null;
      if (!matches || !user || user.archived_at || user.email !== challenge.email) return null;
      const record = passwordRecord(password);
      await db.prepare("UPDATE users SET salt=?,password_hash=?,email_verified_at=CASE WHEN email_verified_at='' THEN ? ELSE email_verified_at END WHERE id=?").run(record.salt, record.passwordHash, new Date().toISOString(), user.id);
      await db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      await db.prepare('DELETE FROM auth_tokens WHERE user_id=?').run(user.id);
      await db.prepare('DELETE FROM recovery_codes WHERE user_id=? OR email=?').run(user.id, user.email);
      await db.prepare('DELETE FROM login_locks WHERE identifier=?').run(digest(user.email));
      return user;
    });
  }

  async function loginLock(email, { failed = false, success = false } = {}) {
    return transaction(async () => {
      const identifier = digest(email), at = Date.now();
      const previous = await db.prepare('SELECT * FROM login_locks WHERE identifier=?').get(identifier);
      if (previous && Number(previous.locked_until) > at) return { locked: true, lockedUntil: Number(previous.locked_until), retryAfterSeconds: Math.ceil((Number(previous.locked_until) - at) / 1000) };
      if (success) { await db.prepare('DELETE FROM login_locks WHERE identifier=?').run(identifier); return {}; }
      if (!failed) return {};
      const failures = previous && !Number(previous.locked_until) ? Number(previous.failures) + 1 : 1;
      const lockedUntil = failures >= 3 ? at + COOLDOWN : 0;
      await db.prepare('INSERT INTO login_locks(identifier,failures,locked_until) VALUES(?,?,?) ON CONFLICT(identifier) DO UPDATE SET failures=excluded.failures,locked_until=excluded.locked_until').run(identifier, failures, lockedUntil);
      return { locked: Boolean(lockedUntil), newlyLocked: Boolean(lockedUntil), lockedUntil, retryAfterSeconds: lockedUntil ? 60 : 0 };
    });
  }
  return { issueRecovery, completeRecovery, loginLock };
}

module.exports = { createAccountSecurity };

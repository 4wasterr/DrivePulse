const PASSWORD_ERROR = 'Use 8–128 characters with at least one uppercase letter, one lowercase letter, and one special character.';
function validPassword(value) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 128 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /[\p{P}\p{S}]/u.test(value);
}
// The existing manager role is the system's Admin role (see User Management).
const isAdmin = user => user?.role === 'manager';
module.exports = { validPassword, PASSWORD_ERROR, isAdmin };

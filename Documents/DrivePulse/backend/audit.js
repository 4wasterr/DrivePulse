const { randomUUID } = require('node:crypto');

function formatValue(value) {
  if (value === undefined || value === null || value === '') return '';
  return typeof value === 'string' ? value.slice(0, 1500) : JSON.stringify(value).slice(0, 1500);
}

function createAudit(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, at TEXT NOT NULL,
    actor_id TEXT, actor TEXT NOT NULL, role TEXT NOT NULL, action TEXT NOT NULL,
    resource TEXT NOT NULL, detail TEXT NOT NULL, status INTEGER NOT NULL,
    old_value TEXT NOT NULL DEFAULT '', new_value TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '', alert_type TEXT NOT NULL DEFAULT '');`);
  const write = (user, action, resource = '', detail = '', status = 200, extra = {}) => {
    const at = new Date().toISOString();
    const hourPHT = new Date(Date.now() + 8 * 3600000).getUTCHours();
    const offHours = hourPHT < 6 || hourPHT >= 22;
    let alertType = extra.alertType || '';
    if (!alertType) {
      if (/failed login/i.test(action)) alertType = 'Failed login attempt';
      else if (/purge|permanently deleted/i.test(action)) alertType = 'Permanent record purge';
      else if (/archive|decommission|deactivat/i.test(action) && offHours) alertType = 'Off-hours deletion';
    }
    db.prepare('INSERT INTO audit_log(id,at,actor_id,actor,role,action,resource,detail,status,old_value,new_value,ip,alert_type) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        randomUUID(), at, user?.id || null, user?.name || 'Anonymous', user?.role || 'anonymous',
        action, resource, String(detail || '').slice(0, 1500), status,
        formatValue(extra.oldValue), formatValue(extra.newValue),
        String(extra.ip || '').slice(0, 100), alertType
      );
  };
  const alerts = (limit = 15) => db.prepare("SELECT * FROM audit_log WHERE alert_type<>'' ORDER BY sequence DESC LIMIT ?").all(limit);
  const middleware = (req, res, next) => next();
  return { write, alerts, middleware };
}
module.exports = { createAudit };

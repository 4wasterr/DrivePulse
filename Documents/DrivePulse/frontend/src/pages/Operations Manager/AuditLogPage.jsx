import ValidatedField from '../../components/ui/ValidatedField.jsx'
import ValidatedForm from '../../components/ui/ValidatedForm.jsx'
import { useState, useEffect } from 'react'
import { api } from '../../api.js'
import Tag from '../../components/workspace/StaffTag.jsx'

const fmt = value => value ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : 'Pending'

export default function AuditLog() {
  const [filters, setFilters] = useState({ q: '', role: '', start: '', end: '', alertsOnly: '', mutationsOnly: '' })
  const [query, setQuery] = useState('page=1')
  const [result, setResult] = useState({ records: [], alerts: [], total: 0, page: 1, size: 10 })
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    api(`/manager/audit?${query}`).then(r => { if (active) { setResult(r); setError('') } }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [query])

  const params = (page, nextFilters = filters) => {
    const p = new URLSearchParams({ page })
    Object.entries(nextFilters).forEach(([k, v]) => { if (v) p.set(k, v) })
    return p.toString()
  }

  return <>
    <section className="workspace-surface staff-section">
      <div className="workspace-section-heading">
        <div>
          <p className="workspace-kicker">THRESHOLD ALERTS WIDGET</p>
          <h2>Flagged security & mutation alerts</h2>
          <p className="workspace-muted">Suspicious events (rate changes over 20%, failed logins, off-hours deletions, permanent purges, policy overrides) are surfaced automatically.</p>
        </div>
        <Tag>{`${(result.alerts || []).length} flagged`}</Tag>
      </div>
      {(result.alerts || []).length ? result.alerts.slice(0, 6).map(a => <article className="staff-ledger-row" key={`alert-${a.id}`}>
        <div>
          <h3>{a.action} · <small>{a.resource}</small></h3>
          <p>{a.detail}</p>
          {(a.old_value || a.new_value) && <small>Old: {a.old_value || '—'} → New: {a.new_value || '—'}</small>}
          <small>Actor: {a.actor} ({a.actor_id || 'anonymous'}) · {fmt(a.at)}{a.ip ? ` · IP ${a.ip}` : ''}</small>
        </div>
        <Tag>{a.alert_type}</Tag>
      </article>) : <p className="workspace-muted">No threshold alerts triggered yet.</p>}
    </section>

    <section className="workspace-surface">
      <div className="workspace-section-heading">
        <div>
          <h2>Activity & security audit logs</h2>
          <p className="workspace-muted">Append-only operational history of all data mutations (old vs. new values), actor IDs, and authentication events.</p>
        </div>
      </div>
      <ValidatedForm className="audit-filters" validation="date-range" onSubmit={e => { e.preventDefault(); setQuery(params(1)) }}>
        <label className="form-field">Search<ValidatedField value={filters.q} onChange={e => setFilters({ ...filters, q: e.target.value })} placeholder="Actor, action, target, or value" maxLength={150} /></label>
        <label className="form-field">Role<ValidatedField as="select" value={filters.role} onChange={e => setFilters({ ...filters, role: e.target.value })}><option value="">All roles</option>{['client', 'agent', 'mechanic', 'manager', 'anonymous'].map(r => <option key={r}>{r}</option>)}</ValidatedField></label>
        <label className="form-field">Scope<ValidatedField as="select" value={filters.alertsOnly ? 'alerts' : filters.mutationsOnly ? 'mutations' : ''} onChange={e => {
          const val = e.target.value
          const next = { ...filters, alertsOnly: val === 'alerts' ? 'true' : '', mutationsOnly: val === 'mutations' ? 'true' : '' }
          setFilters(next); setQuery(params(1, next))
        }}><option value="">All activity logs</option><option value="alerts">Threshold alerts only</option><option value="mutations">Data mutations (Old → New)</option></ValidatedField></label>
        <label className="form-field">From<ValidatedField name="start" type="date" value={filters.start} max={filters.end || undefined} onChange={e => setFilters({ ...filters, start: e.target.value })} /></label>
        <label className="form-field">Through<ValidatedField name="end" type="date" min={filters.start || undefined} value={filters.end} onChange={e => setFilters({ ...filters, end: e.target.value })} /></label>
        <button className="button button-dark">Search logs</button>
      </ValidatedForm>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <p className="workspace-muted">{result.total} matching events</p>
      <div className="agent-table-scroll">
        <table className="agent-table">
          <thead><tr><th>Time & Actor</th><th>Action & Target</th><th>Old vs. New Value</th><th>Event Details</th></tr></thead>
          <tbody>{result.records.map(r => <tr key={r.id}>
            <td>
              <strong>{fmt(r.at)}</strong>
              <small>{r.actor} · {r.role}</small>
              <small>ID: {r.actor_id ? r.actor_id.slice(0, 12) : 'anonymous'}{r.ip ? ` · ${r.ip}` : ''}</small>
            </td>
            <td>
              <strong>{r.action}</strong>
              <small>{r.resource}</small>
              {r.alert_type && <Tag>{r.alert_type}</Tag>}
            </td>
            <td>
              {r.old_value || r.new_value ? (
                <div>
                  <small><strong>Old:</strong> {r.old_value || 'None'}</small>
                  <small><strong>New:</strong> {r.new_value || 'None'}</small>
                </div>
              ) : <span className="workspace-muted">—</span>}
            </td>
            <td>
              <span>{r.detail}</span>
            </td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="record-actions">
        <button className="button button-outline" disabled={result.page <= 1} onClick={() => { const p = new URLSearchParams(query); p.set('through', result.through); p.set('page', result.page - 1); setQuery(p.toString()) }}>Previous</button>
        <span>Page {result.page} · 10 records per page</span>
        <button className="button button-outline" disabled={result.page * result.size >= result.total} onClick={() => { const p = new URLSearchParams(query); p.set('through', result.through); p.set('page', result.page + 1); setQuery(p.toString()) }}>Next</button>
      </div>
    </section>
  </>
}

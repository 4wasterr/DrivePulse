import { useState, useEffect, useCallback } from 'react'
import { api } from '../../api.js'
import Icon from '../../components/ui/Icon.jsx'
import Tag from '../../components/workspace/StaffTag.jsx'
import Modal from '../../components/ui/Modal.jsx'
import Empty from '../../components/workspace/StaffEmpty.jsx'
import { fmt } from '../../utils/workspace.js'

const roleNames = { client: 'Client (End-User)', agent: 'Booking Agent (Front Desk)', mechanic: 'Fleet Mechanic (Yard)', manager: 'Operations Manager (Admin)' }

export default function UserManagementPage({ currentUser, onDone }) {
  const [data, setData] = useState({ users: [], archivedUsers: [], telemetry: {} })
  const [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [modal, setModal] = useState(null), [busy, setBusy] = useState(false)
  const [roleFilter, setRoleFilter] = useState('all'), [search, setSearch] = useState('')

  const load = useCallback(() => {
    return api('/manager/users')
      .then(res => { setData(res); setError('') })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    let active = true
    api('/manager/users')
      .then(res => { if (active) { setData(res); setError('') } })
      .catch(e => { if (active) setError(e.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const shownUsers = data.users.filter(u =>
    (roleFilter === 'all' || u.role === roleFilter) &&
    `${u.name} ${u.email} ${u.role}`.toLowerCase().includes(search.toLowerCase())
  )
  const t = data.telemetry || {}

  return <>
    <div className="staff-metrics">
      {[
        ['Active accounts', t.activeCount ?? 0, 'users'],
        ['Successful logins', t.successfulLogins ?? 0, 'check'],
        ['Failed login attempts', t.failedLogins ?? 0, 'shield'],
        ['Deactivated (archived)', t.archivedCount ?? 0, 'file']
      ].map(([label, val, icon]) => <div className="agent-stat" key={label}>
        <span><Icon name={icon} size={21} /></span>
        <strong className="staff-value">{val}</strong>
        <span>{label}</span>
      </div>)}
    </div>

    <section className="workspace-surface staff-section">
      <div className="workspace-section-heading">
        <div>
          <p className="workspace-kicker">ROLE GOVERNANCE & ACCESS</p>
          <h2>Active users & staff directory <span className="workspace-result-count">{shownUsers.length}</span></h2>
        </div>
        <button className="button button-dark" onClick={() => setModal({ kind: 'create' })}><Icon name="users" size={17} />Create staff / user account</button>
      </div>
      <div className="staff-toolbar">
        <label className="staff-search"><Icon name="search" size={18} /><input aria-label="Search users" placeholder="Search name or email" value={search} onChange={e => setSearch(e.target.value)} /></label>
        <select aria-label="Filter user role" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
          <option value="all">All roles</option>
          {Object.entries(roleNames).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </div>
      {error && <p className="error-banner" role="alert">{error}</p>}
      {loading ? <p className="workspace-muted">Loading user telemetry…</p> : shownUsers.length ? (
        <div className="agent-table-scroll">
          <table className="agent-table">
            <thead><tr><th>User / Email</th><th>Role & Authority</th><th>Last Login</th><th>Actions</th></tr></thead>
            <tbody>{shownUsers.map(u => <tr key={u.id}>
              <td>
                <strong>{u.name}</strong>
                <small>{u.email}</small>
                <small>ID: {u.id.slice(0, 8)}</small>
              </td>
              <td>
                <Tag>{roleNames[u.role] || u.role}</Tag>
              </td>
              <td>
                <span>{u.lastLoginAt ? fmt(u.lastLoginAt) : 'Never signed in'}</span>
                {u.createdAt && <small>Created {fmt(u.createdAt)}</small>}
              </td>
              <td>
                <div className="staff-card-actions">
                  <button className="button button-outline" onClick={() => setModal({ kind: 'role', user: u })}>Edit role</button>
                  {u.id !== currentUser.id && <button className="text-link" onClick={() => setModal({ kind: 'deactivate', user: u })}>Deactivate</button>}
                </div>
              </td>
            </tr>)}</tbody>
          </table>
        </div>
      ) : <Empty>No active accounts match this filter.</Empty>}
    </section>

    <section className="workspace-surface">
      <div className="workspace-section-heading">
        <div>
          <p className="workspace-kicker">AUTHENTICATION TELEMETRY</p>
          <h2>Login activity & authentication history</h2>
          <p className="workspace-muted">Tracks successful sign-ins, failed login attempts, IP origins, and account provisioning events.</p>
        </div>
      </div>
      {(t.authHistory || []).length ? (
        <div className="agent-table-scroll">
          <table className="agent-table">
            <thead><tr><th>Timestamp (PHT)</th><th>Actor / Account</th><th>Event</th><th>IP / Status</th></tr></thead>
            <tbody>{(t.authHistory || []).map(event => <tr key={event.id}>
              <td><strong>{fmt(event.at)}</strong></td>
              <td>
                <strong>{event.actor}</strong>
                <small>{event.role} · {event.actor_id ? event.actor_id.slice(0, 8) : 'unauthenticated'}</small>
              </td>
              <td>
                <strong>{event.action}</strong>
                <small>{event.detail}</small>
              </td>
              <td>
                <Tag>{event.alert_type || (event.status >= 400 ? 'Failed attempt' : 'Success')}</Tag>
                {event.ip && <small>IP: {event.ip}</small>}
              </td>
            </tr>)}</tbody>
          </table>
        </div>
      ) : <Empty>No authentication events recorded yet.</Empty>}
    </section>

    {modal?.kind === 'create' && <Modal title="Create user or staff account" eyebrow="USER PROVISIONING" onClose={() => setModal(null)}>
      <form className="staff-form" onSubmit={async e => {
        e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); setError('')
        try {
          await api('/manager/users', { method: 'POST', body: Object.fromEntries(form) })
          await load(); setModal(null); onDone('Account created and logged in system audit.')
        } catch (err) { setError(err.message) } finally { setBusy(false) }
      }}>
        <fieldset disabled={busy}>
          <label className="form-field">Full name<input name="name" required maxLength={70} /></label>
          <label className="form-field">Email address<input name="email" type="email" required maxLength={160} /></label>
          <label className="form-field">Assigned role<select name="role" defaultValue="agent">{Object.entries(roleNames).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label>
          <label className="form-field">Temporary password (8+ characters)<input name="password" type="password" required minLength={8} maxLength={128} /></label>
          {error && <p className="error-banner" role="alert">{error}</p>}
          <button className="button button-dark" disabled={busy}><Icon name="check" size={17} />{busy ? 'Creating…' : 'Create account'}</button>
        </fieldset>
      </form>
    </Modal>}

    {modal?.kind === 'role' && <Modal title={`Update role · ${modal.user.name}`} eyebrow="ACCESS AUTHORITY" onClose={() => setModal(null)}>
      <form className="staff-form" onSubmit={async e => {
        e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); setError('')
        try {
          await api(`/manager/users/${modal.user.id}`, { method: 'PATCH', body: { name: form.get('name'), role: form.get('role') } })
          await load(); setModal(null); onDone(`Updated role for ${modal.user.name}.`)
        } catch (err) { setError(err.message) } finally { setBusy(false) }
      }}>
        <fieldset disabled={busy}>
          <label className="form-field">Full name<input name="name" required maxLength={70} defaultValue={modal.user.name} /></label>
          <label className="form-field">Role<select name="role" defaultValue={modal.user.role}>{Object.entries(roleNames).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label>
          {error && <p className="error-banner" role="alert">{error}</p>}
          <button className="button button-dark" disabled={busy}><Icon name="check" size={17} />Save changes</button>
        </fieldset>
      </form>
    </Modal>}

    {modal?.kind === 'deactivate' && <Modal title={`Deactivate ${modal.user.name}`} eyebrow="MANAGER CONFIRMATION REQUIRED" onClose={() => setModal(null)}>
      <form className="staff-form" onSubmit={async e => {
        e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); setError('')
        try {
          await api(`/manager/users/${modal.user.id}/archive`, { method: 'POST', body: { reason: form.get('reason') } })
          await load(); setModal(null); onDone(`${modal.user.name} deactivated and moved to Data Archives.`)
        } catch (err) { setError(err.message) } finally { setBusy(false) }
      }}>
        <fieldset disabled={busy}>
          <p className="workspace-muted">Deactivating this account immediately revokes active sessions and moves the user to <strong>Data Archives</strong>, where they can be restored or permanently purged.</p>
          <label className="form-field">Deactivation reason<textarea name="reason" required maxLength={500} rows={3} placeholder="Record end of employment, role transfer, or security policy action." /></label>
          {error && <p className="error-banner" role="alert">{error}</p>}
          <button className="button button-dark" disabled={busy}><Icon name="shield" size={17} />Confirm account deactivation</button>
        </fieldset>
      </form>
    </Modal>}
  </>
}


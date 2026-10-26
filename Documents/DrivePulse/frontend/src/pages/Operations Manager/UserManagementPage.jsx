import ClientProfileFields from '../../components/ui/ClientProfileFields.jsx'
import ValidatedField from '../../components/ui/ValidatedField.jsx'
import ValidatedForm from '../../components/ui/ValidatedForm.jsx'
import { useState, useEffect, useCallback } from 'react'
import { api } from '../../api.js'
import Icon from '../../components/ui/Icon.jsx'
import Tag from '../../components/workspace/StaffTag.jsx'
import Modal from '../../components/ui/Modal.jsx'
import Empty from '../../components/workspace/StaffEmpty.jsx'
import PasswordFields from '../../components/ui/PasswordFields.jsx'
import { PaginatedTable } from '../../components/ui/Pagination.jsx'
import { validPassword } from '../../utils/password.js'
import { fmt } from '../../utils/workspace.js'

const roleNames = { client: 'Client (End-User)', agent: 'Booking Agent', mechanic: 'Fleet Mechanic', manager: 'Admin / Operations Manager' }

export default function UserManagementPage({ currentUser, onDone }) {
  const [data, setData] = useState({ users: [], archivedUsers: [], telemetry: {} })
  const [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [modal, setModal] = useState(null), [busy, setBusy] = useState(false)
  const [tab, setTab] = useState('Active'), [roleFilter, setRoleFilter] = useState('all'), [search, setSearch] = useState('')
  const isAdmin = currentUser.role === 'manager'
  const load = useCallback(() => api('/manager/users').then(setData), [])
  useEffect(() => {
    let active = true
    api('/manager/users').then(res => { if (active) setData(res) }).catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  const shownUsers = (tab === 'Archived' ? data.archivedUsers : data.users).filter(u => (roleFilter === 'all' || u.role === roleFilter) && (u.name + ' ' + u.email + ' ' + u.role).toLowerCase().includes(search.toLowerCase()))
  const t = data.telemetry || {}
  const close = () => { setModal(null); setError('') }
  const [accountRole, setAccountRole] = useState('agent')
  const show = value => { setError(''); setAccountRole(value.user?.role || 'agent'); setModal(value) }
  async function submit(event) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError('')
    try {
      if (['create', 'password'].includes(modal.kind)) {
        if (!validPassword(form.get('password'))) throw new Error('Use 8–128 characters with uppercase, lowercase, and a special character.')
        if (form.get('password') !== form.get('confirm')) throw new Error('Your passwords do not match.')
      }
      if (modal.kind === 'create') await api('/manager/users', { method: 'POST', body: Object.fromEntries(form) })
      if (modal.kind === 'edit') await api('/manager/users/' + modal.user.id, { method: 'PATCH', body: Object.fromEntries(form) })
      if (modal.kind === 'password') await api('/manager/users/' + modal.user.id + '/password', { method: 'POST', body: { password: form.get('password') } })
      if (modal.kind === 'deactivate') await api('/manager/users/' + modal.user.id + '/archive', { method: 'POST', body: { reason: form.get('reason') } })
      const message = modal.kind === 'password' ? 'Password reset. Active sessions were revoked.' : 'User account updated and recorded in History.'
      if (modal.user?.id !== currentUser.id || !['password', 'edit'].includes(modal.kind)) await load()
      close(); await onDone(message)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return <>
    <div className="staff-metrics">{[['Active accounts', t.activeCount ?? 0, 'users'], ['Successful logins', t.successfulLogins ?? 0, 'check'], ['Failed login attempts', t.failedLogins ?? 0, 'shield'], ['Archived accounts', t.archivedCount ?? 0, 'file']].map(([label, val, icon]) => <div className="agent-stat" key={label}><span><Icon name={icon} size={21} /></span><strong className="staff-value">{val}</strong><span>{label}</span></div>)}</div>
    <section className="workspace-surface staff-section">
      <div className="workspace-section-heading"><div><p className="workspace-kicker">USER MANAGEMENT</p><h2>Users & staff directory <span className="workspace-result-count">{shownUsers.length}</span></h2></div>{isAdmin && <button className="button button-dark" onClick={() => show({ kind: 'create' })}><Icon name="users" size={17} />Create User</button>}</div>
      <div className="pill-tabs" role="group" aria-label="User records"><button className={tab === 'Active' ? 'active' : ''} onClick={() => setTab('Active')}>Active <span>{data.users.length}</span></button><button className={tab === 'Archived' ? 'active' : ''} onClick={() => setTab('Archived')}>Archived <span>{data.archivedUsers.length}</span></button><button onClick={() => show({ kind: 'history' })}>History<Icon name="clock" size={16} /></button></div>
      <div className="staff-toolbar user-directory-toolbar"><label className="staff-search"><Icon name="search" size={18} /><ValidatedField aria-label="Search users" placeholder="Search name or email" maxLength={150} value={search} onChange={e => setSearch(e.target.value)} /></label><ValidatedField as="select" aria-label="Filter user role" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}><option value="all">All roles</option>{Object.entries(roleNames).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</ValidatedField></div>
      {error && !modal && <p className="error-banner" role="alert">{error}</p>}
      {loading ? <p role="status">Loading user records…</p> : shownUsers.length ? <div className="agent-table-scroll"><PaginatedTable className="agent-table" resetKey={tab + roleFilter + search}><thead><tr><th>User / Email</th><th>Role & Authority</th><th>{tab === 'Archived' ? 'Archived' : 'Last login'}</th><th>Actions</th></tr></thead><tbody>{shownUsers.map(u => <tr key={u.id}><td><strong>{u.name}</strong><small>{u.email}</small><small>ID: {u.id.slice(0, 8)}</small></td><td><Tag>{roleNames[u.role] || u.role}</Tag></td><td>{tab === 'Archived' ? <><strong>{fmt(u.archivedAt)}</strong><small>{u.archiveReason}</small></> : <><span>{u.lastLoginAt ? fmt(u.lastLoginAt) : 'Never signed in'}</span><small>Created {fmt(u.createdAt)}</small></>}</td><td><div className="staff-card-actions">{isAdmin && (tab === 'Archived' ? <a className="button button-outline" href="#manager-archives">Open archive</a> : <><button className="button button-outline" onClick={() => show({ kind: 'edit', user: u })}>Edit profile</button><button className="text-link" onClick={() => show({ kind: 'password', user: u })}>Reset password</button>{u.id !== currentUser.id && <button className="text-link" onClick={() => show({ kind: 'deactivate', user: u })}>Deactivate</button>}</>)}</div></td></tr>)}</tbody></PaginatedTable></div> : <Empty>No accounts match this filter.</Empty>}
    </section>
    {modal?.kind === 'history' && <Modal title="User history" eyebrow="ACCESS & AUTHENTICATION AUDIT" wide onClose={close}>
      <p>Account changes, sign-ins and security events. All times in PHT.</p>
      {(t.authHistory || []).length ? <div className="agent-table-scroll"><PaginatedTable className="agent-table"><thead><tr><th>Timestamp</th><th>Actor / Account</th><th>Event</th><th>Status</th></tr></thead><tbody>{t.authHistory.map(event => <tr key={event.id}><td>{fmt(event.at)}</td><td><strong>{event.actor}</strong><small>{event.role}</small></td><td><strong>{event.action}</strong><small>{event.detail}</small></td><td><Tag>{event.alert_type || (event.status >= 400 ? 'Failed attempt' : 'Success')}</Tag>{event.ip && <small>IP: {event.ip}</small>}</td></tr>)}</tbody></PaginatedTable></div> : <Empty>No user history recorded yet.</Empty>}
    </Modal>}
    {modal && modal.kind !== 'history' && isAdmin && <Modal title={modal.kind === 'create' ? 'Create User' : modal.kind === 'password' ? 'Reset password · ' + modal.user.name : modal.kind === 'edit' ? 'Edit profile · ' + modal.user.name : 'Deactivate · ' + modal.user.name} eyebrow="ADMIN ACCOUNT MANAGEMENT" onClose={close}>
      <ValidatedForm className="staff-form" onSubmit={submit} validate={form => [{ name: 'role', message: modal.kind === 'edit' && modal.user.id === currentUser.id && form.elements.namedItem('role')?.value !== 'manager' ? 'Keep your own Admin role to retain access to this workspace.' : '' }]}><fieldset disabled={busy}>
        {['create', 'edit'].includes(modal.kind) && <>{accountRole === 'client' ? <ClientProfileFields user={modal.user} /> : <label className="form-field">Full name<ValidatedField name="name" required maxLength={70} defaultValue={modal.user?.name || ''} /></label>}<label className="form-field">Email address<ValidatedField name="email" type="email" required maxLength={160} defaultValue={modal.user?.email || ''} /></label><label className="form-field">Role<ValidatedField as="select" name="role" value={accountRole} onChange={event => setAccountRole(event.target.value)}>{Object.entries(roleNames).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</ValidatedField></label></>}
        {['create', 'password'].includes(modal.kind) && <PasswordFields />}
        {modal.kind === 'password' && <p>Resetting the password signs this user out of all active sessions.</p>}
        {modal.kind === 'deactivate' && <><p>Deactivation revokes active sessions and moves this user to Archived.</p><label className="form-field">Reason<ValidatedField as="textarea" name="reason" required maxLength={500} rows={3} /></label></>}
        {error && <p className="error-banner" role="alert">{error}</p>}
        <button className="button button-dark" disabled={busy}><Icon name="check" size={17} />{busy ? 'Saving…' : modal.kind === 'create' ? 'Create User' : modal.kind === 'password' ? 'Reset password' : modal.kind === 'deactivate' ? 'Deactivate account' : 'Save changes'}</button>
      </fieldset></ValidatedForm>
    </Modal>}
  </>
}

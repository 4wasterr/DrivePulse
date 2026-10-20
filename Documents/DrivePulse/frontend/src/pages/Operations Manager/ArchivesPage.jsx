import { useState, useEffect, useCallback } from 'react'
import { api } from '../../api.js'
import Icon from '../../components/ui/Icon.jsx'
import Tag from '../../components/workspace/StaffTag.jsx'
import Modal from '../../components/ui/Modal.jsx'
import Empty from '../../components/workspace/StaffEmpty.jsx'
import { fmt, vehicleName } from '../../utils/workspace.js'
import { money, prettyDate } from '../../data.js'

export default function ArchivesPage({ onRefresh, onDone }) {
  const [data, setData] = useState({ bookings: [], vehicles: [], pendingDecommissions: [], users: [] })
  const [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [purgeTarget, setPurgeTarget] = useState(null), [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    return api('/manager/archives')
      .then(res => { setData(res); setError('') })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    let active = true
    api('/manager/archives')
      .then(res => { if (active) { setData(res); setError('') } })
      .catch(e => { if (active) setError(e.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function restore(kind, id, label) {
    setBusy(true); setError('')
    try {
      await api(`/manager/archives/${kind}/${id}/restore`, { method: 'POST', body: {} })
      await load(); await onRefresh(); onDone(`${label} restored from archive.`)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function approveDecommission(vehicle) {
    setBusy(true); setError('')
    try {
      await api(`/vehicles/${vehicle.id}/decommission`, { method: 'POST', body: { version: vehicle.version, reason: vehicle.decommissionRequested?.reason || 'Manager confirmed decommission' } })
      await load(); await onRefresh(); onDone(`${vehicle.name} decommissioned and moved to Data Archives.`)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return <>
    <div className="staff-metrics">
      {[
        ['Archived bookings', data.bookings.length, 'calendar'],
        ['Decommissioned vehicles', data.vehicles.length, 'car'],
        ['Deactivated users', data.users.length, 'users'],
        ['Pending decommissions', data.pendingDecommissions.length, 'shield']
      ].map(([label, val, icon]) => <div className="agent-stat" key={label}>
        <span><Icon name={icon} size={21} /></span>
        <strong className="staff-value">{val}</strong>
        <span>{label}</span>
      </div>)}
    </div>

    {error && <p className="error-banner" role="alert">{error}</p>}
    {loading && <p className="workspace-muted">Loading archive records…</p>}

    {data.pendingDecommissions.length > 0 && <section className="workspace-surface staff-section">
      <div className="workspace-section-heading">
        <div>
          <p className="workspace-kicker">MANAGER CONFIRMATION REQUIRED</p>
          <h2>Pending vehicle decommission requests</h2>
        </div>
        <Tag>{`${data.pendingDecommissions.length} awaiting`}</Tag>
      </div>
      {data.pendingDecommissions.map(v => <article className="staff-ledger-row" key={v.id}>
        <div>
          <h3>{v.name} · {money(v.rate)} / day</h3>
          <p>Requested by {v.decommissionRequested.by}: {v.decommissionRequested.reason}</p>
          <small>{fmt(v.decommissionRequested.at)}</small>
        </div>
        <Tag>Decommission request</Tag>
        <button className="button button-dark" disabled={busy} onClick={() => approveDecommission(v)}>Confirm decommission</button>
      </article>)}
    </section>}

    <section className="workspace-surface staff-section">
      <div className="workspace-section-heading">
        <div>
          <p className="workspace-kicker">SOFT-DELETED RESERVATIONS</p>
          <h2>Historical bookings archive</h2>
          <p className="workspace-muted">Standard staff handle one-click soft deletes of completed or cancelled bookings; Operations Managers can restore or permanently purge them.</p>
        </div>
        <Tag>{`${data.bookings.length} archived`}</Tag>
      </div>
      {data.bookings.length ? data.bookings.map(b => <article className="staff-ledger-row" key={b.id}>
        <div>
          <h3>{b.id} · {b.renter.name} · {vehicleName(b.vehicleId)}</h3>
          <p>{prettyDate(b.start)} – {prettyDate(b.end)} · {b.status} · {money(b.total)}</p>
          <small>Archived by {b.archivedBy || 'Staff'} on {fmt(b.archivedAt)} · {b.archiveReason}</small>
        </div>
        <div className="staff-card-actions">
          <button className="button button-outline" disabled={busy} onClick={() => restore('booking', b.id, `Booking ${b.id}`)}>Restore</button>
          <button className="text-link" disabled={busy} onClick={() => setPurgeTarget({ kind: 'booking', id: b.id, label: `Booking ${b.id} (${b.renter.name})` })}>Permanent purge</button>
        </div>
      </article>) : <Empty>No archived reservations.</Empty>}
    </section>

    <section className="workspace-surface staff-section">
      <div className="workspace-section-heading">
        <div>
          <p className="workspace-kicker">PAST FLEET UNITS</p>
          <h2>Decommissioned vehicles archive</h2>
        </div>
        <Tag>{`${data.vehicles.length} decommissioned`}</Tag>
      </div>
      {data.vehicles.length ? data.vehicles.map(v => <article className="staff-ledger-row" key={v.id}>
        <div>
          <h3>{v.name}</h3>
          <p>{v.archiveReason || 'Decommissioned from active service'}</p>
          <small>Decommissioned by {v.archivedBy} on {fmt(v.archivedAt)}</small>
        </div>
        <div className="staff-card-actions">
          <button className="button button-outline" disabled={busy} onClick={() => restore('vehicle', v.id, v.name)}>Restore to active fleet</button>
          <button className="text-link" disabled={busy} onClick={() => setPurgeTarget({ kind: 'vehicle', id: v.id, label: v.name })}>Purge history</button>
        </div>
      </article>) : <Empty>No decommissioned vehicles in the archive.</Empty>}
    </section>

    <section className="workspace-surface">
      <div className="workspace-section-heading">
        <div>
          <p className="workspace-kicker">DEACTIVATED ACCOUNTS</p>
          <h2>Soft-deleted users & employees</h2>
        </div>
        <Tag>{`${data.users.length} deactivated`}</Tag>
      </div>
      {data.users.length ? data.users.map(u => <article className="staff-ledger-row" key={u.id}>
        <div>
          <h3>{u.name} · <small>{u.email}</small></h3>
          <p>Role: {u.role} · Reason: {u.archiveReason || 'Account deactivated'}</p>
          <small>Deactivated by {u.archivedBy} on {fmt(u.archivedAt)}</small>
        </div>
        <div className="staff-card-actions">
          <button className="button button-outline" disabled={busy} onClick={() => restore('user', u.id, u.name)}>Restore account</button>
          <button className="text-link" disabled={busy} onClick={() => setPurgeTarget({ kind: 'user', id: u.id, label: `${u.name} (${u.email})` })}>Permanent purge</button>
        </div>
      </article>) : <Empty>No deactivated user accounts.</Empty>}
    </section>

    {purgeTarget && <Modal title={`Permanently purge · ${purgeTarget.label}`} eyebrow="IRREVERSIBLE MANAGER ACTION" onClose={() => setPurgeTarget(null)}>
      <form className="staff-form" onSubmit={async e => {
        e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); setError('')
        try {
          await api(`/manager/archives/${purgeTarget.kind}/${purgeTarget.id}`, { method: 'DELETE', body: { reason: form.get('reason') } })
          await load(); await onRefresh(); setPurgeTarget(null); onDone(`${purgeTarget.label} permanently purged and recorded in forensic audit logs.`)
        } catch (err) { setError(err.message) } finally { setBusy(false) }
      }}>
        <fieldset disabled={busy}>
          <p className="workspace-muted">Permanent purges require Operations Manager confirmation and generate a high-priority <strong>Permanent record purge</strong> alert in the immutable system audit log.</p>
          <label className="form-field">Purge authorization reason<textarea name="reason" required maxLength={500} rows={3} placeholder="Record data retention expiry or compliance purge reason." /></label>
          {error && <p className="error-banner" role="alert">{error}</p>}
          <button className="button button-dark" disabled={busy}><Icon name="shield" size={17} />Confirm permanent purge</button>
        </fieldset>
      </form>
    </Modal>}
  </>
}


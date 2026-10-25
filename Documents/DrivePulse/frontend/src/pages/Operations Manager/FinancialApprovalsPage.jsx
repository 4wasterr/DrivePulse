import { PaginatedList } from '../../components/ui/Pagination.jsx'
import { useState } from 'react'
import Icon from '../../components/ui/Icon.jsx'
import { money, prettyDate } from '../../data.js'
import { fmt, vehicleName } from '../../utils/workspace.js'
import Tag from '../../components/workspace/StaffTag.jsx'
import { IssuedLink } from '../../components/operations/OperationalRecords.jsx'
import Empty from '../../components/workspace/StaffEmpty.jsx'

export default function ApprovalPanel({ approvals, bookings, flags = [], risks = [], onRequest, onReview, setDialog }) {
  const [filter, setFilter] = useState('pending')
  const shown = approvals.filter(a => filter === 'all' || a.status === filter)
  const autoReleasedCount = approvals.filter(a => a.status === 'auto-released').length

  return <>
    <section className="workspace-surface staff-section">
      <div className="workspace-section-heading">
        <div>
          <p className="workspace-kicker">BY-EXCEPTION FINANCIAL CONTROLS</p>
          <h2>Security Deposit approvals</h2>
        </div>
        <button className="button button-dark" onClick={onRequest}>Security Deposit exception<Icon name="wallet" size={17} /></button>
      </div>
      <div className="staff-toolbar">
        <select aria-label="Filter financial approvals" value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="pending">Pending exceptions ({approvals.filter(a => a.status === 'pending').length})</option>
          <option value="auto-released">Auto-released clean returns ({autoReleasedCount})</option>
          <option value="approved">Manager approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All records</option>
        </select>
        <span className="workspace-muted">Auto-Release active: Clean returns with 0 damage & 100% fuel release automatically (24–48h).</span>
      </div>
      {shown.length ? <PaginatedList>{shown.map(a => <article className="staff-ledger-row" key={a.id}>
        <div>
          <h3>{a.type === 'deposit' ? (a.autoReleased ? 'Auto-released security deposit' : 'Disputed / manual deposit release') : 'Cancelled rental payment return'} · {money(a.amount)}</h3>
          <p>{a.bookingId} · {bookings.find(b => b.id === a.bookingId)?.renter.name || 'Customer'}{a.withheldAmount > 0 ? ` · Withheld for damage/fuel: ${money(a.withheldAmount)}` : ''}</p>
          <p>{a.reason}</p>
          <small>Logged by {a.by} · {fmt(a.at)}</small>
          {a.reviewNote && <p>Manager decision ({a.reviewedBy}): {a.reviewNote}</p>}
        </div>
        {a.disputed && <Tag>Disputed / Withheld</Tag>}
        {a.highValue && !a.autoReleased && <Tag>High value</Tag>}
        <Tag>{a.status}</Tag>
        {a.disbursement?.receipt && <IssuedLink record={a.disbursement.receipt}>Release receipt</IssuedLink>}
        {a.status === 'pending' && <button className="button button-dark" onClick={() => onReview(a)}>Approve / reject</button>}
      </article>)}</PaginatedList> : <Empty>No financial exception requests in this view.</Empty>}
    </section>

    <section className="workspace-surface staff-section">
      <div className="workspace-section-heading">
        <div>
          <p className="workspace-kicker">SYSTEM ANOMALY FLAGS</p>
          <h2>Overdue rental overrides</h2>
        </div>
        <Icon name="clock" />
      </div>
      {flags.length ? <PaginatedList>{flags.map(flag => <article className="staff-ledger-row" key={flag.id}>
        <div>
          <h3>{flag.bookingId} · {vehicleName(flag.vehicleId)}</h3>
          <p>Return due {prettyDate(flag.end)} at {flag.endTime} PHT</p>
          {flag.override && <p>Override by {flag.override.by}: {flag.override.reason}</p>}
        </div>
        <Tag>{flag.override ? 'Reviewed' : 'Overdue'}</Tag>
        {!flag.override && <button className="button button-outline" onClick={() => setDialog({ kind: 'flag-override', flag })}>Override alert</button>}
      </article>)}</PaginatedList> : <Empty>No overdue system flags.</Empty>}
    </section>

    <section className="workspace-surface">
      <div className="workspace-section-heading">
        <div>
          <p className="workspace-kicker">POLICY & RISK OVERRIDES</p>
          <h2>Driver risk register</h2>
        </div>
        <button className="button button-outline" onClick={() => setDialog({ kind: 'risk-new' })}>Log driver risk<Icon name="shield" size={17} /></button>
      </div>
      {risks.length ? <PaginatedList>{risks.map(r => <article className="staff-ledger-row" key={r.id}>
        <div>
          <h3>{r.driver} · {r.bookingId}</h3>
          <p>{r.description}</p>
          <small>{fmt(r.at)} · {r.by}</small>
          {r.reason && <p>Override by {r.reviewedBy}: {r.reason}</p>}
        </div>
        <Tag>{r.severity}</Tag>
        <Tag>{r.status}</Tag>
        {r.status === 'open' && <button className="button button-outline" onClick={() => setDialog({ kind: 'risk-override', risk: r })}>Override risk</button>}
      </article>)}</PaginatedList> : <Empty>No driver risk flags logged.</Empty>}
    </section>
  </>
}

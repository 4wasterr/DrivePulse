import { money } from '../../data.js'

export function IssuedLink({ record, children }) {
  return record ? <a className="button button-outline" href={`/api/rental-documents/${encodeURIComponent(record.id)}`}>{children}</a> : null
}

export function BookingRecords({ booking: b }) {
  return <div className="record-actions">
    <IssuedLink record={b.confirmation}>Booking confirmation</IssuedLink>
    <IssuedLink record={b.agreement}>Rental contract</IssuedLink>
    <IssuedLink record={b.releaseReceipt}>Release receipt</IssuedLink>
    <IssuedLink record={b.returnReceipt}>Return receipt</IssuedLink>
    {b.returnedAt && !b.returnReceipt && <span className="workspace-muted">Return receipt awaiting mechanic’s post-return inspection.</span>}
    {(b.payments || []).filter(p => p.receipt).map(p => <IssuedLink record={p.receipt} key={p.id}>{p.type === 'deposit' ? 'Deposit' : 'Rental'} receipt · {money(p.amount)}</IssuedLink>)}
    {(b.cashReleases || []).map(r => <IssuedLink key={r.approvalId} record={r.receipt}>{r.mode === 'Automated Clean-Return Release' ? 'Auto-released deposit' : 'Release receipt'} · {money(r.amount)}</IssuedLink>)}
  </div>
}

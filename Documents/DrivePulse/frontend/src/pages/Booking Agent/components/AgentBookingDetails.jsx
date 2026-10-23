import { useState } from 'react'
import { vehicles, prettyDate, money, dateISO, rentalDays, tripTime } from '../../../data.js'
import { api } from '../../../api.js'
import Modal from '../../../components/ui/Modal.jsx'
import Icon from '../../../components/ui/Icon.jsx'
import IdViewerModal from '../../../components/ui/IdViewerModal.jsx'
import UploadField from '../../../components/ui/UploadField.jsx'
import { BookingRecords, IssuedLink } from '../../../components/operations/OperationalRecords.jsx'
import { downloadPass } from '../../../dispatchPass.js'
import { generateQRCodeSVG } from '../../../utils/qr.js'

const documentKinds = [
  ['license', "Official Driver's License"],
  ['government-1', 'Primary Government ID (Passport / UMID / PhilSys)'],
  ['government-2', 'Secondary ID / Proof of Billing']
]

const tabs = [
  ['reservation', 'Overview & contracts'],
  ['documents', 'IDs & verification'],
  ['payments', 'Payments & deposits'],
  ['dispatch', 'Dispatch pass'],
  ['adjustments', 'Adjustments & return']
]

const stamp = value => new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function AgentBookingDetails({ booking, initialTab, onClose, onRefresh, onNotice, onArchive }) {
  const [tab, setTab] = useState(() => tabs.some(([id]) => id === initialTab) ? initialTab : 'reservation')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [preview, setPreview] = useState(null)
  const vehicle = vehicles.find(v => v.id === booking.vehicleId)
  const closed = ['Cancelled', 'Completed'].includes(booking.status), canReview = !closed && booking.status !== 'On Rental'

  async function mutate(action, body, message) {
    setBusy(true); setError('')
    try { await api(`/agent/bookings/${booking.id}/${action}`, { method: 'POST', body: { ...body, version: booking.version } }); await onRefresh(); onNotice(message); return true }
    catch (problem) { setError(problem.message); await onRefresh(); return false }
    finally { setBusy(false) }
  }

  return <Modal title={booking.renter.name} eyebrow={`${booking.id}${booking.sample ? ' · SAMPLE RESERVATION' : ''} · ${booking.source.toUpperCase()}`} wide onClose={onClose}>
    <div className="reservation-summary-strip"><img src={vehicle.image} alt={vehicle.name} /><div><strong>{vehicle.name}</strong><span>{prettyDate(booking.start, { year: 'numeric' })} – {prettyDate(booking.end, { year: 'numeric' })}</span></div><span className="workspace-tag tag-solid">{booking.status}</span></div>
    <div className="booking-detail-tabs" role="tablist" aria-label="Reservation sections">{tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} aria-controls={`detail-${id}`} id={`tab-${id}`} className={tab === id ? 'active' : ''} onClick={() => { setTab(id); setError(''); setPreview(null) }}>{label}{id === 'documents' && <small>{booking.documents.filter(d => d.review?.status === 'approved').length}/3</small>}</button>)}</div>
    {error && <p className="error-banner" role="alert"><Icon name="info" />{error}</p>}
    <div role="tabpanel" id={`detail-${tab}`} aria-labelledby={`tab-${tab}`} className="booking-detail-panel">
      {tab === 'reservation' && <>
        <div className="detail-overview-grid">
          <section><p className="workspace-kicker">CUSTOMER</p><h3>{booking.renter.name}</h3><p>{booking.renter.email || 'No email provided'}</p><p>{booking.renter.phone || 'Contact through client support'}</p></section>
          <section><p className="workspace-kicker">RESERVATION</p><h3>{booking.days} rental day(s)</h3><p>{booking.source} · Created {stamp(booking.createdAt)}</p><p>{booking.note || 'No additional reservation notes.'}</p></section>
          <section><p className="workspace-kicker">PICK-UP</p><h3>{prettyDate(booking.start)} · {booking.startTime}</h3><p>{booking.pickup}</p></section>
          <section><p className="workspace-kicker">RETURN</p><h3>{prettyDate(booking.end)} · {booking.endTime}</h3><p>{booking.dropoff}</p></section>
        </div>
        <div className="detail-balance-grid"><div><span>Total quotation</span><strong>{money(booking.total)}</strong></div><div><span>Verified payments</span><strong>{money(booking.billing.totalPaid)}</strong></div><div><span>Outstanding balance</span><strong>{money(booking.billing.balance)}</strong></div></div>
        <div className="record-section">
          <h3>Issued contracts & receipts</h3>
          <BookingRecords booking={booking} />
        </div>
        <div className="detail-next-actions">
          <button className="button button-outline" onClick={() => setTab('documents')}>Verify IDs<Icon name="shield" size={18} /></button>
          <button className="button button-outline" onClick={() => setTab('payments')}>Payments<Icon name="wallet" size={18} /></button>
          <button className="button button-dark" onClick={() => setTab('dispatch')}>Dispatch pass<Icon name="arrow" size={18} /></button>
          {closed && onArchive && <button className="button button-outline" onClick={() => onArchive(booking.id)}>One-click archive</button>}
        </div>
        {booking.cancellation && <div className="info-note"><Icon name="info" /><span>Cancelled by {booking.cancellation.by}: {booking.cancellation.reason}<br />Verified payments requiring refund handling: {money(booking.cancellation.refundDue)}.</span></div>}
      </>}

      {tab === 'documents' && <>
        <div className="workspace-section-heading"><div><h3>Customer verification</h3><p className="workspace-muted">Review the license and two different government IDs.</p></div><span className="workspace-tag">{booking.verificationStatus}</span></div>
        <div className="review-document-list">{documentKinds.map(([kind, label]) => {
          const doc = booking.documents.find(d => d.kind === kind)
          return <article className="review-document" key={kind}>
            <div className="review-document-title"><span className="review-file-icon"><Icon name="file" size={24} /></span><div><h4>{label}</h4><p>{doc?.name || 'No document uploaded'}</p></div><span className={`workspace-tag ${doc?.review?.status === 'approved' ? 'tag-solid' : ''}`}>{doc?.review?.status === 'approved' ? 'Approved' : doc?.review?.status === 'rejected' ? 'Rejected' : 'Pending'}</span></div>
            {doc && <>
              <button className="text-link" onClick={() => setPreview(doc)}>Open document<Icon name="diagonal" size={16} /></button>
              {doc.review?.by && <p className="review-meta">Reviewed by {doc.review.by} · {stamp(doc.review.at)}{doc.review.note && <span>{doc.review.note}</span>}</p>}
              {canReview && <form key={booking.version} onSubmit={async event => { event.preventDefault(); const form = event.currentTarget; await mutate('review', { documentId: doc.id, decision: event.nativeEvent.submitter.value, reason: new FormData(form).get('reason') }, 'Document review saved.') }}><label className="form-field">Review note <span className="field-optional">Required when rejecting</span><input name="reason" maxLength={1000} placeholder="Explain any issue with this document" /></label><div className="review-actions"><button className="button button-outline" value="rejected" disabled={busy}>Reject document</button><button className="button button-dark" value="approved" disabled={busy || doc.review?.status === 'approved'}><Icon name="check" size={18} />Approve document</button></div></form>}
            </>}
            {canReview && (!doc || doc.review?.status === 'rejected') && <UploadField documentId={kind} label={doc ? `Replace ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`} bookingId={booking.id} onUpload={onRefresh} />}
          </article>
        })}</div>
      </>}

      {tab === 'payments' && <>
        <div className="detail-balance-grid"><div><span>Rental + additional fees</span><strong>{money(booking.billing.rentalDue)}</strong><small>{money(booking.billing.rentalBalance)} outstanding</small></div><div><span>Security deposit</span><strong>{money(booking.deposit)}</strong><small>{money(booking.billing.depositBalance)} outstanding</small></div><div><span>Total verified</span><strong>{money(booking.billing.totalPaid)}</strong><small>{money(booking.billing.balance)} still due</small></div></div>
        {booking.lateFee > 0 && <div className="info-note"><Icon name="clock" /><span>Late return: {booking.lateHours} started hour(s) × {money(booking.hourlyLateRate)} = {money(booking.lateFee)}. Included in the rental balance above.</span></div>}
        <h3 className="detail-subheading">Payment records</h3>
        <div className="payment-record-list">{booking.payments.length ? booking.payments.map(payment => <article className="payment-record" key={payment.id}>
          <div className="payment-record-heading"><span className="review-file-icon"><Icon name={payment.type === 'deposit' ? 'shield' : 'wallet'} size={22} /></span><div><strong>{payment.type === 'deposit' ? 'Security deposit' : 'Rental / downpayment'} · {money(payment.amount)}</strong><p>{payment.method}{payment.simulated ? ' · Sample' : ''} · {payment.reference}</p></div><span className={`workspace-tag ${payment.status === 'confirmed' ? 'tag-solid' : ''}`}>{payment.status === 'confirmed' ? 'Verified' : payment.status === 'rejected' ? 'Rejected' : 'Pending review'}</span></div>
          <IssuedLink record={payment.receipt}>Cash receipt</IssuedLink>
          {payment.reviewedBy && <p className="review-meta">Reviewed by {payment.reviewedBy}{payment.reviewNote ? ` · ${payment.reviewNote}` : ''}</p>}
          {payment.status === 'pending' && booking.status !== 'Cancelled' && <form onSubmit={event => { event.preventDefault(); mutate('payment', { paymentId: payment.id, decision: event.nativeEvent.submitter.value, reason: new FormData(event.currentTarget).get('reason'), reference: new FormData(event.currentTarget).get('reference'), received: new FormData(event.currentTarget).get('received') === 'on' }, 'Payment review saved.') }}><label className="form-field">Review note <span className="field-optional">Required when rejecting</span><input name="reason" maxLength={1000} placeholder="Review notes or reason for rejection" /></label><label className="form-field">Cash receipt reference (required to confirm)<input name="reference" maxLength={150} /></label><label className="checkbox-label"><input type="checkbox" name="received" />I physically received this cash amount.</label><div className="review-actions"><button className="button button-outline" value="rejected" disabled={busy}>Reject</button><button className="button button-dark" value="confirmed" disabled={busy}>Confirm payment<Icon name="check" size={18} /></button></div></form>}
        </article>) : <p className="workspace-muted">No payments recorded yet.</p>}</div>
        {booking.status !== 'Cancelled' && booking.billing.balance > 0 && <form key={booking.version} className="record-payment-form" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); mutate('payment', { type: data.get('type'), amount: Number(data.get('amount')), method: data.get('method'), reference: data.get('reference'), received: data.get('received') === 'on' }, 'Payment recorded and added to the verified ledger.') }}><h3>Record a payment</h3><div className="form-grid"><label className="form-field">Payment allocation<select name="type" defaultValue={booking.billing.rentalBalance > 0 ? 'rental' : 'deposit'}><option value="rental">Base Rental Charges / Downpayment</option><option value="deposit">Refundable Security Deposit (PHP 5,000)</option><option value="extension">Rental Extension Adjustment</option><option value="late_fee">Late Return Hourly Surcharge</option><option value="fuel_charge">Fuel Refill / Shortfall Fee</option><option value="cleaning_fee">Interior Sanitation / Detailing Fee</option><option value="damage_fee">Vehicle Damage / Scratch Repair Charge</option><option value="toll_violation">Unpaid Expressway Tolls / Violations</option></select></label><label className="form-field">Amount (PHP)<input name="amount" type="number" min="0.01" max={booking.billing.balance} step="0.01" required /></label><label className="form-field">Payment method<input name="method" value="Cash" readOnly /></label><label className="form-field">Receipt / transaction reference<input name="reference" maxLength={150} required /></label></div><label className="checkbox-label"><input type="checkbox" name="received" required />I physically received this cash amount.</label><button className="button button-dark" disabled={busy}>Record cash received<Icon name="check" size={18} /></button></form>}
      </>}

      {tab === 'dispatch' && <>
        <div className="dispatch-readiness">
          <div><p className="workspace-kicker">RELEASE CHECKLIST</p><h3>{booking.dispatchBlocks.length ? 'A few details before departure.' : 'All checks complete. Ready to go.'}</h3></div>
          <div className="release-checks">{[['Identity approved', booking.verificationStatus === 'Verified'], ['Rental fully paid', booking.billing.rentalBalance === 0], ['Deposit recorded', booking.billing.depositBalance === 0], ['Mechanic inspection', booking.inspection?.status === 'approved' && booking.inspection?.role === 'mechanic']].map(([label, complete]) => <span key={label} className={complete ? 'is-complete' : ''}><Icon name={complete ? 'check' : 'clock'} size={18} />{label}</span>)}</div>
          {booking.dispatchBlocks.length > 0 && <ul>{booking.dispatchBlocks.map(block => <li key={block}>{block}</li>)}</ul>}
        </div>
        {booking.inspection?.status !== 'approved' && !closed && (
          <div className="fast-track-clearance-card" style={{ background: '#f8fafc', border: '1px solid #cbd5e1', padding: '14px 16px', borderRadius: '8px', margin: '14px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#0f172a', fontWeight: 600, marginBottom: '4px' }}>
              <Icon name="bolt" size={17} />
              <span>Fast-track pre-dispatch inspection:</span>
            </div>
            <p className="workspace-muted" style={{ margin: '0 0 10px', fontSize: '13px' }}>
              If this vehicle is currently parked and cleared in the active fleet, you can fast-track digital clearance in 1 click using its active fleet readiness.
            </p>
            <button
              type="button"
              className="button button-outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true); setError('')
                try {
                  await api(`/bookings/${booking.id}/fast-clearance`, { method: 'POST', body: { version: booking.version } })
                  await onRefresh()
                  onNotice('Pre-dispatch clearance verified and attached to reservation!')
                } catch (e) {
                  setError(e.message)
                } finally {
                  setBusy(false)
                }
              }}
            >
              <Icon name="check" size={16} />
              Fast-track dispatch clearance (1-click)
            </button>
          </div>
        )}
        {booking.inspection?.status === 'approved' && booking.inspection?.role === 'mechanic' && <div className="info-note"><Icon name="check" /><span>Inspection approved by {booking.inspection.by} · {stamp(booking.inspection.at)}{booking.inspection.photos && <><br />{booking.inspection.odometer.toLocaleString()} km · Fuel / charge {booking.inspection.fuelLevel}% · Interior {booking.inspection.cleanliness}<br />{booking.inspection.photos.filter(p => !p.id.startsWith('sample-')).map(photo => <a className="text-link" key={photo.id} href={`/api/documents/${encodeURIComponent(photo.id)}`} target="_blank" rel="noreferrer">View {photo.view} condition photo </a>)}</>}</span></div>}
        {booking.dispatchPass && !booking.dispatchPass.revokedAt && !closed ? (
          <div className="digital-pass">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div><span className="workspace-kicker">DIGITAL DISPATCH PASS</span><Icon name="shield" size={28} /></div>
                <h3>{booking.dispatchPass.id}</h3>
                <p>{booking.renter.name} · {vehicle.name}</p>
                <span>Issued by {booking.dispatchPass.issuedBy} · {stamp(booking.dispatchPass.issuedAt)}</span>
              </div>
              <div
                style={{ background: '#fff', padding: '8px', borderRadius: '6px', border: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
                dangerouslySetInnerHTML={{ __html: generateQRCodeSVG(`DP-PASS:${booking.dispatchPass.id}:${booking.id}:${vehicle.name}`, { size: 90 }) }}
              />
            </div>
            <div className="digital-pass-actions">
              <button className="button button-dark" onClick={() => downloadPass(booking)}><Icon name="download" size={18} />Download pass</button>
              {booking.status === 'Ready for Dispatch' && <button className="button button-outline" disabled={busy || booking.dispatchBlocks.length > 0} onClick={() => mutate('dispatch', {}, 'Vehicle dispatched and release receipt issued.')}>Mark vehicle dispatched<Icon name="arrow" size={18} /></button>}
            </div>
          </div>
        ) : !closed && (
          <button className="button button-dark full-width" disabled={busy || booking.dispatchBlocks.length > 0} onClick={() => mutate('pass', {}, 'Digital dispatch pass issued.')}><Icon name="file" size={19} />{booking.dispatchPass?.revokedAt ? 'Issue updated dispatch pass' : 'Issue digital dispatch pass'}</button>
        )}
      </>}

      {tab === 'adjustments' && <Adjustments key={booking.version} booking={booking} vehicle={vehicle} busy={busy} mutate={mutate} />}
    </div>
    {preview && <IdViewerModal document={{ ...preview, label: documentKinds.find(([k]) => k === preview.kind)?.[1] || preview.name }} onClose={() => setPreview(null)} />}
  </Modal>
}

function Adjustments({ booking, vehicle, busy, mutate }) {
  const [end, setEnd] = useState(booking.end), [endTime, setEndTime] = useState(booking.endTime), [cancel, setCancel] = useState(false)
  const now = new Date(), currentTime = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Manila', hour12: false, hour: '2-digit', minute: '2-digit' })
  const [returnDate, setReturnDate] = useState(dateISO), [returnTime, setReturnTime] = useState(currentTime), [lateRate, setLateRate] = useState(200)
  const extra = Math.max(0, rentalDays(booking.start, end, booking.startTime, endTime) * vehicle.rate - booking.rental)
  const hours = Math.max(0, Math.ceil((tripTime(returnDate, returnTime) - tripTime(booking.end, booking.endTime)) / 3600000))
  const closed = ['Cancelled', 'Completed'].includes(booking.status)
  return <div className="adjustment-panels">
    {!closed && <form onSubmit={event => { event.preventDefault(); mutate('extend', { end, endTime, reason: new FormData(event.currentTarget).get('reason') }, 'Rental extended. Review any additional payment and reissue the pass if needed.') }}><h3>Extend this rental</h3><div className="form-grid"><label className="form-field">New return date<input type="date" min={booking.end > dateISO() ? booking.end : dateISO()} required value={end} onChange={e => setEnd(e.target.value)} /></label><label className="form-field">New return time<input type="time" required value={endTime} onChange={e => setEndTime(e.target.value)} /></label><label className="form-field span-2">Adjustment note<input name="reason" maxLength={1000} required /></label></div><p className="adjustment-total">Additional rental <strong>{money(Number.isFinite(extra) ? extra : 0)}</strong></p><button className="button button-dark" disabled={busy}>Confirm extension<Icon name="arrow" size={18} /></button></form>}
    {booking.status === 'On Rental' && <form onSubmit={event => { event.preventDefault(); mutate('return', { date: returnDate, time: returnTime, hourlyRate: Number(lateRate) }, 'Vehicle return recorded. Clean post-return inspection by mechanic will auto-release the deposit (24–48h).') }}><h3>Record return & late fees</h3><p className="workspace-muted">A vehicle moves to Under Inspection upon return. If the mechanic marks Clean Return with zero damage flags and 100% fuel, the deposit auto-releases without manager intervention.</p><div className="form-grid"><label className="form-field">Actual return date<input type="date" min={booking.start} max={dateISO()} required value={returnDate} onChange={e => setReturnDate(e.target.value)} /></label><label className="form-field">Actual return time<input type="time" required value={returnTime} onChange={e => setReturnTime(e.target.value)} /></label><label className="form-field">Late fee / started hour (PHP)<input type="number" required min="0" max="10000" step="1" value={lateRate} onChange={e => setLateRate(e.target.value)} /></label></div><p className="adjustment-total">{Number.isFinite(hours) ? hours : 0} late hour(s) <strong>{money(Number.isFinite(hours) ? hours * Number(lateRate) : 0)}</strong></p><button className="button button-dark" disabled={busy}>Record return & complete rental<Icon name="check" size={18} /></button></form>}
    {['Pending Approval', 'Ready for Dispatch'].includes(booking.status) && <div className="cancel-reservation-panel"><h3>Cancel reservation</h3>{cancel ? <form onSubmit={event => { event.preventDefault(); mutate('cancel', { reason: new FormData(event.currentTarget).get('reason') }, 'Reservation cancelled. Any paid amounts require refund handling.') }}><label className="form-field">Cancellation reason<textarea name="reason" required maxLength={1000} rows={3} /></label><div className="review-actions"><button type="button" className="button button-outline" onClick={() => setCancel(false)}>Keep reservation</button><button className="button button-dark" disabled={busy}>Confirm cancellation</button></div></form> : <button className="button button-outline" onClick={() => setCancel(true)}>Cancel this reservation</button>}</div>}
    {closed && <div className="info-note"><Icon name="info" /><span>This reservation is {booking.status.toLowerCase()}. Scheduling adjustments are closed.{booking.lateFee > 0 && ` Recorded late fee: ${money(booking.lateFee)}.`}</span></div>}
  </div>
}

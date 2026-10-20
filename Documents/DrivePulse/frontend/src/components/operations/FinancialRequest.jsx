import { useState } from 'react'
import Modal from '../ui/Modal.jsx'
import Empty from '../workspace/StaffEmpty.jsx'
import { api } from '../../api.js'
import { money } from '../../data.js'
import Icon from '../ui/Icon.jsx'

export default function FinancialRequest({ bookings, onClose, onDone }) {
  const eligible = bookings.filter(b => ['Cancelled', 'Completed'].includes(b.status) && (b.refundableDeposit > 0 || b.refundableRental > 0))
  const [bookingId, setBookingId] = useState(eligible[0]?.id || ''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const b = eligible.find(b => b.id === bookingId)
  const [allocation, setAllocation] = useState('deposit')
  const available = b ? allocation === 'deposit' ? b.refundableDeposit : b.refundableRental : 0
  return <Modal title="Submit financial exception / refund" eyebrow="BY-EXCEPTION APPROVAL WORKFLOW" onClose={onClose}>
    <p className="workspace-muted">Clean returns with zero damage flags and 100% fuel auto-release deposits within 24–48 hours. Submit this request only for <strong>disputed/withheld deposits</strong> (e.g. damage or fuel deductions) or <strong>cancelled booking refunds</strong>.</p>
    {!eligible.length ? <Empty>No returned or cancelled reservations have unreleased funds requiring manual exception review.</Empty> : <form className="staff-form" onSubmit={async e => {
      e.preventDefault(); const data = new FormData(e.currentTarget); setBusy(true); setError('')
      try {
        await api('/operations/approvals', { method: 'POST', body: { bookingId, type: allocation, amount: Number(data.get('amount')), reason: data.get('reason'), disputed: true } })
        await onDone('Exception request sent to the Operations Manager for review.')
      } catch (e) { setError(e.message) } finally { setBusy(false) }
    }}>
      <fieldset disabled={busy}>
        <label className="form-field">Reservation<select value={bookingId} onChange={e => { setBookingId(e.target.value); setAllocation('deposit') }}>{eligible.map(b => <option key={b.id} value={b.id}>{b.id} · {b.renter.name} · {b.status}</option>)}</select></label>
        <label className="form-field">Allocation type<select value={allocation} onChange={e => setAllocation(e.target.value)}><option value="deposit">Disputed / withheld security deposit</option>{b?.status === 'Cancelled' && <option value="refund">Cancelled rental refund</option>}</select></label>
        <p className="info-note">Available verified funds: {money(available || 0)}. Enter a lower release amount if withholding funds for damage or fuel.</p>
        <label className="form-field">Release amount to customer (PHP)<input key={`${bookingId}-${allocation}`} name="amount" type="number" required min="0.01" step="0.01" max={available || 0} defaultValue={available || ''} /></label>
        <label className="form-field">Exception / withholding reason<textarea name="reason" required maxLength={1500} rows={3} placeholder="Explain the dispute, damage deduction, fuel adjustment, or cancellation refund." /></label>
        {error && <p className="error-banner" role="alert">{error}</p>}
        <button className="button button-dark" disabled={busy}>Send exception to manager<Icon name="arrow" size={18} /></button>
      </fieldset>
    </form>}
  </Modal>
}

import { useContext, useState } from 'react'
import useDraftState from '../../hooks/useDraftState.js'
import { ModalDraftContext } from '../../utils/drafts.js'
import ValidatedForm from '../ui/ValidatedForm.jsx'
import ValidatedField from '../ui/ValidatedField.jsx'
import { money } from '../../data.js'
import { inputError } from '../../../../shared/validation.mjs'

export default function RecordPaymentForm({ booking, busy, onSave, depositOnly = false }) {
  const scope = useContext(ModalDraftContext) || `payment:${booking.id}`
  const [type, setType] = useDraftState(scope, `payment-type:${booking.id}`, depositOnly || !booking.billing.rentalBalance ? 'deposit' : 'rental')
  const allocation = depositOnly ? 'deposit' : type
  const balance = allocation === 'deposit' ? booking.billing.depositBalance : booking.billing.rentalBalance
  const [amount, setAmount] = useDraftState(scope, `payment-amount:${booking.id}`, balance)
  const [received, setReceived] = useState(false)
  const invalid = Boolean(inputError(amount, { kind: 'number', required: true, min: 0.01, max: balance, step: 0.01 })) || !received
  return <ValidatedForm className="record-payment-form" draftKey={`record-payment:${booking.id}`} onSubmit={async event => {
    event.preventDefault()
    if (invalid || busy) return
    await onSave({ type: allocation, amount: Number(amount), method: 'Cash', received })
  }}>
    <h3>{depositOnly ? 'Record security deposit' : 'Record a payment'}</h3>
    <div className="form-grid">
      {!depositOnly && <label className="form-field">Payment allocation<ValidatedField as="select" name="type" value={type} onChange={event => { const value = event.target.value; setType(value); setAmount(value === 'deposit' ? booking.billing.depositBalance : booking.billing.rentalBalance); setReceived(false) }}><option value="rental" disabled={!booking.billing.rentalBalance}>Rental and additional charges</option><option value="deposit" disabled={!booking.billing.depositBalance}>Security Deposit</option></ValidatedField></label>}
      <label className="form-field">Amount received (PHP)<ValidatedField name="amount" type="number" min="0.01" max={balance} step="0.01" required value={amount} onChange={event => setAmount(event.target.value)} /><small>Outstanding: {money(balance)}</small></label>
      <label className="form-field">Booking transaction reference<ValidatedField value={booking.transactionReference || booking.id} readOnly /></label>
      <label className="form-field">Cash receipt number<ValidatedField value="Generated when payment is recorded" readOnly /></label>
    </div>
    <label className="checkbox-label"><ValidatedField type="checkbox" name="received" required checked={received} onChange={event => setReceived(event.target.checked)} />I physically received this cash amount.</label>
    <button className="button button-dark" disabled={busy || invalid || balance <= 0}>{busy ? 'Recording…' : depositOnly ? 'Record deposit received' : 'Record cash received'}</button>
  </ValidatedForm>
}

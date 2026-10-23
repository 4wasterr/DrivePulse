import { useState } from 'react'
import Modal from '../ui/Modal.jsx'
import Empty from '../workspace/StaffEmpty.jsx'
import { api } from '../../api.js'
import { money } from '../../data.js'
import Icon from '../ui/Icon.jsx'

const COMMON_DISPUTES = [
  {
    id: 'fuel_shortfall',
    label: 'Fuel Level Shortfall (Tank returned below 100%)',
    suggestedDeduction: 1500,
    template: 'Vehicle returned with fuel level below 100%. Deducting refueling charge and standard service fee.'
  },
  {
    id: 'scratch_dent',
    label: 'Exterior Body Damage (Scratches / Dents)',
    suggestedDeduction: 2500,
    template: 'New exterior scratches / dent identified during mechanic return inspection. Withholding repair fee.'
  },
  {
    id: 'interior_soilage',
    label: 'Interior Soilage / Food Spills / Smoke Odor',
    suggestedDeduction: 1800,
    template: 'Interior returned with heavy soilage / smoke odor requiring professional deep cleaning and detailing.'
  },
  {
    id: 'late_hours',
    label: 'Unapproved Late Return Surcharge',
    suggestedDeduction: 1200,
    template: 'Vehicle returned significantly past scheduled dropoff time without prior approved extension.'
  },
  {
    id: 'tolls_citations',
    label: 'Unpaid Expressway Tolls / Traffic Citations',
    suggestedDeduction: 800,
    template: 'Unpaid expressway RFID tolls / traffic citation incurred during the rental period.'
  },
  {
    id: 'lost_accessories',
    label: 'Lost Key / Missing Vehicle Tools',
    suggestedDeduction: 3500,
    template: 'Vehicle smart key / spare tire tool kit missing upon return. Withholding replacement cost.'
  },
  {
    id: 'cancellation_fee',
    label: 'Cancelled Booking (Partial Refund with Processing Fee)',
    suggestedDeduction: 1000,
    template: 'Reservation cancelled by client. Releasing refundable balance minus non-refundable processing charge.'
  },
  {
    id: 'custom',
    label: 'Other Custom Dispute / Manager Exception',
    suggestedDeduction: 0,
    template: ''
  }
]

export default function FinancialRequest({ bookings, onClose, onDone }) {
  const eligible = bookings.filter(b => ['Cancelled', 'Completed'].includes(b.status) && (b.refundableDeposit > 0 || b.refundableRental > 0))
  const [bookingId, setBookingId] = useState(eligible[0]?.id || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const b = eligible.find(b => b.id === bookingId)
  const [allocation, setAllocation] = useState('deposit')
  const [disputeType, setDisputeType] = useState('fuel_shortfall')
  const available = b ? (allocation === 'deposit' ? b.refundableDeposit : b.refundableRental) : 0
  const [releaseAmount, setReleaseAmount] = useState(() => Math.max(0, available - 1500))
  const [reasonText, setReasonText] = useState(COMMON_DISPUTES[0].template)

  function onDisputeChange(disputeId) {
    setDisputeType(disputeId)
    const preset = COMMON_DISPUTES.find(d => d.id === disputeId)
    if (preset) {
      if (preset.template) setReasonText(preset.template)
      if (preset.suggestedDeduction > 0 && available > 0) {
        setReleaseAmount(Math.max(0, available - preset.suggestedDeduction))
      }
    }
  }

  function handleBookingChange(id) {
    setBookingId(id)
    const nextB = eligible.find(item => item.id === id)
    const nextAvail = nextB ? (allocation === 'deposit' ? nextB.refundableDeposit : nextB.refundableRental) : 0
    const preset = COMMON_DISPUTES.find(d => d.id === disputeType)
    const deduction = preset?.suggestedDeduction || 0
    setReleaseAmount(Math.max(0, nextAvail - deduction))
  }

  const withheld = Math.max(0, available - Number(releaseAmount || 0))

  return (
    <Modal title="Submit financial exception / dispute" eyebrow="OPERATIONS MANAGER EXCEPTION REVIEW" onClose={onClose}>
      <p className="workspace-muted">
        Clean returns with zero damage flags and 100% fuel auto-release deposits within 24–48 hours. Submit this request only for <strong>disputed/withheld deposits</strong> (e.g. damage or fuel deductions) or <strong>cancelled booking refunds</strong>.
      </p>

      {!eligible.length ? (
        <Empty>No returned or cancelled reservations have unreleased funds requiring manual exception review.</Empty>
      ) : (
        <form
          className="staff-form"
          onSubmit={async e => {
            e.preventDefault()
            const data = new FormData(e.currentTarget)
            setBusy(true)
            setError('')
            try {
              const selectedPreset = COMMON_DISPUTES.find(d => d.id === disputeType)
              const formattedReason = `[${selectedPreset?.label || 'Dispute'}] ${data.get('reason')}${withheld > 0 ? ` (Withheld: PHP ${withheld.toLocaleString()})` : ''}`
              await api('/operations/approvals', {
                method: 'POST',
                body: {
                  bookingId,
                  type: allocation,
                  amount: Number(releaseAmount),
                  withheldAmount: withheld,
                  reason: formattedReason,
                  disputed: true
                }
              })
              await onDone('Dispute exception sent to the Operations Manager for single-step review.')
            } catch (err) {
              setError(err.message)
            } finally {
              setBusy(false)
            }
          }}
        >
          <fieldset disabled={busy}>
            <label className="form-field">
              Reservation
              <select value={bookingId} onChange={e => handleBookingChange(e.target.value)}>
                {eligible.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.id} · {item.renter.name} · {item.status} ({item.refundableDeposit > 0 ? `Deposit PHP ${item.refundableDeposit}` : `Rental refund PHP ${item.refundableRental}`})
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field">
              Allocation category
              <select
                value={allocation}
                onChange={e => {
                  const nextAlloc = e.target.value
                  setAllocation(nextAlloc)
                  const nextAvail = b ? (nextAlloc === 'deposit' ? b.refundableDeposit : b.refundableRental) : 0
                  setReleaseAmount(nextAvail)
                }}
              >
                <option value="deposit">Security Deposit Withholding / Partial Release</option>
                {b?.status === 'Cancelled' && <option value="refund">Cancelled Rental Refund Allocation</option>}
              </select>
            </label>

            <label className="form-field">
              Common dispute category
              <select value={disputeType} onChange={e => onDisputeChange(e.target.value)}>
                {COMMON_DISPUTES.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="detail-balance-grid" style={{ margin: '14px 0' }}>
              <div>
                <span>Held funds</span>
                <strong>{money(available || 0)}</strong>
              </div>
              <div>
                <span>Withheld charge</span>
                <strong style={{ color: withheld > 0 ? '#b91c1c' : '#111827' }}>{money(withheld)}</strong>
              </div>
              <div>
                <span>Release to customer</span>
                <strong style={{ color: '#059669' }}>{money(releaseAmount || 0)}</strong>
              </div>
            </div>

            <label className="form-field">
              Net release amount to customer (PHP)
              <input
                name="amount"
                type="number"
                required
                min="0"
                step="0.01"
                max={available || 0}
                value={releaseAmount}
                onChange={e => setReleaseAmount(Number(e.target.value))}
              />
            </label>

            <label className="form-field">
              Detailed dispute & exception notes
              <textarea
                name="reason"
                required
                maxLength={1500}
                rows={3}
                value={reasonText}
                onChange={e => setReasonText(e.target.value)}
                placeholder="Explain the dispute, damage deductions, fuel charge, or cancellation reason."
              />
            </label>

            {error && <p className="error-banner" role="alert">{error}</p>}
            <button className="button button-dark" disabled={busy}>
              Send dispute exception to manager
              <Icon name="arrow" size={18} />
            </button>
          </fieldset>
        </form>
      )}
    </Modal>
  )
}

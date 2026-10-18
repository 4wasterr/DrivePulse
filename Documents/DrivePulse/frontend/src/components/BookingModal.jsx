import { useRef, useState } from 'react'
import Modal from './Modal'
import Icon from './Icon'
import UploadField from './UploadField'
import { dateISO, isAvailable, locations, money, prettyDate, rentalDays, rentalPeriodError } from '../data'

export const requiredDocuments = [{ id: 'license', label: "Driver’s license" }, { id: 'government-1', label: 'Government ID 1' }, { id: 'government-2', label: 'Government ID 2' }]

export default function BookingModal({ vehicle, initialDates, bookings, documents, onDocument, onReserve, onClose, onViewTrips }) {
  const [step, setStep] = useState(0)
  const [dates, setDates] = useState(initialDates)
  const [method, setMethod] = useState('demo')
  const [proof, setProof] = useState(null)
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState('')
  const [reservation, setReservation] = useState(null)
  const [busy, setBusy] = useState(false)
  const [proofId] = useState(() => `payment-${crypto.randomUUID()}`)
  const submitting = useRef(false)
  const days = rentalDays(dates.start, dates.end, dates.startTime, dates.endTime)
  const rental = days * vehicle.rate
  const deposit = 5000
  const total = rental + deposit
  const update = (key, value) => setDates(prev => ({ ...prev, [key]: value }))

  function validateDates() {
    const problem = rentalPeriodError(dates)
    if (problem) return problem
    if (!isAvailable(vehicle.id, dates, bookings)) return 'This vehicle is reserved during those dates. Try a different date range.'
    return ''
  }
  async function next(e) {
    e.preventDefault()
    setError('')
    if (step === 0) {
      const problem = validateDates()
      if (problem) { setError(problem); return }
      setStep(1)
    } else if (step === 1) {
      if (!requiredDocuments.every(doc => documents[doc.id])) { setError('Please upload your driver’s license and two different government IDs.'); return }
      const fingerprints = requiredDocuments.map(doc => documents[doc.id].fingerprint || `${documents[doc.id].name}:${documents[doc.id].size}`)
      if (new Set(fingerprints).size !== fingerprints.length) { setError('Please use three different documents: your license and two government IDs.'); return }
      setStep(2)
    } else {
      const problem = validateDates()
      if (problem) { setError(problem); return }
      if (method === 'proof' && !proof) { setError('Please upload your proof of payment.'); return }
      if (!agreed) { setError('Please accept the rental summary before continuing.'); return }
      if (submitting.current) return
      submitting.current = true
      setBusy(true)
      try {
        const booking = {
          id: `DP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, vehicleId: vehicle.id, ...dates, days, rental, deposit, total,
          status: 'Pending Approval', payment: method === 'demo' ? 'Demo checkout' : 'Payment proof',
          paymentStatus: method === 'demo' ? 'Simulated · paid' : 'Awaiting verification', proofId: method === 'proof' ? proofId : null,
          documents: requiredDocuments.map(d => ({ id: d.id, name: documents[d.id].name })), createdAt: new Date().toISOString(),
        }
        await onReserve(booking)
        setReservation(booking)
      } catch (err) { setError(err.message || 'Could not save the reservation. Please try again.') }
      finally { submitting.current = false; setBusy(false) }
    }
  }

  if (reservation) return <Modal title="Your next adventure is on its way." eyebrow="RESERVATION RECEIVED" onClose={onClose}>
    <div className="success-mark"><Icon name="check" size={34} /></div>
    <p className="success-copy">Your {vehicle.name} is reserved for {prettyDate(dates.start)} – {prettyDate(dates.end)}. Your documents are ready for review.</p>
    <div className="success-reference"><span>Booking reference</span><strong>{reservation.id}</strong><span className="status status-pending">Pending Approval</span></div>
    <p className="small muted">This is a browser-local preview. No real reservation or payment has been sent.</p>
    <button className="button button-dark full-width" onClick={onViewTrips}>Track my booking<Icon name="arrow" size={18} /></button>
  </Modal>

  return <Modal title="Make the journey yours." eyebrow="YOUR NEXT CHAPTER" wide onClose={onClose}>
    <div className="booking-steps" aria-label="Booking progress">{['Trip details', 'Your documents', 'Payment'].map((label, index) => <div key={label} className={index <= step ? 'current' : ''} aria-current={step === index ? 'step' : undefined}><span>{index < step ? <Icon name="check" size={14} /> : `0${index + 1}`}</span>{label}</div>)}</div>
    <div className="booking-layout">
      <form className="booking-form" onSubmit={next}>
        {step === 0 && <div className="step-content">
          <h3>A few details, a great trip.</h3><p className="muted small">Choose where and when. We’ll take care of the rest.</p>
          <div className="form-grid">
            <label className="form-field span-2">Pick-up location<select value={dates.pickup} onChange={e => update('pickup', e.target.value)}>{locations.map(l => <option key={l}>{l}</option>)}</select></label>
            <label className="form-field span-2">Drop-off location<select value={dates.dropoff} onChange={e => update('dropoff', e.target.value)}>{locations.map(l => <option key={l}>{l}</option>)}</select></label>
            <label className="form-field">Pick-up date<input required type="date" min={dateISO()} value={dates.start} onChange={e => update('start', e.target.value)} /></label>
            <label className="form-field">Pick-up time<input required type="time" value={dates.startTime} onChange={e => update('startTime', e.target.value)} /></label>
            <label className="form-field">Return date<input required type="date" min={dates.start} value={dates.end} onChange={e => update('end', e.target.value)} /></label>
            <label className="form-field">Return time<input required type="time" value={dates.endTime} onChange={e => update('endTime', e.target.value)} /></label>
          </div><p className="timezone-note"><Icon name="clock" size={14} /> All times are Philippine Standard Time (UTC+8).</p>
        </div>}
        {step === 1 && <div className="step-content"><h3>A little paperwork. Then freedom.</h3><p className="muted small">Upload a valid license and two different government-issued IDs. PDF, JPG, PNG or WebP, up to 5 MB each.</p><div className="upload-stack">{requiredDocuments.map(doc => <UploadField key={doc.id} documentId={doc.id} label={doc.label} value={documents[doc.id]} onUpload={value => onDocument(doc.id, value)} />)}</div><div className="info-note"><Icon name="shield" size={18} /><span>Files stay in this browser for this preview. Uploading a file does not verify your identity.</span></div></div>}
        {step === 2 && <div className="step-content"><h3>One last stop before you go.</h3><p className="muted small">Choose how you’d like to complete your booking.</p><div className="payment-options">
          <label className={`payment-option ${method === 'demo' ? 'selected' : ''}`}><input type="radio" name="payment" checked={method === 'demo'} onChange={() => setMethod('demo')} /><Icon name="card" /><span><strong>Simulated checkout</strong><small>Try the full flow. No card or charge.</small></span><span className="mini-tag">DEMO</span></label>
          <label className={`payment-option ${method === 'proof' ? 'selected' : ''}`}><input type="radio" name="payment" checked={method === 'proof'} onChange={() => setMethod('proof')} /><Icon name="upload" /><span><strong>Upload payment proof</strong><small>Submit a receipt for review in this preview.</small></span></label>
        </div>{method === 'proof' && <UploadField documentId={proofId} label="Proof of payment" value={proof} onUpload={setProof} />}
        <div className="info-note"><Icon name="info" size={18} /><span>The {money(deposit)} refundable security deposit is included in your total. Rental is billed per started 24-hour period.</span></div>
        <label className="checkbox-label"><input required type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} /><span>I have reviewed the dates, locations, rental quotation, and refundable deposit. I understand this is a simulated booking.</span></label></div>}
        {error && <p className="error-banner" role="alert"><Icon name="info" size={18} />{error}</p>}
        <div className="form-actions">{step > 0 && <button type="button" className="button button-ghost" disabled={busy} onClick={() => { setStep(step - 1); setError('') }}>Back</button>}<button type="submit" disabled={busy} className="button button-dark">{busy ? 'Saving…' : step === 2 ? method === 'demo' ? 'Confirm simulated booking' : 'Submit for review' : 'Continue'}<Icon name="arrow" size={17} /></button></div>
      </form>
      <aside className="booking-summary"><img src={vehicle.image} alt={vehicle.name} /><div className="summary-content"><span className="eyebrow">YOUR CHOSEN RIDE</span><h3>{vehicle.name}</h3><p className="muted small">{vehicle.category} · {vehicle.transmission} · {vehicle.seats} seats</p><div className="summary-dates"><Icon name="calendar" size={18} /><span>{prettyDate(dates.start)} – {prettyDate(dates.end)}<small>{days} {days === 1 ? 'day' : 'days'} of possibility</small></span></div><div className="price-line"><span>{money(vehicle.rate)} × {days} days</span><span>{money(rental)}</span></div><div className="price-line"><span>Refundable deposit</span><span>{money(deposit)}</span></div><div className="price-total"><span>Total quotation</span><strong>{money(total)}</strong></div><p className="small muted">No hidden booking fees. Fuel, tolls, and any additional charges are excluded.</p><span className="summary-trust"><Icon name="shield" size={16} /> Your plans, in good hands.</span></div></aside>
    </div>
  </Modal>
}

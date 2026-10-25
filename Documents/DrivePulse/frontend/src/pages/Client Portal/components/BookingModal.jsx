import ValidatedField from '../../../components/ui/ValidatedField.jsx'
import ValidatedForm from '../../../components/ui/ValidatedForm.jsx'
import { useState, useRef, useEffect } from 'react'
import { rentalDays, getAvailabilityReason, requiredDocuments, prettyDate, locations, dateISO, money } from '../../../data.js'
import Modal from '../../../components/ui/Modal.jsx'
import Icon from '../../../components/ui/Icon.jsx'
import UploadField from '../../../components/ui/UploadField.jsx'
import { api } from '../../../api.js'
import ReservationConfirmation, { RentalAgreementSummary } from '../../../components/operations/ReservationConfirmation.jsx'
import { bookingStepError, duplicateDocumentsError } from '../../../utils/bookingSteps.js'

export default function BookingModal({ vehicle, initialDates, bookings, documents, onDocument, onReserve, onClose, onBack, onViewTrips }) {
  const [step, setStep] = useState(0)
  const [dates, setDates] = useState(initialDates)
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState('')
  const [reservation, setReservation] = useState(null)
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const [agreement, setAgreement] = useState(null), [retry, setRetry] = useState(0)
  const requestBody = JSON.stringify({ vehicleId: vehicle.id, ...dates })
  const requestKey = requestBody + ':' + retry

  useEffect(() => {
    let active = true
    api('/bookings/agreement-preview', { method: 'POST', body: JSON.parse(requestBody) })
      .then(data => { if (active) setAgreement({ key: requestKey, data }) })
      .catch(err => { if (active) setAgreement({ key: requestKey, error: err.message }) })
    return () => { active = false }
  }, [requestBody, requestKey])

  const currentAgreement = agreement?.key === requestKey ? agreement : null
  const preview = currentAgreement?.data
  const days = preview?.quote.days || rentalDays(dates.start, dates.end, dates.startTime, dates.endTime)
  const rental = preview?.quote.rental ?? days * vehicle.rate
  const deposit = preview?.quote.deposit ?? 5000
  const total = rental + deposit

  const update = (key, value) => {
    setDates(prev => ({ ...prev, [key]: value, ...(key === 'start' && prev.end < value ? { end: value } : {}) }))
    setAgreed(false)
    setError('')
  }

  const stepValidationContext = {
    dates,
    vehicleId: vehicle.id,
    bookings,
    documents,
    requiredDocs: requiredDocuments,
    preview,
    agreementError: currentAgreement?.error || '',
    agreed,
  }
  const currentStepProblem = bookingStepError({ step, ...stepValidationContext })
  const availabilityProblem = step === 0 ? getAvailabilityReason(vehicle.id, dates, bookings) : ''
  const duplicateDocsProblem = step === 1 ? duplicateDocumentsError(documents, requiredDocuments) : ''
  const uploadedCount = requiredDocuments.filter(doc => Boolean(documents[doc.id])).length

  async function next(e) {
    e.preventDefault()
    setError('')
    const problem = bookingStepError({ step, ...stepValidationContext })
    if (problem) {
      setError(problem)
      return
    }
    if (step < 2) {
      setStep(step + 1)
      return
    }
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    try {
      const booking = {
        agreementPreviewDigest: preview.digest,
        agreed: true,
        vehicleId: vehicle.id,
        ...dates,
        days,
        rental,
        deposit,
        total,
        status: 'Pending Approval',
        payment: 'Cash',
        paymentStatus: 'Awaiting verification',
        proofId: null,
        documents: requiredDocuments.map(d => ({ id: documents[d.id].id, kind: d.id, name: documents[d.id].name })),
        createdAt: new Date().toISOString(),
      }
      const savedBooking = await onReserve(booking)
      setReservation(savedBooking)
    } catch (err) {
      setError(err.message || 'Could not save the reservation. Please try again.')
      setAgreed(false)
      setRetry(value => value + 1)
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  if (reservation) return <ReservationConfirmation booking={reservation} onClose={onClose} onContinue={onViewTrips} continueLabel="Track my booking" />

  return (
    <Modal title="Make the journey yours." eyebrow="YOUR NEXT CHAPTER" wide onClose={onClose}>
      <div className="booking-steps" aria-label="Booking progress">
        {['Trip details', 'Your documents', 'Agreement & payment'].map((label, index) => (
          <div key={label} className={index <= step ? 'current' : ''} aria-current={step === index ? 'step' : undefined}>
            <span>{index < step ? <Icon name="check" size={14} /> : `0${index + 1}`}</span>
            {label}
          </div>
        ))}
      </div>

      <div className="booking-layout">
        <ValidatedForm
          key={step}
          className="booking-form"
          validation="rental"
          validate={() => availabilityProblem ? [{ name: 'end', message: `Vehicle unavailable: ${availabilityProblem}` }] : []}
          onSubmit={next}
        >
          {!currentAgreement && <p className="info-note" role="status">Preparing your Rental Terms & Agreement…</p>}
          {currentAgreement?.error && (
            <div className="error-banner" role="alert">
              {currentAgreement.error}
              <button type="button" className="text-link" onClick={() => setRetry(value => value + 1)}>Retry agreement</button>
            </div>
          )}

          {step === 0 && (
            <div className="step-content">
              <h3>A few details, a great trip.</h3>
              <p className="muted small">Choose where and when. All schedule fields are required before advancing.</p>
              <div className="form-grid">
                <label className="form-field span-2">
                  Pick-up location
                  <ValidatedField as="select" name="pickup" required value={dates.pickup} onChange={e => update('pickup', e.target.value)}>
                    {locations.map(l => <option key={l}>{l}</option>)}
                  </ValidatedField>
                </label>
                <label className="form-field span-2">
                  Drop-off location
                  <ValidatedField as="select" name="dropoff" required value={dates.dropoff} onChange={e => update('dropoff', e.target.value)}>
                    {locations.map(l => <option key={l}>{l}</option>)}
                  </ValidatedField>
                </label>
                <label className="form-field">
                  Pick-up date
                  <ValidatedField name="start" required type="date" min={dateISO()} value={dates.start} onChange={e => update('start', e.target.value)} />
                </label>
                <label className="form-field">
                  Pick-up time
                  <ValidatedField name="startTime" required type="time" value={dates.startTime} onChange={e => update('startTime', e.target.value)} />
                </label>
                <label className="form-field">
                  Return date
                  <ValidatedField name="end" required type="date" min={dates.start > dateISO() ? dates.start : dateISO()} value={dates.end} onChange={e => update('end', e.target.value)} />
                </label>
                <label className="form-field">
                  Return time
                  <ValidatedField name="endTime" required type="time" value={dates.endTime} onChange={e => update('endTime', e.target.value)} />
                </label>
              </div>
              {currentStepProblem && (
                <p className="field-error step-guardrail-message" role="alert">
                  <Icon name="info" size={15} /> {currentStepProblem}
                </p>
              )}
              <p className="timezone-note"><Icon name="clock" size={14} /> All times are Philippine Standard Time (UTC+8).</p>
            </div>
          )}

          {step === 1 && (
            <div className="step-content">
              <h3>A little paperwork. Then freedom.</h3>
              <p className="muted small">
                Upload a valid license and two different government-issued IDs ({uploadedCount} of {requiredDocuments.length} uploaded). PDF, JPG, PNG or WebP, up to 4 MB each.
              </p>
              <div className="upload-stack">
                {requiredDocuments.map(doc => (
                  <div key={doc.id} className="booking-upload-item">
                    <UploadField
                      documentId={doc.id}
                      label={doc.label}
                      value={documents[doc.id]}
                      onUpload={value => {
                        setError('')
                        return onDocument(doc.id, value)
                      }}
                    />
                    {!documents[doc.id] && (
                      <small className="step-field-hint">Required to continue</small>
                    )}
                  </div>
                ))}
              </div>
              {duplicateDocsProblem && (
                <p className="error-banner" role="alert"><Icon name="info" size={18} />{duplicateDocsProblem}</p>
              )}
              <div className="info-note">
                <Icon name="shield" size={18} />
                <span>Your documents are uploaded for booking-agent review. An upload alone does not verify your identity.</span>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="step-content">
              <h3>One last stop before you go.</h3>
              <p className="muted small">Review and confirm your agreement details to complete your booking.</p>
              <div className="info-note">
                <Icon name="wallet" />
                <span>
                  <strong>Cash at the counter</strong><br />
                  Pay the rental and security deposit in cash before vehicle release. Staff will issue a cash receipt when payment is received. Security Deposit and rental payment returns are paid in cash after manager approval.
                </span>
              </div>
              <div className="info-note">
                <Icon name="info" size={18} />
                <span>The {money(deposit)} Security Deposit is included in your total. Rental is billed per started 24-hour period.</span>
              </div>
              {preview && <RentalAgreementSummary preview={preview} />}
              <label className="checkbox-label">
                <ValidatedField
                  name="agreed"
                  required
                  type="checkbox"
                  checked={agreed}
                  onChange={e => {
                    setAgreed(e.target.checked)
                    setError('')
                  }}
                />
                <span>I accept the complete rental terms, assigned vehicle, dates, rate breakdown and Security Deposit shown above. I will pay in cash at the counter before vehicle release.</span>
              </label>
            </div>
          )}

          {error && <p className="error-banner" role="alert"><Icon name="info" size={18} />{error}</p>}

          <div className="form-actions">
            {step > 0 ? (
              <button type="button" className="button button-ghost" disabled={busy} onClick={() => { setStep(step - 1); setError('') }}>
                Back
              </button>
            ) : onBack ? (
              <button type="button" className="button button-ghost" disabled={busy} onClick={onBack}>
                Cancel
              </button>
            ) : null}
            <button
              type="submit"
              disabled={busy || Boolean(currentStepProblem)}
              className="button button-dark"
            >
              {busy ? 'Saving…' : step === 2 ? 'Submit reservation' : 'Continue'}
              <Icon name="arrow" size={17} />
            </button>
          </div>
        </ValidatedForm>

        <aside className="booking-summary">
          <img src={vehicle.image} alt={vehicle.name} />
          <div className="summary-content">
            <span className="eyebrow">YOUR CHOSEN RIDE</span>
            <h3>{vehicle.name}</h3>
            <p className="small muted">{vehicle.fleetCode || vehicle.id}</p>
            <p className="muted small">{vehicle.category} · {vehicle.transmission} · {vehicle.seats} seats</p>
            <div className="summary-dates">
              <Icon name="calendar" size={18} />
              <span>
                {prettyDate(dates.start)} – {prettyDate(dates.end)}
                <small>{days} {days === 1 ? 'day' : 'days'} of possibility</small>
              </span>
            </div>
            <div className="price-line">
              <span>{money(preview?.quote.dailyRate || vehicle.rate)} × {days} days</span>
              <span>{money(rental)}</span>
            </div>
            <div className="price-line">
              <span>Security Deposit</span>
              <span>{money(deposit)}</span>
            </div>
            <div className="price-total">
              <span>Total quotation</span>
              <strong>{money(total)}</strong>
            </div>
            <p className="small muted">No hidden booking fees. Fuel, tolls, and any additional charges are excluded.</p>
            <span className="summary-trust"><Icon name="shield" size={16} /> Your plans, in good hands.</span>
          </div>
        </aside>
      </div>
    </Modal>
  )
}

import Modal from '../ui/Modal.jsx'
import VehicleIdentity from '../fleet/VehicleIdentity.jsx'
import { money, prettyDate } from '../../data.js'

export function RentalAgreementSummary({ preview }) {
  const { renter, vehicle, schedule, quote, terms } = preview
  return <section className="rental-agreement-summary" aria-label="Rental Terms and Agreement">
    <h3>Rental Terms & Agreement</h3>
    <VehicleIdentity vehicle={vehicle} />
    <dl className="agreement-details">
      <div><dt>Renter</dt><dd>{renter.name}<small>{renter.email}</small></dd></div>
      <div><dt>Pick-up</dt><dd>{prettyDate(schedule.start)} · {schedule.startTime} PHT<small>{schedule.pickup}</small></dd></div>
      <div><dt>Return</dt><dd>{prettyDate(schedule.end)} · {schedule.endTime} PHT<small>{schedule.dropoff}</small></dd></div>
      <div><dt>Daily rate × days</dt><dd>{money(quote.dailyRate)} × {quote.days}</dd></div>
      <div><dt>Rental charges</dt><dd>{money(quote.rental)}</dd></div>
      <div><dt>Security Deposit</dt><dd>{money(quote.deposit)}</dd></div>
      <div><dt>Total quotation</dt><dd><strong>{money(quote.total)}</strong></dd></div>
    </dl>
    <details className="rental-terms" open><summary>Complete rental terms</summary><div>{terms}</div></details>
  </section>
}

export default function ReservationConfirmation({ booking, onClose, onContinue, continueLabel = 'View booking' }) {
  const record = booking.confirmation || booking.agreement
  const preview = { renter: booking.renter, vehicle: booking.vehicle, schedule: booking, quote: { days: booking.days, dailyRate: booking.dailyRate || booking.rental / booking.days, rental: booking.rental, deposit: booking.deposit, total: booking.total }, terms: booking.agreement?.terms || '' }
  return <Modal title="Reservation Confirmation" eyebrow={booking.id + ' · ' + booking.status} wide onClose={onClose}>
    <p className="info-note">Your reservation was received. Staff approval, verified documents, cash payment and a mechanic inspection are required before vehicle release.</p>
    <p className="info-note">Transaction reference: <strong>{booking.transactionReference || booking.id}</strong></p>
    <RentalAgreementSummary preview={preview} />
    <div className="confirmation-actions">
      {record && <a className="button button-outline" href={'/api/rental-documents/' + encodeURIComponent(record.id) + '?view=inline'} target="_blank" rel="noreferrer">Print / Save as PDF</a>}
      {record && <a className="button button-outline" href={'/api/rental-documents/' + encodeURIComponent(record.id)}>Download confirmation</a>}
      {onContinue && <button className="button button-dark" onClick={onContinue}>{continueLabel}</button>}
    </div>
  </Modal>
}

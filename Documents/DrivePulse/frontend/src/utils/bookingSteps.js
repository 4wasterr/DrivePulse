import { getAvailabilityReason, rentalPeriodError, requiredDocuments } from '../data.js'

export function duplicateDocumentsError(documents = {}, requiredDocs = requiredDocuments) {
  const uploaded = requiredDocs.map(doc => documents?.[doc.id]).filter(Boolean)
  if (uploaded.length < 2) return ''
  const fingerprints = uploaded.map(doc => doc.fingerprint || `${doc.name}:${doc.size}`)
  return new Set(fingerprints).size !== fingerprints.length
    ? 'Please use three different documents: your license and two government IDs.'
    : ''
}

export function bookingStepError({
  step,
  dates,
  vehicleId,
  bookings = [],
  documents = {},
  requiredDocs = requiredDocuments,
  preview = null,
  agreementError = '',
  agreed = false,
}) {
  if (step === 0) {
    if (!dates?.pickup?.trim() || !dates?.dropoff?.trim() || !dates?.start || !dates?.startTime || !dates?.end || !dates?.endTime) {
      return 'Complete all pick-up and return schedule fields to continue.'
    }
    const periodProblem = rentalPeriodError(dates)
    if (periodProblem) return periodProblem
    const availabilityReason = vehicleId ? getAvailabilityReason(vehicleId, dates, bookings) : ''
    if (availabilityReason) return `Vehicle unavailable: ${availabilityReason}`
    return ''
  }

  if (step === 1) {
    const duplicateProblem = duplicateDocumentsError(documents, requiredDocs)
    if (duplicateProblem) return duplicateProblem
    if (!requiredDocs.every(doc => Boolean(documents?.[doc.id]))) {
      return 'Please upload your driver’s license and two different government IDs.'
    }
    return ''
  }

  const stepZeroProblem = bookingStepError({ step: 0, dates, vehicleId, bookings, documents, requiredDocs })
  if (stepZeroProblem) return stepZeroProblem
  const stepOneProblem = bookingStepError({ step: 1, dates, vehicleId, bookings, documents, requiredDocs })
  if (stepOneProblem) return stepOneProblem
  if (!preview) return agreementError || 'Wait for the rental agreement to finish preparing.'
  if (!agreed) return 'Please accept the rental summary before continuing.'
  return ''
}

export function canAdvanceBookingStep(options) {
  return bookingStepError(options) === ''
}

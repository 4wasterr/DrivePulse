export function cancellationFee(booking) {
  const paid = (booking.payments || []).filter(payment => payment.status === 'confirmed' && payment.type !== 'deposit').reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0)
  return Math.round(paid * 0.2) / 100
}

export function cancellationSettlement(booking, fee = booking.cancellation ? booking.cancellation.fee ?? 0 : cancellationFee(booking)) {
  if (typeof fee !== 'number' || !Number.isFinite(fee) || fee < 0 || fee > 1e9 || Math.abs(Math.round(fee * 100) - fee * 100) > 0.00001) throw new Error('Enter a cancellation fee from PHP 0 to 1,000,000,000 with at most two decimal places.')
  const payments = (booking.payments || []).filter(payment => payment.status === 'confirmed')
  const rental = payments.filter(payment => payment.type !== 'deposit').reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0)
  const deposit = payments.filter(payment => payment.type === 'deposit').reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0)
  const cents = Math.round(fee * 100)
  const feeFromRental = Math.min(rental, cents)
  const feeFromDeposit = Math.min(deposit, Math.max(0, cents - rental))
  return { fee, feeFromRental: feeFromRental / 100, feeFromDeposit: feeFromDeposit / 100, rentalRefund: (rental - feeFromRental) / 100, depositRefund: (deposit - feeFromDeposit) / 100, refundDue: Math.max(0, rental + deposit - cents) / 100, balanceDue: Math.max(0, cents - rental - deposit) / 100 }
}

function eligible(booking, vehicleId, type) {
  if (booking.archivedAt || booking.vehicleId !== vehicleId) return false
  if (type === 'pre-dispatch') return ['Pending Approval', 'Ready for Dispatch'].includes(booking.status)
  return type === 'post-return' && booking.status === 'Completed' && Boolean(booking.returnedAt)
}

// Queue actions preserve their explicit booking. Fleet actions choose the next
// outstanding inspection, never a previously approved return or a different car.
export function inspectionBooking(bookings, vehicleId, type, requestedId) {
  if (type === 'clearance') return null
  const matches = bookings.filter(booking => eligible(booking, vehicleId, type))
  const requested = matches.find(booking => booking.id === requestedId)
  if (requested) return requested
  const report = type === 'pre-dispatch' ? 'inspection' : 'returnInspection'
  const order = booking => type === 'post-return' ? booking.returnedAt : `${booking.start}T${booking.startTime || '10:00'}`
  return matches.filter(booking => booking[report]?.status !== 'approved')
    .sort((a, b) => order(a).localeCompare(order(b)) || a.id.localeCompare(b.id))[0] || null
}

export function inspectionTypeForVehicle(bookings, vehicleId) {
  if (inspectionBooking(bookings, vehicleId, 'post-return')) return 'post-return'
  if (inspectionBooking(bookings, vehicleId, 'pre-dispatch')) return 'pre-dispatch'
  return 'clearance'
}

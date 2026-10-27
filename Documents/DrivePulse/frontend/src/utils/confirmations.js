let handler = null

export function registerConfirmationHandler(next) {
  handler = next
  return () => { if (handler === next) handler = null }
}

export function confirmationFor(path, { method = 'GET', body } = {}) {
  const verb = method.toUpperCase()
  if (verb === 'DELETE') return { title: 'Delete this record?', message: 'Are you sure you want to delete this record? This action cannot be undone.', confirmLabel: 'Delete record', destructive: true }
  if (path === '/logout') return { title: 'Log out?', message: 'Are you sure you want to log out?', confirmLabel: 'Log Out' }
  if (!['POST', 'PATCH', 'PUT'].includes(verb)) return null
  if (/^\/(?:auth\/|session\/activity$|notifications(?:\/|$)|saved(?:\/|$)|documents(?:\/|\?|$)|vehicle-images(?:\/|$))/.test(path)) return null
  if (['/bookings', '/bookings/agreement-preview', '/support'].includes(path) || /^\/support\/[^/]+\/messages$/.test(path)) return null
  if (/archive|deactivate/.test(path)) return { title: 'Archive this record?', message: 'Confirm that this record should be removed from active operations. Its history will remain in the archive.', confirmLabel: 'Confirm archive', destructive: true }
  if (/cancel/.test(path)) return { title: 'Cancel this booking?', message: 'Cancellation deducts 20% of the verified rental/downpayment, returns the full verified security deposit, and releases the vehicle. Refunds remain pending until cash release is recorded.', confirmLabel: 'Cancel booking', destructive: true }
  if (/decommission/.test(path)) return { title: 'Decommission this vehicle?', message: 'Confirm removal of this vehicle from the active rental fleet.', confirmLabel: 'Confirm decommission', destructive: true }
  if (/payment|refund|deposit|approval/.test(path)) return { title: 'Confirm financial update', message: 'Confirm this change to the payment, deposit, or approval record before continuing.', confirmLabel: 'Confirm update' }
  const status = typeof body?.status === 'string' ? body.status.slice(0, 80) : ''
  return { title: 'Confirm operational update', message: status ? `Change this record to “${status}”? This updates the current operational status.` : 'Save these changes? This will update the current record and its operational history.', confirmLabel: 'Confirm changes' }
}

export async function confirmRequest(path, options) {
  const prompt = confirmationFor(path, options)
  if (!prompt) return
  if (handler && await handler(prompt)) return
  const error = new Error('')
  error.code = 'ACTION_CANCELLED'
  throw error
}

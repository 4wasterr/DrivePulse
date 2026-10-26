export async function api(path, options = {}) {
  let response
  try {
    response = await fetch(`/api${path}`, { credentials: 'same-origin', ...options, headers: { ...(options.body && !(options.body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}), ...options.headers }, body: options.body && !(options.body instanceof Blob) ? JSON.stringify(options.body) : options.body })
  } catch { throw new Error('We could not connect to DrivePulse. Please try again.') }
  const result = await response.json().catch(() => ({}))
  if (!response.ok) { const error = new Error(result.error || (response.status === 503 ? 'DrivePulse is temporarily unavailable. Please try again shortly.' : 'The request could not be completed.')); error.status = response.status; error.code = result.code; error.data = result; throw error }
  return result
}
export const uploadDocument = (kind, file, bookingId) => api(`/documents/${encodeURIComponent(kind)}${bookingId ? `?bookingId=${encodeURIComponent(bookingId)}` : ''}`, { method: 'POST', body: file, headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) } })
export const uploadConditionPhoto = (vehicleId, file) => api(`/documents/condition?vehicleId=${encodeURIComponent(vehicleId)}`, { method: 'POST', body: file, headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) } })
export const uploadVehicleImage = file => api('/vehicle-images', { method: 'POST', body: file, headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) } })
export async function fetchDocument(id) {
  const response = await fetch(`/api/documents/${encodeURIComponent(id)}`, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('The document could not be opened. Please refresh and try again.')
  return response.blob()
}

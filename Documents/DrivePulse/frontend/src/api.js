import { confirmRequest } from './utils/confirmations.js'
import { sessionState, reportSessionExpired } from './utils/session.js'

export async function api(path, options = {}) {
  if (!(path === '/logout' && options.automatic)) await confirmRequest(path, options)
  const sessionRevision = sessionState.revision
  let response
  try {
    response = await fetch(`/api${path}`, { credentials: 'same-origin', cache: 'no-store', ...options, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000), headers: { ...(options.body && !(options.body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}), ...options.headers }, body: options.body && !(options.body instanceof Blob) ? JSON.stringify(options.body) : options.body })
  } catch (cause) { if (options.signal?.aborted) throw cause; throw new Error('We could not connect to DrivePulse. Please try again.', { cause }) }
  const result = await response.json().catch(() => ({}))
  if (!response.ok) { const error = new Error(result.error || (response.status === 503 ? 'DrivePulse is temporarily unavailable. Please try again shortly.' : 'The request could not be completed.')); error.status = response.status; error.code = result.code; error.data = result; if (result.code === 'SESSION_EXPIRED' && !path.startsWith('/auth/')) reportSessionExpired(sessionRevision); throw error }
  if (/^\/auth\/(login|signup|verify-email)$/.test(path) && result.user) sessionState.authenticated(result.user.id)
  if (typeof window !== 'undefined' && ['POST', 'PATCH', 'PUT'].includes(options.method) && !/^\/(auth|session|notifications|documents|vehicle-images)(\/|$)/.test(path) && path !== '/bookings/agreement-preview') window.dispatchEvent(new Event('drivepulse:mutation-succeeded'))
  return result
}
export const uploadDocument = (kind, file, bookingId) => api(`/documents/${encodeURIComponent(kind)}${bookingId ? `?bookingId=${encodeURIComponent(bookingId)}` : ''}`, { method: 'POST', body: file, headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) } })
export const uploadConditionPhoto = (vehicleId, file) => api(`/documents/condition?vehicleId=${encodeURIComponent(vehicleId)}`, { method: 'POST', body: file, headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) } })
export const uploadVehicleImage = file => api('/vehicle-images', { method: 'POST', body: file, headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) } })
export async function fetchDocument(id, { signal } = {}) {
  const sessionRevision = sessionState.revision
  try {
    const response = await fetch(`/api/documents/${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) })
    if (!response.ok) {
      const result = await response.json().catch(() => ({}))
      if (result.code === 'SESSION_EXPIRED') reportSessionExpired(sessionRevision)
      throw Object.assign(new Error(result.error || (response.status === 401 ? 'Sign in again to open this private document.' : response.status === 404 ? 'The uploaded document is missing or you do not have access. Ask the client to upload it again.' : 'The document service is unavailable. Retry shortly.')), { status: response.status, code: result.code })
    }
    const blob = await response.blob()
    if (!blob.size || !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(blob.type.split(';')[0])) throw new Error('The server returned an empty or unsupported document. Ask the client to upload it again.')
    return blob
  } catch (error) {
    if (signal?.aborted || error.status) throw error
    if (error.name === 'TypeError' || error.name === 'TimeoutError') throw new Error('The document could not be downloaded. Check your connection and retry.', { cause: error })
    throw error
  }
}

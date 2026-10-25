const controlCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u

export function inputError(value, { kind = 'text', label = 'This field', required = false, maxLength = 2000, minLength = 0, min, max, step } = {}) {
  const raw = typeof value === 'string' ? value : value == null ? '' : String(value)
  const clean = kind === 'password' ? raw : raw.trim()
  if (!clean.trim()) {
    if (!required) return ''
    return raw.length > 0 ? `Enter a valid ${label.toLowerCase()} without blank spaces.` : `${label} is required.`
  }
  if (typeof value === 'object' || typeof value === 'boolean') return `Enter a valid ${label.toLowerCase()}.`
  if (controlCharacters.test(clean)) return `${label} contains an unsupported control character.`
  if (clean.length > maxLength) return `Keep ${label.toLowerCase()} to ${maxLength} characters or fewer.`
  if (clean.length < minLength) return `Use at least ${minLength} characters for ${label.toLowerCase()}.`
  if (kind === 'name' && (!/^[\p{L}\p{M} .,'’()\-]+$/u.test(clean) || !/\p{L}/u.test(clean))) return 'Enter a name using letters, spaces, apostrophes, periods or hyphens.'
  if (kind === 'login-identifier') {
    if (clean.includes('@')) return inputError(clean, { kind: 'email', label, maxLength })
    if (!/^[a-z\d._-]+$/i.test(clean)) return 'Enter a username or email address.'
  }
  if (kind === 'email') {
    const [local, domain] = clean.split('@')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(clean) || local.startsWith('.') || local.endsWith('.') || clean.includes('..') || !domain.split('.').every(part => /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u.test(part))) return 'Enter an email such as name@example.com.'
  }
  if (kind === 'phone' && (!/^\+?[\d\s().-]+$/u.test(clean) || clean.replace(/\D/g, '').length < 7 || clean.replace(/\D/g, '').length > 15)) return 'Enter 7–15 digits. A leading +, spaces, brackets and hyphens are allowed.'
  if (kind === 'plate' && !/^[a-z\d][a-z\d -]{1,29}$/i.test(clean)) return 'Use 2–30 letters, numbers, spaces or hyphens for the plate.'
  if (kind === 'fleet-code' && !/^[a-z\d][a-z\d _-]{1,29}$/i.test(clean)) return 'Use 2–30 letters, numbers, spaces, hyphens or underscores for the fleet code.'
  if (kind === 'reference' && !/[\p{L}\p{N}]/u.test(clean)) return 'Include at least one letter or number in the reference.'
  if (kind === 'number') {
    const number = Number(clean)
    if (!Number.isFinite(number)) return `Enter a valid number for ${label.toLowerCase()}.`
    if (min != null && number < Number(min)) return `${label} must be at least ${min}.`
    if (max != null && number > Number(max)) return `${label} must be ${max} or less.`
    if (step && step !== 'any') {
      const units = (number - Number(min || 0)) / Number(step)
      if (Math.abs(units - Math.round(units)) > Math.max(0.000001, Math.abs(units) * Number.EPSILON * 8)) return Number(step) === 1 ? `Enter a whole number for ${label.toLowerCase()}.` : `Use increments of ${step} for ${label.toLowerCase()}.`
    }
  }
  if (kind === 'date') {
    if (!validDate(clean)) return 'Choose a valid calendar date.'
    if (min && clean < min) return `Choose a date on or after ${min}.`
    if (max && clean > max) return `Choose a date on or before ${max}.`
  }
  if (kind === 'time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(clean)) return 'Choose a valid time.'
  return ''
}

export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false
  const stamp = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value
}

export function phtTime(date, time = '00:00') {
  return validDate(date) && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? Date.parse(`${date}T${time}:00+08:00`) : NaN
}

export function extensionError(booking, end, endTime, now = Date.now()) {
  const previous = phtTime(booking.end, booking.endTime || '10:00')
  const next = phtTime(end, endTime)
  if (!Number.isFinite(next) || next <= previous) return 'The new return must be later than the current return date and time.'
  if (next <= now) return 'The new return date and time must be in the future.'
  if (next - phtTime(booking.start, booking.startTime || '10:00') > 366 * 86400000) return 'The total rental period cannot exceed 366 days.'
  return ''
}

export function returnError(booking, date, time, now = Date.now()) {
  const returned = phtTime(date, time)
  if (!Number.isFinite(returned)) return 'Choose a valid return date and time.'
  if (returned < Math.max(phtTime(booking.start, booking.startTime || '10:00'), Date.parse(booking.dispatchedAt) || 0)) return 'The actual return cannot be before pick-up or vehicle dispatch.'
  if (returned > now + 60000) return 'The actual return cannot be in the future.'
  return ''
}

export function duplicateVehicleErrors(input, vehicles, excludeId) {
  const normalize = value => String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase()
  const others = vehicles.filter(vehicle => vehicle.id !== excludeId)
  const code = normalize(input.fleetCode), plate = normalize(input.plate)
  return [
    { name: 'fleetCode', message: code && others.some(vehicle => normalize(vehicle.fleetCode) === code || normalize(vehicle.id) === code) ? 'This fleet code is already in use. Choose a different code.' : '' },
    { name: 'plate', message: plate && others.some(vehicle => normalize(vehicle.plate) === plate) ? 'This license plate is already registered in the fleet.' : '' },
  ]
}

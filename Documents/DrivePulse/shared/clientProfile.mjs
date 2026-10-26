import { inputError } from './validation.mjs'

export function clientProfile(input) {
  const profile = Object.fromEntries(['firstName', 'middleName', 'lastName', 'phone', 'street', 'city', 'postalCode'].map(key => [key, typeof input[key] === 'string' ? input[key].trim() : '']))
  for (const [key, label] of [['firstName', 'First name'], ['middleName', 'Middle name'], ['lastName', 'Last name']]) {
    const error = inputError(profile[key], { kind: 'name', label, required: key !== 'middleName', maxLength: 40 })
    if (error) throw new Error(error)
  }
  const error = inputError(profile.phone, { kind: 'ph-mobile', label: 'Contact number', required: true, maxLength: 24 })
  if (error) throw new Error(error)
  const digits = profile.phone.replace(/\D/g, '')
  profile.phone = '+63' + (digits.startsWith('0') ? digits.slice(1) : digits.startsWith('63') ? digits.slice(2) : digits)
  for (const [key, label] of [['street', 'Street address'], ['city', 'Barangay / city']]) {
    const error = inputError(profile[key], { label, required: true, minLength: 2, maxLength: 160 })
    if (error) throw new Error(error)
  }
  if (!/^\d{4}$/.test(profile.postalCode)) throw new Error('Enter a four-digit Philippine postal code.')
  return { ...profile, name: [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(' ') }
}

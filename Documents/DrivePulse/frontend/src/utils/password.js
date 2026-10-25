export const passwordRequirements = value => [
  { label: '8–128 characters', met: value.length >= 8 && value.length <= 128 },
  { label: 'One uppercase letter (A–Z)', met: /[A-Z]/.test(value) },
  { label: 'One lowercase letter (a–z)', met: /[a-z]/.test(value) },
  { label: 'One special character (e.g. !@#$%)', met: /[\p{P}\p{S}]/u.test(value) },
]
export const validPassword = value => passwordRequirements(value).every(rule => rule.met)
export function suggestPassword() {
  const groups = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '!@#$%^&*', '23456789']
  const randomIndex = length => {
    const buffer = new Uint32Array(1), ceiling = Math.floor(2 ** 32 / length) * length
    do { globalThis.crypto.getRandomValues(buffer) } while (buffer[0] >= ceiling)
    return buffer[0] % length
  }
  const all = groups.join('')
  const result = groups.map(group => group[randomIndex(group.length)])
  while (result.length < 16) result.push(all[randomIndex(all.length)])
  for (let i = result.length - 1; i > 0; i--) { const j = randomIndex(i + 1); [result[i], result[j]] = [result[j], result[i]] }
  return result.join('')
}

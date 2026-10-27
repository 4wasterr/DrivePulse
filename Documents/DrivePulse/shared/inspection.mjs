export const CONDITION_STATUSES = ['Good', 'Fair', 'Damaged', 'Needs Repair', 'N/A']
export const CONDITION_RATINGS = [
  { value: 1, label: 'Good' },
  { value: 2, label: 'Fair' },
  { value: 3, label: 'Damaged' },
  { value: 4, label: 'Needs Repair' },
]

export function conditionRating(value) {
  if (value === true) return 1
  const rating = CONDITION_RATINGS.find(rating => rating.value === value || String(rating.value) === value || rating.label === value)
  return rating?.value ?? null
}

export function conditionLabel(value) {
  const rating = CONDITION_RATINGS.find(rating => rating.value === conditionRating(value))
  return rating ? `${rating.value} – ${rating.label}` : value === 'N/A' ? 'N/A (earlier inspection)' : 'Not recorded'
}

export function normalizeRatings(checks, checklist) {
  return Object.fromEntries(checklist.map(({ key }) => [key, conditionRating(checks?.[key])]))
}

export function normalizeConditions(checks, checklist) {
  return Object.fromEntries(checklist.map(({ key }) => {
    const value = checks?.[key], rating = CONDITION_RATINGS.find(rating => rating.value === conditionRating(value))
    return [key, rating?.label || value]
  }))
}

export function conditionProblem(checks, checklist, outcome) {
  checks = normalizeConditions(checks, checklist)
  if (!checklist.every(({ key }) => CONDITION_STATUSES.includes(checks?.[key]))) return 'Select a condition status for every mandatory inspection checkpoint.'
  if (outcome === 'approved' && ['tyres', 'controls'].some(key => checks[key] === 'N/A')) return 'Tires and safety controls must be assessed before approving the vehicle.'
  if (outcome === 'approved' && Object.values(checks).some(value => ['Damaged', 'Needs Repair'].includes(value))) return 'Repair damaged checkpoints before approving the vehicle, or mark the inspection unsafe.'
  return ''
}

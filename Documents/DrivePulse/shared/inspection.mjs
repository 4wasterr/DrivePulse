export const CONDITION_STATUSES = ['Good', 'Fair', 'Damaged', 'Needs Repair', 'N/A']

export function normalizeConditions(checks, checklist) {
  return Object.fromEntries(checklist.map(({ key }) => [key, checks?.[key] === true ? 'Good' : checks?.[key]]))
}

export function conditionProblem(checks, checklist, outcome) {
  if (!checklist.every(({ key }) => CONDITION_STATUSES.includes(checks?.[key]))) return 'Select a condition status for every mandatory inspection checkpoint.'
  if (outcome === 'approved' && ['tyres', 'controls'].some(key => checks[key] === 'N/A')) return 'Tires and safety controls must be assessed before approving the vehicle.'
  if (outcome === 'approved' && Object.values(checks).some(value => ['Damaged', 'Needs Repair'].includes(value))) return 'Repair damaged checkpoints before approving the vehicle, or mark the inspection unsafe.'
  return ''
}

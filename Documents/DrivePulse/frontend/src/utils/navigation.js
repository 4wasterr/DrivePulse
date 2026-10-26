import { isPublicPage, workspaceHome } from './roles.js'

const clientPages = ['overview', 'fleet', 'bookings', 'documents', 'payments']
const authPage = page => /^(?:(?:agent|mechanic|manager)-)?(?:login|signup)$|^(?:forgot-password|reset-password|verify-email)$/.test(page)

// Email links carry a token after the route, e.g. #verify-email?token=…
export const routeFromHash = (hash = window.location.hash) => hash.replace(/^#/, '').split('?')[0] || 'home'
export const hashParam = (name, hash = window.location.hash) => new URLSearchParams(hash.split('?')[1] || '').get(name) || ''

// Each hash entry keeps its own trail, so browser Back/Forward restores it too.
export function readNavigationTrail(page, state, previous = []) {
  const saved = state?.drivepulseNavigation
  if (Array.isArray(saved) && saved.length && saved.every(item => typeof item === 'string') && saved.at(-1) === page) return saved
  return previous.at(-1) === page ? previous : [...previous, page]
}

export function getBackNavigation(trail, page, role) {
  for (let index = trail.length - 2; index >= 0; index--) {
    const target = trail[index]
    const inWorkspace = role === 'client' ? clientPages.includes(target) : role && target.startsWith(`${role}-`) && !authPage(target)
    if (target !== page && (isPublicPage(target) || inWorkspace || !role && authPage(target))) {
      return { page: target, delta: index - (trail.length - 1) }
    }
  }
  const home = role ? workspaceHome(role) : 'home'
  return { page: isPublicPage(page) || authPage(page) || page === home ? 'home' : home, delta: 0 }
}

// Requests belong to the session that started them. A late response from a
// previous session must never expire a fresh sign-in or recreate a login alert.
export function createSessionState() {
  let revision = 0, userId = null, authenticating = false
  return {
    get revision() { return revision },
    get userId() { return userId },
    get authenticating() { return authenticating },
    isCurrent(value) { return value === revision },
    restore(id) {
      if (!authenticating && userId !== id) { userId = id; revision++ }
    },
    beginAuthentication() { revision++; userId = null; authenticating = true },
    authenticated(id) { revision++; userId = id; authenticating = false },
    finishAuthentication() { authenticating = false },
    expire(expectedRevision = revision) {
      if (!userId || authenticating || expectedRevision !== revision) return false
      revision++; userId = null
      return true
    },
    clear() { revision++; userId = null; authenticating = false },
  }
}

export const sessionState = createSessionState()

export function reportSessionExpired(revision) {
  if (typeof window === 'undefined' || !sessionState.userId || sessionState.authenticating || !sessionState.isCurrent(revision)) return
  window.dispatchEvent(new CustomEvent('drivepulse:session-expired', { detail: { revision } }))
}

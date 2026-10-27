export const INACTIVITY_MS = 15 * 60 * 1000
export const EXPIRATION_MESSAGE = 'Your session expired after 15 minutes of inactivity. Please sign in again.'

// Activity is shared across tabs, but background polling never renews the session.
export function watchInactivity({ userId, lastActivity, onExpire, onActivity, target = window, storage = localStorage, now = Date.now }) {
  const key = `drivepulse:activity:${userId}`
  let last = Math.max(Number(lastActivity) || 0, Number(storage.getItem(key)) || 0)
  let timer, activityTimer, expired = false, lastSync = 0
  function check() {
    if (expired) return false
    const remaining = INACTIVITY_MS - (now() - last)
    if (remaining <= 0) {
      expired = true
      storage.removeItem(key)
      storage.setItem(`drivepulse:logout:${userId}`, String(now()))
      onExpire()
      return false
    }
    clearTimeout(timer)
    timer = setTimeout(check, remaining)
    return true
  }
  function activity(event) {
    if (event.isTrusted === false || !check()) return
    last = now()
    storage.setItem(key, String(last))
    check()
    // Batch bursts of typing; a final update records the last interaction.
    clearTimeout(activityTimer)
    const syncActivity = () => { if (!expired) { lastSync = now(); onActivity(last) } }
    if (last - lastSync >= 30000) syncActivity()
    else activityTimer = setTimeout(syncActivity, 500)
  }
  function sync(event) {
    if (event.key === `drivepulse:logout:${userId}` && event.newValue) { expired = true; onExpire(); return }
    if (event.key === key && event.newValue) { last = Math.max(last, Number(event.newValue) || 0); check() }
  }
  const events = ['click', 'keydown', 'hashchange', 'popstate']
  events.forEach(name => target.addEventListener(name, activity, true))
  target.addEventListener('storage', sync)
  target.addEventListener('focus', check)
  target.document?.addEventListener('visibilitychange', check)
  check()
  return () => {
    clearTimeout(timer); clearTimeout(activityTimer)
    events.forEach(name => target.removeEventListener(name, activity, true))
    target.removeEventListener('storage', sync); target.removeEventListener('focus', check)
    target.document?.removeEventListener('visibilitychange', check)
  }
}

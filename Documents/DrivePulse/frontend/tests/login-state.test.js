import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { createElement, act, useCallback, useState } from 'react'

// Exercise real React forms and app effects in a DOM, without a browser or a
// production account. Every API response is controlled by the regression test.
let dom, vite, createRoot, App, AuthPage, InspectionForm, registerConfirmationHandler, sessionState, root, container
const savedGlobals = new Map()
const user = { id: 'client-one', name: 'Test Client', email: 'client@example.com', role: 'client' }
const snapshot = (account = null) => ({
  session: { user: account, lastActivity: Date.now(), rates: {}, demo: true, emailDelivery: false },
  workspace: account ? { user: account, bookings: [], documents: {}, tickets: [] } : null,
  availability: [], vehicles: [], notifications: [],
  operations: account && account.role !== 'client' ? { fleet: [], bookings: [], inspections: [], maintenance: [], approvals: [], risks: [], flags: [], thresholdAlerts: [], renewalNotices: [], stages: [], summary: { utilization: 0, overdueCount: 0, criticalRepairs: 0, pendingExceptions: 0, autoReleasedCount: 0 }, refundThreshold: 5000 } : null,
})
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
async function flush() { await act(async () => { await tick(); await tick() }) }
async function render(Component, props) { await act(async () => { root.render(createElement(Component, props)); await tick() }); await flush() }
function text() { return container.textContent }

before(async () => {
  dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { url: 'http://localhost/#login', pretendToBeVisual: true })
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'FormData', 'Event', 'CustomEvent', 'SubmitEvent', 'localStorage', 'sessionStorage', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    savedGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    const value = ['requestAnimationFrame', 'cancelAnimationFrame'].includes(key) ? dom.window[key].bind(dom.window) : dom.window[key]
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  dom.window.scrollTo = () => {}
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
  ;({ createRoot } = await import('react-dom/client'))
  vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' })
  App = (await vite.ssrLoadModule('/src/App.jsx')).default
  AuthPage = (await vite.ssrLoadModule('/src/pages/Authentication/AuthPage.jsx')).default
  InspectionForm = (await vite.ssrLoadModule('/src/pages/Fleet Mechanic/components/InspectionForm.jsx')).default
  ;({ registerConfirmationHandler } = await vite.ssrLoadModule('/src/utils/confirmations.js'))
  ;({ sessionState } = await vite.ssrLoadModule('/src/utils/session.js'))
  const style = dom.window.document.createElement('style')
  style.textContent = await readFile(new URL('../src/styles/workflow-fixes.css', import.meta.url), 'utf8')
  dom.window.document.head.append(style)
})

beforeEach(() => {
  sessionState.clear()
  dom.window.localStorage.clear(); dom.window.sessionStorage.clear()
  dom.window.history.replaceState({}, '', '/#login')
  container = dom.window.document.getElementById('root')
  root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); sessionState.clear() })
after(async () => {
  await vite?.close(); dom?.window.close()
  for (const [key, descriptor] of savedGlobals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] }
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

test('login mount and reload clear persisted timeout notices, including an expired cookie', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async path => {
    calls.push(path)
    return Response.json({ ...snapshot(), session: { ...snapshot().session, sessionExpired: true } })
  })
  dom.window.sessionStorage.setItem('drivepulse:session-expired', 'Your session expired after 15 minutes of inactivity. Please sign in again.')
  await render(App)
  assert.match(text(), /Sign in to DrivePulse/)
  assert.doesNotMatch(text(), /session expired|temporarily unavailable/i)
  assert.equal(dom.window.sessionStorage.getItem('drivepulse:session-expired'), null)
  assert.equal(calls.filter(path => path === '/api/logout').length, 0)
  await act(async () => { dom.window.dispatchEvent(new dom.window.Event('drivepulse:session-expired')); dom.window.dispatchEvent(new dom.window.Event('focus')); await tick() })
  assert.doesNotMatch(text(), /session expired/i, 'anonymous background refresh cannot restore the banner')
  await act(async () => root.unmount())
  root = createRoot(container)
  await render(App)
  assert.doesNotMatch(text(), /session expired/i)
})

test('an already-mounted login page ignores duplicate expiry events and remains usable', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json(snapshot()))
  await render(App)
  await act(async () => {
    for (let index = 0; index < 3; index++) dom.window.dispatchEvent(new dom.window.CustomEvent('drivepulse:session-expired', { detail: { revision: sessionState.revision } }))
    await tick()
  })
  assert.doesNotMatch(text(), /session expired/i)
  assert.equal(container.querySelector('[name=username]').disabled, false)
})

test('AuthPage remount dismisses a timeout notice without requiring a click or typing', async () => {
  function LoginHarness() {
    const [notice, setNotice] = useState('Your session expired after 15 minutes of inactivity. Please sign in again.')
    const dismiss = useCallback(() => setNotice(''), [])
    return createElement(AuthPage, { mode: 'login', sessionNotice: notice, onDismissNotice: dismiss })
  }
  await render(LoginHarness)
  assert.match(text(), /Sign in to DrivePulse/)
  assert.doesNotMatch(text(), /session expired/i)
})

test('a fresh login waits for timeout logout and old expiry responses cannot sign it out again', async t => {
  let account = user, releaseLogout, loginCalls = 0, logoutCalls = 0
  t.mock.method(globalThis, 'fetch', async path => {
    if (path === '/api/logout') {
      logoutCalls++
      return new Promise(resolve => { releaseLogout = () => { account = null; resolve(Response.json({ ok: true })) } })
    }
    if (path === '/api/auth/login') { loginCalls++; account = user; return Response.json({ user }) }
    if (path === '/api/locations') return Response.json([])
    return Response.json(snapshot(account))
  })
  dom.window.history.replaceState({}, '', '/#documents')
  await render(App)
  assert.ok(container.querySelector('.sidebar-logout'))
  const oldRevision = sessionState.revision
  await act(async () => { dom.window.dispatchEvent(new dom.window.CustomEvent('drivepulse:session-expired', { detail: { revision: oldRevision } })); await tick() })
  await flush()
  assert.match(text(), /Sign in to DrivePulse/)
  assert.doesNotMatch(text(), /session expired/i)
  assert.equal(logoutCalls, 1)
  container.querySelector('[name=username]').value = 'demo'
  container.querySelector('[name=password]').value = 'demo'
  await act(async () => {
    const submitter = container.querySelector('button[type=submit]')
    container.querySelector('form').dispatchEvent(new dom.window.SubmitEvent('submit', { bubbles: true, cancelable: true, submitter }))
    await tick()
  })
  assert.equal(loginCalls, 0, 'the expired-session cookie must finish clearing before sign-in')
  await act(async () => { releaseLogout(); await tick(); await tick() })
  await flush()
  assert.equal(loginCalls, 1)
  assert.equal(sessionState.userId, user.id)
  assert.ok(container.querySelector('.sidebar-logout'))
  await act(async () => { dom.window.dispatchEvent(new dom.window.CustomEvent('drivepulse:session-expired', { detail: { revision: oldRevision } })); await tick() })
  assert.equal(sessionState.userId, user.id)
  assert.equal(logoutCalls, 1)
  assert.doesNotMatch(text(), /session expired/i)
})

test('all roles and modules mount the same anchored sidebar logout area', async t => {
  let account
  t.mock.method(globalThis, 'fetch', async path => path === '/api/locations' ? Response.json([]) : Response.json(snapshot(account)))
  const cases = [
    ['client', '#overview'], ['client', '#bookings'],
    ['agent', '#agent-overview'], ['agent', '#agent-reservations'],
    ['mechanic', '#mechanic-overview'], ['mechanic', '#mechanic-inspections'],
    ['manager', '#manager-overview'], ['manager', '#manager-fleet'],
  ]
  const geometry = []
  for (const [role, route] of cases) {
    await act(async () => root.unmount())
    sessionState.clear()
    account = { ...user, id: role, role, name: role === 'manager' ? 'Operations Manager and Admin With A Long Name' : `Test ${role}` }
    dom.window.history.replaceState({}, '', `/${route}`)
    root = createRoot(container)
    await render(App)
    const sidebar = container.querySelector('.workspace-sidebar')
    assert.ok(sidebar, `${role} ${route} must use the shared sidebar`)
    const footer = sidebar.querySelector(':scope > .sidebar-account-footer')
    const logout = footer.querySelector('.sidebar-logout')
    assert.equal(logout.textContent, 'Log Out')
    assert.equal(footer.lastElementChild, logout)
    const parentStyle = dom.window.getComputedStyle(sidebar), footerStyle = dom.window.getComputedStyle(footer), buttonStyle = dom.window.getComputedStyle(logout)
    assert.equal(parentStyle.position, 'fixed')
    assert.equal(footerStyle.position, 'absolute')
    assert.equal(buttonStyle.height, '44px')
    geometry.push([parentStyle.width, footerStyle.inset, footerStyle.paddingBottom, buttonStyle.height, buttonStyle.margin])
  }
  assert.ok(geometry.every(item => JSON.stringify(item) === JSON.stringify(geometry[0])), 'all roles share the same sidebar width, bottom anchor and logout height')
})

const inspectionVehicle = { id: 'mercedes-c', name: 'Mercedes-Benz C-Class', fleetCode: 'CAR-00002', plate: 'NDP 1002', version: 1, odometer: 1500 }
async function changeField(name, value) {
  await act(async () => {
    const field = container.querySelector(`[name="${name}"]`)
    assert.ok(field, `field ${name} must exist`)
    if (field.tagName === 'SELECT') { field.value = value; field.dispatchEvent(new dom.window.Event('change', { bubbles: true })) }
    else {
      const prototype = field.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, value)
      field.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    }
    await tick()
  })
}
async function submitInspectionStep() {
  await act(async () => {
    const form = container.querySelector('form'), submitter = form.querySelector('button[type=submit]')
    form.dispatchEvent(new dom.window.SubmitEvent('submit', { bubbles: true, cancelable: true, submitter }))
    await tick()
  })
  await flush()
}

test('an empty post-return inspection has no required reservation selector and can open safety clearance', async () => {
  await render(InspectionForm, { operations: { fleet: [inspectionVehicle], bookings: [] }, initial: { type: 'post-return', vehicleId: inspectionVehicle.id }, onClose() {}, onDone() {} })
  assert.equal(container.querySelector('[name=reservationId]'), null)
  assert.doesNotMatch(text(), /Select a reservation|Reservation is required|Driver: See reservation/)
  assert.match(text(), /No returned trip is awaiting inspection/)
  assert.equal(container.querySelector('[name=driverVerification]'), null, 'do not require a driver for a trip that does not exist')
  assert.equal(container.querySelector('form'), null)
  const clearance = [...container.querySelectorAll('button')].find(button => button.textContent.includes('Start safety / maintenance clearance'))
  await act(async () => clearance.click())
  assert.equal(container.querySelector('[name=type]').value, 'clearance')
  assert.match(text(), /Technician verification/)
  assert.ok(container.querySelector('button[type=submit]'))
})

test('post-return inspection saves the automatically linked trip and mileage without a reservation dropdown', async t => {
  const trip = { id: 'DP-AUTO-RETURN', vehicleId: inspectionVehicle.id, status: 'Completed', returnedAt: '2026-10-27T04:00:00Z', start: '2026-10-25', end: '2026-10-27', driverName: 'Test Driver', version: 3, dispatchOdometer: 1500 }
  const earlier = { ...trip, id: 'DP-ALREADY-REVIEWED', returnedAt: '2026-10-26T04:00:00Z', returnInspection: { status: 'approved' } }
  const saved = [], notices = []
  let upload = 0
  t.after(registerConfirmationHandler(async () => true))
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    if (path.startsWith('/api/documents/condition')) return Response.json({ id: `photo-${++upload}`, name: `condition-${upload}.png` })
    assert.equal(path, '/api/mechanic/inspections')
    saved.push(JSON.parse(options.body))
    return Response.json({ id: 'inspection', cleanReturn: true })
  })
  await render(InspectionForm, { operations: { fleet: [inspectionVehicle], bookings: [earlier, trip] }, initial: { vehicleId: inspectionVehicle.id }, mechanic: { name: 'Test Mechanic' }, onClose() {}, onDone(message) { notices.push(message) } })
  assert.equal(container.querySelector('[name=type]').value, 'post-return')
  assert.equal(container.querySelector('[name=reservationId]'), null)
  assert.match(text(), /Trip: DP-AUTO-RETURN/)
  assert.doesNotMatch(text(), /DP-ALREADY-REVIEWED/)
  for (const [name, value] of Object.entries({ driverVerification: 'matched', odometer: '2500', fuelLevel: '100', frontLeft: '32', frontRight: '32', rearLeft: '32', rearRight: '32' })) await changeField(name, value)
  assert.match(text(), /1,000 km used/)
  await submitInspectionStep()
  for (const name of ['tyres', 'controls', 'exterior', 'interior', 'fuel']) await changeField(name, '1')
  await changeField('cleanliness', 'Clean')
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent.includes('Back to vehicle details')).click())
  assert.equal(container.querySelector('[name=odometer]').value, '2500')
  await submitInspectionStep()
  assert.equal(container.querySelector('[name=tyres]').value, '1')
  await submitInspectionStep()
  await changeField('damageStatus', 'no')
  await changeField('scratches', 'No visible damage.')
  for (const view of ['exterior', 'interior']) {
    await act(async () => {
      const field = container.querySelector(`[name=${view}Photo]`)
      Object.defineProperty(field, 'files', { configurable: true, value: [new File(['test condition photo'], `${view}.png`, { type: 'image/png' })] })
      field.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
      await tick()
    })
  }
  await submitInspectionStep()
  await changeField('outcome', 'approved')
  await submitInspectionStep()
  assert.equal(saved.length, 1)
  assert.equal(saved[0].bookingId, trip.id)
  assert.equal(saved[0].version, trip.version)
  assert.equal(saved[0].type, 'post-return')
  assert.equal(saved[0].odometer, 2500)
  assert.deepEqual(saved[0].conditionRatings, { tyres: 1, controls: 1, exterior: 1, interior: 1, fuel: 1 })
  assert.match(notices[0], /mileage saved/)
})

test('changing vehicles automatically switches trip context instead of retaining another vehicle’s booking', async () => {
  const otherVehicle = { ...inspectionVehicle, id: 'toyota-camry', name: 'Toyota Camry', odometer: 5500 }
  const original = { id: 'DP-FIRST', vehicleId: inspectionVehicle.id, status: 'Completed', returnedAt: '2026-10-27T04:00:00Z', dispatchOdometer: 1500 }
  const other = { ...original, id: 'DP-OTHER', vehicleId: otherVehicle.id, dispatchOdometer: 5500 }
  await render(InspectionForm, { operations: { fleet: [inspectionVehicle, otherVehicle], bookings: [original, other] }, initial: { type: 'post-return', booking: original }, onClose() {}, onDone() {} })
  assert.match(text(), /Trip: DP-FIRST/)
  await changeField('vehicleId', otherVehicle.id)
  assert.match(text(), /Trip: DP-OTHER/)
  assert.match(text(), /5,500/)
  assert.doesNotMatch(text(), /DP-FIRST/)
  assert.equal(container.querySelector('[name=reservationId]'), null)
})

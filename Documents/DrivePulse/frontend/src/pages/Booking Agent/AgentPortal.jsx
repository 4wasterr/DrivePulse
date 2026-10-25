import { useState } from 'react'
import { vehicleFor } from '../../utils/vehicles.js'
import BrandMark from '../../components/ui/BrandMark.jsx'
import Icon from '../../components/ui/Icon.jsx'
import NotificationCenter from '../../components/ui/NotificationCenter.jsx'
import AgentOverviewPage from './OverviewPage.jsx'
import AgentReservationsPage from './ReservationsPage.jsx'
import AvailabilityCalendar from './AvailabilityCalendarPage.jsx'
import FinancialRequest from '../../components/operations/FinancialRequest.jsx'
import WalkInReservation from './components/WalkInReservation.jsx'
import AgentBookingDetails from './components/AgentBookingDetails.jsx'
import { api } from '../../api.js'
import ReservationConfirmation from '../../components/operations/ReservationConfirmation.jsx'
import BackButton from '../../components/ui/BackButton.jsx'

const navigation = [
  ['agent-overview', 'grid', 'Overview'],
  ['agent-reservations', 'calendar', 'Reservations & intake'],
  ['agent-calendar', 'car', 'Availability calendar'],
]

const headings = {
  'agent-overview': ['A smooth day starts here.', 'Your reservations, ID verifications, payments, and departures at a glance.'],
  'agent-reservations': ['Unified reservation & intake handling.', 'Manage walk-in and online bookings, verify IDs, record cash/deposits, issue dispatch passes, and archive closed records.'],
  'agent-calendar': ['A clear view of the road ahead.', 'Explore the fleet schedule and vehicle operational readiness. Select an open day to schedule a walk-in.'],
}

export default function AgentPortal({ page, user, workspace, availability, onRefresh, onNavigate, onLogout, onBack }) {
  const [menuOpen, setMenuOpen] = useState(false), [dialog, setDialog] = useState(null), [notice, setNotice] = useState(''), [error, setError] = useState('')
  const [query, setQuery] = useState(''), [status, setStatus] = useState('All statuses'), [channel, setChannel] = useState('All channels')
  const bookings = workspace.bookings
  const activePage = ['agent-verification', 'agent-billing', 'agent-dispatch'].includes(page) ? 'agent-reservations' : (navigation.some(([id]) => id === page) ? page : 'agent-overview')
  const title = headings[activePage] || headings['agent-overview']
  const pending = bookings.filter(b => b.status === 'Pending Approval')
  const active = bookings.filter(b => !['Cancelled', 'Completed'].includes(b.status))
  const reviews = active.filter(b => b.verificationStatus !== 'Verified')
  const paymentQueue = bookings.filter(b => b.status !== 'Cancelled' && b.payments.some(p => p.status === 'pending'))
  const ready = active.filter(b => b.status === 'Ready for Dispatch')
  const selected = dialog?.kind === 'booking' ? bookings.find(b => b.id === dialog.id) : null

  function go(to) {
    setMenuOpen(false)
    if (to === 'agent-verification') { setStatus('Needs ID review'); onNavigate('agent-reservations'); return }
    if (to === 'agent-billing') { setStatus('Payment review'); onNavigate('agent-reservations'); return }
    if (to === 'agent-dispatch') { setStatus('Ready for Dispatch'); onNavigate('agent-reservations'); return }
    onNavigate(to)
  }
  function open(id, tab = 'reservation') { setDialog({ kind: 'booking', id, tab }) }
  function done(message) { setNotice(message); setError('') }
  async function archiveBooking(bookingId) {
    try {
      await api(`/bookings/${bookingId}/archive`, { method: 'POST', body: { reason: 'One-click front-desk record cleanup' } })
      await onRefresh()
      if (selected?.id === bookingId) setDialog(null)
      done(`Reservation ${bookingId} soft-deleted and moved to Data Archives.`)
    } catch (problem) { setError(problem.message) }
  }

  const searched = list => list.filter(b => `${b.id} ${b.renter.name} ${b.renter.email} ${vehicleFor(b).name} ${vehicleFor(b).fleetCode || ''} ${b.vehicleId}`.toLowerCase().includes(query.toLowerCase()))
  const reservationList = searched(bookings).filter(b => {
    const channelMatch = channel === 'All channels' || b.source === channel
    if (!channelMatch) return false
    if (status === 'All statuses') return true
    if (status === 'Needs ID review') return !['Cancelled', 'Completed'].includes(b.status) && b.verificationStatus !== 'Verified'
    if (status === 'Payment review') return b.status !== 'Cancelled' && (b.billing.balance > 0 || b.payments.some(p => p.status === 'pending'))
    return b.status === status
  })

  async function signout() { try { await onLogout() } catch (problem) { setError(problem.message) } }
  const actions = <div className="staff-card-actions"><button className="button button-outline" onClick={() => setDialog({ kind: 'financial-request' })}>Security Deposit exception</button><button className="button button-dark" onClick={() => setDialog({ kind: 'walkin' })}><span aria-hidden="true">＋</span>New walk-in</button></div>

  return <div className="agent-shell">
    {menuOpen && <button className="agent-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <aside className={`agent-sidebar ${menuOpen ? 'is-open' : ''}`}>
      <a className="agent-brand" href="#home"><BrandMark /><span>drivepulse.</span></a>
      <div className="agent-workspace-label"><span>STAFF WORKSPACE</span><strong>Booking Agent / Front Desk</strong></div>
      <nav aria-label="Front-desk navigation">
        {navigation.map(([id, icon, label]) => <a href={`#${id}`} key={id} className={id === activePage ? 'active' : ''} aria-current={id === activePage ? 'page' : undefined} onClick={() => setMenuOpen(false)}>
          <Icon name={icon} size={20} /><span>{label}</span>
          {id === 'agent-reservations' && pending.length > 0 && <small>{pending.length}</small>}
        </a>)}
      </nav>
      <div className="agent-sidebar-bottom">
        <div className="agent-sidebar-note"><Icon name="road" size={28} /><strong>A great journey starts<br />with the details.</strong><span>One desk. Every step.</span></div>
        <button className="agent-signout" onClick={signout}><Icon name="logout" size={18} />Log Out</button>
        <div className="agent-user"><span className="avatar">{user.name.split(' ').map(n => n[0]).slice(0, 2).join('')}</span><div><strong>{user.name}</strong><span>Booking agent</span></div></div>
      </div>
    </aside>
    <main className="agent-main">
      <header className="agent-topbar">
        <div><button className="icon-button agent-mobile-menu" aria-label="Open navigation" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button><span>Staff workspace</span><Icon name="chevron" size={13} /><strong>{navigation.find(([id]) => id === activePage)?.[2] || 'Overview'}</strong></div>
        <div><NotificationCenter /><span className="agent-development-tag">DEVELOPMENT</span><span className="agent-topbar-date"><Icon name="calendar" size={17} />{new Date().toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' })}</span></div>
      </header>
      <div className="agent-page" key={activePage}>
        <BackButton onBack={onBack} />
        <section className="agent-page-heading"><div><p className="workspace-kicker">{activePage === 'agent-overview' ? `WELCOME BACK, ${user.name.split(' ')[0].toUpperCase()}` : 'YOUR FRONT DESK, CONNECTED'}</p><h1>{title[0]}</h1><p>{title[1]}</p></div>{actions}</section>
        {notice && <div className="workspace-notice" role="status"><Icon name="check" size={18} /><span>{notice}</span><button className="icon-button" aria-label="Dismiss update" onClick={() => setNotice('')}><Icon name="close" size={16} /></button></div>}
        {error && <p className="error-banner" role="alert">{error}</p>}
        {activePage === 'agent-overview' && <AgentOverviewPage pending={pending} reviews={reviews} paymentQueue={paymentQueue} ready={ready} go={go} open={open} active={active} />}
        {activePage === 'agent-reservations' && <AgentReservationsPage query={query} setQuery={setQuery} status={status} setStatus={setStatus} channel={channel} setChannel={setChannel} reservationList={reservationList} open={open} onArchive={archiveBooking} />}
        {activePage === 'agent-calendar' && <AvailabilityCalendar bookings={bookings} availability={availability} onOpen={open} onCreate={values => setDialog({ kind: 'walkin', values })} />}
        <footer className="agent-footer"><span>One desk. Every journey. <strong>drivepulse.</strong></span><span>Booking Agent / Front Desk · All times in PHT</span></footer>
      </div>
    </main>
    {dialog?.kind === 'financial-request' && <FinancialRequest bookings={bookings} onClose={() => setDialog(null)} onDone={async message => { await onRefresh(); setDialog(null); done(message) }} />}
    {dialog?.kind === 'walkin' && <WalkInReservation availability={availability} values={dialog.values} onClose={() => setDialog(null)} onCreated={async booking => { await onRefresh(); setDialog({ kind: 'confirmation', booking }); done('Reservation created with confirmation and rental terms.') }} />}
    {dialog?.kind === 'confirmation' && <ReservationConfirmation booking={dialog.booking} onClose={() => setDialog(null)} onContinue={() => open(dialog.booking.id)} continueLabel="Continue to reservation" />}
    {selected && <AgentBookingDetails key={selected.id} booking={selected} initialTab={dialog.tab} onClose={() => setDialog(null)} onRefresh={onRefresh} onNotice={done} onArchive={archiveBooking} />}
  </div>
}

import useDraftState from '../../hooks/useDraftState.js'
import { useState, useRef, useEffect } from 'react'
import { initialDates, requiredDocuments, rentalPeriodError, vehicles as baseVehicles, isAvailable, getAvailabilityReason, canChooseBookingDates, prettyDate, money } from '../../data.js'
import { api, fetchDocument } from '../../api.js'
import { downloadFile } from '../../storage.js'
import VehicleCard from '../../components/fleet/VehicleCard.jsx'
import BrandMark from '../../components/ui/BrandMark.jsx'
import Icon from '../../components/ui/Icon.jsx'
import NotificationCenter from '../../components/ui/NotificationCenter.jsx'
import SidebarFooter from '../../components/ui/SidebarFooter.jsx'
import WorkspaceSidebar from '../../components/ui/WorkspaceSidebar.jsx'
import { vehicleFor } from '../../utils/vehicles.js'
import ClientOverviewPage from './OverviewPage.jsx'
import ClientFleetPage from './FleetPage.jsx'
import ClientBookingsPage from './BookingsPage.jsx'
import ClientDocumentsPage from './DocumentsPage.jsx'
import ClientPaymentsPage from './PaymentsPage.jsx'
import BookingModal from './components/BookingModal.jsx'
import Modal from '../../components/ui/Modal.jsx'
import { BookingRecords } from '../../components/operations/OperationalRecords.jsx'
import TripDetails from './components/TripDetails.jsx'
import ExtensionModal from './components/ExtensionModal.jsx'
import { downloadPass } from '../../dispatchPass.js'

const navigation = [{ id: 'overview', icon: 'grid', label: 'Overview' }, { id: 'fleet', icon: 'car', label: 'Explore the fleet' }, { id: 'bookings', icon: 'calendar', label: 'My bookings' }, { id: 'documents', icon: 'file', label: 'My documents' }, { id: 'payments', icon: 'wallet', label: 'Payments & billing' }]

const titles = { overview: 'A good day for a great drive.', fleet: 'Find your kind of drive.', bookings: 'Your journeys, all in one place.', documents: 'A little prep. A lot of freedom.', payments: 'Every detail, accounted for.' }

const readPage = () => navigation.some(n => n.id === window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'overview'

export default function ClientPortal({ user, workspace, availability, rates = {}, onRefresh, onLogout, onAuthenticate }) {
  const [page, setPage] = useState(readPage)
  const bookings = workspace?.bookings || []
  const documents = workspace?.documents || {}
  const profile = user || { name: 'Client', email: '' }
  const vehicles = baseVehicles.filter(v => !v.archivedAt).map(v => ({ ...v, rate: rates[v.id] || v.rate }))
  const [dates, setDates] = useDraftState('trip-search', 'dates', initialDates)
  const [category, setCategory] = useState('All cars')
  const [brand, setBrand] = useState('all')
  const brands = [...new Set(vehicles.map(v => v.brand).filter(Boolean))].sort()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('recommended')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [seats, setSeats] = useState('any')
  const [transmission, setTransmission] = useState('any')
  const [onlyAvailable, setOnlyAvailable] = useState(false)
  const [modal, setModal] = useState(null)
  const [toast, setToast] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [bookingTab, setBookingTab] = useState('Upcoming')
  const toastTimer = useRef(null)
  const upcoming = bookings.filter(b => !['Completed', 'Cancelled'].includes(b.status)).sort((a, b) => a.start.localeCompare(b.start))
  const nextTrip = upcoming[0]
  const completed = bookings.filter(b => b.status === 'Completed')
  const documentCount = requiredDocuments.filter(d => documents[d.id]).length
  const initials = profile?.name ? profile.name.split(' ').filter(Boolean).map(n => n[0]).slice(0, 2).join('').toUpperCase() : 'DP'

  useEffect(() => {
    const change = () => {
      setPage(readPage()); setMenuOpen(false)
      requestAnimationFrame(() => {
        const section = document.getElementById(window.location.hash.slice(1))
        if (section) section.scrollIntoView({ behavior: 'instant' })
        else window.scrollTo({ top: 0, behavior: 'instant' })
      })
    }
    window.addEventListener('hashchange', change)
    const initialScroll = window.location.hash ? requestAnimationFrame(() => document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ behavior: 'instant' })) : null
    return () => { window.removeEventListener('hashchange', change); clearTimeout(toastTimer.current); if (initialScroll !== null) cancelAnimationFrame(initialScroll) }
  }, [])
  function navigate(to) { window.location.assign(`#${to}`); setPage(to); setMenuOpen(false) }
  function notify(message) { setToast(message); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 4500) }
  async function onDocument() { await onRefresh() }
  function openBooking(vehicle) {
    if (!user) { onAuthenticate('fleet'); return }
    if (user.role !== 'client') { navigate(`${user.role}-${user.role === 'agent' ? 'reservations' : 'overview'}`); return }
    setModal({ type: 'booking', vehicle, previous: modal?.type === 'vehicle' ? modal : null })
  }
  function search() {
    const problem = rentalPeriodError(dates)
    if (problem) { notify(problem); return }
    if (!user) { onAuthenticate('fleet'); return }
    setOnlyAvailable(true); navigate('fleet')
  }
  async function reserve(booking) {
    const result = await api('/bookings', { method: 'POST', body: booking })
    await onRefresh()
    return result
  }
  async function downloadDocument(id) {
    try { const blob = await fetchDocument(id); downloadFile(blob, documents[id]?.name || 'document') }
    catch (error) { notify(error.message) }
  }
  const filtered = vehicles.filter(v => (category === 'All cars' || v.category === category) && (brand === 'all' || v.brand === brand) && `${v.name} ${v.model || ""} ${v.fleetCode || ""} ${v.id} ${v.plate || ""} ${v.category} ${v.fuel}`.toLowerCase().includes(query.toLowerCase()) && (seats === 'any' || v.seats >= Number(seats)) && (transmission === 'any' || v.transmission === transmission) && (!onlyAvailable || isAvailable(v.id, dates, availability))).sort((a, b) => sort === 'price-low' ? a.rate - b.rate : sort === 'price-high' ? b.rate - a.rate : 0)
  const card = vehicle => {
    const reason = getAvailabilityReason(vehicle.id, dates, availability)
    const available = reason === ''
    return <VehicleCard key={vehicle.id} vehicle={vehicle} available={available} canChooseDates={canChooseBookingDates(vehicle.id, availability)} unavailabilityReason={reason} onDetails={() => setModal({ type: 'vehicle', vehicle, available, reason })} onReserve={() => openBooking(vehicle)} />
  }

  return <div className="app-shell">
    <WorkspaceSidebar className="sidebar" open={menuOpen} onClose={() => setMenuOpen(false)}>
      <a className="brand" href="#home" onClick={() => navigate('home')} aria-label="DrivePulse home"><span className="brand-mark"><BrandMark /></span><span>drivepulse<span className="brand-period">.</span></span></a>
      <div className="workspace-label">YOUR OPEN ROAD</div>
      <nav className="primary-nav" aria-label="Main navigation">{navigation.map(item => <a key={item.id} href={`#${item.id}`} onClick={() => navigate(item.id)} className={page === item.id ? 'active' : ''} aria-current={page === item.id ? 'page' : undefined}><Icon name={item.icon} size={19} /><span>{item.label}</span>{item.id === 'bookings' && upcoming.length > 0 && <span className="nav-count">{upcoming.length}</span>}</a>)}</nav>
      <SidebarFooter user={profile} role="Client account" onLogout={() => onLogout().catch(error => notify(error.message))} onProfile={() => setModal({ type: 'profile' })} />
    </WorkspaceSidebar>

    <main className="main-content">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button><span>Client portal</span><Icon name="chevron" size={12} /><strong>{navigation.find(n => n.id === page)?.label}</strong></div><div className="topbar-actions"><span className="topbar-location"><Icon name="pin" size={15} />Metro Manila, PH</span><span className="topbar-separator" /><button className="icon-button" aria-label="Search vehicles" onClick={() => { navigate('fleet'); setTimeout(() => document.getElementById('fleet-search')?.focus(), 50) }}><Icon name="search" size={19} /></button><NotificationCenter /><button className="avatar topbar-avatar" onClick={() => user ? setModal({ type: 'profile' }) : onAuthenticate('overview')} aria-label="View profile">{initials}</button></div></header>

      <div className="page-content" key={page}>
        <section className="page-heading"><div><p className="greeting"><Icon name="sun" size={15} />{page === 'overview' ? `Good to see you, ${profile.name.split(' ')[0]}.` : 'A little freedom goes a long way.'}</p><h1>{titles[page]}</h1></div><span className="today-date"><Icon name="calendar" size={16} />{new Date().toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' })}</span></section>

        {page === 'overview' && <ClientOverviewPage navigate={navigate} setModal={setModal} dates={dates} setDates={setDates} search={search} card={card} upcoming={upcoming} nextTrip={nextTrip} documentCount={documentCount} />}

        {page === 'fleet' && <ClientFleetPage brand={brand} setBrand={setBrand} brands={brands} dates={dates} setDates={setDates} category={category} setCategory={setCategory} query={query} setQuery={setQuery} filtersOpen={filtersOpen} setFiltersOpen={setFiltersOpen} seats={seats} setSeats={setSeats} transmission={transmission} setTransmission={setTransmission} onlyAvailable={onlyAvailable} setOnlyAvailable={setOnlyAvailable} filtered={filtered} sort={sort} setSort={setSort} card={card} navigate={navigate} />}

        {page === 'bookings' && <ClientBookingsPage bookingTab={bookingTab} setBookingTab={setBookingTab} upcoming={upcoming} completed={completed} bookings={bookings} navigate={navigate} setModal={setModal} />}

        {page === 'documents' && <ClientDocumentsPage documentCount={documentCount} documents={documents} onDocument={onDocument} downloadDocument={downloadDocument} bookings={bookings} />}

        {page === 'payments' && <ClientPaymentsPage bookings={bookings} upcoming={upcoming} downloadDocument={downloadDocument} />}
        <footer className="page-footer"><span>Go places. Make memories. <strong>drivepulse.</strong></span><span>Thoughtfully made for your journey.<span className="footer-dot" />Client portal</span></footer>
      </div>
    </main>

    {modal?.type === 'booking' && <BookingModal vehicle={modal.vehicle} initialDates={dates} bookings={availability} documents={documents} onDocument={onDocument} onReserve={reserve} onClose={() => setModal(null)} onBack={modal.previous ? () => setModal(modal.previous) : undefined} onViewTrips={() => { setModal(null); setBookingTab('Upcoming'); navigate('bookings') }} />}
    {modal?.type === 'vehicle' && (() => {
      const reason = getAvailabilityReason(modal.vehicle.id, dates, availability)
      const isCarAvailable = reason === ''
      const canChooseDates = canChooseBookingDates(modal.vehicle.id, availability)
      return <Modal title={modal.vehicle.name} eyebrow={modal.vehicle.label.toUpperCase()} wide onClose={() => setModal(null)}>
        <div className="vehicle-detail-layout">
          <img className="vehicle-detail-image" src={modal.vehicle.image} alt={modal.vehicle.name} />
          <div className="vehicle-detail-copy">
            <h3>{modal.vehicle.tagline}</h3>
            <p className="muted">{modal.vehicle.description}</p>
            <p className="small muted">License plate: <strong>{modal.vehicle.plate}</strong></p>
            {!isCarAvailable && (
              <div className="unavailability-callout" role="alert">
                <Icon name="info" size={18} />
                <div>
                  <strong>Unavailable for selected dates:</strong>
                  <p>{reason}</p>
                </div>
              </div>
            )}
            <div className="detail-spec-grid">
              <span><Icon name="users" />{modal.vehicle.seats} seats</span>
              <span><Icon name="gear" />{modal.vehicle.transmission}</span>
              <span><Icon name="fuel" />{modal.vehicle.fuel}</span>
              <span><Icon name="car" />{modal.vehicle.category}</span>
            </div>
            <div className="detail-inclusions">
              <span><Icon name="check" size={15} />Air conditioning</span>
              <span><Icon name="check" size={15} />Bluetooth audio</span>
              <span><Icon name="check" size={15} />{modal.vehicle.luggage} bags</span>
            </div>
            <div className="detail-price">
              <span className="vehicle-price">{money(modal.vehicle.rate)}<small> / day</small></span>
              <span className="small muted">+ {money(5000)} Security Deposit</span>
            </div>
            <button
              className="button button-dark full-width"
              disabled={Boolean(user) && !isCarAvailable && !canChooseDates}
              onClick={() => user ? openBooking(modal.vehicle) : onAuthenticate('fleet')}
            >
              {user ? (isCarAvailable ? 'Make this ride yours' : canChooseDates ? 'Choose other dates' : `Unavailable: ${reason}`) : 'Sign in to reserve this ride'}
              <Icon name="arrow" size={18} />
            </button>
            <p className="small muted">Selected dates: {prettyDate(dates.start)} – {prettyDate(dates.end)}</p>
          </div>
        </div>
      </Modal>
    })()}
    {modal?.type === 'trip' && (() => {
      const activeBooking = bookings.find(b => b.id === modal.booking.id) || modal.booking
      const canExtend = ['On Rental', 'Ready for Dispatch'].includes(activeBooking.status) && !(activeBooking.extensionRequests || []).some(r => r.status === 'pending')
      return (
        <Modal title="Every step of your journey." eyebrow={activeBooking.id} wide onClose={() => setModal(null)}>
          <BookingRecords booking={activeBooking} />
          <TripDetails booking={activeBooking} />
          {(activeBooking.extensionRequests || []).map(request => <p className="info-note" key={request.id}>Extension to {prettyDate(request.newEnd)} at {request.newEndTime}: {request.status === 'pending' ? 'Pending verification / approval. Your current return schedule remains in effect.' : `${request.status} by ${request.reviewedBy}. ${request.reason || ''}`}</p>)}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '14px' }}>
            {activeBooking.dispatchPass && !activeBooking.dispatchPass.revokedAt && (
              <button className="button button-dark full-width" onClick={() => downloadPass(activeBooking)}>
                <Icon name="download" />Download dispatch pass
              </button>
            )}
            {canExtend && (
              <button
                className="button button-outline full-width"
                onClick={() => setModal({ type: 'extend', booking: activeBooking })}
              >
                <Icon name="calendar" />Extend rental duration
              </button>
            )}
          </div>
        </Modal>
      )
    })()}
    {modal?.type === 'extend' && (
      <ExtensionModal
        booking={modal.booking}
        vehicle={vehicleFor(modal.booking)}
        onBack={() => setModal({ type: 'trip', booking: modal.booking })}
        onClose={() => setModal(null)}
        onSuccess={async () => {
          await onRefresh()
          setModal(null)
          notify('Extension request submitted for Operations Manager or Booking Agent approval. Your current return schedule remains in effect.')
        }}
      />
    )}
    {modal?.type === 'profile' && <Modal title="Your profile" eyebrow="CLIENT ACCOUNT" onClose={() => setModal(null)}><div className="profile-intro"><span className="avatar large-avatar">{initials}</span><p>Contact an Admin to update your profile.</p></div><label className="form-field">Full name<input readOnly value={profile.name} /></label><label className="form-field">Email address<input readOnly value={profile.email} /></label></Modal>}
    {toast && <div className="toast" role="status"><span><Icon name="check" size={17} /></span>{toast}<button aria-label="Dismiss notification" onClick={() => setToast('')}><Icon name="close" size={15} /></button></div>}
  </div>
}

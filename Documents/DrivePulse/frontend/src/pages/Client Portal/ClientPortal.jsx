import { useState, useRef, useEffect } from 'react'
import { initialDates, requiredDocuments, rentalPeriodError, vehicles as baseVehicles, isAvailable, getAvailabilityReason, prettyDate, money } from '../../data.js'
import { api, fetchDocument } from '../../api.js'
import { downloadFile } from '../../storage.js'
import VehicleCard from '../../components/fleet/VehicleCard.jsx'
import LandingPage from '../Public/LandingPage.jsx'
import SearchBar from './components/SearchBar.jsx'
import BrandMark from '../../components/ui/BrandMark.jsx'
import Icon from '../../components/ui/Icon.jsx'
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
import ClientSupport from './components/ClientSupport.jsx'

const navigation = [{ id: 'overview', icon: 'grid', label: 'Overview' }, { id: 'fleet', icon: 'car', label: 'Explore the fleet' }, { id: 'bookings', icon: 'calendar', label: 'My bookings' }, { id: 'documents', icon: 'file', label: 'My documents' }, { id: 'payments', icon: 'wallet', label: 'Payments & billing' }]

const titles = { overview: 'A good day for a great drive.', fleet: 'Find your kind of drive.', bookings: 'Your journeys, all in one place.', documents: 'A little prep. A lot of freedom.', payments: 'Every detail, accounted for.' }

const readPage = () => [...navigation.map(n => n.id), 'home'].includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'home'

export default function ClientPortal({ user, workspace, availability, rates = {}, onRefresh, onLogout, onAuthenticate }) {
  const [page, setPage] = useState(readPage)
  const bookings = workspace?.bookings || []
  const documents = workspace?.documents || {}
  const profile = user || { name: 'Client', email: '' }
  const vehicles = baseVehicles.map(v => ({ ...v, rate: rates[v.id] || v.rate }))
  const [dates, setDates] = useState(initialDates)
  const [category, setCategory] = useState('All cars')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('recommended')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [maxRate, setMaxRate] = useState(15000)
  const [seats, setSeats] = useState('any')
  const [transmission, setTransmission] = useState('any')
  const [onlyAvailable, setOnlyAvailable] = useState(false)
  const [modal, setModal] = useState(null)
  const [toast, setToast] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [notifications, setNotifications] = useState(false)
  const [bookingTab, setBookingTab] = useState('Upcoming')
  const toastTimer = useRef(null)
  const upcoming = bookings.filter(b => !['Completed', 'Cancelled'].includes(b.status)).sort((a, b) => a.start.localeCompare(b.start))
  const nextTrip = upcoming[0]
  const completed = bookings.filter(b => b.status === 'Completed')
  const documentCount = requiredDocuments.filter(d => documents[d.id]).length
  const initials = profile?.name ? profile.name.split(' ').filter(Boolean).map(n => n[0]).slice(0, 2).join('').toUpperCase() : 'DP'

  useEffect(() => {
    const change = () => {
      setPage(readPage()); setMenuOpen(false); setNotifications(false)
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
  function navigate(to) { window.location.assign(`#${to}`); setPage(to); setMenuOpen(false); setNotifications(false) }
  function notify(message) { setToast(message); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 4500) }
  async function onDocument() { await onRefresh() }
  function openBooking(vehicle) {
    if (!user) { onAuthenticate('fleet'); return }
    if (user.role !== 'client') { navigate(`${user.role}-${user.role === 'agent' ? 'reservations' : 'overview'}`); return }
    setModal({ type: 'booking', vehicle })
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
  const filtered = vehicles.filter(v => (category === 'All cars' || v.category === category) && `${v.name} ${v.category} ${v.fuel}`.toLowerCase().includes(query.toLowerCase()) && v.rate <= maxRate && (seats === 'any' || v.seats >= Number(seats)) && (transmission === 'any' || v.transmission === transmission) && (!onlyAvailable || isAvailable(v.id, dates, availability))).sort((a, b) => sort === 'price-low' ? a.rate - b.rate : sort === 'price-high' ? b.rate - a.rate : sort === 'rating' ? Number(b.rating) - Number(a.rating) : 0)
  const card = vehicle => {
    const reason = getAvailabilityReason(vehicle.id, dates, availability)
    const available = reason === ''
    return <VehicleCard key={vehicle.id} vehicle={vehicle} available={available} unavailabilityReason={reason} onDetails={() => setModal({ type: 'vehicle', vehicle, available, reason })} onReserve={() => openBooking(vehicle)} />
  }
  const publicCard = vehicle => {
    const reason = getAvailabilityReason(vehicle.id, dates, availability)
    const available = reason === ''
    return <VehicleCard key={vehicle.id} vehicle={vehicle} available={available} unavailabilityReason={reason} onDetails={() => setModal({ type: 'vehicle', vehicle, available, reason })} onReserve={() => user ? openBooking(vehicle) : onAuthenticate('fleet')} actionLabel={user ? 'View details for' : 'Sign in to reserve'} />
  }

  return <div id={page === 'home' ? 'home' : undefined} className={page === 'home' ? 'landing-shell' : 'app-shell'}>
    {page === 'home' ? <LandingPage user={user} onAuthenticate={onAuthenticate} renderVehicle={publicCard} searchBar={<SearchBar dates={dates} onChange={setDates} onSearch={search} />} onFeature={() => setModal({ type: 'vehicle', vehicle: vehicles.find(v => v.id === 'porsche-panamera') })} /> : <>
    {menuOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <aside className={`sidebar ${menuOpen ? 'mobile-open' : ''}`}>
      <a className="brand" href="#home" onClick={() => navigate('home')} aria-label="DrivePulse home"><span className="brand-mark"><BrandMark /></span><span>drivepulse<span className="brand-period">.</span></span></a>
      <div className="workspace-label">YOUR OPEN ROAD</div>
      <nav className="primary-nav" aria-label="Main navigation">{navigation.map(item => <a key={item.id} href={`#${item.id}`} onClick={() => navigate(item.id)} className={page === item.id ? 'active' : ''} aria-current={page === item.id ? 'page' : undefined}><Icon name={item.icon} size={19} /><span>{item.label}</span>{item.id === 'bookings' && upcoming.length > 0 && <span className="nav-count">{upcoming.length}</span>}</a>)}</nav>
      <div className="sidebar-bottom"><button className="sidebar-auth-action" onClick={() => onLogout().catch(error => notify(error.message))}><Icon name="logout" size={18} />Sign out</button><div className="help-card"><span className="help-spark"><Icon name="road" size={24} /></span><p>A smooth journey,<br />from the very start.</p><button onClick={() => setModal({ type: 'help' })}>We’re here to help<Icon name="diagonal" size={16} /></button><span className="help-circle one" /><span className="help-circle two" /></div><button className="sidebar-help" onClick={() => setModal({ type: 'help' })}><Icon name="help" size={18} />Help & support<Icon name="diagonal" size={15} /></button><button className="profile-button" onClick={() => setModal({ type: 'profile' })}><span className="avatar">{initials}</span><span><strong>{profile.name}</strong><small>Client account</small></span><Icon name="settings" size={18} /></button><div className="preview-caption"><i />DrivePulse development workspace</div></div>
    </aside>

    <main className="main-content">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button><span>Client portal</span><Icon name="chevron" size={12} /><strong>{navigation.find(n => n.id === page)?.label}</strong></div><div className="topbar-actions"><span className="topbar-location"><Icon name="pin" size={15} />Metro Manila, PH</span><span className="topbar-separator" /><button className="icon-button" aria-label="Search vehicles" onClick={() => { navigate('fleet'); setTimeout(() => document.getElementById('fleet-search')?.focus(), 50) }}><Icon name="search" size={19} /></button><div className="notification-wrap"><button className={`icon-button notification-button ${notifications ? 'selected' : ''}`} aria-label="Notifications" aria-expanded={notifications} onClick={() => setNotifications(!notifications)}><Icon name="bell" size={19} /><i /></button>{notifications && <><button className="notification-dismiss" aria-label="Close notifications" onClick={() => setNotifications(false)} /><div className="notification-popover"><div className="popover-title"><strong>Your updates</strong><span className="mini-tag">PREVIEW</span></div>{nextTrip && <button onClick={() => { setNotifications(false); setModal({ type: 'trip', booking: nextTrip }) }}><span className="notification-icon"><Icon name="car" size={18} /></span><span><strong>{nextTrip.status === 'Ready for Dispatch' ? 'Your ride is getting ready' : 'Your reservation is in progress'}</strong><small>{vehicleFor(nextTrip).name} · {prettyDate(nextTrip.start)}</small></span><Icon name="chevron" size={15} /></button>}<button onClick={() => navigate('documents')}><span className="notification-icon"><Icon name="shield" size={18} /></span><span><strong>{documentCount === 3 ? 'Your documents are uploaded' : 'A smooth start begins here'}</strong><small>{documentCount} of 3 required documents uploaded</small></span><Icon name="chevron" size={15} /></button></div></>}</div><button className="avatar topbar-avatar" onClick={() => user ? setModal({ type: 'profile' }) : onAuthenticate('overview')} aria-label="Edit profile">{initials}</button></div></header>

      <div className="page-content" key={page}>
        <section className="page-heading"><div><p className="greeting"><Icon name="sun" size={15} />{page === 'overview' ? `Good to see you, ${profile.name.split(' ')[0]}.` : 'A little freedom goes a long way.'}</p><h1>{titles[page]}</h1></div><span className="today-date"><Icon name="calendar" size={16} />{new Date().toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' })}</span></section>

        {page === 'overview' && <ClientOverviewPage navigate={navigate} setModal={setModal} dates={dates} setDates={setDates} search={search} card={card} upcoming={upcoming} nextTrip={nextTrip} documentCount={documentCount} />}

        {page === 'fleet' && <ClientFleetPage dates={dates} setDates={setDates} search={search} category={category} setCategory={setCategory} query={query} setQuery={setQuery} filtersOpen={filtersOpen} setFiltersOpen={setFiltersOpen} maxRate={maxRate} setMaxRate={setMaxRate} seats={seats} setSeats={setSeats} transmission={transmission} setTransmission={setTransmission} onlyAvailable={onlyAvailable} setOnlyAvailable={setOnlyAvailable} filtered={filtered} sort={sort} setSort={setSort} card={card} navigate={navigate} />}

        {page === 'bookings' && <ClientBookingsPage bookingTab={bookingTab} setBookingTab={setBookingTab} upcoming={upcoming} completed={completed} bookings={bookings} navigate={navigate} setModal={setModal} />}

        {page === 'documents' && <ClientDocumentsPage documentCount={documentCount} documents={documents} onDocument={onDocument} downloadDocument={downloadDocument} bookings={bookings} />}

        {page === 'payments' && <ClientPaymentsPage bookings={bookings} upcoming={upcoming} downloadDocument={downloadDocument} />}
        <footer className="page-footer"><span>Go places. Make memories. <strong>drivepulse.</strong></span><span>Thoughtfully made for your journey.<span className="footer-dot" />Client portal</span></footer>
      </div>
    </main>
    </>}

    {modal?.type === 'booking' && <BookingModal vehicle={modal.vehicle} initialDates={dates} bookings={availability} documents={documents} onDocument={onDocument} onReserve={reserve} onClose={() => setModal(null)} onViewTrips={() => { setModal(null); setBookingTab('Upcoming'); navigate('bookings') }} />}
    {modal?.type === 'vehicle' && (() => {
      const reason = modal.reason !== undefined ? modal.reason : getAvailabilityReason(modal.vehicle.id, dates, availability)
      const isCarAvailable = reason === ''
      return <Modal title={modal.vehicle.name} eyebrow={modal.vehicle.label.toUpperCase()} wide onClose={() => setModal(null)}>
        <div className="vehicle-detail-layout">
          <img className="vehicle-detail-image" src={modal.vehicle.image} alt={modal.vehicle.name} />
          <div className="vehicle-detail-copy">
            <span className="rating"><Icon name="star" size={15} />{modal.vehicle.rating}<span className="muted"> · {modal.vehicle.trips} sample trips</span></span>
            <h3>{modal.vehicle.tagline}</h3>
            <p className="muted">{modal.vehicle.description}</p>
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
              <span className="small muted">+ {money(5000)} refundable deposit</span>
            </div>
            <button
              className="button button-dark full-width"
              disabled={user && !isCarAvailable}
              onClick={() => user ? openBooking(modal.vehicle) : onAuthenticate('fleet')}
            >
              {user ? (isCarAvailable ? 'Make this ride yours' : `Unavailable: ${reason}`) : 'Sign in to reserve this ride'}
              <Icon name="arrow" size={18} />
            </button>
            <p className="small muted">Selected dates: {prettyDate(dates.start)} – {prettyDate(dates.end)} · Photos are illustrative.</p>
          </div>
        </div>
      </Modal>
    })()}
    {modal?.type === 'trip' && (() => {
      const activeBooking = bookings.find(b => b.id === modal.booking.id) || modal.booking
      const canExtend = ['On Rental', 'Ready for Dispatch'].includes(activeBooking.status)
      return (
        <Modal title="Every step of your journey." eyebrow={`${activeBooking.id}${activeBooking.sample ? ' · SAMPLE BOOKING' : ''}`} wide onClose={() => setModal(null)}>
          <BookingRecords booking={activeBooking} />
          <TripDetails booking={activeBooking} />
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
        onClose={() => setModal(null)}
        onSuccess={async () => {
          await onRefresh()
          setModal(null)
          notify('Rental extension confirmed! Your return schedule and contract have been updated.')
        }}
      />
    )}
    {modal?.type === 'profile' && <Modal title="Make yourself at home." eyebrow="YOUR CLIENT PROFILE" onClose={() => setModal(null)}><form onSubmit={async e => { e.preventDefault(); const data = new FormData(e.currentTarget); const name = String(data.get('name')).trim(); if (!name) return; try { await api('/profile', { method: 'PATCH', body: { name, email: String(data.get('email')).trim() } }); await onRefresh(); setModal(null); notify('Your profile has been updated.') } catch (error) { notify(error.message) } }}><div className="profile-intro"><span className="avatar large-avatar">{initials}</span><p className="muted">A few details to make your journey more personal.</p></div><label className="form-field">Full name<input required name="name" autoComplete="name" defaultValue={profile.name} maxLength={70} /></label><label className="form-field">Email address<input required name="email" type="email" autoComplete="email" defaultValue={profile.email} maxLength={120} /></label><div className="info-note"><Icon name="info" size={18} /><span>Updating your email also updates the email you use to sign in.</span></div><button className="button button-dark full-width" type="submit">Save my details<Icon name="check" size={17} /></button></form></Modal>}
    {modal?.type === 'help' && <Modal title="A smoother journey starts here." eyebrow="YOUR PERSONAL PIT STOP" onClose={() => setModal(null)}><p className="muted">A few helpful answers before you hit the road.</p>{user ? <ClientSupport bookings={bookings} tickets={workspace?.tickets || []} onRefresh={onRefresh} /> : <a className="button button-dark" href="#login">Sign in to contact the booking team</a>}<div className="faq-list">{[{ q: 'What do I need to book a vehicle?', a: 'Choose your dates and locations, upload a valid driver’s license and two different government-issued IDs, then pay the rental and deposit in cash at the counter. Your booking starts as Pending Approval.' }, { q: 'How is my quotation calculated?', a: 'The daily rate is charged for each started 24-hour period. A ₱5,000 refundable security deposit is added to the rental total. Fuel, tolls, and additional charges are excluded.' }, { q: 'How are security deposits released?', a: 'If the fleet mechanic marks a Clean Return with zero damage flags and full fuel, the system automatically schedules your deposit release within 24–48 hours. Only disputed or withheld deposits require Operations Manager approval.' }, { q: 'Can I get a rental contract or receipt?', a: 'Download your official rental contract and receipts from My documents, Payments & billing, or booking details. Open the HTML file, choose Print, then Save as PDF.' }].map(faq => <details key={faq.q}><summary>{faq.q}<Icon name="down" size={17} /></summary><p>{faq.a}</p></details>)}</div><button className="button button-dark full-width" onClick={() => { setModal(null); if (user) navigate('fleet'); else onAuthenticate('fleet') }}>Find my next ride<Icon name="arrow" size={17} /></button></Modal>}
    {toast && <div className="toast" role="status"><span><Icon name="check" size={17} /></span>{toast}<button aria-label="Dismiss notification" onClick={() => setToast('')}><Icon name="close" size={15} /></button></div>}
  </div>
}

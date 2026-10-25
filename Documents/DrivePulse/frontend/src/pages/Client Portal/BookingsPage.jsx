import { PaginatedList } from '../../components/ui/Pagination.jsx'
import Icon from '../../components/ui/Icon.jsx'
import { vehicleFor } from '../../utils/vehicles.js'
import Status from './components/Status.jsx'
import { prettyDate, money } from '../../data.js'
import TripTimeline from './components/TripTimeline.jsx'
import EmptyState from './components/EmptyState.jsx'

export default function ClientBookingsPage({ bookingTab, setBookingTab, upcoming, completed, bookings, navigate, setModal }) {
  
  return <><div className="bookings-header"><div className="pill-tabs" role="group" aria-label="Booking view">{['Upcoming', 'Past trips', 'All bookings'].map(t => <button key={t} className={bookingTab === t ? 'active' : ''} onClick={() => setBookingTab(t)}>{t}<span>{t === 'Upcoming' ? upcoming.length : t === 'Past trips' ? completed.length : bookings.length}</span></button>)}</div><button className="button button-dark" onClick={() => navigate('fleet')}>Plan a new trip<Icon name="diagonal" size={17} /></button></div><div className="booking-list">{<PaginatedList>{(bookingTab === 'Upcoming' ? upcoming : bookingTab === 'Past trips' ? completed : bookings).map(booking => <article className="booking-list-card" key={booking.id}><img src={vehicleFor(booking).image} alt={vehicleFor(booking).name} /><div className="booking-list-info"><div className="booking-list-meta"><span>{booking.id}{booking.sample && ' · SAMPLE TRIP'}</span><Status value={booking.status} /></div><h2>{vehicleFor(booking).name}</h2><p><Icon name="calendar" size={15} />{prettyDate(booking.start, { year: 'numeric' })} – {prettyDate(booking.end, { year: 'numeric' })}<span>·</span>{booking.days} days</p><p><Icon name="pin" size={15} />{booking.pickup}</p><TripTimeline status={booking.status} compact /></div><div className="booking-list-actions"><span className="vehicle-price">{money(booking.total)}<small> incl. deposit</small></span><button className="button button-outline" onClick={() => setModal({ type: 'trip', booking })}>View details<Icon name="arrow" size={16} /></button></div></article>)}</PaginatedList>}</div>{!(bookingTab === 'Upcoming' ? upcoming : bookingTab === 'Past trips' ? completed : bookings).length && <EmptyState icon="road" title="Your next chapter is unwritten." description="Choose a ride and make some new memories." action="Explore the fleet" onAction={() => navigate('fleet')} />}</>
}

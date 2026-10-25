import { PaginatedList } from '../../components/ui/Pagination.jsx'
import { useState } from 'react'
import { dateISO, prettyDate, vehicles, money, tripTime } from '../../data.js'
import Icon from '../../components/ui/Icon.jsx'
import Tag from '../../components/workspace/StaffTag.jsx'
import { clampCalendarStart, bookingDatesForDay } from '../../utils/calendar.js'

const addDays = (date, amount) => new Date(Date.parse(`${date}T12:00:00Z`) + amount * 86400000).toISOString().slice(0, 10)

export default function AvailabilityCalendar({ bookings, availability, onOpen, onCreate }) {
  const [start, setStart] = useState(dateISO)
  const [range, setRange] = useState(7)
  const [filter, setFilter] = useState('all')
  const [now] = useState(() => Date.now())

  const today = dateISO()
  const visibleStart = clampCalendarStart(start, today)
  const days = Array.from({ length: range }, (_, index) => addDays(visibleStart, index))

  // Determine current live vehicle status
  const vehicleStatusMap = vehicles.reduce((acc, v) => {
    const hold = availability.find(item => item.blocked && item.vehicleId === v.id)
    const active = bookings.find(b => b.vehicleId === v.id && b.status === 'On Rental')
    const isOverdue = active && (tripTime(active.end, active.endTime) < now)

    let status = 'Available'
    if (hold) status = hold.status
    else if (isOverdue) status = 'Overdue'
    else if (active) status = 'On Rental'

    acc[v.id] = { status, isOverdue, activeBooking: active }
    return acc
  }, {})

  const displayedVehicles = vehicles.filter(v => {
    if (v.archivedAt) return false
    const info = vehicleStatusMap[v.id]
    if (filter === 'available') return info.status === 'Available'
    if (filter === 'rented') return info.status === 'On Rental'
    if (filter === 'overdue') return info.isOverdue
    if (filter === 'maintenance') return ['Maintenance', 'Under Inspection', 'Out of Service'].includes(info.status)
    return true
  })

  return (
    <section className="workspace-surface availability-calendar">
      <div className="calendar-toolbar">
        <div>
          <p className="workspace-kicker">FLEET OPERATIONAL SCHEDULE</p>
          <h2>{prettyDate(visibleStart, { year: 'numeric' })} – {prettyDate(days[days.length - 1], { year: 'numeric' })}</h2>
          <p className="workspace-muted">
            Track active rentals, overdue returns, scheduled maintenance, and open reservation slots across the fleet.
          </p>
        </div>

        <div className="calendar-controls">
          <div className="calendar-nav-buttons">
            <button className="icon-button calendar-prev" aria-label="Previous days" disabled={visibleStart <= today} onClick={() => setStart(clampCalendarStart(addDays(visibleStart, -range), today))}>
              <Icon name="chevron" />
            </button>
            <button className="button button-outline" onClick={() => setStart(today)}>
              Today
            </button>
            <button className="icon-button" aria-label="Next days" onClick={() => setStart(addDays(visibleStart, range))}>
              <Icon name="chevron" />
            </button>
          </div>

          <div className="calendar-view-options">
            <select value={range} onChange={e => setRange(Number(e.target.value))}>
              <option value={7}>7-day view</option>
              <option value={14}>14-day view</option>
            </select>

            <select value={filter} onChange={e => setFilter(e.target.value)}>
              <option value="all">All fleet ({vehicles.length})</option>
              <option value="available">Available now</option>
              <option value="rented">Active rentals</option>
              <option value="overdue">Overdue returns</option>
              <option value="maintenance">Maintenance & holds</option>
            </select>

            <input
              id="calendar-start"
              aria-label="Calendar start date"
              min={today}
              type="date"
              value={visibleStart}
              onChange={e => e.target.value >= today && setStart(e.target.value)}
              title="Jump to date"
            />
          </div>
        </div>
      </div>

      <div className="calendar-legend">
        <span><i style={{ background: '#10b981' }} /> Available for booking</span>
        <span><i style={{ background: '#3b82f6' }} /> Reserved (Pending / Ready)</span>
        <span><i style={{ background: '#f97316' }} /> Active trip (On Rental)</span>
        <span><i style={{ background: '#ef4444' }} /> Overdue return</span>
        <span><i style={{ background: '#8b5cf6' }} /> Maintenance / Inspection</span>
      </div>

      <div className="calendar-scroll">
        <div className="fleet-calendar-grid" style={{ gridTemplateColumns: '235px repeat(' + range + ', minmax(125px, 1fr))' }}>
          <div className="calendar-corner">
            <strong>VEHICLE & LIVE STATUS</strong>
          </div>

          {days.map(day => (
            <div className={`calendar-day ${day === today ? 'is-today' : ''}`} key={day}>
              <span>{prettyDate(day, { weekday: 'short', month: undefined, day: undefined })}</span>
              <strong>{day.slice(8)}</strong>
              {day === today && <small className="calendar-today-tag">TODAY</small>}
            </div>
          ))}

          {<PaginatedList>{displayedVehicles.map(vehicle => {
            const vInfo = vehicleStatusMap[vehicle.id]
            const hold = availability.find(item => item.blocked && item.vehicleId === vehicle.id)

            return (
              <div className="calendar-vehicle-row" key={vehicle.id}>
                <div className="calendar-vehicle">
                  <img src={vehicle.image} alt={vehicle.name} />
                  <div>
                    <strong>{vehicle.name}</strong>
                    <small>{money(vehicle.rate)} / day</small>
                    <span className="calendar-vstatus">
                      <Tag>{vInfo.status}</Tag>
                    </span>
                  </div>
                </div>

                {days.map(day => {
                  const dayStart = tripTime(day, '00:00')
                  const dayEnd = tripTime(addDays(day, 1), '00:00')

                  // Find bookings active on this specific calendar day
                  const dayBookings = bookings.filter(b =>
                    b.vehicleId === vehicle.id &&
                    !['Cancelled', 'Completed'].includes(b.status) &&
                    tripTime(b.start, b.startTime || '10:00') < dayEnd &&
                    tripTime(b.end, b.endTime || '10:00') > dayStart
                  )

                  const selectableDates = bookingDatesForDay(day)
                  const isPast = !selectableDates

                  // If day is today and vehicle has an active hold
                  const isDayOnHold = hold && (day === today || (hold.status === 'Maintenance' && day <= addDays(today, 2)))

                  return (
                    <div className={`calendar-cell ${day === today ? 'cell-today' : ''}`} key={day}>
                      {dayBookings.length > 0 ? (
                        dayBookings.map(b => {
                          const isBookingOverdue = b.status === 'On Rental' && tripTime(b.end, b.endTime || '10:00') < Date.now()
                          const bookingLabel = isBookingOverdue ? 'Overdue Return' : b.status === 'On Rental' ? 'On Rental' : 'Reserved'
                          const statusClass = isBookingOverdue ? 'booking-overdue' : b.status === 'On Rental' ? 'booking-rental' : 'booking-reserved'

                          return (
                            <button
                              className={`calendar-booking ${statusClass}`}
                              key={b.id}
                              disabled={day < today}
                              onClick={() => { if (day >= dateISO()) onOpen(b.id) }}
                              title={`${b.renter.name} · ${b.id} (${bookingLabel})`}
                            >
                              <strong>{b.renter.name}</strong>
                              <small>{b.id}</small>
                              <span>{bookingLabel}</span>
                            </button>
                          )
                        })
                      ) : isDayOnHold ? (
                        <div className="calendar-hold-box" title={`${vehicle.name} is currently ${hold.status}`}>
                          <Icon name="settings" size={14} />
                          <strong>{hold.status}</strong>
                        </div>
                      ) : isPast ? (
                        <span className="workspace-muted calendar-past">Past date</span>
                      ) : (
                        <button
                          className="calendar-available"
                          aria-label={`Reserve ${vehicle.name} on ${prettyDate(day)}`}
                          disabled={!selectableDates}
                          onClick={() => { const dates = bookingDatesForDay(day); if (dates) onCreate({ vehicleId: vehicle.id, ...dates }) }}
                        >
                          <span>＋</span>
                          Available
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}</PaginatedList>}
        </div>
      </div>
      <p className="workspace-muted calendar-caption">
        Partial-day handovers are supported. Click any reserved or overdue rental block to inspect documents, payments, and dispatch passes.
      </p>
    </section>
  )
}

import { useId, useState } from 'react'
import ValidatedField from './ValidatedField.jsx'
import { dateISO } from '../../data.js'
import { isBookedDate } from '../../utils/bookingCalendar.js'
import { addCalendarDays } from '../../utils/calendar.js'

export default function BookingDatePicker({ name, value, min = dateISO(), onChange, vehicleId, dates, bookings, disabled = false }) {
  const id = useId(), [open, setOpen] = useState(false)
  const [month, setMonth] = useState((value || min).slice(0, 7))
  const first = new Date(`${month}-01T12:00:00Z`)
  const start = addCalendarDays(`${month}-01`, -first.getUTCDay())
  const move = offset => { const next = new Date(first); next.setUTCMonth(next.getUTCMonth() + offset); setMonth(next.toISOString().slice(0, 7)) }
  return <div className="booking-date-picker">
    <div className="booking-date-control"><ValidatedField name={name} type="text" readOnly required value={value} aria-label={name === 'start' ? 'Pick-up date' : 'Return date'} /><button type="button" className="button button-outline" aria-expanded={open} aria-controls={id} disabled={disabled} onClick={() => { setMonth((value || min).slice(0, 7)); setOpen(!open) }}>Choose date</button></div>
    {open && <div id={id} className="booking-calendar" role="group" aria-label={`${name === 'start' ? 'Pick-up' : 'Return'} calendar`}>
      <div className="booking-calendar-heading"><button type="button" aria-label="Previous month" onClick={() => move(-1)} disabled={month <= min.slice(0, 7)}>‹</button><strong aria-live="polite">{first.toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</strong><button type="button" aria-label="Next month" onClick={() => move(1)}>›</button></div>
      <div className="booking-calendar-days">{['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => <span key={day}>{day}</span>)}
        {Array.from({ length: 42 }, (_, index) => {
          const day = addCalendarDays(start, index), booked = isBookedDate(day, { vehicleId, field: name, dates, bookings })
          const locked = disabled || day < min || day.slice(0, 7) !== month || booked
          return <button key={day} type="button" disabled={locked} className={booked ? 'is-booked' : ''} aria-label={`${day}${booked ? ' · Booked / unavailable' : ''}`} aria-pressed={day === value} title={booked ? 'Booked / unavailable' : day} onClick={() => { if (locked) return; onChange(day); setOpen(false) }}>{Number(day.slice(-2))}</button>
        })}
      </div><small>Booked dates are locked. Times use PHT.</small><button type="button" className="text-link" onClick={() => setOpen(false)}>Close calendar</button>
    </div>}
  </div>
}

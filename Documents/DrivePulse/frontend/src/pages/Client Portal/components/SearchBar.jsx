import Icon from '../../../components/ui/Icon.jsx'
import { locations, dateISO } from '../../../data.js'

export default function SearchBar({ dates, onChange, onSearch }) {
  function handleStartChange(newStart) {
    const next = { ...dates, start: newStart }
    if (dates.end < newStart) {
      next.end = newStart
    }
    onChange(next)
  }

  return (
    <form className="trip-search glass" onSubmit={e => { e.preventDefault(); onSearch() }}>
      <label className="search-field location-field">
        <span className="search-label"><Icon name="pin" size={17} />Pick-up location</span>
        <select value={dates.pickup} onChange={e => onChange({ ...dates, pickup: e.target.value, dropoff: e.target.value })}>
          {locations.map(location => <option key={location}>{location}</option>)}
        </select>
      </label>

      <label className="search-field">
        <span className="search-label"><Icon name="calendar" size={17} />Pick-up date</span>
        <input
          aria-label="Pick-up date"
          required
          type="date"
          min={dateISO()}
          value={dates.start}
          onChange={e => handleStartChange(e.target.value)}
        />
      </label>

      <label className="search-field time-field">
        <span className="search-label"><Icon name="clock" size={17} />Time</span>
        <input
          aria-label="Pick-up time"
          required
          type="time"
          value={dates.startTime || '10:00'}
          onChange={e => onChange({ ...dates, startTime: e.target.value })}
        />
      </label>

      <label className="search-field">
        <span className="search-label"><Icon name="calendar" size={17} />Return date</span>
        <input
          aria-label="Return date"
          required
          type="date"
          min={dates.start || dateISO()}
          value={dates.end}
          onChange={e => onChange({ ...dates, end: e.target.value })}
        />
      </label>

      <label className="search-field time-field">
        <span className="search-label"><Icon name="clock" size={17} />Time</span>
        <input
          aria-label="Return time"
          required
          type="time"
          value={dates.endTime || '10:00'}
          onChange={e => onChange({ ...dates, endTime: e.target.value })}
        />
      </label>

      <button className="button button-dark search-submit" type="submit">
        <Icon name="search" size={18} />
        <span>Find a ride</span>
      </button>
    </form>
  )
}

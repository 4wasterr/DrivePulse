import ValidatedField from '../../../components/ui/ValidatedField.jsx'
import ValidatedForm from '../../../components/ui/ValidatedForm.jsx'
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
    <ValidatedForm className="trip-search glass" validation="rental" onSubmit={e => { e.preventDefault(); onSearch() }}>
      <label className="search-field location-field">
        <span className="search-label"><Icon name="pin" size={17} />Pick-up location</span>
        <ValidatedField as="select" value={dates.pickup} onChange={e => onChange({ ...dates, pickup: e.target.value, dropoff: e.target.value })}>
          {locations.map(location => <option key={location}>{location}</option>)}
        </ValidatedField>
      </label>

      <label className="search-field">
        <span className="search-label"><Icon name="calendar" size={17} />Pick-up date</span>
        <ValidatedField
          aria-label="Pick-up date"
          name="start"
          required
          type="date"
          min={dateISO()}
          value={dates.start}
          onChange={e => handleStartChange(e.target.value)}
        />
      </label>

      <label className="search-field time-field">
        <span className="search-label"><Icon name="clock" size={17} />Time</span>
        <ValidatedField
          aria-label="Pick-up time"
          name="startTime"
          required
          type="time"
          value={dates.startTime || '10:00'}
          onChange={e => onChange({ ...dates, startTime: e.target.value })}
        />
      </label>

      <label className="search-field">
        <span className="search-label"><Icon name="calendar" size={17} />Return date</span>
        <ValidatedField
          aria-label="Return date"
          name="end"
          required
          type="date"
          min={dates.start > dateISO() ? dates.start : dateISO()}
          value={dates.end}
          onChange={e => onChange({ ...dates, end: e.target.value })}
        />
      </label>

      <label className="search-field time-field">
        <span className="search-label"><Icon name="clock" size={17} />Time</span>
        <ValidatedField
          aria-label="Return time"
          name="endTime"
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
    </ValidatedForm>
  )
}

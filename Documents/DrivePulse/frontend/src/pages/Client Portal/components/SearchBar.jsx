import Icon from '../../../components/ui/Icon.jsx'
import { locations, dateISO } from '../../../data.js'

export default function SearchBar({ dates, onChange, onSearch }) {
  return <form className="trip-search glass" onSubmit={e => { e.preventDefault(); onSearch() }}>
    <label className="search-field location-field"><span className="search-label"><Icon name="pin" size={17} />Pick-up location</span><select value={dates.pickup} onChange={e => onChange({ ...dates, pickup: e.target.value, dropoff: e.target.value })}>{locations.map(location => <option key={location}>{location}</option>)}</select></label>
    <label className="search-field"><span className="search-label"><Icon name="calendar" size={17} />Pick-up date</span><input aria-label="Pick-up date" required type="date" min={dateISO()} value={dates.start} onChange={e => onChange({ ...dates, start: e.target.value })} /></label>
    <label className="search-field"><span className="search-label"><Icon name="calendar" size={17} />Return date</span><input aria-label="Return date" required type="date" min={dates.start} value={dates.end} onChange={e => onChange({ ...dates, end: e.target.value })} /></label>
    <button className="button button-dark search-submit" type="submit"><Icon name="search" size={18} /><span>Find a ride</span></button>
  </form>
}

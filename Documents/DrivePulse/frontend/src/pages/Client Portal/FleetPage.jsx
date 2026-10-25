import { PaginatedList } from '../../components/ui/Pagination.jsx'
import SearchBar from './components/SearchBar.jsx'
import Icon from '../../components/ui/Icon.jsx'
import { money, prettyDate } from '../../data.js'
import EmptyState from './components/EmptyState.jsx'

export default function ClientFleetPage({ dates, setDates, search, category, setCategory, brand, setBrand, brands, query, setQuery, filtersOpen, setFiltersOpen, maxRate, setMaxRate, seats, setSeats, transmission, setTransmission, onlyAvailable, setOnlyAvailable, filtered, sort, setSort, card }) {
  function reset() { setMaxRate(100000); setSeats('any'); setTransmission('any'); setOnlyAvailable(false); setQuery(''); setCategory('All cars'); setBrand('all') }
  const filterKey = JSON.stringify({ category, brand, query, maxRate, seats, transmission, onlyAvailable, sort, dates })
  return <section className="find-ride" aria-label="Find a Ride">
    <SearchBar dates={dates} onChange={setDates} onSearch={search} />
    <div className="ride-filter-bar">
      <label className="form-field ride-search"><span>Find a vehicle</span><input id="fleet-search" type="search" placeholder="Name, model, fleet ID or plate" maxLength={150} value={query} onChange={e => setQuery(e.target.value)} /></label>
      <label className="form-field"><span>Category</span><select value={category} onChange={e => setCategory(e.target.value)}>{['All cars', 'Sedan', 'SUV', 'Van', 'Hatchback', 'Truck', 'Compact', 'Luxury', 'Electric'].map(c => <option key={c}>{c}</option>)}</select></label>
      <label className="form-field"><span>Brand</span><select value={brand} onChange={e => setBrand(e.target.value)}><option value="all">All brands</option>{brands.map(b => <option key={b}>{b}</option>)}</select></label>
      <label className="form-field ride-price"><span>Maximum daily rate · {money(maxRate)}</span><input type="range" aria-label="Maximum daily rate" min="500" max="100000" step="500" value={maxRate} onChange={e => setMaxRate(Number(e.target.value))} /></label>
      <button type="button" className="button button-outline" aria-expanded={filtersOpen} aria-controls="ride-extra-filters" onClick={() => setFiltersOpen(!filtersOpen)}><Icon name="filter" size={17} />More filters</button>
    </div>
    {filtersOpen && <div id="ride-extra-filters" className="ride-extra-filters">
      <label className="form-field"><span>Seating</span><select value={seats} onChange={e => setSeats(e.target.value)}><option value="any">Any capacity</option><option value="5">5 or more seats</option><option value="7">7 or more seats</option><option value="10">10 or more seats</option></select></label>
      <label className="form-field"><span>Transmission</span><select value={transmission} onChange={e => setTransmission(e.target.value)}><option value="any">All transmissions</option><option>Automatic</option><option>Manual</option></select></label>
      <label className="checkbox-label"><input type="checkbox" checked={onlyAvailable} onChange={e => setOnlyAvailable(e.target.checked)} />Available for selected dates</label>
      <button type="button" className="text-link" onClick={reset}>Reset filters</button>
    </div>}
    <div className="results-header"><p><strong>{filtered.length}</strong> vehicles<span> · {prettyDate(dates.start)} – {prettyDate(dates.end)}</span></p><label>Sort by<select aria-label="Sort vehicles" value={sort} onChange={e => setSort(e.target.value)}><option value="recommended">Recommended</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="rating">Highest rated</option></select></label></div>
    {filtered.length ? <div className="fleet-grid ride-fleet-grid"><PaginatedList resetKey={filterKey}>{filtered.map(card)}</PaginatedList></div> : <EmptyState icon="search" title="No vehicles match these filters." description="Adjust the category, brand, price or dates to find your ride." action="Reset filters" onAction={reset} />}
    <div className="fleet-note"><Icon name="info" size={17} />Availability reflects current reservations and fleet readiness.</div>
  </section>
}

import { useEffect, useState } from 'react'
import { api } from '../../api.js'
import ValidatedField from './ValidatedField.jsx'

function useReference(path) {
  const [state, setState] = useState({ path: null, items: [], error: '' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!path) return
    const controller = new AbortController()
    api(path, { signal: controller.signal }).then(items => setState({ path, items, error: '' })).catch(error => {
      if (!controller.signal.aborted) setState({ path, items: [], error: error.message })
    })
    return () => controller.abort()
  }, [path, attempt])
  return { items: state.path === path ? state.items : [], error: state.path === path ? state.error : '', loading: Boolean(path && state.path !== path), retry: () => { setState({ path: null, items: [], error: '' }); setAttempt(value => value + 1) } }
}

export default function AddressFields({ address = {} }) {
  const [selection, setSelection] = useState(() => ({ regionCode: address.regionCode || '', cityCode: address.cityCode || '', barangayCode: address.barangayCode || '', postalCode: address.postalCode || '' }))
  const regions = useReference('/geography/regions')
  const cities = useReference(selection.regionCode ? `/geography/regions/${selection.regionCode}/cities` : null)
  const barangays = useReference(selection.cityCode ? `/geography/cities/${selection.cityCode}/barangays` : null)
  const city = cities.items.find(item => item.code === selection.cityCode)
  const [customPostal, setCustomPostal] = useState(false)
  const postalCodes = city?.postalCodes || []
  const changeRegion = value => { setCustomPostal(false); setSelection({ regionCode: value, cityCode: '', barangayCode: '', postalCode: '' }) }
  const changeCity = value => {
    const item = cities.items.find(city => city.code === value)
    setCustomPostal(false)
    setSelection(previous => ({ ...previous, cityCode: value, barangayCode: '', postalCode: item?.postalCodes.length === 1 ? item.postalCodes[0] : '' }))
  }
  const select = (name, label, source, value, onChange, parent = true) => <label className="form-field">{label}<ValidatedField as="select" name={name} required value={source.items.some(item => item.code === value) ? value : ''} onChange={event => onChange(event.target.value)} aria-busy={source.loading}>
    <option value="">{source.loading ? 'Loading…' : !parent ? 'Select the parent location first' : `Select ${label.toLowerCase()}`}</option>
    {source.items.map(item => <option key={item.code} value={item.code}>{item.name}{item.province ? ` · ${item.province}` : ''}</option>)}
  </ValidatedField>{source.error && <span role="alert">{source.error} <button type="button" className="text-link" onClick={source.retry}>Retry</button></span>}</label>
  return <div className="address-fields">
    {select('regionCode', 'Region', regions, selection.regionCode, changeRegion)}
    {select('cityCode', 'City / Municipality', cities, selection.cityCode, changeCity, Boolean(selection.regionCode))}
    {select('barangayCode', 'Barangay', barangays, selection.barangayCode, value => {
      const codes = barangays.items.find(item => item.code === value)?.postalCodes || []
      setCustomPostal(false)
      setSelection(previous => ({ ...previous, barangayCode: value, postalCode: codes.length === 1 ? codes[0] : city?.postalCodes.length === 1 ? city.postalCodes[0] : '' }))
    }, Boolean(selection.cityCode))}
    <input type="hidden" name="city" value={city?.name || ''} />
    <label className="form-field">Postal / ZIP Code{postalCodes.length > 0 && <ValidatedField as="select" name={customPostal ? 'postalChoice' : 'postalCode'} required value={customPostal ? 'custom' : selection.postalCode} onChange={event => { setCustomPostal(event.target.value === 'custom'); setSelection(previous => ({ ...previous, postalCode: event.target.value === 'custom' ? '' : event.target.value })) }}><option value="">Select ZIP code</option>{postalCodes.map(code => <option key={code} value={code}>{code}{city.postalOptions?.some(option => option.code === code) ? ` · ${city.postalOptions.filter(option => option.code === code).map(option => option.area).join(', ')}` : ''}</option>)}<option value="custom">Enter another ZIP code</option></ValidatedField>}{(!postalCodes.length || customPostal) && <ValidatedField name="postalCode" required inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} autoComplete="postal-code" placeholder="Four-digit ZIP code" value={selection.postalCode} onChange={event => setSelection(previous => ({ ...previous, postalCode: event.target.value }))} />}{city && <small className="muted">Confirm your delivery area’s ZIP code. Postal zones can cover multiple barangays.</small>}</label>
  </div>
}

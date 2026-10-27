import ValidatedField from './ValidatedField.jsx'
import useLocations from '../../hooks/useLocations.js'

export default function LocationField(props) {
  const { locations, loading, error } = useLocations()
  const valid = locations.includes(props.value)
  return <>
    <ValidatedField {...props} as="select" disabled={props.disabled || loading || Boolean(error)} value={valid ? props.value : ''}>
      <option value="">{loading ? 'Loading locations…' : 'Select an operational location'}</option>
      {locations.map(location => <option key={location}>{location}</option>)}
    </ValidatedField>
    {error && <span className="field-validation-message" role="alert">{error}</span>}
    {!loading && !error && props.value && !valid && <span className="field-validation-message" role="alert">Choose a currently operational location.</span>}
  </>
}

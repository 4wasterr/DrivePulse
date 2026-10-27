import ValidatedField from './ValidatedField.jsx'
import useLocations from '../../hooks/useLocations.js'

export default function LocationField(props) {
  const { locations, branches, loading, error } = useLocations()
  const valid = locations.includes(props.value)
  return <>
    <ValidatedField {...props} as="select" disabled={props.disabled || loading || Boolean(error)} value={valid ? props.value : ''}>
      <option value="">{loading ? 'Loading branches…' : 'Select a branch'}</option>
      {branches.map(branch => <option key={branch.id} value={branch.name}>{branch.branchName || branch.name}{branch.branchName && branch.branchName !== branch.name ? ` · ${branch.name}` : ''}</option>)}
    </ValidatedField>
    {error && <span className="field-validation-message" role="alert">{error}</span>}
    {!loading && !error && props.value && !valid && <span className="field-validation-message" role="alert">Choose an active branch.</span>}
  </>
}

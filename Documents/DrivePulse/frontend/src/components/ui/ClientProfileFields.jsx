import ValidatedField from './ValidatedField.jsx'
import AddressFields from './AddressFields.jsx'

export default function ClientProfileFields({ user = {} }) {
  return <>
    <div className="auth-name-grid">
      {[['firstName', 'First Name', 'given-name'], ['middleName', 'Middle Name', 'additional-name'], ['lastName', 'Last Name', 'family-name']].map(([name, label, autoComplete]) => <label className="form-field" key={name}><span>{label}{name === 'middleName' && <small className="field-optional"> (Optional)</small>}</span><ValidatedField name={name} data-validate="name" required={name !== 'middleName'} maxLength={40} autoComplete={autoComplete} defaultValue={user[name] || ''} /></label>)}
    </div>
    <label className="form-field">Contact Number<ValidatedField name="phone" type="tel" data-validate="ph-mobile" required maxLength={24} autoComplete="tel" placeholder="+63 9XX XXX XXXX" defaultValue={user.phone || ''} /></label>
    <label className="form-field">Street Address<ValidatedField name="street" required minLength={2} maxLength={160} autoComplete="address-line1" placeholder="House / building number and street" defaultValue={user.address?.street || ''} /></label>
    <AddressFields address={user.address} />
  </>
}

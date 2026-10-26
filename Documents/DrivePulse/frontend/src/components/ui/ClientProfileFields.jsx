import ValidatedField from './ValidatedField.jsx'

export default function ClientProfileFields({ user = {} }) {
  return <>
    <div className="auth-name-grid">
      {[['firstName', 'First Name', 'given-name'], ['middleName', 'Middle Name', 'additional-name'], ['lastName', 'Last Name', 'family-name']].map(([name, label, autoComplete]) => <label className="form-field" key={name}><span>{label}{name === 'middleName' && <small className="field-optional"> (Optional)</small>}</span><ValidatedField name={name} data-validate="name" required={name !== 'middleName'} maxLength={40} autoComplete={autoComplete} defaultValue={user[name] || ''} /></label>)}
    </div>
    <label className="form-field">Contact Number<ValidatedField name="phone" type="tel" data-validate="ph-mobile" required maxLength={24} autoComplete="tel" placeholder="0917 123 4567 / +63 917 123 4567" defaultValue={user.phone || ''} /></label>
    <label className="form-field">Street Address<ValidatedField name="street" required minLength={2} maxLength={160} autoComplete="address-line1" placeholder="House / building number and street" defaultValue={user.address?.street || ''} /></label>
    <label className="form-field">Barangay / City<ValidatedField name="city" required minLength={2} maxLength={160} autoComplete="address-level2" defaultValue={user.address?.city || ''} /></label>
    <label className="form-field">Postal Code<ValidatedField name="postalCode" required inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} autoComplete="postal-code" placeholder="1234" defaultValue={user.address?.postalCode || ''} /></label>
  </>
}

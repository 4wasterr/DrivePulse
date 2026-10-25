import ValidatedField from '../../../components/ui/ValidatedField.jsx'
import ValidatedForm from '../../../components/ui/ValidatedForm.jsx'
import { useState } from 'react'
import Modal from '../../../components/ui/Modal.jsx'
import VehicleImageField from '../../../components/ui/VehicleImageField.jsx'
import { api, uploadVehicleImage } from '../../../api.js'
import { duplicateVehicleErrors } from '../../../../../shared/validation.mjs'
import { vehicles } from '../../../data.js'

export default function VehicleProfileModal({ vehicle, onClose, onDone }) {
  const [photo, setPhoto] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <Modal title={vehicle.name} eyebrow="VEHICLE PROFILE & RENEWALS" onClose={onClose}>
    <ValidatedForm validate={form => duplicateVehicleErrors({ fleetCode: new FormData(form).get('fleetCode') }, vehicles, vehicle.id)} onSubmit={async e => {
      e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); setError('')
      try {
        const image = photo ? await uploadVehicleImage(photo) : null
        await api(`/manager/vehicles/${vehicle.id}/profile`, { method: 'PATCH', body: { version: vehicle.version, fleetCode: form.get('fleetCode'), registrationExpiry: form.get('registrationExpiry'), insuranceExpiry: form.get('insuranceExpiry'), imageId: image?.id || vehicle.imageId } })
        await onDone('Vehicle profile and renewal dates updated.')
      } catch (err) { setError(err.message) } finally { setBusy(false) }
    }}><fieldset disabled={busy}>
      <VehicleImageField image={vehicle.image} onChange={setPhoto} disabled={busy} />
      <label className="form-field">Unique Vehicle ID / Fleet code<ValidatedField name="fleetCode" data-validate="fleet-code" defaultValue={vehicle.fleetCode} required maxLength={30} /></label>
      <label className="form-field">OR/CR Registration Expiry Date<ValidatedField type="date" name="registrationExpiry" defaultValue={vehicle.registrationExpiry || ''} /></label>
      <label className="form-field">Insurance Expiry Date<ValidatedField type="date" name="insuranceExpiry" defaultValue={vehicle.insuranceExpiry || ''} /></label>
      <p>Renewal alerts update automatically at 30, 15 and 7 days, and when overdue.</p>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <button className="button button-dark" disabled={busy}>{busy ? 'Saving…' : 'Save vehicle profile'}</button>
    </fieldset></ValidatedForm>
  </Modal>
}

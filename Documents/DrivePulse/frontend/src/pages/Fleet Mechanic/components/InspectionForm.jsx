import { useState } from 'react'
import { validateFile } from '../../../storage.js'
import { uploadConditionPhoto, api } from '../../../api.js'
import Modal from '../../../components/ui/Modal.jsx'
import Icon from '../../../components/ui/Icon.jsx'

export default function InspectionForm({ operations, initial, onClose, onDone }) {
  const initialType = initial.type || (operations.bookings.some(b => b.vehicleId === initial.vehicleId && ['Pending Approval', 'Ready for Dispatch'].includes(b.status)) || !initial.vehicleId ? 'pre-dispatch' : 'clearance')
  const [type, setType] = useState(initialType), [vehicleId, setVehicleId] = useState(initial.booking?.vehicleId || initial.vehicleId || operations.fleet[0].id)
  const [bookingId, setBookingId] = useState(initial.booking?.id || ''), [outcome, setOutcome] = useState('approved')
  const [damageFlag, setDamageFlag] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const vehicle = operations.fleet.find(v => v.id === vehicleId)
  const eligible = operations.bookings.filter(b => b.vehicleId === vehicleId && (type === 'pre-dispatch' ? ['Pending Approval', 'Ready for Dispatch'].includes(b.status) : b.status === 'Completed' && b.returnedAt))
  const chosen = eligible.find(b => b.id === bookingId) || eligible[0]

  async function submit(event) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError('')
    try {
      const files = ['exterior', 'interior'].map(view => ({ view, file: data.get(`${view}Photo`) }))
      for (const { file } of files) { const problem = validateFile(file); if (problem || !file.type.startsWith('image/')) throw new Error(problem || 'Upload an exterior photo and a separate interior photo.') }
      const photos = []
      for (const { view, file } of files) { const photo = await uploadConditionPhoto(vehicleId, file); photos.push({ id: photo.id, view }) }
      const res = await api('/mechanic/inspections', {
        method: 'POST',
        body: {
          vehicleId, vehicleVersion: vehicle.version, type, bookingId: type === 'clearance' ? null : chosen?.id, version: chosen?.version,
          odometer: Number(data.get('odometer')), fuelLevel: Number(data.get('fuelLevel')),
          tirePressure: Object.fromEntries(['frontLeft', 'frontRight', 'rearLeft', 'rearRight'].map(k => [k, Number(data.get(k))])),
          cleanliness: data.get('cleanliness'), scratches: data.get('scratches'), note: data.get('note'),
          outcome, damageFlag,
          checks: Object.fromEntries(['tyres', 'controls', 'exterior', 'interior', 'fuel'].map(k => [k, data.get(k) === 'on'])),
          photos
        }
      })
      await onDone(outcome === 'unsafe' ? 'Inspection recorded. The vehicle is Out of Service and release is blocked.' : res.cleanReturn ? 'Clean return verified! Security deposit automatically scheduled for Auto-Release (24–48h).' : 'Digital inspection and condition photos saved.')
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const [damageZones, setDamageZones] = useState([])

  const ZONES = [
    { id: 'front-bumper', label: 'Front Bumper / Grille' },
    { id: 'hood-windshield', label: 'Hood & Windshield' },
    { id: 'left-front', label: 'Left Front Door / Fender' },
    { id: 'left-rear', label: 'Left Rear Door / Quarter' },
    { id: 'rear-bumper', label: 'Rear Bumper & Trunk' },
    { id: 'right-rear', label: 'Right Rear Door / Quarter' },
    { id: 'right-front', label: 'Right Front Door / Fender' },
    { id: 'roof', label: 'Roof & Pillars' },
    { id: 'cabin', label: 'Interior Cabin / Upholstery' }
  ]

  function toggleZone(zoneId) {
    const next = damageZones.includes(zoneId) ? damageZones.filter(z => z !== zoneId) : [...damageZones, zoneId]
    setDamageZones(next)
    if (next.length > 0) {
      setDamageFlag(true)
      const names = next.map(id => ZONES.find(z => z.id === id)?.label).join(', ')
      const form = document.querySelector('.staff-form')
      if (form?.elements.scratches) form.elements.scratches.value = `Documented damage on: ${names}`
    } else {
      setDamageFlag(false)
      const form = document.querySelector('.staff-form')
      if (form?.elements.scratches) form.elements.scratches.value = 'No visible scratches or new exterior damage.'
    }
  }

  function handleFastFill() {
    const form = document.querySelector('.staff-form')
    if (!form) return
    const setVal = (name, val) => { const el = form.elements[name]; if (el) el.value = val }
    setVal('odometer', vehicle?.odometer || 14000)
    setVal('fuelLevel', 100)
    ;['frontLeft', 'frontRight', 'rearLeft', 'rearRight'].forEach(k => setVal(k, 33))
    setVal('scratches', 'Vehicle verified clean and free of new exterior damage.')
    setVal('cleanliness', 'Clean')
    setVal('note', 'Nominal pre-dispatch safety checklist verified and cleared.')
    ;['tyres', 'controls', 'exterior', 'interior', 'fuel'].forEach(k => {
      const el = form.elements[k]
      if (el) el.checked = true
    })
    setOutcome('approved')
    setDamageFlag(false)
    setDamageZones([])
  }

  return <Modal title="Digital vehicle inspection" eyebrow="FLEET MECHANIC · CHECKLIST & PHOTO PROOF" wide onClose={onClose}><form className="staff-form" onSubmit={submit}><fieldset disabled={busy}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', background: '#f9fafb', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
      <div>
        <strong style={{ fontSize: '13px', display: 'block', color: '#111827' }}>Speed up inspection workflow:</strong>
        <span style={{ fontSize: '12px', color: '#6b7280' }}>Pre-fills standard nominal readings (100% fuel, 33 PSI, clean interior, all checks verified).</span>
      </div>
      <button type="button" className="button button-outline" onClick={handleFastFill} style={{ fontSize: '12px', padding: '6px 12px' }}>
        <Icon name="bolt" size={15} />
        1-Click Checklist Fill
      </button>
    </div>
    <div className="form-grid"><label className="form-field">Inspection type<select value={type} onChange={e => setType(e.target.value)}><option value="pre-dispatch">Pre-dispatch / handover</option><option value="post-return">Post-return</option><option value="clearance">Safety / maintenance clearance</option></select></label><label className="form-field">Vehicle<select value={vehicleId} onChange={e => { setVehicleId(e.target.value); setBookingId('') }}>{operations.fleet.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>{type !== 'clearance' && <label className="form-field span-2">Reservation<select required value={chosen?.id || ''} onChange={e => setBookingId(e.target.value)}><option value="" disabled>Select a reservation</option>{eligible.map(b => <option value={b.id} key={b.id}>{b.id} · {b.start} – {b.end} · {b.status}</option>)}</select></label>}</div>
    {type !== 'clearance' && !eligible.length && <p className="info-note">No eligible reservation for this vehicle and inspection type. Use a safety clearance inspection for service work.</p>}
    {type === 'post-return' && <p className="info-note"><Icon name="shield" size={16} /><span><strong>Auto-Release Deposit Rule:</strong> Marking a post-return inspection Safe, Clean, with 100% fuel and zero damage flags automatically releases the customer’s deposit (24–48h window) without requiring manager intervention.</span></p>}
    <h3>01 / Readings at the vehicle</h3><div className="form-grid" key={vehicleId}><label className="form-field">Odometer (km)<input type="number" name="odometer" required min={vehicle?.odometer || 0} max="10000000" step="0.01" defaultValue={vehicle?.odometer ?? ''} /></label><label className="form-field">{vehicleId === 'tesla-3' ? 'Battery charge' : 'Fuel level'} (%)<input type="number" name="fuelLevel" required min="0" max="100" step="0.01" defaultValue="100" /></label>{[['frontLeft', 'Front left'], ['frontRight', 'Front right'], ['rearLeft', 'Rear left'], ['rearRight', 'Rear right']].map(([key, label]) => <label className="form-field" key={key}>{label} tire pressure (PSI)<input name={key} type="number" required min="0" max="100" step="0.1" defaultValue="33" /></label>)}</div>
    <h3>02 / Condition & mandatory checks</h3>
    <div style={{ marginBottom: '14px', background: '#f9fafb', padding: '12px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#374151' }}>Interactive 2D Damage Zone Locator:</span>
        <span style={{ fontSize: '11px', color: damageZones.length ? '#b91c1c' : '#059669', fontWeight: 600 }}>
          {damageZones.length ? `${damageZones.length} defect zone(s) marked` : 'All zones clear'}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '6px' }}>
        {ZONES.map(z => {
          const marked = damageZones.includes(z.id)
          return (
            <button
              key={z.id}
              type="button"
              onClick={() => toggleZone(z.id)}
              style={{
                fontSize: '11px',
                padding: '6px 8px',
                borderRadius: '6px',
                border: marked ? '1px solid #ef4444' : '1px solid #d1d5db',
                background: marked ? '#fee2e2' : '#ffffff',
                color: marked ? '#991b1b' : '#374151',
                cursor: 'pointer',
                textAlign: 'center',
                fontWeight: marked ? 600 : 400
              }}
            >
              {marked ? '⚠️ ' : ''}{z.label}
            </button>
          )
        })}
      </div>
    </div>
    <label className="form-field">Exterior scratches / condition<textarea name="scratches" required maxLength={1500} rows={2} placeholder="Describe each scratch and its location, or record no visible damage." defaultValue="No visible scratches or new exterior damage." /></label><label className="form-field">Interior cleanliness<select name="cleanliness"><option>Clean</option><option>Needs cleaning</option><option>Damaged</option></select></label>
    {type === 'post-return' && <label className="checkbox-label"><input type="checkbox" checked={damageFlag} onChange={e => setDamageFlag(e.target.checked)} />Flag return damage / dispute (holds deposit for Operations Manager exception review)</label>}
    <div className="staff-checklist">{[['tyres', 'Tires inspected and all four pressures recorded'], ['controls', 'Brakes, lights, controls, and safety equipment inspected'], ['exterior', 'Exterior scratches and existing damage documented'], ['interior', 'Interior cleanliness and condition assessed'], ['fuel', 'Fuel / battery level and mileage read at the vehicle']].map(([key, label]) => <label className="checkbox-label" key={key}><input type="checkbox" name={key} required />{label}</label>)}</div>
    <h3>03 / Condition photo proof</h3><p className="workspace-muted">Upload separate exterior and interior photos taken for this handover or return. JPG, PNG, or WebP; up to 5 MB each.</p><div className="form-grid">{['exterior', 'interior'].map(view => <label className="form-field staff-photo-input" key={view}><Icon name="camera" size={24} />{view === 'exterior' ? 'Exterior photo' : 'Interior photo'}<input type="file" name={`${view}Photo`} accept="image/jpeg,image/png,image/webp" required /></label>)}</div>
    <h3>04 / Inspection outcome</h3><label className="form-field">Release assessment<select value={outcome} onChange={e => setOutcome(e.target.value)}><option value="approved">Safe / inspection approved</option><option value="unsafe">Unsafe / put Out of Service</option></select></label><label className="form-field">Inspection notes {outcome === 'unsafe' && '(required)'}<textarea name="note" maxLength={1500} required={outcome === 'unsafe'} rows={3} placeholder="Record observations and required repairs." /></label>{error && <p className="error-banner" role="alert">{error}</p>}<button className="button button-dark full-width" disabled={busy || type !== 'clearance' && !chosen}><Icon name="check" size={18} />{busy ? 'Uploading proof & saving…' : 'Save inspection & photo proof'}</button>
  </fieldset></form></Modal>
}

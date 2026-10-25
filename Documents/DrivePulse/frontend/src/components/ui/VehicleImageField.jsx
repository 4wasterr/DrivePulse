import ValidatedField from './ValidatedField.jsx'
import { useEffect, useRef, useState } from 'react'

export default function VehicleImageField({ image, onChange, disabled }) {
  const [preview, setPreview] = useState(''), [error, setError] = useState('')
  const objectURL = useRef(null)
  useEffect(() => () => { if (objectURL.current) URL.revokeObjectURL(objectURL.current) }, [])
  return <div className="vehicle-image-field">
    {(preview || image) && <img src={preview || image} alt="Vehicle profile preview" />}
    <label className="form-field">Vehicle profile photo
      <ValidatedField type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={e => {
        const file = e.target.files?.[0]
        setError('')
        if (file && (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 4 * 1024 * 1024 || !file.size)) { setError('Choose a JPG, PNG, or WebP image up to 4 MB.'); e.target.value = ''; return }
        if (objectURL.current) URL.revokeObjectURL(objectURL.current)
        objectURL.current = file ? URL.createObjectURL(file) : null
        setPreview(objectURL.current || ''); onChange(file || null)
      }} />
      <small>JPG, PNG or WebP · up to 4 MB</small>
    </label>
    {error && <p className="error-banner" role="alert">{error}</p>}
  </div>
}

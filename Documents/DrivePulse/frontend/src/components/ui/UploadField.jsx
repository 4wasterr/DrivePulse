import ValidatedField from './ValidatedField.jsx'
import { useId, useState } from 'react'
import { validateFile } from '../../storage.js'
import { uploadDocument } from '../../api.js'
import Icon from './Icon.jsx'

export default function UploadField({ documentId, label, value, onUpload, bookingId }) {
  const inputId = useId()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function upload(file) {
    const problem = validateFile(file)
    if (problem) { setError(problem); return }
    setBusy(true)
    setError('')
    try {
      const uploaded = await uploadDocument(documentId, file, bookingId)
      await onUpload(uploaded)
    } catch (problem) { setError(problem.message || 'Your file could not be uploaded. Please try again.') }
    finally { setBusy(false) }
  }
  return <div className="upload-group">
    <label className={`upload-field ${value ? 'uploaded' : ''} ${busy ? 'is-busy' : ''}`} htmlFor={inputId} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) upload(e.dataTransfer.files[0]) }}>
      <span className="upload-symbol"><Icon name={value ? 'check' : 'upload'} size={21} /></span>
      <span className="upload-copy"><strong>{label}</strong><span>{busy ? 'Saving your file…' : value ? value.name : 'Drop a file here or click to browse'}</span></span>
      <span className="upload-action">{value ? 'Replace' : 'Upload'}<Icon name="diagonal" size={15} /></span>
    </label>
    <ValidatedField className="sr-only" id={inputId} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={busy} onChange={e => { upload(e.target.files[0]); e.target.value = '' }} />
    {error && <p className="field-error" role="alert">{error}</p>}
  </div>
}

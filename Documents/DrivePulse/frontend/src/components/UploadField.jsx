import { useId, useState } from 'react'
import Icon from './Icon'
import { putDocument, validateFile } from '../storage'

export default function UploadField({ documentId, label, value, onUpload }) {
  const inputId = useId()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function upload(file) {
    const problem = validateFile(file)
    if (problem) { setError(problem); return }
    setBusy(true)
    setError('')
    try {
      await putDocument(documentId, file)
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
      const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
      onUpload({ id: documentId, name: file.name, size: file.size, fingerprint, uploadedAt: new Date().toISOString() })
    } catch { setError('This browser could not save the file. Please allow local storage and try again.') }
    finally { setBusy(false) }
  }
  return <div className="upload-group">
    <label className={`upload-field ${value ? 'uploaded' : ''} ${busy ? 'is-busy' : ''}`} htmlFor={inputId} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) upload(e.dataTransfer.files[0]) }}>
      <span className="upload-symbol"><Icon name={value ? 'check' : 'upload'} size={21} /></span>
      <span className="upload-copy"><strong>{label}</strong><span>{busy ? 'Saving your file…' : value ? value.name : 'Drop a file here or click to browse'}</span></span>
      <span className="upload-action">{value ? 'Replace' : 'Upload'}<Icon name="diagonal" size={15} /></span>
    </label>
    <input className="sr-only" id={inputId} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={busy} onChange={e => { upload(e.target.files[0]); e.target.value = '' }} />
    {error && <p className="field-error" role="alert">{error}</p>}
  </div>
}

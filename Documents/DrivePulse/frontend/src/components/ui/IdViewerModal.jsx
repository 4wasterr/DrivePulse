import { useState, useEffect } from 'react'
import { fetchDocument } from '../../api.js'
import { downloadFile } from '../../storage.js'
import Modal from './Modal.jsx'
import Icon from './Icon.jsx'

export default function IdViewerModal({ document: doc, onClose }) {
  const [state, setState] = useState({ file: null, error: '', loading: Boolean(doc.id) })
  const [attempt, setAttempt] = useState(0)
  const sample = doc.kind === 'license' ? 'license' : doc.kind === 'government-2' ? 'billing' : 'id'
  useEffect(() => {
    if (!doc.id) return
    const controller = new AbortController()
    let url
    fetchDocument(doc.id, { signal: controller.signal }).then(blob => {
      if (controller.signal.aborted) return
      url = URL.createObjectURL(blob)
      setState({ file: { url, blob, isImage: blob.type.startsWith('image/') }, loading: false, error: '' })
    }).catch(error => { if (!controller.signal.aborted) setState({ file: null, loading: false, error: error.message }) })
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [doc.id, attempt])
  const retry = () => { setState({ file: null, error: '', loading: true }); setAttempt(value => value + 1) }
  const { file, error, loading } = state
  return <Modal title={doc.label || doc.name || 'Sample document'} eyebrow="DOCUMENT PREVIEW" wide onClose={onClose}>
    <div className="id-popup-container">
      {loading && <div className="id-popup-loading" role="status"><span className="loading-line" /><p>Loading private document…</p></div>}
      {error && <div className="error-banner" role="alert"><Icon name="info" size={18} /><span>{error}</span><button className="button button-outline" onClick={retry}>Retry document</button></div>}
      {!loading && !file && <div className="document-sample"><p className="info-note" role="status">SAMPLE ONLY — preview for testing. This is not the client’s document and cannot be used to verify their identity.</p><img src={`/images/documents/sample-${sample}.svg`} alt={`Sample ${sample} document. Not valid for identification.`} /></div>}
      {file && <div className="id-popup-content"><div className="id-popup-frame-wrap">
        {file.isImage ? <img src={file.url} alt={`Document: ${doc.name}`} className="id-popup-image" onError={() => setState({ file: null, loading: false, error: 'This image is damaged or cannot be displayed. Ask the client to upload a new copy.' })} /> : <iframe src={file.url} title={`Document: ${doc.name}`} className="id-popup-iframe" />}
      </div><div className="id-popup-footer"><div className="id-popup-meta"><strong>{doc.name}</strong>{doc.uploadedAt && <small>Uploaded {new Date(doc.uploadedAt).toLocaleDateString('en-PH', { dateStyle: 'medium' })}</small>}</div><button className="button button-outline" onClick={() => downloadFile(file.blob, doc.name)}><Icon name="download" size={16} />Download file</button></div></div>}
    </div>
  </Modal>
}

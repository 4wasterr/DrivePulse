import { useState, useEffect } from 'react'
import { fetchDocument } from '../../api.js'
import { downloadFile } from '../../storage.js'
import Modal from './Modal.jsx'
import Icon from './Icon.jsx'

export default function IdViewerModal({ document: doc, onClose }) {
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    let objectUrl = null

    fetchDocument(doc.id)
      .then(blob => {
        if (!active) return
        objectUrl = URL.createObjectURL(blob)
        setFile({ url: objectUrl, blob, isImage: blob.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(doc.name) })
      })
      .catch(err => {
        if (active) setError(err.message || 'Unable to display this document.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [doc.id, doc.name])

  return (
    <Modal
      title={doc.label || doc.name}
      eyebrow={doc.kind ? `VERIFIED ID · ${String(doc.kind).toUpperCase()}` : 'DOCUMENT PREVIEW'}
      wide
      onClose={onClose}
    >
      <div className="id-popup-container">
        {loading && (
          <div className="id-popup-loading" role="status">
            <span className="loading-line" />
            <p>Loading document image…</p>
          </div>
        )}

        {error && (
          <div className="error-banner" role="alert">
            <Icon name="info" size={18} />
            <span>{error}</span>
          </div>
        )}

        {file && (
          <div className="id-popup-content">
            <div className="id-popup-frame-wrap">
              {file.isImage ? (
                <img
                  src={file.url}
                  alt={`ID: ${doc.name}`}
                  className="id-popup-image"
                />
              ) : (
                <iframe
                  src={file.url}
                  title={`ID: ${doc.name}`}
                  className="id-popup-iframe"
                />
              )}
            </div>
            <div className="id-popup-footer">
              <div className="id-popup-meta">
                <strong>{doc.name}</strong>
                {doc.uploadedAt && <small>Uploaded {new Date(doc.uploadedAt).toLocaleDateString('en-PH', { dateStyle: 'medium' })}</small>}
              </div>
              <button
                className="button button-outline"
                onClick={() => downloadFile(file.blob, doc.name)}
              >
                <Icon name="download" size={16} />
                Download file
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}


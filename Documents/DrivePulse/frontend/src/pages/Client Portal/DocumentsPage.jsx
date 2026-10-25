import { PaginatedList } from '../../components/ui/Pagination.jsx'
import { useState } from 'react'
import { requiredDocuments, prettyDate } from '../../data.js'
import UploadField from '../../components/ui/UploadField.jsx'
import Icon from '../../components/ui/Icon.jsx'
import IdViewerModal from '../../components/ui/IdViewerModal.jsx'
import { vehicleFor } from '../../utils/vehicles.js'
import { BookingRecords } from '../../components/operations/OperationalRecords.jsx'

export default function ClientDocumentsPage({ documentCount, documents, onDocument, downloadDocument, bookings }) {
  const [viewingDoc, setViewingDoc] = useState(null)

  return (
    <>
      <div className="documents-layout">
        <section className="surface-card documents-card">
          <div className="section-heading">
            <div>
              <span className="eyebrow">MANDATORY RENTER VERIFICATION</span>
              <h2>Your travel identification documents</h2>
            </div>
            <span className="count-pill">{documentCount} of 3 uploaded</span>
          </div>
          <p className="muted">
            DrivePulse requires 3 distinct official identification files before vehicle dispatch: your official driver’s license and two separate government IDs or proof of address. Files can be JPG, PNG, WebP or PDF, up to 4 MB each.
          </p>
          <div className="document-completion">
            <span style={{ width: `${(documentCount / 3) * 100}%` }} />
          </div>

          <div className="upload-stack">
            {requiredDocuments.map(doc => {
              const uploaded = documents[doc.id]
              return (
                <div key={doc.id} className="document-item-box">
                  <div className="document-spec-header">
                    <div>
                      <h3>{doc.label}</h3>
                      <p className="document-spec-desc">{doc.description}</p>
                      {doc.examples && <small className="document-spec-examples">Accepted: {doc.examples}</small>}
                    </div>
                    <span className={`status-pill ${uploaded ? 'status-pill-ok' : 'status-pill-pending'}`}>
                      {uploaded ? 'Uploaded' : 'Unfilled / Required'}
                    </span>
                  </div>

                  <UploadField
                    documentId={doc.id}
                    label={uploaded ? `Replace ${doc.label}` : `Upload ${doc.label}`}
                    value={uploaded}
                    onUpload={value => onDocument(doc.id, value)}
                  />

                  {uploaded && (
                    <div className="uploaded-meta">
                      <span>
                        <Icon name="check" size={14} />
                        {uploaded.name} · Uploaded {new Date(uploaded.uploadedAt).toLocaleDateString('en-PH', { dateStyle: 'medium' })}
                      </span>
                      <div className="uploaded-actions">
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => setViewingDoc({ id: uploaded.id, name: uploaded.name, kind: doc.id, label: doc.label, uploadedAt: uploaded.uploadedAt })}
                        >
                          <Icon name="eye" size={14} />
                          View ID photo
                        </button>
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => downloadDocument(doc.id)}
                        >
                          <Icon name="download" size={14} />
                          Download
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        <aside className="document-guidance">
          <span className="guidance-icon"><Icon name="shield" size={30} /></span>
          <p className="eyebrow">VERIFICATION GUIDELINES</p>
          <h2>Good to go,<br />from the get-go.</h2>
          <ul>
            <li><Icon name="check" size={17} />Ensure full document is visible with all four corners.</li>
            <li><Icon name="check" size={17} />Name and photo must match your account details.</li>
            <li><Icon name="check" size={17} />Must be valid and not expired at the time of rental.</li>
            <li><Icon name="check" size={17} />All three uploads must be completely different documents.</li>
          </ul>
          <div className="info-note">
            <Icon name="info" size={18} />
            <span>
              <strong>Identity Privacy & Protection:</strong> Customer identity documents are strictly isolated and only accessible to authorized Booking Agents during pre-dispatch review.
            </span>
          </div>
        </aside>
      </div>

      <section className="surface-card generated-documents">
        <div className="section-heading">
          <div>
            <span className="eyebrow">OFFICIAL RENTAL CONTRACTS & RECEIPTS</span>
            <h2>Rental agreements and financial records</h2>
          </div>
        </div>
        <p className="muted">
          Your official rental agreement governs rental duration, daily rates, cash deposit auto-release criteria, and handover terms. Official release and return receipts are issued upon physical dispatch and inspection.
        </p>

        {bookings.length ? (
          <PaginatedList>{bookings.map(b => (
            <div className="generated-row" key={b.id}>
              <span className="file-symbol"><Icon name="file" /></span>
              <div>
                <strong>{vehicleFor(b).name}</strong>
                <small>{b.id} · {prettyDate(b.start)} to {prettyDate(b.end)}{b.sample ? ' · Sample' : ''} · {b.status}</small>
              </div>
              <BookingRecords booking={b} />
            </div>
          ))}</PaginatedList>
        ) : (
          <p className="workspace-muted">No reservations on file yet. Book a vehicle to generate your official rental contract.</p>
        )}
        <p className="small muted">Downloads are official printable HTML documents with cryptographic digest (SHA-256). Open any record and choose Print → Save as PDF for an archived PDF copy.</p>
      </section>

      {viewingDoc && (
        <IdViewerModal
          document={viewingDoc}
          onClose={() => setViewingDoc(null)}
        />
      )}
    </>
  )
}

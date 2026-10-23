import { vehicles, prettyDate } from './data'
import { downloadFile } from './storage'
import { generateQRCodeSVG } from './utils/qr'

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))

export function downloadPass(booking) {
  if (!booking.dispatchPass || booking.dispatchPass.revokedAt || ['Cancelled', 'Completed'].includes(booking.status)) return
  const vehicle = vehicles.find(v => v.id === booking.vehicleId) || { name: 'Fleet Vehicle', color: 'Standard' }
  const pass = booking.dispatchPass
  const qrData = `DP-PASS:${pass.id}:${booking.id}:${vehicle.name}:${pass.issuedAt}`
  const qrSvg = generateQRCodeSVG(qrData, { size: 140 })

  const details = [
    ['PASS REFERENCE', pass.id],
    ['BOOKING', booking.id],
    ['CUSTOMER', booking.renter.name],
    ['VEHICLE', `${vehicle.name} · ${vehicle.color}`],
    ['PICK-UP', `${prettyDate(booking.start, { year: 'numeric' })} · ${booking.startTime} PHT`],
    ['RETURN', `${prettyDate(booking.end, { year: 'numeric' })} · ${booking.endTime} PHT`],
    ['PICK-UP LOCATION', booking.pickup],
    ['RETURN LOCATION', booking.dropoff],
    ['ISSUED BY', pass.issuedBy],
    ['ISSUED AT', new Date(pass.issuedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) + ' PHT']
  ]

  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dispatch Pass ${escape(pass.id)}</title><style>body{font:16px/1.6 system-ui,sans-serif;color:#111;max-width:820px;margin:48px auto;padding:30px}header{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:22px}h1{font-size:44px;letter-spacing:-2px;margin-bottom:8px}.tag{background:#111;color:#fff;padding:6px 14px;border-radius:5px;font-size:13px}.layout{display:flex;gap:36px;align-items:flex-start;margin:32px 0}dl{display:grid;grid-template-columns:1fr 1fr;gap:24px;flex:1;margin:0}dt{font-size:11px;letter-spacing:1px;color:#666}dd{margin:6px 0 0;font-size:17px}.qr-box{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;text-align:center}.qr-box p{margin:8px 0 0;font-size:11px;letter-spacing:1px;color:#6b7280;font-weight:600}footer{border-top:1px solid #ddd;padding-top:22px;font-size:13px;color:#666}.checks{background:#f2f2f2;padding:22px;border-radius:6px;margin-bottom:28px}@media print{body{margin:0}}@media(max-width:650px){.layout{flex-direction:column}dl{grid-template-columns:1fr}}</style><header><strong>drivepulse.</strong><span class="tag">DISPATCH AUTHORIZED</span></header><h1>Dispatch Pass</h1><p>Release authorization for the verified reservation below.</p><div class="layout"><dl>${details.map(([label, value]) => `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl><div class="qr-box">${qrSvg}<p>GATE SCAN CODE</p></div></div><div class="checks">Identity documents approved · Rental payment verified · Security deposit recorded · Vehicle inspection approved</div><footer>Development copy. Verify the current pass reference and booking status in DrivePulse before releasing a vehicle. A downloaded copy does not reflect later cancellations or adjustments.<br>Use Print → Save as PDF for a PDF copy.</footer></html>`
  downloadFile(html, `${pass.id}-dispatch-pass.html`, 'text/html')
}

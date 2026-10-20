import { useState, useEffect } from 'react'
import { dateISO, prettyDate, money } from '../../data.js'
import { api } from '../../api.js'
import { vehicleName, fmt } from '../../utils/workspace.js'
import { downloadFile } from '../../storage.js'
import Icon from '../../components/ui/Icon.jsx'
import MaintenanceList from '../../components/operations/MaintenanceList.jsx'
import Tag from '../../components/workspace/StaffTag.jsx'
import Empty from '../../components/workspace/StaffEmpty.jsx'

export default function Analytics() {
  const [start, setStart] = useState(() => dateISO(-29)), [end, setEnd] = useState(dateISO), [period, setPeriod] = useState(() => ({ start: dateISO(-29), end: dateISO() }))
  const [result, setResult] = useState({ data: null, error: '', busy: true })
  useEffect(() => {
    let active = true
    api(`/manager/analytics?start=${period.start}&end=${period.end}`).then(data => { if (active) setResult({ data, error: '', busy: false }) }).catch(e => { if (active) setResult({ data: null, error: e.message, busy: false }) })
    return () => { active = false }
  }, [period])
  const data = result.data
  function exportReport() {
    const rows = [
      ['DrivePulse macro operations report', data.start, data.end],
      ['Measure', 'Value'],
      ['Fleet utilization (%)', data.utilization],
      ['Confirmed rental receipts (PHP)', data.revenue],
      ['Cancelled rental refunds (PHP)', data.refunds],
      ['Net rental revenue (PHP)', data.revenue - data.refunds],
      ['Security deposit releases (PHP)', data.depositReleases],
      ['Auto-released clean-return deposits (PHP)', data.autoReleasedDeposits || 0],
      ['Maintenance expenditure (PHP)', data.maintenanceCost],
      [],
      ['Vehicle', 'Daily Rate (PHP)', 'Rented days', 'Utilization (%)', 'Rental receipts (PHP)', 'Refunds (PHP)', 'Net revenue (PHP)', 'Maintenance (PHP)'],
      ...data.vehicles.map(v => [v.name, v.rate, v.rentalDays, v.utilization, v.revenue, v.refunds, v.netRevenue, v.maintenanceCost]),
      [],
      ['Maintenance vehicle', 'Type', 'Description', 'Cost (PHP)', 'Invoice', 'Completed at'],
      ...data.maintenance.map(m => [vehicleName(m.vehicleId), m.type, m.description, m.cost, m.reference, m.completedAt]),
      [],
      ['Driver risk', 'Reservation', 'Severity', 'Description', 'Status', 'Logged at', 'Override reason'],
      ...data.risks.map(r => [r.driver, r.bookingId, r.severity, r.description, r.status, r.at, r.reason || '']),
    ]
    const cell = value => `"${String(value ?? '').replace(/^[=+\-@\t\r]/, "'$&").replaceAll('"', '""')}"`
    downloadFile('\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n'), `DrivePulse-report-${data.start}-${data.end}.csv`, 'text/csv;charset=utf-8')
  }
  return <>
    <section className="workspace-surface staff-section">
      <form className="staff-report-toolbar" onSubmit={e => { e.preventDefault(); setResult(previous => ({ ...previous, busy: true, error: '' })); setPeriod({ start, end }) }}>
        <label className="form-field">From<input type="date" required value={start} max={end} onChange={e => setStart(e.target.value)} /></label>
        <label className="form-field">Through<input type="date" required value={end} min={start} max={dateISO()} onChange={e => setEnd(e.target.value)} /></label>
        <button className="button button-dark" disabled={result.busy}>Generate report<Icon name="chart" size={17} /></button>
        <button type="button" className="button button-outline" disabled={!data || result.busy} onClick={exportReport}>Export CSV<Icon name="download" size={17} /></button>
      </form>
      {result.error && <p className="error-banner" role="alert">{result.error}</p>}
      {result.busy && <p role="status" className="workspace-muted">Preparing macro dashboard…</p>}
    </section>
    {data && <>
      <p className="workspace-muted staff-caption">Reporting period: {prettyDate(data.start, { year: 'numeric' })} – {prettyDate(data.end, { year: 'numeric' })} · {data.days} days</p>
      <div className="staff-metrics">
        {[
          ['Fleet utilization', `${data.utilization}%`, 'road'],
          ['Net rental revenue', money(data.revenue - data.refunds), 'wallet'],
          ['Maintenance costs', money(data.maintenanceCost), 'settings'],
          ['Driver risk summaries', data.risks.length, 'shield']
        ].map(([label, value, icon]) => <div className="agent-stat" key={label}><span><Icon name={icon} /></span><strong className="staff-value">{value}</strong><span>{label}</span></div>)}
      </div>
      <section className="workspace-surface staff-section">
        <div className="workspace-section-heading"><div><p className="workspace-kicker">MACRO PERFORMANCE BY VEHICLE</p><h2>Utilization, revenue & upkeep</h2></div></div>
        <div className="agent-table-scroll">
          <table className="agent-table">
            <thead><tr><th>Vehicle</th><th>Daily rate</th><th>Utilization</th><th>Rental receipts</th><th>Refunds</th><th>Net revenue</th><th>Maintenance</th></tr></thead>
            <tbody>{data.vehicles.map(v => <tr key={v.id}><td><strong>{v.name}</strong><small>{v.rentalDays} days rented</small></td><td>{money(v.rate)}</td><td><strong>{v.utilization}%</strong><div className="staff-utilization-bar"><span style={{ width: `${Math.min(100, v.utilization)}%` }} /></div></td><td>{money(v.revenue)}</td><td>{money(v.refunds)}</td><td><strong>{money(v.netRevenue)}</strong></td><td>{money(v.maintenanceCost)}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="workspace-muted staff-caption">{data.note}</p>
        <p className="workspace-muted">Security deposit releases: {money(data.depositReleases)} (Auto-released clean returns: {money(data.autoReleasedDeposits || 0)}).</p>
      </section>
      <section className="workspace-surface staff-section"><h2>Maintenance cost summary</h2><MaintenanceList records={data.maintenance} /></section>
      <section className="workspace-surface"><h2>Driver risk summary</h2>{data.risks.length ? data.risks.map(r => <article className="staff-ledger-row" key={r.id}><div><h3>{r.driver} · {r.bookingId}</h3><p>{r.description}</p><small>{fmt(r.at)}</small></div><Tag>{r.severity}</Tag><Tag>{r.status}</Tag></article>) : <Empty>No driver risks logged in this reporting period.</Empty>}</section>
    </>}
  </>
}

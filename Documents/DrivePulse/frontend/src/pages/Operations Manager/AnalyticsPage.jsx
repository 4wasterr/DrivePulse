import ValidatedField from '../../components/ui/ValidatedField.jsx'
import ValidatedForm from '../../components/ui/ValidatedForm.jsx'
import { PaginatedList, PaginatedTable } from '../../components/ui/Pagination.jsx'
import { useState, useEffect } from 'react'
import { dateISO, prettyDate, money } from '../../data.js'
import { api } from '../../api.js'
import { fmt } from '../../utils/workspace.js'
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
  return <>
    <section className="workspace-surface staff-section">
      <ValidatedForm className="staff-report-toolbar" validation="report" onSubmit={e => { e.preventDefault(); setResult(previous => ({ ...previous, busy: true, error: '' })); setPeriod({ start, end }) }}>
        <label className="form-field">From<ValidatedField name="start" type="date" required value={start} max={end} onChange={e => setStart(e.target.value)} /></label>
        <label className="form-field">Through<ValidatedField name="end" type="date" required value={end} min={start} max={dateISO()} onChange={e => setEnd(e.target.value)} /></label>
        <button className="button button-dark" disabled={result.busy}>Apply dates<Icon name="chart" size={17} /></button>
      </ValidatedForm>
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
          <PaginatedTable className="agent-table">
            <thead><tr><th>Vehicle</th><th>Daily rate</th><th>Utilization</th><th>Rental receipts</th><th>Payment returns</th><th>Net revenue</th><th>Maintenance</th></tr></thead>
            <tbody>{data.vehicles.map(v => <tr key={v.id}><td><strong>{v.name}</strong><small>{v.fleetCode || v.id}</small><small>{v.rentalDays} days rented</small></td><td>{money(v.rate)}</td><td><strong>{v.utilization}%</strong><div className="staff-utilization-bar"><span style={{ width: `${Math.min(100, v.utilization)}%` }} /></div></td><td>{money(v.revenue)}</td><td>{money(v.refunds)}</td><td><strong>{money(v.netRevenue)}</strong></td><td>{money(v.maintenanceCost)}</td></tr>)}</tbody>
          </PaginatedTable>
        </div>
        <p className="workspace-muted staff-caption">{data.note}</p>
        <p className="workspace-muted">Security deposit releases: {money(data.depositReleases)} (Auto-released clean returns: {money(data.autoReleasedDeposits || 0)}).</p>
      </section>
      <section className="workspace-surface staff-section"><h2>Maintenance cost summary</h2><MaintenanceList records={data.maintenance} /></section>
      <section className="workspace-surface"><h2>Driver risk summary</h2>{data.risks.length ? <PaginatedList>{data.risks.map(r => <article className="staff-ledger-row" key={r.id}><div><h3>{r.driver} · {r.bookingId}</h3><p>{r.description}</p><small>{fmt(r.at)}</small></div><Tag>{r.severity}</Tag><Tag>{r.status}</Tag></article>)}</PaginatedList> : <Empty>No driver risks logged in this reporting period.</Empty>}</section>
    </>}
  </>
}

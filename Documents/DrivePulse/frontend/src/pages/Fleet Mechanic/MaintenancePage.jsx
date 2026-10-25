import { useState } from 'react'
import Tag from '../../components/workspace/StaffTag.jsx'
import MaintenanceList from '../../components/operations/MaintenanceList.jsx'
import Icon from '../../components/ui/Icon.jsx'
import { api } from '../../api.js'
import { filterMaintenance } from '../../utils/maintenance.js'

const tabs = [['active', 'Active Work Orders'], ['completed', 'Completed / Repaired'], ['archived', 'Archived']]
export default function MaintenancePage({ openWork, maintenance, setDialog, onDone }) {
  const [tab, setTab] = useState('active'), [query, setQuery] = useState(''), [start, setStart] = useState(''), [end, setEnd] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const invalidRange = start && end && start > end
  const shown = filterMaintenance(maintenance, { tab, query, start, end })
  async function archive(record, restore = false) {
    setBusy(true); setError('')
    try {
      await api('/mechanic/maintenance/' + record.id + (restore ? '/restore' : '/archive'), { method: 'POST', body: { version: record.version } })
      await onDone(restore ? 'Work order restored to Completed / Repaired.' : 'Completed work order archived.')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return <section className="workspace-surface maintenance-board">
    <div className="workspace-section-heading"><div><p className="workspace-kicker">WORK ORDERS & REPAIR LOG</p><h2>Maintenance & service ledger</h2></div><Tag>{openWork.length + ' open'}</Tag></div>
    <div className="pill-tabs" role="group" aria-label="Work order status">{tabs.map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}<span>{filterMaintenance(maintenance, { tab: key }).length}</span></button>)}</div>
    <div className="maintenance-filters">
      <label className="form-field"><span>Search work orders</span><span className="maintenance-search"><Icon name="search" size={18} /><input type="search" placeholder="Work order ID, fleet ID or mechanic" maxLength={150} value={query} onChange={e => setQuery(e.target.value)} /></span></label>
      <label className="form-field"><span>Start Date</span><input type="date" value={start} max={end || undefined} onChange={e => setStart(e.target.value)} /></label>
      <label className="form-field"><span>End Date</span><input type="date" value={end} min={start || undefined} onChange={e => setEnd(e.target.value)} /></label>
      <button className="button button-outline" type="button" onClick={() => { setQuery(''); setStart(''); setEnd('') }}>Clear filters</button>
    </div>
    <p className="workspace-muted">{shown.length} matching records · Date range uses the logged date in Philippine Standard Time.</p>
    {(error || invalidRange) && <p className="error-banner" role="alert">{error || 'End Date must be on or after Start Date.'}</p>}
    <MaintenanceList records={shown} resetKey={tab + query + start + end} onUpdate={m => setDialog({ kind: 'service-update', record: m })} onArchive={m => archive(m)} onRestore={m => archive(m, true)} busy={busy} />
    <p className="workspace-muted staff-caption">Completed work requires a safe clearance inspection before vehicle release. Archiving preserves repair costs, invoices and audit history.</p>
  </section>
}

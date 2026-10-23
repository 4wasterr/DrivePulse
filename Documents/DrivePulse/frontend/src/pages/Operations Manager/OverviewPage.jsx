import Icon from '../../components/ui/Icon.jsx'
import FleetPage from '../../components/operations/FleetPage.jsx'
import Tag from '../../components/workspace/StaffTag.jsx'
import { fmt } from '../../utils/workspace.js'

export default function ManagerOverviewPage({ operations, fleetFilters, onRefresh, setDialog, onSection }) {
  const { fleet, stages, summary = {}, thresholdAlerts = [], flags = [] } = operations
  const pendingDecommissions = fleet.filter(v => v.decommissionRequested)
  const unreviewedOverdue = flags.filter(f => !f.override)

  return <>
    <section className="workspace-surface staff-section">
      <div className="workspace-section-heading">
        <div>
          <p className="workspace-kicker">AGGREGATED MACRO DASHBOARD</p>
          <h2>Operational health at a glance</h2>
        </div>
        <span className="workspace-tag">Automated · By-exception oversight</span>
      </div>
      <div className="staff-metrics">
        <div className="agent-stat">
          <span><Icon name="road" size={21} /></span>
          <strong className="staff-value">{summary.utilization ?? 0}%</strong>
          <span>Fleet utilization</span>
        </div>
        <button type="button" className="agent-stat" onClick={() => fleetFilters.setFilter('Overdue')}>
          <span><Icon name="clock" size={21} /><Icon name="diagonal" size={15} /></span>
          <strong className="staff-value">{summary.overdueCount ?? 0}</strong>
          <span>Units overdue</span>
        </button>
        <button type="button" className="agent-stat" onClick={() => fleetFilters.setFilter('Out of Service')}>
          <span><Icon name="settings" size={21} /><Icon name="diagonal" size={15} /></span>
          <strong className="staff-value">{summary.criticalRepairs ?? 0}</strong>
          <span>Critical repairs & holds</span>
        </button>
        <button type="button" className="agent-stat" onClick={() => onSection('approvals')}>
          <span><Icon name="shield" size={21} /><Icon name="diagonal" size={15} /></span>
          <strong className="staff-value">{summary.pendingExceptions ?? 0}</strong>
          <span>Exceptions awaiting review</span>
        </button>
      </div>
      <div className="staff-metrics fleet-stage-metrics">
        {stages.map(stage => <button type="button" className="agent-stat" key={stage} onClick={() => fleetFilters.setFilter(fleetFilters.filter === stage ? 'All statuses' : stage)}>
          <span><Icon name={stage === 'Overdue' ? 'clock' : 'car'} size={19} /></span>
          <strong>{String(fleet.filter(vehicle => vehicle.status === stage).length).padStart(2, '0')}</strong>
          <span>{stage}</span>
        </button>)}
      </div>
    </section>

    <section className="workspace-surface staff-section">
      <div className="workspace-section-heading">
        <div>
          <p className="workspace-kicker">THRESHOLD ALERTS WIDGET</p>
          <h2>Flagged security & operational exceptions</h2>
        </div>
        <button className="text-link" onClick={() => onSection('audit')}>Forensic audit lookup<Icon name="arrow" size={16} /></button>
      </div>
      {thresholdAlerts.length === 0 && pendingDecommissions.length === 0 && unreviewedOverdue.length === 0 ? (
        <p className="workspace-muted">No suspicious threshold events or unreviewed operational anomalies detected. Normal workflows are running automatically.</p>
      ) : (
        <div>
          {pendingDecommissions.map(v => <article className="staff-ledger-row" key={`decom-${v.id}`}>
            <div>
              <h3>Decommission approval needed · {v.name}</h3>
              <p>Requested by {v.decommissionRequested.by}: {v.decommissionRequested.reason}</p>
              <small>{fmt(v.decommissionRequested.at)}</small>
            </div>
            <Tag>Decommission request</Tag>
            <button className="button button-dark" onClick={() => setDialog({ kind: 'decommission', vehicle: v })}>Confirm decommission</button>
          </article>)}
          {unreviewedOverdue.map(flag => <article className="staff-ledger-row" key={flag.id}>
            <div>
              <h3>Overdue unit · {flag.bookingId}</h3>
              <p>Return due {flag.end} at {flag.endTime} PHT</p>
            </div>
            <Tag>Overdue anomaly</Tag>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="button button-outline" onClick={() => setDialog({ kind: 'flag-override', flag })}>Override alert</button>
              <button className="button button-dark" onClick={() => setDialog({ kind: 'escalate-overdue', bookingId: flag.bookingId })}>Escalate</button>
            </div>
          </article>)}
          {thresholdAlerts.slice(0, 5).map(alert => <article className="staff-ledger-row" key={alert.id}>
            <div>
              <h3>{alert.action} <small>· {alert.resource}</small></h3>
              <p>{alert.detail}</p>
              {(alert.old_value || alert.new_value) && <small>Mutation: {alert.old_value || '—'} → {alert.new_value || '—'}</small>}
              <small>{alert.actor} ({alert.role}) · {fmt(alert.at)}{alert.ip ? ` · IP ${alert.ip}` : ''}</small>
            </div>
            <Tag>{alert.alert_type}</Tag>
          </article>)}
        </div>
      )}
    </section>

    <FleetPage fleet={fleet} stages={stages} mechanic={false} onRefresh={onRefresh} setDialog={setDialog} {...fleetFilters} />
  </>
}

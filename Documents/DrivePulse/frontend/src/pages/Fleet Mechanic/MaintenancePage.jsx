import Tag from '../../components/workspace/StaffTag.jsx'
import MaintenanceList from '../../components/operations/MaintenanceList.jsx'

export default function MaintenancePage({ openWork, maintenance, setDialog }) {
  
  return <section className="workspace-surface"><div className="workspace-section-heading"><h2>Maintenance & service ledger</h2><Tag>{`${openWork.length} open`}</Tag></div><MaintenanceList records={maintenance} onUpdate={m => setDialog({ kind: 'service-update', record: m })} /><p className="workspace-muted staff-caption">Completed work remains on hold until a mechanic completes a safe clearance inspection. Expenditure uses the completed service invoice.</p></section>
}

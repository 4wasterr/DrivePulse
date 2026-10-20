import InspectionQueue from './components/InspectionQueue.jsx'
import ReportList from '../../components/operations/InspectionReports.jsx'

export default function InspectionsPage({ queue, setDialog, inspections }) {
  
  return <><InspectionQueue bookings={queue} onInspect={b => setDialog({ kind: 'inspection', booking: b, type: b.inspectionType })} /><section className="workspace-surface staff-section"><div className="workspace-section-heading"><div><p className="workspace-kicker">CONDITION HISTORY</p><h2>Inspection reports</h2></div><span className="workspace-tag">Manual readings · Photo proof</span></div><ReportList inspections={inspections} onOpen={r => setDialog({ kind: 'report', report: r })} /></section></>
}

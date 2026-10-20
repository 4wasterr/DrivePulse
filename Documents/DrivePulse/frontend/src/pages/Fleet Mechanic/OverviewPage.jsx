import Icon from '../../components/ui/Icon.jsx'
import InspectionQueue from './components/InspectionQueue.jsx'
import FleetPage from '../../components/operations/FleetPage.jsx'

export default function MechanicOverviewPage({ operations, queue, openWork, fleetFilters, onRefresh, setDialog }) {
  const { fleet, inspections, stages } = operations
  const metrics = [
    ['Inspections awaiting', queue.length, 'shield'],
    ['Open work orders', openWork.length, 'settings'],
    ['Out of service', fleet.filter(vehicle => vehicle.status === 'Out of Service').length, 'car'],
    ['Checklists completed', inspections.length, 'file'],
  ]

  return <>
    <div className="staff-metrics">
      {metrics.map(([label, count, icon]) => <div className="agent-stat" key={label}>
        <span><Icon name={icon} size={21} /></span>
        <strong>{String(count).padStart(2, '0')}</strong>
        <span>{label}</span>
      </div>)}
    </div>
    <InspectionQueue bookings={queue} onInspect={booking => setDialog({ kind: 'inspection', booking, type: booking.inspectionType })} />
    <FleetPage fleet={fleet} stages={stages} mechanic={true} onRefresh={onRefresh} setDialog={setDialog} {...fleetFilters} />
  </>
}

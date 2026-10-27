import { useState } from 'react'
import StaffLayout from '../../layouts/StaffLayout.jsx'
import Icon from '../../components/ui/Icon.jsx'
import MechanicOverviewPage from './OverviewPage.jsx'
import InspectionsPage from './InspectionsPage.jsx'
import MaintenancePage from './MaintenancePage.jsx'
import StaffDialogs from '../../components/operations/StaffDialogs.jsx'
import InspectionForm from './components/InspectionForm.jsx'
import MaintenanceForm from './components/MaintenanceForm.jsx'
import ServiceUpdate from './components/ServiceUpdate.jsx'
import StatusForm from './components/StatusForm.jsx'

const navigation = [
  ['overview', 'grid', 'Yard overview & fleet'],
  ['inspections', 'shield', 'Digital checklists'],
  ['maintenance', 'settings', 'Work orders & repairs']
]
const titles = {
  'mechanic-overview': ['A safer journey starts here.', 'Execute vehicle checklists, manage Out of Service flags, and oversee yard readiness.'],
  'mechanic-inspections': ['Every detail. Every handover.', 'Complete digital pre-dispatch and post-return checklists with time-stamped photo proof.'],
  'mechanic-maintenance': ['Keep the next journey moving.', 'Log repair work, maintenance costs, and service clearance holds.']
}

export default function MechanicPortal({ page, user, operations, onRefresh, onLogout }) {
  const [dialog, setDialog] = useState(null), [notice, setNotice] = useState(''), [error, setError] = useState('')
  const [filter, setFilter] = useState('All statuses'), [query, setQuery] = useState('')
  const fleetFilters = { filter, setFilter, query, setQuery }
  const requestedSection = page.slice(user.role.length + 1)
  const section = navigation.some(([id]) => id === requestedSection) ? requestedSection : 'overview'
  const title = titles[`${user.role}-${section}`] || titles['mechanic-overview']
  const { fleet, bookings, inspections, maintenance, approvals } = operations
  const queue = bookings.flatMap(b => ['Pending Approval', 'Ready for Dispatch'].includes(b.status) && b.inspection?.role !== 'mechanic' || ['Pending Approval', 'Ready for Dispatch'].includes(b.status) && b.inspection?.status !== 'approved' ? [{ ...b, inspectionType: 'pre-dispatch' }] : (b.status === 'Completed' && b.returnedAt) && b.returnInspection?.status !== 'approved' ? [{ ...b, inspectionType: 'post-return' }] : [])
  const openWork = maintenance.filter(m => !m.archivedAt && m.status !== 'Completed')
  async function done(message) { await onRefresh(); setDialog(null); setNotice(message); setError('') }
  const dialogs = <>
    <StaffDialogs dialog={dialog} setDialog={setDialog} inspections={inspections} maintenance={maintenance} mechanic={true} done={done} />
    {dialog?.kind === 'inspection' && <InspectionForm operations={operations} initial={dialog} mechanic={user} onClose={() => setDialog(null)} onDone={done} />}
    {dialog?.kind === 'maintenance' && <MaintenanceForm fleet={fleet} onClose={() => setDialog(null)} onDone={done} />}
    {dialog?.kind === 'service-update' && <ServiceUpdate record={dialog.record} onClose={() => setDialog(null)} onDone={done} />}
    {dialog?.kind === 'status' && <StatusForm vehicle={dialog.vehicle} onClose={() => setDialog(null)} onDone={done} />}
  </>
  return <StaffLayout user={user} navigation={navigation} section={section} title={title} approvals={approvals} notice={notice} error={error} setNotice={setNotice} setError={setError} onLogout={onLogout} dialogs={dialogs} actions={<button className="button button-dark" onClick={() => setDialog({ kind: section === 'maintenance' ? 'maintenance' : 'inspection' })}><Icon name={section === 'maintenance' ? 'settings' : 'shield'} size={18} />{section === 'maintenance' ? 'Log work order' : 'New inspection'}</button>}>
    {section === 'overview' && <MechanicOverviewPage operations={operations} queue={queue} openWork={openWork} fleetFilters={fleetFilters} onRefresh={onRefresh} setDialog={setDialog} />}
    {section === 'inspections' && <InspectionsPage queue={queue} inspections={inspections} setDialog={setDialog} />}
    {section === 'maintenance' && <MaintenancePage maintenance={maintenance} openWork={openWork} setDialog={setDialog} onDone={done} />}
  </StaffLayout>
}

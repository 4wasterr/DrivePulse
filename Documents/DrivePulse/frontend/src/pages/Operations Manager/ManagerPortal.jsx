import { useState } from 'react'
import StaffLayout from '../../layouts/StaffLayout.jsx'
import ManagerOverviewPage from './OverviewPage.jsx'
import ApprovalPanel from './FinancialApprovalsPage.jsx'
import Analytics from './AnalyticsPage.jsx'
import AuditLog from './AuditLogPage.jsx'
import UserManagementPage from './UserManagementPage.jsx'
import ArchivesPage from './ArchivesPage.jsx'
import StaffDialogs from '../../components/operations/StaffDialogs.jsx'
import FinancialRequest from '../../components/operations/FinancialRequest.jsx'
import DecisionForm from './components/DecisionForm.jsx'
import { money } from '../../data.js'
import RiskForm from './components/RiskForm.jsx'
import AddVehicleModal from './components/AddVehicleModal.jsx'
import VehicleProfileModal from './components/VehicleProfileModal.jsx'
import EscalateOverdueModal from './components/EscalateOverdueModal.jsx'

const navigation = [
  ['overview', 'grid', 'Fleet & oversight'],
  ['approvals', 'wallet', 'Exceptions & overrides'],
  ['analytics', 'chart', 'Macro dashboards'],
  ['users', 'users', 'User management'],
  ['audit', 'shield', 'Audit & security logs'],
  ['archives', 'file', 'Data archives']
]

const titles = {
  'manager-overview': ['Aggregated oversight. Zero bottlenecks.', 'Monitor live fleet deployment, threshold alerts, rate modifications, and anomalies by exception.'],
  'manager-approvals': ['Intervene only on exceptions.', 'Clean returns auto-release deposits. Review disputed/withheld deposits, Security Deposit updates, and risk overrides here.'],
  'manager-analytics': ['Understand every kilometre.', 'Review fleet utilization percentages, net rental revenue growth, driver risk summaries, and maintenance costs.'],
  'manager-users': ['Governance, access & login telemetry.', 'Manage staff and client accounts, track authentication history, and control employee deactivations.'],
  'manager-audit': ['Threshold alerts & forensic lookup.', 'Suspicious events are flagged automatically. Search all data mutations with old vs. new values and actor IDs.'],
  'manager-archives': ['Clean records. Controlled retention.', 'Restore or permanently purge soft-deleted bookings, deactivated users, and decommissioned vehicles.']
}

export default function ManagerPortal({ page, user, operations, onRefresh, onNavigate, onLogout, onBack }) {
  const [dialog, setDialog] = useState(null), [notice, setNotice] = useState(''), [error, setError] = useState('')
  const [filter, setFilter] = useState('All statuses'), [query, setQuery] = useState('')
  const fleetFilters = { filter, setFilter, query, setQuery }
  const requestedSection = page.slice(user.role.length + 1)
  const mappedSection = requestedSection === 'risks' ? 'approvals' : requestedSection === 'vehicles' ? 'overview' : requestedSection
  const section = navigation.some(([id]) => id === mappedSection) ? mappedSection : 'overview'
  const title = titles[`${user.role}-${section}`] || titles['manager-overview']
  const { bookings, inspections, maintenance, approvals, risks, flags = [] } = operations

  async function done(message) { await onRefresh(); setDialog(null); setNotice(message); setError('') }
  const goSection = target => onNavigate ? onNavigate(`manager-${target}`) : window.location.assign(`#manager-${target}`)

  const dialogs = <>
    <StaffDialogs dialog={dialog} setDialog={setDialog} inspections={inspections} maintenance={maintenance} mechanic={false} done={done} />
    {dialog?.kind === 'financial-request' && <FinancialRequest bookings={bookings} onClose={() => setDialog(null)} onDone={done} />}
    {dialog?.kind === 'approval-review' && <DecisionForm title={`Review ${dialog.approval.type === 'deposit' ? 'disputed deposit release' : 'rental payment return'}`} description={`${dialog.approval.bookingId} · ${money(dialog.approval.amount)}. ${dialog.approval.reason}`} path={`/manager/approvals/${dialog.approval.id}`} version={dialog.approval.version} decisions onClose={() => setDialog(null)} onDone={done} />}
    {dialog?.kind === 'risk-new' && <RiskForm bookings={bookings} onClose={() => setDialog(null)} onDone={done} />}
    {dialog?.kind === 'risk-override' && <DecisionForm title="Override driver risk flag" description={dialog.risk.description} path={`/manager/risks/${dialog.risk.id}/override`} version={dialog.risk.version} onClose={() => setDialog(null)} onDone={done} />}
    {dialog?.kind === 'flag-override' && <DecisionForm title="Override overdue alert" description={`${dialog.flag.bookingId}. Record why this alert can be acknowledged. The vehicle stays overdue and unavailable for a new booking.`} path={`/manager/flags/${dialog.flag.bookingId}/override`} version={dialog.flag.version} onClose={() => setDialog(null)} onDone={done} />}
    {dialog?.kind === 'add-vehicle' && <AddVehicleModal onClose={() => setDialog(null)} onDone={done} />}
    {dialog?.kind === 'vehicle-profile' && <VehicleProfileModal vehicle={dialog.vehicle} onClose={() => setDialog(null)} onDone={done} />}
    {dialog?.kind === 'escalate-overdue' && <EscalateOverdueModal bookingId={dialog.bookingId} onClose={() => setDialog(null)} onDone={done} />}
  </>

  return <StaffLayout user={user} navigation={navigation} section={section} title={title} approvals={approvals} notice={notice} error={error} setNotice={setNotice} setError={setError} onLogout={onLogout} onBack={onBack} dialogs={dialogs}>
    {section === 'overview' && <ManagerOverviewPage operations={operations} fleetFilters={fleetFilters} onRefresh={onRefresh} setDialog={setDialog} onSection={goSection} />}
    {section === 'approvals' && <ApprovalPanel approvals={approvals} bookings={bookings} flags={flags} risks={risks} setDialog={setDialog} onRequest={() => setDialog({ kind: 'financial-request' })} onReview={a => setDialog({ kind: 'approval-review', approval: a })} />}
    {section === 'analytics' && <Analytics />}
    {section === 'users' && <UserManagementPage currentUser={user} onDone={done} />}
    {section === 'audit' && <AuditLog />}
    {section === 'archives' && <ArchivesPage onRefresh={onRefresh} onDone={done} />}
  </StaffLayout>
}

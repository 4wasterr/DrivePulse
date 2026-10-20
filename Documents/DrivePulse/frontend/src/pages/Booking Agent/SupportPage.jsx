import Conversation from '../../components/support/Conversation.jsx'
import WorkspaceEmpty from '../../components/workspace/WorkspaceEmpty.jsx'

export default function AgentSupportPage({ supportTab, setSupportTab, tickets, onRefresh, open }) {
  
  return <><div className="agent-support-toolbar"><div className="auth-role-tabs">{['open', 'resolved', 'all'].map(tab => <button key={tab} className={supportTab === tab ? 'active' : ''} aria-pressed={supportTab === tab} onClick={() => setSupportTab(tab)}>{tab === 'open' ? 'Open queries' : tab === 'resolved' ? 'Resolved' : 'All conversations'} <span>{tickets.filter(t => tab === 'all' || t.status === tab).length}</span></button>)}</div></div><div className="agent-support-grid">{tickets.filter(t => supportTab === 'all' || t.status === supportTab).map(ticket => <Conversation key={ticket.id} ticket={ticket} agent onRefresh={onRefresh} onOpenBooking={open} />)}{!tickets.some(t => supportTab === 'all' || t.status === supportTab) && <WorkspaceEmpty title="All caught up." copy="Customer questions and adjustment requests will appear here." />}</div></>
}

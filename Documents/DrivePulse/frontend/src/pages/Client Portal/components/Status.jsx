export default function Status({ value }) {
  const style = { 'Pending Approval': 'pending', 'Ready for Dispatch': 'ready', 'On Rental': 'rental', Completed: 'completed' }[value] || 'completed'
  return <span className={`status status-${style}`}><span />{value}</span>
}

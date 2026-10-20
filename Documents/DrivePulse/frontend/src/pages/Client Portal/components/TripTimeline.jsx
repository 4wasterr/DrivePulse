import { statuses } from '../../../data.js'
import Icon from '../../../components/ui/Icon.jsx'

export default function TripTimeline({ status, compact = false }) {
  const current = statuses.indexOf(status)
  return <ol className={`trip-timeline ${compact ? 'compact' : ''}`}>{statuses.map((label, index) => <li key={label} className={`${index <= current ? 'reached' : ''} ${index === current ? 'active' : ''}`}><span className="timeline-dot">{index < current ? <Icon name="check" size={11} /> : <i />}</span><span>{label}</span></li>)}</ol>
}

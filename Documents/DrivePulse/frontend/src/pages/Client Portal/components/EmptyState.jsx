import Icon from '../../../components/ui/Icon.jsx'

export default function EmptyState({ icon = 'car', title, description, action, onAction }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={30} /></span><h3>{title}</h3><p>{description}</p>{action && <button className="button button-dark" onClick={onAction}>{action}<Icon name="arrow" size={17} /></button>}</div>
}

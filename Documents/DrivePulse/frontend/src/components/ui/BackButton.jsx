import Icon from './Icon.jsx'

export default function BackButton({ onBack, label = 'Back', className = '', disabled = false }) {
  return <button type="button" className={`back-button ${className}`} onClick={onBack} disabled={disabled}><Icon name="arrowLeft" size={16} /><span>{label}</span></button>
}

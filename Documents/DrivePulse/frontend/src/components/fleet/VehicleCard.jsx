import Icon from '../ui/Icon.jsx'
import { money } from '../../data.js'

export default function VehicleCard({ vehicle, onDetails, onReserve, available, actionLabel = 'Reserve' }) {
  return <article className="vehicle-card">
    <div className="vehicle-image"><img src={vehicle.image} alt={vehicle.name} loading="lazy" /><span className="vehicle-category">{vehicle.category === 'Electric' && <Icon name="bolt" size={12} />}{vehicle.category}</span><span className={`availability ${available ? '' : 'unavailable'}`}><i />{available ? 'Available for your dates' : 'Unavailable for these dates'}</span></div>
    <div className="vehicle-content"><div className="vehicle-title-row"><button className="text-button vehicle-name" onClick={onDetails}>{vehicle.name}</button><span className="rating"><Icon name="star" size={13} />{vehicle.rating}</span></div><p className="vehicle-tagline">{vehicle.tagline}</p><div className="vehicle-specs"><span><Icon name="users" size={15} />{vehicle.seats} seats</span><span><Icon name="gear" size={15} />{vehicle.transmission}</span><span><Icon name={vehicle.fuel === 'Electric' ? 'bolt' : 'fuel'} size={15} />{vehicle.fuel}</span></div><div className="vehicle-card-footer"><span className="vehicle-price">{money(vehicle.rate)}<small> / day</small></span><button className="round-arrow" onClick={onReserve} disabled={actionLabel === 'Reserve' && !available} aria-label={`${actionLabel} ${vehicle.name}`}><Icon name="diagonal" size={19} /></button></div></div>
  </article>
}

import { vehicles } from '../data.js'

export const vehicleFor = booking => vehicles.find(vehicle => vehicle.id === booking.vehicleId) || { id: booking.vehicleId, name: booking.vehicleName || booking.vehicleId, image: '/images/car-sedan.jpg', seats: '—', transmission: '—', category: 'Fleet vehicle' }

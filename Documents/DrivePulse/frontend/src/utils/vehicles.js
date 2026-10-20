import { vehicles } from '../data.js'

export const vehicleFor = booking => vehicles.find(vehicle => vehicle.id === booking.vehicleId)

import { vehicles } from '../data.js'

export const fmt = value => value ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : '—'
export const vehicleName = id => vehicles.find(v => v.id === id)?.name || id

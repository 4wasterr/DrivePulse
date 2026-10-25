import { vehicles } from '../data.js'

export const workOrderId = record => record.workOrderCode || record.id
export function maintenanceDate(record) {
  const date = new Date(record.at)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date) : ''
}
export function filterMaintenance(records, { tab = 'active', query = '', start = '', end = '' } = {}) {
  if (start && end && start > end) return []
  const search = query.trim().toLowerCase()
  return records.filter(record => {
    if (tab === 'archived' ? !record.archivedAt : record.archivedAt || (tab === 'completed' ? record.status !== 'Completed' : record.status === 'Completed')) return false
    const vehicle = vehicles.find(v => v.id === record.vehicleId) || record.vehicle || {}
    const text = `${record.id} ${workOrderId(record)} ${record.vehicleId} ${vehicle.fleetCode || ''} ${vehicle.name || ''} ${vehicle.plate || ''} ${record.by || ''} ${record.mechanic || ''}`.toLowerCase()
    const day = maintenanceDate(record)
    return text.includes(search) && (!start || day && day >= start) && (!end || day && day <= end)
  })
}

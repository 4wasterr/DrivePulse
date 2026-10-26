export const workspaceRoles = [
  { id: 'client', name: 'Client', icon: 'car', description: 'Coordinate reservations and rental documentation.', tasks: ['Browse vehicles and make reservations', 'Review agreements and required documents', 'Track bookings and payment records'] },
  { id: 'agent', name: 'Booking Agent', icon: 'calendar', description: 'Coordinate reservations and handovers.', tasks: ['Manage online and walk-in reservations', 'Verify documents and record payments', 'Coordinate vehicle dispatch and returns'] },
  { id: 'mechanic', name: 'Fleet Mechanic', icon: 'settings', description: 'Maintain inspection standards and dispatch readiness.', tasks: ['Complete vehicle inspections and photo proof', 'Record repairs and maintenance work', 'Update vehicle readiness and safety status'] },
  { id: 'manager', name: 'Operations Manager', icon: 'chart', description: 'Control fleet performance, access, and operational exceptions.', tasks: ['Monitor fleet performance and exceptions', 'Manage users and access as Admin', 'Review approvals, archives and audit history'] },
]

export const workspaceHome = role => role === 'client' ? 'overview' : workspaceRoles.some(r => r.id === role) ? `${role}-overview` : 'login'
export const isPublicPage = page => ['home', 'workspaces', 'how-it-works', 'why-drivepulse', 'landing-main'].includes(page)

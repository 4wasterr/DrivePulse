export const vehicles = [
  { id: 'bmw-3', name: 'BMW 3 Series', tagline: 'A little more extraordinary.', category: 'Sedan', label: 'The everyday upgrade', image: '/images/bmw.jpg', rate: 4200, seats: 5, transmission: 'Automatic', fuel: 'Petrol', rating: '4.9', trips: 48, color: 'Alpine White', luggage: 3, description: 'Effortless performance meets thoughtful comfort. From city meetings to scenic detours, make every kilometre feel like the best part of your day.' },
  { id: 'mercedes-c', name: 'Mercedes-Benz C-Class', tagline: 'Arrive in your element.', category: 'Luxury', label: 'Comfort, reimagined', image: '/images/mercedes.jpg', rate: 5500, seats: 5, transmission: 'Automatic', fuel: 'Petrol', rating: '4.9', trips: 36, color: 'Obsidian Black', luggage: 3, description: 'An elegant cabin, a wonderfully quiet ride, and all the details that make the journey special. Your invitation to take the long way home.' },
  { id: 'porsche-panamera', name: 'Porsche Panamera', tagline: 'For the love of the drive.', category: 'Luxury', label: 'The open-road favourite', image: '/images/hero-porsche.jpg', rate: 8500, seats: 4, transmission: 'Automatic', fuel: 'Petrol', rating: '5.0', trips: 24, color: 'Jet Black', luggage: 2, description: 'Sporting spirit with room to unwind. Turn a weekend escape into a memorable experience with confident performance and remarkable comfort.' },
  { id: 'toyota-camry', name: 'Toyota Camry', tagline: 'Everyday, made effortless.', category: 'Sedan', label: 'Your city companion', image: '/images/toyota.jpg', rate: 2800, seats: 5, transmission: 'Automatic', fuel: 'Petrol', rating: '4.8', trips: 67, color: 'Pearl White', luggage: 3, description: 'Reliable, spacious, and easy to love. An inviting cabin and smooth ride make this your perfect companion for everyday plans and spontaneous getaways.' },
  { id: 'range-rover', name: 'Range Rover Sport', tagline: 'Go beyond the usual.', category: 'SUV', label: 'Room for adventure', image: '/images/range-rover.jpg', rate: 7200, seats: 5, transmission: 'Automatic', fuel: 'Diesel', rating: '4.9', trips: 31, color: 'Santorini Black', luggage: 4, description: 'Bring your people and your sense of adventure. Elevated comfort and generous space turn every route into something worth looking forward to.' },
  { id: 'tesla-3', name: 'Tesla Model 3', tagline: 'A quieter kind of escape.', category: 'Electric', label: 'A fresh perspective', image: '/images/tesla.jpg', rate: 4800, seats: 5, transmission: 'Automatic', fuel: 'Electric', rating: '4.9', trips: 42, color: 'Pearl White', luggage: 3, description: 'Discover a refreshingly simple drive. Enjoy instant acceleration, a peaceful cabin, and the freedom to move a little differently.' },
]

export const locations = ['Makati City, Metro Manila', 'BGC, Taguig City', 'NAIA Terminal 3, Pasay', 'Quezon City, Metro Manila']
export const statuses = ['Pending Approval', 'Ready for Dispatch', 'On Rental', 'Completed']
export const requiredDocuments = [
  {
    id: 'license',
    label: "Driver's License",
    description: 'Official LTO Driver’s License (Front & Back photo or PDF)',
    examples: 'Valid Philippine or International Driver’s License'
  },
  {
    id: 'government-1',
    label: 'Primary Government ID',
    description: 'Government photo identification with full legal name and birthdate',
    examples: 'Philippine Passport, UMID, PhilSys National ID, or PRC ID'
  },
  {
    id: 'government-2',
    label: 'Secondary Government ID / Proof of Billing',
    description: 'Secondary government identification or verified proof of address',
    examples: 'SSS ID, GSIS, Postal ID, Voter’s ID, or recent Utility Statement'
  }
]
export const money = (amount) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(amount)
export const dateISO = (offset = 0) => {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}
export const prettyDate = (date, options = {}) => new Date(`${date}T12:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', ...options })
export const tripTime = (date, time = '10:00') => Date.parse(`${date}T${time}:00+08:00`)
export const rentalDays = (start, end, startTime = '10:00', endTime = '10:00') => Math.max(1, Math.ceil((tripTime(end, endTime) - tripTime(start, startTime)) / 86400000))
export function rentalPeriodError(dates) {
  const start = tripTime(dates.start, dates.startTime)
  const end = tripTime(dates.end, dates.endTime)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Choose valid pick-up and return dates and times.'
  if (start <= Date.now()) return 'Choose a pick-up date and time in the future.'
  if (end <= start) return 'Return must be after your pick-up date and time.'
  return ''
}
export const initialDates = () => ({ start: dateISO(2), end: dateISO(5), startTime: '10:00', endTime: '10:00', pickup: locations[0], dropoff: locations[0] })
export function sampleBookings() {
  return [
    { id: 'DP-10248', vehicleId: 'bmw-3', start: dateISO(8), end: dateISO(11), startTime: '10:00', endTime: '10:00', pickup: locations[0], dropoff: locations[0], days: 3, rental: 12600, deposit: 5000, total: 17600, status: 'Ready for Dispatch', payment: 'Demo checkout', paymentStatus: 'Simulated · paid', sample: true, createdAt: new Date().toISOString() },
    { id: 'DP-10182', vehicleId: 'mercedes-c', start: dateISO(-15), end: dateISO(-13), startTime: '10:00', endTime: '10:00', pickup: locations[1], dropoff: locations[1], days: 2, rental: 11000, deposit: 5000, total: 16000, status: 'Completed', payment: 'Demo checkout', paymentStatus: 'Simulated · paid', sample: true, createdAt: new Date().toISOString() },
  ]
}

export function getAvailabilityReason(vehicleId, dates, bookings = []) {
  if (!dates?.start || !dates?.end) return 'Please choose pick-up and return dates.'
  const start = tripTime(dates.start, dates.startTime || '10:00')
  const end = tripTime(dates.end, dates.endTime || '10:00')
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Please choose valid pick-up and return dates.'
  if (end <= start) return 'Return must be after your pick-up date and time.'

  // Operational fleet holds
  const hold = bookings.find(b => b.blocked && b.vehicleId === vehicleId)
  if (hold) {
    if (hold.status === 'Maintenance') return 'Vehicle is currently in scheduled maintenance.'
    if (hold.status === 'Under Inspection') return 'Vehicle is undergoing post-return inspection.'
    if (hold.status === 'Out of Service') return 'Vehicle is temporarily out of service for repairs.'
    if (hold.status === 'Overdue') return 'Vehicle is currently overdue on a previous rental.'
    return `Vehicle is currently unavailable (${hold.status.toLowerCase()}).`
  }

  // Active rental conflict
  const conflict = bookings.find(b =>
    b.vehicleId === vehicleId &&
    !b.blocked &&
    !['Completed', 'Cancelled'].includes(b.status) &&
    start < tripTime(b.end, b.endTime || '10:00') &&
    end > tripTime(b.start, b.startTime || '10:00')
  )

  if (conflict) {
    if (conflict.status === 'On Rental') return `Currently deployed on an active trip through ${prettyDate(conflict.end)}.`
    return `Reserved by another customer for these dates (${prettyDate(conflict.start)} – ${prettyDate(conflict.end)}).`
  }

  return ''
}

export function isAvailable(vehicleId, dates, bookings = []) {
  return getAvailabilityReason(vehicleId, dates, bookings) === ''
}

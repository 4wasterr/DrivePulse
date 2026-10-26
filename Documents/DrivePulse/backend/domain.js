const DAY = 86400000;
const { inputError } = require('../shared/validation.mjs');
const REQUIRED_DOCUMENTS = ['license', 'government-1', 'government-2'];
const LOCATIONS = ['Makati City, Metro Manila', 'BGC, Taguig City', 'NAIA Terminal 3, Pasay', 'Quezon City, Metro Manila'];
const FLEET = [
  { id: 'bmw-3', name: 'BMW 3 Series', brand: 'BMW', model: '3 Series', category: 'Sedan', rate: 4200 },
  { id: 'mercedes-c', name: 'Mercedes-Benz C-Class', brand: 'Mercedes-Benz', model: 'C-Class', category: 'Luxury', rate: 5500 },
  { id: 'porsche-panamera', name: 'Porsche Panamera', brand: 'Porsche', model: 'Panamera', category: 'Luxury', rate: 8500 },
  { id: 'toyota-camry', name: 'Toyota Camry', brand: 'Toyota', model: 'Camry', category: 'Sedan', rate: 2800 },
  { id: 'range-rover', name: 'Range Rover Sport', brand: 'Range Rover', model: 'Sport', category: 'SUV', rate: 7200 },
  { id: 'tesla-3', name: 'Tesla Model 3', brand: 'Tesla', model: 'Model 3', category: 'Electric', rate: 4800 },
];
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function text(value, label, max = 200, required = true) {
  if (value != null && typeof value !== 'string') fail(`Enter valid text for ${label.toLowerCase()}.`);
  const clean = typeof value === 'string' ? value.trim() : '';
  const kind = ['Full name', 'Customer name'].includes(label) ? 'name' : label === 'Email' ? 'email' : label === 'Contact number' ? 'phone' : /reference/i.test(label) ? 'reference' : 'text';
  const problem = inputError(clean, { kind, label, required, maxLength: max });
  if (problem) fail(problem);
  return clean;
}
function time(date, hour = '10:00') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hour)) return NaN;
  const stamp = Date.parse(`${date}T${hour}:00+08:00`);
  if (!Number.isFinite(stamp) || new Date(stamp + 8 * 3600000).toISOString().slice(0, 10) !== date) return NaN;
  return stamp;
}
function quote(input, allowPast = false, customRate = null, definition = null) {
  const vehicle = definition?.id === input.vehicleId ? definition : FLEET.find(v => v.id === input.vehicleId);
  if (!vehicle) fail('Choose a vehicle from the fleet.');
  const start = time(input.start, input.startTime), end = time(input.end, input.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) fail('Choose valid dates, with return after pick-up.');
  if (!allowPast && start <= Date.now()) fail('Pick-up must be in the future.');
  if (end - start > 366 * DAY) fail('A rental can be at most 366 days.');
  if (!LOCATIONS.includes(input.pickup) || !LOCATIONS.includes(input.dropoff)) fail('Choose supported pick-up and return locations.');
  const days = Math.ceil((end - start) / DAY);
  const dailyRate = typeof customRate === 'number' && customRate > 0 ? customRate : vehicle.rate;
  return { days, rental: dailyRate * days, deposit: 5000, total: dailyRate * days + 5000 };
}
function available(bookings, input, exclude) {
  return !bookings.some(b => !b.archivedAt && b.id !== exclude && b.vehicleId === input.vehicleId && !['Cancelled', 'Completed'].includes(b.status) && time(input.start, input.startTime) < time(b.end, b.endTime) && time(input.end, input.endTime) > time(b.start, b.startTime));
}
function billing(booking) {
  const paid = type => (booking.payments || []).filter(p => p.type === type && p.status === 'confirmed').reduce((sum, p) => sum + Math.round(p.amount * 100), 0) / 100;
  const rentalDue = Math.round((booking.rental + (booking.lateFee || 0)) * 100) / 100;
  const depositPaid = paid('deposit');
  const rentalPaid = (booking.payments || []).filter(p => p.type !== 'deposit' && p.status === 'confirmed').reduce((sum, p) => sum + Math.round(p.amount * 100), 0) / 100;
  const rentalBalance = Math.max(0, Math.round((rentalDue - rentalPaid) * 100)) / 100, depositBalance = Math.max(0, Math.round((booking.deposit - depositPaid) * 100)) / 100;
  return { rentalDue, rentalPaid, depositPaid, rentalBalance, depositBalance, totalPaid: Math.round((rentalPaid + depositPaid) * 100) / 100, balance: Math.round((rentalBalance + depositBalance) * 100) / 100 };
}
function verification(booking) {
  const docs = REQUIRED_DOCUMENTS.map(kind => (booking.documents || []).find(d => d.kind === kind));
  if (docs.some(d => d?.review?.status === 'rejected')) return 'Rejected';
  return docs.every(d => d?.review?.status === 'approved') && new Set(docs.map(d => d.fingerprint)).size === 3 ? 'Verified' : 'Pending review';
}
function dispatchBlocks(booking) {
  const bill = billing(booking), blocks = [];
  if (verification(booking) !== 'Verified') blocks.push('Approve the license and both government IDs.');
  if (bill.rentalBalance > 0) blocks.push('Verify the full rental payment, including additional charges.');
  if (bill.depositBalance > 0) blocks.push('Record the full security deposit.');
  if (booking.inspection?.status !== 'approved' || booking.inspection?.role !== 'mechanic' || !booking.inspection?.photos?.length) blocks.push('A fleet mechanic must complete the digital pre-dispatch inspection with condition photos.');
  if (['Cancelled', 'Completed'].includes(booking.status)) blocks.push('This reservation is closed.');
  return blocks;
}
function present(booking) {
  const bill = billing(booking);
  return { ...booking, billing: bill, verificationStatus: verification(booking), dispatchBlocks: dispatchBlocks(booking), total: booking.rental + booking.deposit + (booking.lateFee || 0), paymentStatus: bill.balance === 0 ? 'Verified · paid' : (booking.payments || []).some(p => p.status === 'pending') ? 'Awaiting verification' : bill.totalPaid > 0 ? 'Partially paid' : 'Unpaid' };
}
function invalidatePass(booking) {
  if (booking.dispatchPass) booking.dispatchPass = { ...booking.dispatchPass, revokedAt: new Date().toISOString() };
  if (booking.status === 'Ready for Dispatch') booking.status = 'Pending Approval';
}
module.exports = { DAY, REQUIRED_DOCUMENTS, LOCATIONS, FLEET, fail, text, time, quote, available, billing, verification, dispatchBlocks, present, invalidatePass };

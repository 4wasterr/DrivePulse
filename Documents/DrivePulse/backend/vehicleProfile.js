const { randomUUID } = require('node:crypto');
const D = require('./domain');
const catalog = require('../shared/vehicleCatalog.json');
const { inputError } = require('../shared/validation.mjs');

function expiryDate(value, label) {
  if (value === '' || value == null) return null;
  if (typeof value !== 'string' || !Number.isFinite(D.time(value, '00:00'))) D.fail(`Enter a valid ${label} date.`);
  return value;
}
function vehicleProfile(input, existing = []) {
  const brand = D.text(input.brand, 'Vehicle brand', 70);
  const model = D.text(input.model, 'Vehicle model', 70);
  if (!catalog.brands[brand]?.includes(model)) D.fail('Choose a model belonging to the selected brand.');
  const defaults = catalog.categories[input.category];
  if (!defaults) D.fail('Choose a supported vehicle category.');
  const plate = D.text(input.plate, 'License plate number', 30).toUpperCase().replace(/\s+/g, ' ');
  if (!/^[A-Z0-9][A-Z0-9 -]{1,29}$/.test(plate)) D.fail('Enter a license plate using letters, numbers, spaces or hyphens.');
  const fleetCode = (D.text(input.fleetCode, 'Fleet code', 30, false) || `CAR-${randomUUID().slice(0, 8)}`).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 _-]{1,29}$/.test(fleetCode)) D.fail('Use 2–30 letters, numbers, spaces, hyphens or underscores for the fleet code.');
  const normalize = value => String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  if (existing.some(v => normalize(v.fleetCode) === normalize(fleetCode) || normalize(v.id) === normalize(fleetCode) || normalize(v.plate) === normalize(plate))) D.fail('A vehicle with this fleet code or license plate already exists.', 409);
  const numeric = (value, fallback, min, max, label, integer = false) => {
    const n = value == null ? fallback : value;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max || integer && !Number.isInteger(n)) D.fail(`Enter a valid ${label} (${min}–${max}).`);
    return n;
  };
  const transmission = input.transmission || 'Automatic', fuelType = input.fuelType || (input.category === 'Electric' ? 'Electric' : 'Gasoline');
  if (!['Automatic', 'Manual'].includes(transmission)) D.fail('Choose a supported transmission.');
  if (!['Gasoline', 'Diesel', 'Hybrid', 'Electric'].includes(fuelType)) D.fail('Choose a supported fuel type.');
  const rateError = inputError(input.rate ?? 3500, { kind: 'number', label: 'Daily rental rate', min: 500, max: 100000, step: 0.01 });
  if (rateError) D.fail(rateError);
  return {
    brand, model, name: `${brand} ${model}`, category: input.category, plate, fleetCode, transmission, fuelType,
    rate: numeric(input.rate, 3500, 500, 100000, 'daily rate'),
    seats: numeric(input.seats, defaults.seats, 2, 15, 'seating capacity', true),
    tankCapacity: numeric(input.tankCapacity, defaults.tankCapacity, 10, 150, 'tank / battery capacity'),
    mileage: numeric(input.mileage, 0, 0, 10000000, 'odometer', true),
    registrationExpiry: expiryDate(input.registrationExpiry, 'OR/CR registration expiry'),
    insuranceExpiry: expiryDate(input.insuranceExpiry, 'insurance expiry')
  };
}

function renewalNotices(vehicles, at = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  return vehicles.filter(v => !v.archivedAt).flatMap(v => ['registrationExpiry', 'insuranceExpiry'].flatMap(field => {
    const expires = v[field];
    if (!expires) return [];
    const days = Math.round((Date.parse(`${expires}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / D.DAY);
    if (!Number.isFinite(days) || days > 30) return [];
    const milestone = days < 0 ? 'overdue' : days <= 7 ? '7' : days <= 15 ? '15' : '30';
    const document = field === 'registrationExpiry' ? 'OR/CR registration' : 'Insurance';
    return [{ id: `renewal:${v.id}:${field}:${expires}:${milestone}`, category: 'renewal', severity: days <= 7 ? 'urgent' : 'warning', title: `${document} ${days < 0 ? 'overdue' : 'renewal due'}`, message: `${v.name} · ${v.fleetCode || v.id} · ${days < 0 ? `${-days} days overdue` : days === 0 ? 'Expires today' : `Expires in ${days} days`} (${expires})`, vehicleId: v.id, expires, days, milestone }];
  }));
}
module.exports = { vehicleProfile, renewalNotices, expiryDate };

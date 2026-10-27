export function mileageConsumption(dispatchOdometer, returnOdometer) {
  if (typeof dispatchOdometer !== 'number' || !Number.isFinite(dispatchOdometer) || dispatchOdometer < 0) throw new Error('A recorded dispatch odometer is required before re-accepting this vehicle.')
  if (typeof returnOdometer !== 'number' || !Number.isFinite(returnOdometer) || returnOdometer < dispatchOdometer) throw new Error('The return odometer cannot be lower than the dispatch odometer.')
  return Math.round((returnOdometer - dispatchOdometer) * 100) / 100
}

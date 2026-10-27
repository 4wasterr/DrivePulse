const reference = require('./reference/geography.json');
const regions = new Map(reference.regions.map(region => [region.code, region]));
const cities = new Map(reference.cities.map(city => [city.code, city]));
const barangays = new Map(reference.barangays.map(barangay => [barangay.code, barangay]));
const { fail } = require('./domain');
const sorted = list => list.sort((a, b) => a.name.localeCompare(b.name));

function geographicAddress(input) {
  const region = regions.get(input.regionCode), city = cities.get(input.cityCode), barangay = barangays.get(input.barangayCode);
  if (!region || !city || city.regionCode !== region.code || !barangay || barangay.cityCode !== city.code) fail('Select a valid region, city / municipality and barangay.');
  if (!/^\d{4}$/.test(input.postalCode || '')) fail('Enter a four-digit Philippine postal code.');
  // Postal delivery zones do not map one-to-one to PSGC cities. Suggested ZIPs
  // are editable; never treat a city-level suggestion as a barangay assignment.
  return { region: region.name, regionCode: region.code, city: city.name, cityCode: city.code, barangay: barangay.name, barangayCode: barangay.code, postalCode: input.postalCode };
}

function registerGeography(app) {
  app.get('/api/geography/regions', (req, res) => res.json(sorted([...regions.values()])));
  app.get('/api/geography/regions/:code/cities', (req, res) => {
    if (!regions.has(req.params.code)) fail('Region not found.', 404);
    res.json(sorted(reference.cities.filter(city => city.regionCode === req.params.code)));
  });
  app.get('/api/geography/cities/:code/barangays', (req, res) => {
    if (!cities.has(req.params.code)) fail('City / municipality not found.', 404);
    res.json(sorted(reference.barangays.filter(barangay => barangay.cityCode === req.params.code)));
  });
}
module.exports = { geographicAddress, registerGeography };

// Refresh the bundled reference once; production reads never depend on a third-party API.
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

async function refresh() {
  const source = 'https://barangays.sanchez.ph/downloads/all.json';
  const response = await fetch(source, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`PSGC download failed (${response.status}).`);
  const data = await response.json();
  if (data.regions?.length < 18 || data.cities?.length < 1600 || data.barangays?.length < 42000) throw new Error('Incomplete PSGC snapshot. Existing reference was preserved.');
  const postalSource = 'https://psgc.cloud/api/v2/cities-municipalities';
  const postalResponse = await fetch(postalSource, { signal: AbortSignal.timeout(30000) });
  if (!postalResponse.ok) throw new Error('Postal suggestion download failed. Existing reference was preserved.');
  const postal = (await postalResponse.json()).data;
  const deliverySource = 'https://zip.ph.neps.dev/';
  const deliveryResponse = await fetch(deliverySource, { signal: AbortSignal.timeout(30000) });
  if (!deliveryResponse.ok) throw new Error('Delivery ZIP reference download failed. Existing reference was preserved.');
  const html = await deliveryResponse.text();
  const delivery = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(match => [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(cell => cell[1].replace(/<[^>]+>/g, '').replaceAll('&amp;', '&').trim())).filter(row => row.length === 3 && /^\d{4}$/.test(row[0]));
  if (delivery.length < 1500) throw new Error('Incomplete ZIP reference. Existing reference was preserved.');
  const normalize = name => name.toLowerCase().replace(/city of | city|\([^)]*\)/g, '').trim();
  const provinces = new Map(data.provinces.map(province => [province.code, province.name]));
  const provinceLabels = new Set(data.provinces.map(province => province.name.toLowerCase().trim()));
  const regions = data.regions.map(({ code, name }) => ({ code, name }));
  const cities = data.cities.map(city => {
    const province = provinces.get(city.province_code) || '';
    const matches = postal.filter(item => normalize(item.name) === normalize(city.name) && (province ? normalize(item.province || '') === normalize(province) : item.region === 'National Capital Region (NCR)'));
    const postalOptions = delivery.filter(([, area, parent]) => province ? normalize(parent) === normalize(province) && normalize(area) === normalize(city.name) : !provinceLabels.has(parent.toLowerCase().trim()) && normalize(parent) === normalize(city.name)).map(([code, area]) => ({ code, area }));
    const postalCodes = [...new Set([...postalOptions.map(option => option.code), ...matches.flatMap(item => String(item.zip_code || '').match(/\b\d{4}\b/g) || [])])].sort();
    return { code: city.code, name: city.name, regionCode: city.region_code, province, postalCodes, postalOptions };
  });
  const cityCodes = new Set(cities.map(city => city.code));
  const citiesByCode = new Map(cities.map(city => [city.code, city]));
  const barangays = data.barangays.map(item => {
    const city = citiesByCode.get(item.city_code);
    const matched = city?.postalOptions.filter(option => normalize(option.area) === normalize(item.name)) || [];
    return { code: item.code, name: item.name, cityCode: item.city_code, postalCodes: [...new Set(matched.map(option => option.code))] };
  });
  if (barangays.some(item => !cityCodes.has(item.cityCode))) throw new Error('PSGC parent relationship is incomplete. Existing reference was preserved.');
  const directory = join(__dirname, '../reference');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'geography.json'), JSON.stringify({ source, postalSource, deliverySource, retrievedAt: new Date().toISOString(), regions, cities, barangays }));
  console.log(`Saved ${regions.length} regions, ${cities.length} cities/municipalities and ${barangays.length} barangays.`);
}
if (require.main === module) refresh().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { refresh };

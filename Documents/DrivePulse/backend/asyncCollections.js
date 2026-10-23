// Sequential iteration preserves transaction ordering while awaiting database work.
async function asyncMap(values, callback) {
  const result = [];
  for (let i = 0; i < values.length; i++) result.push(await callback(values[i], i, values));
  return result;
}
async function asyncForEach(values, callback) { await asyncMap(values, callback); }
module.exports = { asyncMap, asyncForEach };

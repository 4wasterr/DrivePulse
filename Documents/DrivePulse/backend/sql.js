// SQL structure must come from application code. All request values are bound
// separately; never interpolate them into a statement, identifier or ORDER BY.
function preparedSql(sql) {
  if (typeof sql !== 'string' || !sql.trim()) throw new TypeError('A SQL statement is required.');
  let count = 0, ended = false;
  // Quoted strings, identifiers and comments cannot contain bind markers.
  const tokens = /'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\r\n]*|\/\*[\s\S]*?\*\/|\$([a-zA-Z_][a-zA-Z_0-9]*|)\$[\s\S]*?\$\1\$|\?|;|[^?'";$/-]+|./g;
  const postgres = sql.replace(tokens, token => {
    const comment = token.startsWith('--') || token.startsWith('/*');
    if (ended && token.trim() && !comment) throw new TypeError('Prepared queries must contain exactly one SQL statement.');
    if (token === ';') ended = true;
    return token === '?' ? `$${++count}` : token;
  });
  return { postgres, count };
}

function assertBindings(params, count) {
  if (params.length !== count) throw new TypeError('SQL binding count does not match the prepared statement.');
  for (const value of params) {
    if (value === null || typeof value === 'string' || typeof value === 'bigint' || value instanceof Uint8Array || typeof value === 'number' && Number.isFinite(value)) continue;
    throw new TypeError('SQL values must be scalar parameters or binary data.');
  }
}

module.exports = { preparedSql, assertBindings };

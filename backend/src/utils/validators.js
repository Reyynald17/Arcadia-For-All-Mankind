// backend/src/utils/validators.js
function requireFields(obj, fields) {
  const missing = fields.filter(f => obj[f] === undefined || obj[f] === null);
  if (missing.length) throw new Error('Missing fields: ' + missing.join(', '));
}

module.exports = { requireFields };

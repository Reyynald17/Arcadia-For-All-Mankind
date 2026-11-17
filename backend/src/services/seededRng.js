function hashSeed(value) {
  const text = String(value ?? '');
  let hash = 2166136261 >>> 0;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;

  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createSeededRng(seed) {
  return mulberry32(typeof seed === 'number' ? seed : hashSeed(seed));
}

module.exports = { hashSeed, createSeededRng };

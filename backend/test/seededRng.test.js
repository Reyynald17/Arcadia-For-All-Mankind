const test = require('node:test');
const assert = require('node:assert/strict');
const { hashSeed, createSeededRng } = require('../src/services/seededRng');

test('identical seeds produce identical sequences', () => {
  const first = createSeededRng('agency:mission:42');
  const second = createSeededRng('agency:mission:42');

  const firstSequence = Array.from({ length: 8 }, () => first());
  const secondSequence = Array.from({ length: 8 }, () => second());

  assert.deepEqual(firstSequence, secondSequence);
});

test('different seeds diverge', () => {
  const first = createSeededRng('mission-a');
  const second = createSeededRng('mission-b');

  assert.notDeepEqual(
    Array.from({ length: 4 }, () => first()),
    Array.from({ length: 4 }, () => second()),
  );
});

test('generated values stay inside the unit interval', () => {
  const rng = createSeededRng(12345);
  for (let index = 0; index < 100; index += 1) {
    const value = rng();
    assert.ok(value >= 0 && value < 1);
  }
});

test('hashes are stable and input-sensitive', () => {
  assert.equal(hashSeed('same'), hashSeed('same'));
  assert.notEqual(hashSeed('same'), hashSeed('different'));
});

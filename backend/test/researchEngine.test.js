const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateResearchDurationDays,
  assignedEngineersForAgency,
} = require('../src/services/researchEngine');

test('optimal staff leaves the base duration unchanged', () => {
  assert.equal(
    calculateResearchDurationDays({ baseDays: 220, engineers: 20, optimalEngineers: 20 }),
    220,
  );
});

test('more engineers reduce duration with diminishing returns', () => {
  const duration = calculateResearchDurationDays({
    baseDays: 220,
    engineers: 40,
    optimalEngineers: 20,
  });

  assert.ok(duration > 130 && duration < 145);
});

test('reduced staffing stretches duration', () => {
  const duration = calculateResearchDurationDays({
    baseDays: 220,
    engineers: 10,
    optimalEngineers: 20,
  });

  assert.ok(duration > 220);
});

test('prerequisite TRL bonus shortens duration', () => {
  const baseline = calculateResearchDurationDays({ baseDays: 220, engineers: 20 });
  const boosted = calculateResearchDurationDays({
    baseDays: 220,
    engineers: 20,
    prereqTrlCount: 2,
  });

  assert.ok(boosted < baseline);
  assert.ok(Math.abs(boosted - 220 / 1.3) < 1e-9);
});

test('zero engineers do not speed up research', () => {
  assert.equal(calculateResearchDurationDays({ baseDays: 90, engineers: 0 }), 90);
});

test('engineer assignment respects agency headcount', () => {
  const agency = { total_engineers: 30 };

  assert.equal(assignedEngineersForAgency(agency), 20);
  assert.equal(assignedEngineersForAgency(agency, 12), 12);
  assert.equal(assignedEngineersForAgency(agency, 80), 30);
  assert.equal(assignedEngineersForAgency(agency, 0), 0);
});

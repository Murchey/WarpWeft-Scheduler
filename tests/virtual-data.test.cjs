const test = require('node:test');
const assert = require('node:assert/strict');
const { solve } = require('./java-solver-helper.cjs');
const fs = require('node:fs');

const demo = JSON.parse(fs.readFileSync('database/seeds/demo.json', 'utf8'));

function runSolver(overrides = {}) {
  const input = {
    ...demo,
    protocolVersion: '1.0',
    dataSnapshotVersion: 'virtual-test',
    hardConstraints: [],
    softConstraints: [],
    unavailableSlots: [],
    lockedEntries: [],
    timeLimitSeconds: 5,
    randomSeed: 7,
    ...overrides,
  };
  const result = solve(input);
  assert.equal(result.status, 0, result.stderr || 'Java solver process failed');
  return JSON.parse(result.stdout);
}

test('virtual baseline data is feasible', () => {
  const result = runSolver();
  assert.equal(result.hasFeasibleSolution, true);
  assert.equal(result.entries.length, 21);
});

test('virtual teacher unavailable data is rejected', () => {
  const unavailableSlots = demo.timeSlots.map(slot => ({ teacherId: 'teacher-math', slotId: slot.id }));
  const result = runSolver({ unavailableSlots });
  assert.equal(result.hasFeasibleSolution, false);
  assert.ok(result.hardConstraintViolations.length > 0);
});

test('virtual room capacity data is rejected', () => {
  const rooms = demo.rooms.map(room => ({ ...room, capacity: 20 }));
  const result = runSolver({ rooms });
  assert.equal(result.hasFeasibleSolution, false);
  assert.ok(result.hardConstraintViolations.length > 0);
});

test('locked entries remain fixed on the next solve', () => {
  const baseline = runSolver();
  const locked = baseline.entries.find((entry) => entry.coursePlanId === 'plan-1');
  assert.ok(locked);
  const result = runSolver({
    lockedEntries: [{ ...locked, locked: true, source: 'MANUAL' }],
  });
  assert.equal(result.hasFeasibleSolution, true);
  const pinned = result.entries.find(
    (entry) =>
      entry.coursePlanId === 'plan-1' && entry.slotId === locked.slotId,
  );
  assert.ok(pinned);
  assert.equal(pinned.locked, true);
});

test('virtual fixed-time conflict data is rejected', () => {
  const coursePlans = demo.coursePlans.map(plan => ({ ...plan }));
  coursePlans[0].fixedSlotId = 'mon-1';
  coursePlans[1].fixedSlotId = 'mon-1';
  const result = runSolver({ coursePlans });
  assert.equal(result.hasFeasibleSolution, false);
  assert.ok(result.hardConstraintViolations.length > 0);
});

test('teacher unavailable slot and soft weights are accepted', () => {
  const result = runSolver({
    unavailableSlots: [{ teacherId: 'teacher-chinese', slotId: 'mon-1' }],
    softConstraints: [{ kind: 'SUBJECT_DISTRIBUTION', weight: 5 }],
  });
  assert.equal(result.hasFeasibleSolution, true);
  assert.ok(result.entries.every((entry) => !(entry.teacherId === 'teacher-chinese' && entry.slotId === 'mon-1')));
});

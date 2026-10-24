const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { solve } = require('./java-solver-helper.cjs');

const demo = JSON.parse(fs.readFileSync('database/seeds/demo.json', 'utf8'));

function run({ slots, plans, overrides = {} }) {
  const input = {
    ...demo,
    timeSlots: slots ?? demo.timeSlots,
    coursePlans: plans,
    protocolVersion: '1.0',
    dataSnapshotVersion: 'slot-kind-test',
    hardConstraints: [],
    softConstraints: [],
    unavailableSlots: [],
    lockedEntries: [],
    rules: [],
    timeLimitSeconds: 5,
    stagnationSeconds: 1,
    randomSeed: 1,
    ...overrides,
  };
  const result = solve(input);
  assert.equal(result.status, 0, result.stderr || 'Java solver process failed');
  return JSON.parse(result.stdout);
}

const plan = (id, classId, subjectId, teacherId, extra = {}) => ({
  id,
  classId,
  subjectId,
  teacherId,
  weeklyPeriods: 1,
  ...extra,
});

function withKind(ids, kind) {
  return demo.timeSlots.map((slot) => (ids.includes(slot.id) ? { ...slot, kind } : { ...slot, kind: 'regular' }));
}

test('a morning plan can use a morning slot', () => {
  const output = run({
    slots: withKind(['mon-1'], 'morning'),
    plans: [plan('p-morning', 'class-1', 'subject-math', 'teacher-math', { fixedSlotId: 'mon-1', kind: 'morning' })],
  });
  assert.equal(output.hasFeasibleSolution, true);
  assert.equal(output.entries.length, 1);
  assert.equal(output.entries[0].slotId, 'mon-1');
});

test('a regular plan cannot be placed into a morning slot', () => {
  const output = run({
    slots: withKind(['mon-1'], 'morning'),
    plans: [plan('p-regular', 'class-1', 'subject-math', 'teacher-math', { fixedSlotId: 'mon-1', kind: 'regular' })],
  });
  assert.equal(output.hasFeasibleSolution, false);
  assert.equal(output.entries.length, 0);
});

test('regular plans do not spill into evening slots', () => {
  // Every slot is evening: a regular plan has nowhere to go.
  const slots = demo.timeSlots.map((slot) => ({ ...slot, kind: 'evening' }));
  const output = run({
    slots,
    plans: [plan('p-regular', 'class-1', 'subject-math', 'teacher-math', { weeklyPeriods: 1 })],
  });
  assert.equal(output.hasFeasibleSolution, false);
  assert.equal(output.entries.length, 0);

  const evening = run({
    slots,
    plans: [plan('p-evening', 'class-1', 'subject-math', 'teacher-math', { weeklyPeriods: 1, kind: 'evening' })],
  });
  assert.equal(evening.hasFeasibleSolution, true);
  assert.equal(evening.entries.length, 1);
});

test('study and aftercare plans can fill regular slots', () => {
  const study = run({
    plans: [plan('p-study', 'class-1', 'subject-math', 'teacher-math', { fixedSlotId: 'mon-1', kind: 'study' })],
  });
  assert.equal(study.hasFeasibleSolution, true);
  assert.equal(study.entries.length, 1);
  assert.equal(study.entries[0].slotId, 'mon-1');

  const aftercare = run({
    plans: [plan('p-aftercare', 'class-1', 'subject-math', 'teacher-math', { fixedSlotId: 'mon-1', kind: 'aftercare' })],
  });
  assert.equal(aftercare.hasFeasibleSolution, true);
  assert.equal(aftercare.entries.length, 1);
  assert.equal(aftercare.entries[0].slotId, 'mon-1');
});

test('regular plans cannot use aftercare slots, aftercare plans can', () => {
  const slots = demo.timeSlots.map((slot) => ({ ...slot, kind: 'aftercare' }));
  const regular = run({
    slots,
    plans: [plan('p-regular', 'class-1', 'subject-math', 'teacher-math', { fixedSlotId: 'mon-1', kind: 'regular' })],
  });
  assert.equal(regular.hasFeasibleSolution, false);
  assert.equal(regular.entries.length, 0);

  const aftercare = run({
    slots,
    plans: [plan('p-aftercare', 'class-1', 'subject-math', 'teacher-math', { fixedSlotId: 'mon-1', kind: 'aftercare' })],
  });
  assert.equal(aftercare.hasFeasibleSolution, true);
  assert.equal(aftercare.entries.length, 1);
});

test('mix of morning and regular plans fills each kind', () => {
  const output = run({
    slots: withKind(['mon-1'], 'morning'),
    plans: [
      plan('p-morning', 'class-1', 'subject-math', 'teacher-math', { kind: 'morning' }),
      plan('p-regular', 'class-1', 'subject-chinese', 'teacher-chinese', { kind: 'regular' }),
    ],
  });
  assert.equal(output.hasFeasibleSolution, true);
  const morning = output.entries.find((entry) => entry.coursePlanId === 'p-morning');
  const regular = output.entries.find((entry) => entry.coursePlanId === 'p-regular');
  assert.equal(morning.slotId, 'mon-1');
  assert.notEqual(regular.slotId, 'mon-1');
});

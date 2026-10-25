const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { solve } = require('./java-solver-helper.cjs');

const demo = JSON.parse(fs.readFileSync('database/seeds/demo.json', 'utf8'));

function run({ plans, slots = demo.timeSlots, classes = demo.classes.slice(0, 1), teachers = demo.teachers, rooms = demo.rooms, subjects = demo.subjects, overrides = {} }) {
  const input = {
    ...demo,
    timeSlots: slots,
    classes,
    teachers,
    rooms,
    subjects,
    coursePlans: plans,
    protocolVersion: '1.0',
    dataSnapshotVersion: 'new-model-test',
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

const slotById = new Map(demo.timeSlots.map((slot) => [slot.id, slot]));

test('consecutive: 2 places weekly lessons as adjacent runs', () => {
  const output = run({
    plans: [
      { id: 'essay', classId: 'class-1', subjectId: 'subject-chinese', teacherId: 'teacher-chinese', weeklyPeriods: 4, consecutive: 2 },
    ],
  });
  assert.equal(output.hasFeasibleSolution, true);
  assert.equal(output.entries.length, 4);
  const byDay = new Map();
  for (const entry of output.entries) {
    const slot = slotById.get(entry.slotId);
    byDay.set(slot.day, [...(byDay.get(slot.day) ?? []), slot.period]);
  }
  const pairs = [...byDay.values()].filter((periods) => {
    const sorted = [...periods].sort((a, b) => a - b);
    return sorted.length === 2 && sorted[1] === sorted[0] + 1;
  });
  assert.equal(pairs.length, 2);
});

test('fixed consecutive slots make an anchored double period', () => {
  const output = run({
    plans: [
      { id: 'essay', classId: 'class-1', subjectId: 'subject-chinese', teacherId: 'teacher-chinese', weeklyPeriods: 2, consecutive: 2, fixedSlotIds: ['thu-2', 'thu-3'] },
    ],
  });
  assert.equal(output.hasFeasibleSolution, true);
  assert.deepEqual(output.entries.map((entry) => entry.slotId).sort(), ['thu-2', 'thu-3']);
});

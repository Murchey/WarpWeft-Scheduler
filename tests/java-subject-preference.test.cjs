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

test('subject morning/afternoon preference is honoured', () => {
  const output = run({
    plans: [
      { id: 'math', classId: 'class-1', subjectId: 'subject-math', teacherId: 'teacher-math', weeklyPeriods: 5 },
      { id: 'activity', classId: 'class-1', subjectId: 'subject-chinese', teacherId: 'teacher-chinese', weeklyPeriods: 5 },
    ],
    subjects: [
      { id: 'subject-math', name: '数学', preference: 'morning' },
      { id: 'subject-chinese', name: '活动', preference: 'afternoon' },
    ],
    overrides: { softConstraints: [{ kind: 'SUBJECT_TIME_PREFERENCE', weight: 5 }] },
  });
  assert.equal(output.hasFeasibleSolution, true);
  // 3 periods per day → morning = periods 1–2.
  const math = output.entries.filter((entry) => entry.coursePlanId === 'math');
  const activity = output.entries.filter((entry) => entry.coursePlanId === 'activity');
  assert.ok(math.every((entry) => slotById.get(entry.slotId).period <= 2));
  assert.ok(activity.every((entry) => slotById.get(entry.slotId).period > 2));
  assert.equal(typeof output.scoreBreakdown.subjectTimePreference, 'number');
});

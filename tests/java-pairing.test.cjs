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

test('odd and even paired plans share one slot', () => {
  const output = run({
    plans: [
      { id: 'odd', classId: 'class-1', subjectId: 'subject-chinese', teacherId: 'teacher-chinese', weeklyPeriods: 1, weeks: 'odd', pairId: '语数间周' },
      { id: 'even', classId: 'class-1', subjectId: 'subject-math', teacherId: 'teacher-math', weeklyPeriods: 1, weeks: 'even', pairId: '语数间周' },
    ],
  });
  assert.equal(output.hasFeasibleSolution, true);
  assert.equal(output.entries.length, 2);
  assert.equal(output.entries[0].slotId, output.entries[1].slotId);
});

test('paired plans whose weeks overlap are rejected', () => {
  const output = run({
    plans: [
      { id: 'odd', classId: 'class-1', subjectId: 'subject-chinese', teacherId: 'teacher-chinese', weeklyPeriods: 1, weeks: 'odd', pairId: 'g1' },
      { id: 'odd2', classId: 'class-1', subjectId: 'subject-math', teacherId: 'teacher-math', weeklyPeriods: 1, weeks: 'odd', pairId: 'g1' },
    ],
  });
  assert.equal(output.hasFeasibleSolution, false);
  assert.ok(output.hardConstraintViolations.some((message) => message.includes('周次重叠')));
});

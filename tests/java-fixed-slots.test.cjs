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

test('fixedSlotIds pins only the listed occurrences', () => {
  const output = run({
    plans: [
      { id: 'p1', classId: 'class-1', subjectId: 'subject-math', teacherId: 'teacher-math', weeklyPeriods: 3, fixedSlotIds: ['mon-1', 'thu-1'] },
    ],
  });
  assert.equal(output.hasFeasibleSolution, true);
  assert.equal(output.entries.length, 3);
  const slots = output.entries.map((entry) => entry.slotId);
  assert.ok(slots.includes('mon-1'), 'first occurrence must use the first fixed slot');
  assert.ok(slots.includes('thu-1'), 'second occurrence must use the second fixed slot');
  assert.equal(new Set(slots).size, 3);
});

test('fixed slots stay protected even when the whole class grid is full', () => {
  const plans = [
    { id: 'pin', classId: 'class-1', subjectId: 'subject-math', teacherId: 't-pin', weeklyPeriods: 1, fixedSlotIds: ['fri-3'] },
    { id: 'a', classId: 'class-1', subjectId: 'subject-chinese', teacherId: 't-a', weeklyPeriods: 4 },
    { id: 'b', classId: 'class-1', subjectId: 'subject-english', teacherId: 't-b', weeklyPeriods: 4 },
    { id: 'c', classId: 'class-1', subjectId: 'subject-math', teacherId: 't-c', weeklyPeriods: 3 },
    { id: 'd', classId: 'class-1', subjectId: 'subject-chinese', teacherId: 't-d', weeklyPeriods: 3 },
  ];
  const teachers = [{ id: 't-pin', name: '固定' }, { id: 't-a', name: 'A' }, { id: 't-b', name: 'B' }, { id: 't-c', name: 'C' }, { id: 't-d', name: 'D' }];
  const output = run({ plans, teachers, classes: [{ id: 'class-1', name: '一班', size: 40 }] });
  assert.equal(output.hasFeasibleSolution, true);
  assert.equal(output.entries.length, 15);
  const pinned = output.entries.filter((entry) => entry.coursePlanId === 'pin');
  assert.equal(pinned.length, 1);
  assert.equal(pinned[0].slotId, 'fri-3');
  const others = output.entries.filter((entry) => entry.slotId === 'fri-3' && entry.coursePlanId !== 'pin');
  assert.equal(others.length, 0);
});

test('conflicting fixed lessons are reported, not silently moved', () => {
  const plans = [
    { id: 'x', classId: 'class-1', subjectId: 'subject-math', teacherId: 't-x', weeklyPeriods: 1, fixedSlotIds: ['mon-1'] },
    { id: 'y', classId: 'class-1', subjectId: 'subject-chinese', teacherId: 't-y', weeklyPeriods: 1, fixedSlotIds: ['mon-1'] },
  ];
  const teachers = [{ id: 't-x', name: 'X' }, { id: 't-y', name: 'Y' }];
  const output = run({ plans, teachers, classes: [{ id: 'class-1', name: '一班', size: 40 }] });
  const placed = output.entries.filter((entry) => entry.slotId === 'mon-1');
  assert.equal(placed.length, 1);
  assert.equal(output.hasFeasibleSolution, false);
});

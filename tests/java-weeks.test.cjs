const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { solve } = require('./java-solver-helper.cjs');

const demo = JSON.parse(fs.readFileSync('database/seeds/demo.json', 'utf8'));

function run(coursePlans, overrides = {}) {
  const input = {
    ...demo,
    coursePlans,
    protocolVersion: '1.0',
    dataSnapshotVersion: 'weeks-test',
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

const plan = (id, classId, subjectId, teacherId, weeks, extra = {}) => ({
  id,
  classId,
  subjectId,
  teacherId,
  weeklyPeriods: 1,
  fixedSlotId: 'mon-1',
  weeks,
  ...extra,
});

test('odd and even plans can share a fixed slot', () => {
  const output = run([
    plan('p-odd', 'class-1', 'subject-math', 'teacher-math', 'odd'),
    plan('p-even', 'class-1', 'subject-chinese', 'teacher-chinese', 'even'),
  ]);
  assert.equal(output.hasFeasibleSolution, true);
  assert.equal(output.entries.length, 2);
  const weeks = output.entries.map((entry) => entry.weeks).sort();
  assert.deepEqual(weeks, ['even', 'odd']);
  assert.ok(output.entries.every((entry) => entry.slotId === 'mon-1'));
});

test('an every-week plan cannot share a slot with an odd/even pair', () => {
  const output = run([
    plan('p-odd', 'class-1', 'subject-math', 'teacher-math', 'odd'),
    plan('p-even', 'class-1', 'subject-chinese', 'teacher-chinese', 'even'),
    plan('p-all', 'class-1', 'subject-english', 'teacher-english', 'all'),
  ]);
  assert.equal(output.hasFeasibleSolution, false);
  assert.ok(output.entries.length < 3);
});

test('a teacher can teach odd and even lessons in the same slot', () => {
  const output = run([
    plan('p-a', 'class-1', 'subject-math', 'teacher-math', 'odd'),
    plan('p-b', 'class-2', 'subject-math', 'teacher-math', 'even'),
  ]);
  assert.equal(output.hasFeasibleSolution, true);
  assert.equal(output.entries.length, 2);
  assert.ok(output.entries.every((entry) => entry.teacherId === 'teacher-math' && entry.slotId === 'mon-1'));
});

test('two plans in the same week still conflict', () => {
  const output = run([
    plan('p-a', 'class-1', 'subject-math', 'teacher-math', 'odd'),
    plan('p-b', 'class-1', 'subject-chinese', 'teacher-chinese', 'odd'),
  ]);
  assert.equal(output.hasFeasibleSolution, false);
  assert.ok(output.entries.length <= 1);
});


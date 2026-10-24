const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { solve } = require('./java-solver-helper.cjs');

const demo = JSON.parse(fs.readFileSync('database/seeds/demo.json', 'utf8'));

function run(softConstraints) {
  const input = {
    ...demo,
    classes: [demo.classes[0]],
    teachers: demo.teachers,
    rooms: [demo.rooms[0]],
    timeSlots: demo.timeSlots.map((slot) => ({ ...slot, kind: 'regular' })),
    coursePlans: [
      { id: 'p-math', classId: 'class-1', subjectId: 'subject-math', teacherId: 'teacher-math', weeklyPeriods: 2 },
      { id: 'p-chinese', classId: 'class-1', subjectId: 'subject-chinese', teacherId: 'teacher-chinese', weeklyPeriods: 2 },
      { id: 'p-english', classId: 'class-1', subjectId: 'subject-english', teacherId: 'teacher-english', weeklyPeriods: 2 },
    ],
    unavailableSlots: [],
    lockedEntries: [],
    rules: [],
    softConstraints,
    timeLimitSeconds: 5,
    stagnationSeconds: 1,
    randomSeed: 7,
  };
  const result = solve(input);
  assert.equal(result.status, 0, result.stderr || 'Java solver process failed');
  return JSON.parse(result.stdout);
}

test('class gaps are parsed from softConstraints and reported in the breakdown', () => {
  const output = run([{ kind: 'CLASS_GAPS', weight: 5 }]);
  assert.equal(output.hasFeasibleSolution, true);
  assert.equal(output.entries.length, 6);
  assert.equal(typeof output.scoreBreakdown.classGaps, 'number');
});

test('enabling class gaps does not increase class gaps', () => {
  const baseline = run([]);
  const compact = run([{ kind: 'CLASS_GAPS', weight: 5 }]);
  assert.equal(baseline.entries.length, 6);
  assert.equal(compact.entries.length, 6);
  assert.ok(compact.scoreBreakdown.classGaps <= baseline.scoreBreakdown.classGaps);
});

test('an empty soft constraint list still places every lesson', () => {
  const output = run([]);
  assert.equal(output.hasFeasibleSolution, true);
  assert.equal(output.entries.length, 6);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { solve } = require('./java-solver-helper.cjs');

test('demo data produces a feasible schedule', () => {
  const input = JSON.parse(fs.readFileSync('database/seeds/demo.json', 'utf8'));
  Object.assign(input, {
    protocolVersion: '1.0',
    dataSnapshotVersion: 'test',
    hardConstraints: [],
    softConstraints: [],
    unavailableSlots: [],
    lockedEntries: [],
    timeLimitSeconds: 30,
    randomSeed: 1,
  });
  const process = solve(input);
  assert.equal(process.status, 0, process.stderr || 'Java solver process failed');
  const out = JSON.parse(process.stdout);
  assert.equal(out.status, 'COMPLETED');
  assert.equal(out.hasFeasibleSolution, true);
  assert.equal(out.entries.length, 21);
});

test('the solver protocol rejects a plan whose teacher is bound to another class', () => {
  const input = JSON.parse(fs.readFileSync('database/seeds/demo.json', 'utf8'));
  Object.assign(input, {
    protocolVersion: '1.0',
    dataSnapshotVersion: 'test',
    hardConstraints: [],
    softConstraints: [],
    unavailableSlots: [],
    lockedEntries: [],
    timeLimitSeconds: 30,
    randomSeed: 1,
  });
  const plan = input.coursePlans.find((item) => item.teacherId);
  assert.ok(plan, 'demo data should have a plan with a teacher');
  const teacher = input.teachers.find((item) => item.id === plan.teacherId);
  assert.ok(teacher, 'demo data should contain the plan teacher');
  const otherClass = input.classes.find((item) => item.id !== plan.classId);
  assert.ok(otherClass, 'demo data should contain another class');
  teacher.classIds = [otherClass.id];
  const process = solve(input);
  assert.equal(process.status, 0, process.stderr || 'Java solver process failed');
  const out = JSON.parse(process.stdout);
  assert.equal(out.status, 'FAILED');
  assert.ok(out.hardConstraintViolations.some((message) => message.includes('不负责班级')));
});

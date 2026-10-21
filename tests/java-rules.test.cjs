const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { solve } = require('./java-solver-helper.cjs');

function demoInput() {
  const input = JSON.parse(fs.readFileSync('database/seeds/demo.json', 'utf8'));
  Object.assign(input, {
    protocolVersion: '1.0',
    dataSnapshotVersion: 'rules-test',
    hardConstraints: [],
    softConstraints: [],
    unavailableSlots: [],
    lockedEntries: [],
    timeLimitSeconds: 30,
    randomSeed: 1,
    rules: [],
  });
  return input;
}

test('hard teacher daily rule is passed to the Java solver', () => {
  const input = demoInput();
  const teacher = input.teachers[0];
  input.rules = [{
    id: 'rule-hard-teacher',
    kind: 'TEACHER_MAX_DAILY',
    scope: { type: 'teacher', teacherId: teacher.id },
    time: { type: 'all' },
    importance: 'must',
    params: { maxPerDay: 1 },
    enabled: true,
    createdAt: new Date().toISOString(),
    source: 'manual',
  }];
  const result = solve(input);
  assert.equal(result.status, 0, result.stderr || 'Java solver process failed');
  const output = JSON.parse(result.stdout);
  assert.equal(output.hasFeasibleSolution, false);
  assert.ok(output.entries.length < 21);
});

test('subject time preference produces a rule penalty', () => {
  const input = demoInput();
  const subject = input.subjects[0];
  input.rules = [{
    id: 'rule-time-preference',
    kind: 'SUBJECT_TIME_PREFERENCE',
    scope: { type: 'subject', subjectId: subject.id },
    time: { type: 'all' },
    importance: 'prefer',
    params: { preference: 'afternoon' },
    enabled: true,
    createdAt: new Date().toISOString(),
    source: 'manual',
  }];
  const result = solve(input);
  assert.equal(result.status, 0, result.stderr || 'Java solver process failed');
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, 'COMPLETED');
  assert.ok(Number(output.scoreBreakdown.rules || 0) > 0);
});

test('free half-day rule produces a penalty when target is impossible', () => {
  const input = demoInput();
  const teacher = input.teachers[0];
  input.rules = [{
    id: 'rule-half-day',
    kind: 'TEACHER_FREE_HALF_DAY',
    scope: { type: 'teacher', teacherId: teacher.id },
    time: { type: 'all' },
    importance: 'prefer',
    params: { minFreeHalfDays: 10 },
    enabled: true,
    createdAt: new Date().toISOString(),
    source: 'manual',
  }];
  const result = solve(input);
  assert.equal(result.status, 0, result.stderr || 'Java solver process failed');
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, 'COMPLETED');
  assert.ok(Number(output.scoreBreakdown.rules || 0) > 0);
});

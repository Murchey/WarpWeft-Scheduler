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

test('hard double-period rule places adjacent pairs', () => {
  const input = demoInput();
  const subject = input.subjects.find((item) => item.name === '数学');
  input.rules = [{
    id: 'rule-double',
    kind: 'DOUBLE_PERIOD',
    scope: { type: 'subject', subjectId: subject.id },
    time: { type: 'all' },
    importance: 'must',
    params: { periods: 2 },
    enabled: true,
    createdAt: new Date().toISOString(),
    source: 'manual',
  }];
  const result = solve(input);
  assert.equal(result.status, 0, result.stderr || 'Java solver process failed');
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, 'COMPLETED');
  assert.equal(output.entries.length, 21);
  const planSubject = new Map(input.coursePlans.map((plan) => [plan.id, plan.subjectId]));
  const byClass = new Map();
  for (const entry of output.entries) {
    if (planSubject.get(entry.coursePlanId) !== subject.id) continue;
    const slot = input.timeSlots.find((item) => item.id === entry.slotId);
    const key = entry.classId;
    if (!byClass.has(key)) byClass.set(key, []);
    byClass.get(key).push(slot);
  }
  for (const slots of byClass.values()) {
    const byDay = new Map();
    for (const slot of slots) {
      if (!byDay.has(slot.day)) byDay.set(slot.day, []);
      byDay.get(slot.day).push(slot.period);
    }
    let hasPair = false;
    for (const periods of byDay.values()) {
      periods.sort((a, b) => a - b);
      for (let i = 1; i < periods.length; i += 1) if (periods[i] === periods[i - 1] + 1) hasPair = true;
    }
    assert.equal(hasPair, true);
  }
});

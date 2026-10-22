const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { solve } = require('./java-solver-helper.cjs');

const demo = JSON.parse(fs.readFileSync('database/seeds/demo.json', 'utf8'));

function baseData() {
  return {
    ...demo,
    classes: [
      ...demo.classes,
      { id: 'class-4', name: '八年级2班', size: 40 },
    ],
    teachers: [
      ...demo.teachers,
      { id: 'teacher-physics', name: '赵老师' },
      { id: 'teacher-history', name: '钱老师' },
      { id: 'teacher-geo', name: '孙老师' },
    ],
  };
}

function run(input, overrides = {}) {
  const payload = {
    ...input,
    protocolVersion: '1.0',
    dataSnapshotVersion: 'elective-test',
    hardConstraints: [],
    softConstraints: [],
    unavailableSlots: [],
    lockedEntries: [],
    rules: [],
    timeLimitSeconds: 10,
    stagnationSeconds: 2,
    randomSeed: 3,
    ...overrides,
  };
  const result = solve(payload);
  assert.equal(result.status, 0, result.stderr || 'Java solver process failed');
  return JSON.parse(result.stdout);
}

function group(id, classIds, teachers, weeklyPeriods = 2) {
  return {
    id,
    name: id,
    subjectId: 'subject-math',
    weeklyPeriods,
    classIds,
    blocks: teachers.map((teacherId, index) => ({
      id: id + '-block-' + index,
      name: '分层' + String.fromCharCode(65 + index),
      teacherId,
      roomType: '普通教室',
    })),
  };
}

function regularPlans() {
  return ['class-1', 'class-2', 'class-3', 'class-4'].map((classId, index) => ({
    id: 'plan-' + classId,
    classId,
    subjectId: 'subject-english',
    teacherId: 'teacher-english',
    weeklyPeriods: 1,
  }));
}

test('two elective groups with three parallel blocks are scheduled together', () => {
  const data = baseData();
  const groups = [
    group('g1', ['class-1', 'class-2'], ['teacher-math', 'teacher-chinese', 'teacher-english']),
    group('g2', ['class-3', 'class-4'], ['teacher-physics', 'teacher-history', 'teacher-geo']),
  ];
  const output = run({ ...data, coursePlans: regularPlans(), electiveGroups: groups });
  assert.equal(output.hasFeasibleSolution, true, output.explanation);
  const groupEntries = output.entries.filter((entry) => entry.groupId);
  assert.equal(groupEntries.length, 2 * 3 * 2);

  for (const id of ['g1', 'g2']) {
    const entries = groupEntries.filter((entry) => entry.groupId === id);
    const bySlot = new Map();
    for (const entry of entries) bySlot.set(entry.slotId, (bySlot.get(entry.slotId) ?? 0) + 1);
    assert.equal(bySlot.size, 2);
    for (const count of bySlot.values()) assert.equal(count, 3);
    for (const entry of entries) assert.ok(entry.blockId);
  }
});

test('member classes are released in the elective slot', () => {
  const data = baseData();
  const groups = [group('g1', ['class-1', 'class-2'], ['teacher-math', 'teacher-chinese', 'teacher-english'])];
  const output = run({ ...data, coursePlans: regularPlans(), electiveGroups: groups });
  assert.equal(output.hasFeasibleSolution, true, output.explanation);
  const electiveSlots = new Set(output.entries.filter((entry) => entry.groupId === 'g1').map((entry) => entry.slotId));
  const memberClasses = new Set(['class-1', 'class-2']);
  const violations = output.entries.filter(
    (entry) => !entry.groupId && memberClasses.has(entry.classId) && electiveSlots.has(entry.slotId),
  );
  assert.equal(violations.length, 0, 'member classes must not have regular lessons in elective slots');
});

test('a group with a duplicated block teacher cannot be fully scheduled', () => {
  const data = baseData();
  const groups = [group('g1', ['class-1', 'class-2'], ['teacher-math', 'teacher-math', 'teacher-chinese'])];
  const output = run({ ...data, coursePlans: regularPlans(), electiveGroups: groups }, { timeLimitSeconds: 4 });
  assert.equal(output.hasFeasibleSolution, false);
  const placed = output.entries.filter((entry) => entry.groupId === 'g1').length;
  assert.ok(placed < 2 * 3, 'cannot place both lessons with a duplicated teacher');
});

test('a group larger than the room count cannot be fully scheduled', () => {
  // Four parallel blocks, three rooms: the fourth block never finds a room.
  const data = baseData();
  const groups = [
    group('g1', ['class-1', 'class-2'], ['teacher-math', 'teacher-chinese', 'teacher-english', 'teacher-physics'], 1),
  ];
  const output = run({ ...data, coursePlans: regularPlans(), electiveGroups: groups }, { timeLimitSeconds: 4 });
  assert.equal(output.hasFeasibleSolution, false);
  assert.equal(output.entries.filter((entry) => entry.groupId === 'g1').length, 0);
});

test('invalid elective group input is rejected with a clear violation', () => {
  const data = baseData();
  const groups = [{ id: 'g1', subjectId: 'subject-math', weeklyPeriods: 1, classIds: ['missing-class'], blocks: [] }];
  const output = run({ ...data, coursePlans: regularPlans(), electiveGroups: groups }, { timeLimitSeconds: 2 });
  assert.equal(output.hasFeasibleSolution, false);
  assert.ok(output.hardConstraintViolations.some((item) => item.includes('走班组 g1')));
});

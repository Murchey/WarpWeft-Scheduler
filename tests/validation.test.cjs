const test = require('node:test');
const assert = require('node:assert/strict');

async function loadValidation() {
  return import('../packages/validation/src.ts');
}

function input() {
  return {
    protocolVersion: '1.0',
    dataSnapshotVersion: 'test',
    timeSlots: [{ id: 's1', day: 1, period: 1 }],
    classes: [
      { id: 'c1', name: '一班', size: 40 },
      { id: 'c2', name: '二班', size: 40 },
    ],
    teachers: [{ id: 't1', name: '王老师', classIds: ['c1'] }],
    subjects: [{ id: 'sub1', name: '数学' }],
    rooms: [{ id: 'r1', name: '一号教室', capacity: 40, type: '普通教室' }],
    coursePlans: [
      { id: 'p1', classId: 'c1', subjectId: 'sub1', teacherId: 't1', weeklyPeriods: 1 },
    ],
    unavailableSlots: [],
    lockedEntries: [],
    hardConstraints: [],
    softConstraints: [],
    timeLimitSeconds: 1,
    randomSeed: 1,
  };
}

test('solver input rejects a teacher outside the bound class', async () => {
  const { validateInput } = await loadValidation();
  const data = input();
  assert.equal(validateInput(data).length, 0);
  data.coursePlans[0].classId = 'c2';
  const issues = validateInput(data);
  assert.ok(issues.some((issue) => issue.code === 'TEACHER_CLASS_BINDING'));
});

test('solver input rejects unknown class ids in a teacher binding', async () => {
  const { validateInput } = await loadValidation();
  const data = input();
  data.teachers[0].classIds = ['missing-class'];
  const issues = validateInput(data);
  assert.ok(issues.some((issue) => issue.code === 'MISSING_REFERENCE' && issue.field === 'classIds'));
});

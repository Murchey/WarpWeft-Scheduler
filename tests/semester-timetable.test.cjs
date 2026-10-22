const test = require('node:test');
const assert = require('node:assert/strict');

async function loadSemesterTimetable() {
  return import('../apps/renderer/src/semesterTimetable.ts');
}

function fixture() {
  const timeSlots = [
    { id: 'mon-1', day: 1, period: 1, label: '周一 第1节', kind: 'regular' },
    { id: 'tue-1', day: 2, period: 1, label: '周二 第1节', kind: 'regular' },
  ];
  const data = {
    school: { id: 's', name: '测试学校' },
    classes: [{ id: 'c1', name: '七年级1班', size: 40, grade: '七年级' }],
    teachers: [{ id: 't1', name: '王老师' }],
    subjects: [{ id: 'sub1', name: '数学' }],
    rooms: [{ id: 'r1', name: '一号教室', capacity: 50, type: '普通教室' }],
    timeSlots,
    coursePlans: [{ id: 'p1', classId: 'c1', subjectId: 'sub1', teacherId: 't1', weeklyPeriods: 2 }],
    semester: { startDate: '2026-09-07', endDate: '2026-09-27' },
    adjustments: [],
  };
  const result = {
    protocolVersion: '1.0',
    status: 'COMPLETED',
    entries: [
      { id: 'e1', coursePlanId: 'p1', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 'mon-1', weeks: 'all', source: 'AUTO', locked: false },
      { id: 'e2', coursePlanId: 'p1', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 'tue-1', weeks: 'all', source: 'AUTO', locked: false },
    ],
    hardConstraintViolations: [],
    hasFeasibleSolution: true,
    elapsedMs: 1,
  };
  const settings = {
    view: 'class',
    entityId: 'c1',
    layout: 'vertical',
    schoolName: '测试学校',
    title: '班级课表',
    weeks: 'all',
    weekNo: null,
    showTeacher: true,
    showRoom: true,
    showWeeks: true,
    scope: 'semester',
  };
  return { data, result, settings };
}

test('identical weeks collapse into one pattern', async () => {
  const { semesterPatterns } = await loadSemesterTimetable();
  const { data, result, settings } = fixture();
  const patterns = semesterPatterns(data, result, [], settings);
  assert.equal(patterns.length, 1);
  assert.deepEqual(patterns[0].weeks, [1, 2, 3]);
  assert.equal(patterns[0].label, '第1-3周');
  assert.equal(patterns[0].entries.length, 2);
});

test('a date adjustment splits only the affected week', async () => {
  const { semesterPatterns } = await loadSemesterTimetable();
  const { data, result, settings } = fixture();
  const cancel = {
    id: 'a1',
    date: '2026-09-14',
    type: 'cancel',
    slotId: 'mon-1',
    classId: 'c1',
    originalEntryId: 'e1',
    status: 'active',
    createdAt: '2026-09-10T00:00:00.000Z',
  };
  const patterns = semesterPatterns(data, result, [cancel], settings);
  assert.equal(patterns.length, 2);
  const week2 = patterns.find((pattern) => pattern.weeks.includes(2));
  assert.equal(week2.weeks.length, 1);
  assert.equal(week2.entries.some((entry) => entry.slotId === 'mon-1'), false);
  const other = patterns.find((pattern) => !pattern.weeks.includes(2));
  assert.deepEqual(other.weeks, [1, 3]);
  assert.equal(other.entries.some((entry) => entry.slotId === 'mon-1'), true);
});

test('teacher view patterns are computed from the teacher schedule', async () => {
  const { semesterPatterns } = await loadSemesterTimetable();
  const { data, result, settings } = fixture();
  const patterns = semesterPatterns(data, result, [], { ...settings, view: 'teacher', entityId: 't1' });
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].entries.length, 2);
});

const test = require('node:test');
const assert = require('node:assert/strict');

test('timetable diff reports added, removed and changed lessons against the published baseline', async () => {
  const { diffTimetables } = await import('../apps/renderer/src/timetableDiff.ts');
  const data = {
    school: { id: 's', name: '测试学校' },
    classes: [{ id: 'c1', name: '七年级1班', size: 40 }],
    teachers: [{ id: 't1', name: '王老师' }, { id: 't2', name: '李老师' }],
    subjects: [{ id: 'sub1', name: '数学' }],
    rooms: [{ id: 'r1', name: '一号教室' }, { id: 'r2', name: '二号教室' }],
    timeSlots: [
      { id: 'm1', day: 1, period: 1, label: '周一 第1节' },
      { id: 'm2', day: 1, period: 2, label: '周一 第2节' },
    ],
    coursePlans: [{ id: 'p1', classId: 'c1', subjectId: 'sub1', teacherId: 't1', weeklyPeriods: 3 }],
  };
  const base = {
    protocolVersion: '1', status: 'COMPLETED', entries: [
      { id: 'e1', coursePlanId: 'p1', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 'm1', source: 'AUTO', locked: false },
      { id: 'e2', coursePlanId: 'p1', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 'm2', source: 'AUTO', locked: false },
    ],
  };
  const next = {
    ...base,
    entries: [
      { ...base.entries[0], slotId: 'm2', teacherId: 't2', roomId: 'r2', source: 'MANUAL' },
      { id: 'e3', coursePlanId: 'p1', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 'm1', source: 'AUTO', locked: false },
    ],
  };
  const summary = diffTimetables(data, base, next);
  assert.equal(summary.changed, 1);
  assert.equal(summary.added, 1);
  assert.equal(summary.removed, 1);
  assert.equal(summary.unchanged, 0);
  assert.match(summary.items.find((item) => item.kind === 'changed').detail, /教师/);
});

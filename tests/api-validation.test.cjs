const test = require('node:test');
const assert = require('node:assert/strict');
const { validateData } = require('../apps/desktop/api.cjs');

test('API rejects invalid timetable references before persistence', () => {
  const data = {
    classes: [{ id: 'c1' }], teachers: [{ id: 't1' }], subjects: [{ id: 's1' }],
    rooms: [{ id: 'r1', capacity: 30 }], timeSlots: [{ id: 'slot-1', day: 1, period: 1 }],
    coursePlans: [{ id: 'p1', classId: 'c1', teacherId: 't1', subjectId: 's1', weeklyPeriods: 1, fixedSlotId: 'missing-slot' }],
  };
  assert.match(validateData(data), /不存在的固定时间/);
});

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

test('API accepts week parity plans and rejects unknown week types', () => {
  const data = {
    classes: [{ id: 'c1' }], teachers: [{ id: 't1' }], subjects: [{ id: 's1' }],
    rooms: [{ id: 'r1', capacity: 30 }], timeSlots: [{ id: 'slot-1', day: 1, period: 1 }],
    coursePlans: [{ id: 'p1', classId: 'c1', teacherId: 't1', subjectId: 's1', weeklyPeriods: 1, weeks: 'odd' }],
  };
  assert.equal(validateData(data), null);
  data.coursePlans[0].weeks = 'weekly';
  assert.match(validateData(data), /周次无效/);
});

test('API validates the semester date range', () => {
  const data = {
    classes: [{ id: 'c1' }], teachers: [{ id: 't1' }], subjects: [{ id: 's1' }],
    rooms: [{ id: 'r1', capacity: 30 }], timeSlots: [{ id: 'slot-1', day: 1, period: 1 }],
    coursePlans: [{ id: 'p1', classId: 'c1', teacherId: 't1', subjectId: 's1', weeklyPeriods: 1 }],
  };
  assert.equal(validateData(data), null);
  data.semester = { startDate: '2026-09-01', endDate: '2027-01-18' };
  assert.equal(validateData(data), null);
  data.semester.startDate = '2026-9-1';
  assert.match(validateData(data), /学期日期格式/);
  data.semester = { startDate: '2026-02-30', endDate: '2026-03-01' };
  assert.match(validateData(data), /学期日期格式/);
  data.semester = { startDate: '2026-09-10', endDate: '2026-09-01' };
  assert.match(validateData(data), /不能晚于/);
});

test('API validates slot kinds and start times', () => {
  const data = {
    classes: [{ id: 'c1' }], teachers: [{ id: 't1' }], subjects: [{ id: 's1' }],
    rooms: [{ id: 'r1', capacity: 30 }],
    timeSlots: [{ id: 'slot-1', day: 1, period: 1, kind: 'morning', start: '07:40', duration: 20 }],
    coursePlans: [{ id: 'p1', classId: 'c1', teacherId: 't1', subjectId: 's1', weeklyPeriods: 1, kind: 'morning' }],
  };
  assert.equal(validateData(data), null);
  data.timeSlots[0].kind = 'dawn';
  assert.match(validateData(data), /时段类型无效/);
  data.timeSlots[0].kind = 'morning';
  data.timeSlots[0].start = '7点40';
  assert.match(validateData(data), /开始时间无效/);
  data.timeSlots[0].start = '07:40';
  data.coursePlans[0].kind = 'weekly';
  assert.match(validateData(data), /时段类型无效/);
});

test('API validates elective groups', () => {
  const data = {
    classes: [{ id: 'c1' }, { id: 'c2' }], teachers: [{ id: 't1' }, { id: 't2' }], subjects: [{ id: 's1' }],
    rooms: [{ id: 'r1', capacity: 30 }], timeSlots: [{ id: 'slot-1', day: 1, period: 1 }],
    coursePlans: [{ id: 'p1', classId: 'c1', teacherId: 't1', subjectId: 's1', weeklyPeriods: 1 }],
    electiveGroups: [{
      id: 'g1', name: '分层', subjectId: 's1', weeklyPeriods: 2, classIds: ['c1', 'c2'],
      blocks: [{ id: 'b1', teacherId: 't1' }, { id: 'b2', teacherId: 't2' }],
    }],
  };
  assert.equal(validateData(data), null);
  data.electiveGroups[0].blocks[1].teacherId = 'missing-teacher';
  assert.match(validateData(data), /并行班引用了不存在的教师/);
  data.electiveGroups[0].blocks[1].teacherId = 't2';
  data.electiveGroups[0].classIds = [];
  assert.match(validateData(data), /至少需要一个班级/);
});

test('API validates date adjustments before persistence', () => {
  const data = {
    classes: [{ id: 'c1' }], teachers: [{ id: 't1' }], subjects: [{ id: 's1' }],
    rooms: [{ id: 'r1', capacity: 30 }], timeSlots: [{ id: 'slot-1', day: 1, period: 1 }],
    coursePlans: [{ id: 'p1', classId: 'c1', teacherId: 't1', subjectId: 's1', weeklyPeriods: 1 }],
    candidate: { entries: [{ id: 'e1', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 'slot-1' }] },
    adjustments: [{
      id: 'a1', date: '2026-10-19', type: 'substitute', slotId: 'slot-1', classId: 'c1',
      originalEntryId: 'e1', substituteTeacherId: 'missing-teacher', createdAt: '2026-10-18T00:00:00.000Z', status: 'active',
    }],
  };
  assert.match(validateData(data), /代课教师不存在/);
  data.adjustments[0].substituteTeacherId = 't1';
  data.adjustments[0].date = '2026/10/19';
  assert.match(validateData(data), /日期无效/);
  data.adjustments[0].date = '2026-10-19';
  data.adjustments[0].type = 'move';
  data.adjustments[0].targetSlotId = 'missing-slot';
  assert.match(validateData(data), /调课目标无效/);
});

test('API allows a teaching plan without a fixed teacher', () => {
  const data = {
    classes: [{ id: 'c1' }], teachers: [{ id: 't1' }], subjects: [{ id: 's1' }],
    rooms: [{ id: 'r1', capacity: 30 }], timeSlots: [{ id: 'slot-1', day: 1, period: 1 }],
    coursePlans: [{ id: 'p1', classId: 'c1', teacherId: '', subjectId: 's1', weeklyPeriods: 1 }],
    candidate: { entries: [{ id: 'e1', classId: 'c1', teacherId: '', roomId: 'r1', slotId: 'slot-1' }] },
  };
  assert.equal(validateData(data), null);
});

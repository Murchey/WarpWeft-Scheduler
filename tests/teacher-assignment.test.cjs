const test = require('node:test');
const assert = require('node:assert/strict');

async function loadAssignment() {
  return import('../apps/renderer/src/teacherAssignment.ts');
}

function fixture() {
  return {
    school: { id: 's', name: '测试学校' },
    classes: [
      { id: 'c1', name: '二年级1班', grade: '二年级', size: 40 },
      { id: 'c2', name: '三年级1班', grade: '三年级', size: 40 },
      { id: 'c3', name: '四年级1班', grade: '四年级', size: 40 },
    ],
    teachers: [
      { id: 't1', name: '王老师', subject: '数学', grade: '1;2;3' },
      { id: 't2', name: '李老师', subject: '数学', grade: '3;4' },
    ],
    subjects: [{ id: 's1', name: '数学' }],
    rooms: [],
    timeSlots: [],
    coursePlans: [
      { id: 'p1', classId: 'c1', subjectId: 's1', teacherId: '', weeklyPeriods: 4 },
      { id: 'p2', classId: 'c2', subjectId: 's1', teacherId: '', weeklyPeriods: 4 },
      { id: 'p3', classId: 'c3', subjectId: 's1', teacherId: '', weeklyPeriods: 4 },
    ],
  };
}

test('blank teachers are assigned by subject and grade with load balancing', async () => {
  const { assignMissingTeachers } = await loadAssignment();
  const result = assignMissingTeachers(fixture());
  assert.equal(result.assigned, 3);
  const byId = new Map(result.plans.map((plan) => [plan.id, plan]));
  assert.equal(byId.get('p1').teacherId, 't1');
  assert.equal(byId.get('p2').teacherId, 't2');
  assert.equal(byId.get('p3').teacherId, 't2');
});

test('a subject mismatch leaves the plan unresolved', async () => {
  const { assignMissingTeachers } = await loadAssignment();
  const data = fixture();
  data.teachers = [{ id: 't1', name: '王老师', subject: '语文', grade: '1;2;3' }];
  const result = assignMissingTeachers(data);
  assert.equal(result.assigned, 0);
  assert.equal(result.unresolved, 3);
  assert.equal(result.plans.every((plan) => plan.teacherId === ''), true);
});

test('teacher class bindings restrict blank-teacher assignment', async () => {
  const { assignMissingTeachers } = await loadAssignment();
  const data = fixture();
  data.teachers = [
    { id: 't1', name: '王老师', subject: '数学', grade: '1;2;3', classes: '二年级1班' },
    { id: 't2', name: '李老师', subject: '数学', grade: '3;4', classes: '三年级1班' },
  ];
  const result = assignMissingTeachers(data);
  const byId = new Map(result.plans.map((plan) => [plan.id, plan]));
  assert.equal(byId.get('p1').teacherId, 't1');
  assert.equal(byId.get('p2').teacherId, 't2');
  assert.equal(byId.get('p3').teacherId, '');
  assert.equal(result.unresolved, 1);
});

test('homeroom teacher gets a blank lesson in their own class first', async () => {
  const { assignMissingTeachers } = await loadAssignment();
  const data = fixture();
  data.classes[0].homeroomTeacherId = 't1';
  const result = assignMissingTeachers(data);
  const byId = new Map(result.plans.map((plan) => [plan.id, plan]));
  assert.equal(byId.get('p1').teacherId, 't1');
});

test('Chinese grade names and explicit teacher grades are compared numerically', async () => {
  const { gradeNumber } = await loadAssignment();
  assert.equal(gradeNumber('七年级'), 7);
  assert.equal(gradeNumber('7'), 7);
  assert.equal(gradeNumber('三年级'), 3);
  assert.equal(gradeNumber('初一'), 7);
  assert.equal(gradeNumber('高二'), 11);
  assert.equal(gradeNumber(''), null);
});


function capacityFixture() {
  return {
    school: { id: 's', name: '测试学校' },
    classes: [{ id: 'c1', name: '二年级1班', grade: '二年级', size: 40 }],
    teachers: [{ id: 't1', name: '王老师', subject: '数学', grade: '2' }],
    subjects: [{ id: 's1', name: '数学' }],
    rooms: [],
    timeSlots: [
      { id: 'd1-p1', day: 1, period: 1, label: '周一 第1节' },
      { id: 'd1-p2', day: 1, period: 2, label: '周一 第2节' },
    ],
    coursePlans: [{ id: 'p1', classId: 'c1', subjectId: 's1', teacherId: '', weeklyPeriods: 2 }],
  };
}

test('a teacher is skipped when the weekly load exceeds available slots', async () => {
  const { assignMissingTeachers } = await loadAssignment();
  const data = capacityFixture();
  data.coursePlans[0].weeklyPeriods = 3;
  const result = assignMissingTeachers(data);
  assert.equal(result.assigned, 0);
  assert.equal(result.unresolved, 1);
  assert.ok(result.unresolvedReasons[0].reason.includes('已满'));
});

test('unavailable slots reduce the weekly capacity used by auto assignment', async () => {
  const { assignMissingTeachers } = await loadAssignment();
  const data = capacityFixture();
  data.unavailableSlots = [{ teacherId: 't1', slotId: 'd1-p1' }];
  const result = assignMissingTeachers(data);
  assert.equal(result.assigned, 0);
  assert.equal(result.unresolved, 1);
});

test('a must-level daily cap limits auto assignment', async () => {
  const { assignMissingTeachers } = await loadAssignment();
  const data = capacityFixture();
  data.timeSlots = Array.from({ length: 5 }, (_, index) => ({ id: 's' + index, day: index + 1, period: 1, label: '第' + (index + 1) + '天' }));
  data.coursePlans[0].weeklyPeriods = 6;
  data.rules = [{
    id: 'r1', kind: 'TEACHER_MAX_DAILY', scope: { type: 'teacher', teacherId: 't1' }, time: { type: 'all' },
    importance: 'must', params: { maxPerDay: 1 }, enabled: true, createdAt: '2026-09-01T00:00:00.000Z', source: 'manual',
  }];
  const result = assignMissingTeachers(data);
  assert.equal(result.assigned, 0);
  assert.equal(result.unresolved, 1);
});

test('a teacher already teaching the class is preferred for continuity', async () => {
  const { assignMissingTeachers } = await loadAssignment();
  const data = capacityFixture();
  data.timeSlots = Array.from({ length: 10 }, (_, index) => ({ id: 's' + index, day: Math.floor(index / 2) + 1, period: (index % 2) + 1, label: '时段' + index }));
  data.teachers = [
    { id: 't1', name: '甲', subject: '数学', grade: '2' },
    { id: 't2', name: '乙', subject: '数学', grade: '2' },
  ];
  data.coursePlans = [
    { id: 'existing', classId: 'c1', subjectId: 's1', teacherId: 't1', weeklyPeriods: 4 },
    { id: 'blank', classId: 'c1', subjectId: 's1', teacherId: '', weeklyPeriods: 1 },
  ];
  const result = assignMissingTeachers(data);
  const blank = result.plans.find((plan) => plan.id === 'blank');
  assert.equal(blank.teacherId, 't1');
});

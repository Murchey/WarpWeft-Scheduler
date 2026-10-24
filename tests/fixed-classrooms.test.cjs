const test = require('node:test');
const assert = require('node:assert/strict');

async function loadFixedRooms() {
  return import('../apps/renderer/src/fixedClassrooms.ts');
}

function fixture() {
  const classes = [
    { id: 'c1', name: '一年级1班', size: 40, grade: '1' },
    { id: 'c2', name: '一年级2班', size: 40, grade: '1' },
  ];
  const rooms = [
    { id: 'r1', name: '一年级1班教室', capacity: 40, type: '普通教室' },
    { id: 'r2', name: '一年级2班教室', capacity: 40, type: '普通教室' },
    { id: 'r3', name: '实验室', capacity: 50, type: '实验室' },
  ];
  const coursePlans = [
    { id: 'p1', classId: 'c1', subjectId: 's1', teacherId: 't1', weeklyPeriods: 1 },
    { id: 'p2', classId: 'c1', subjectId: 's2', teacherId: 't1', weeklyPeriods: 1, roomType: '实验室' },
    { id: 'p3', classId: 'c2', subjectId: 's1', teacherId: 't2', weeklyPeriods: 1 },
  ];
  const entries = [
    { id: 'e1', coursePlanId: 'p1', classId: 'c1', teacherId: 't1', roomId: 'r2', slotId: 's1', source: 'AUTO', locked: false },
    { id: 'e2', coursePlanId: 'p2', classId: 'c1', teacherId: 't1', roomId: 'r3', slotId: 's2', source: 'AUTO', locked: false },
    { id: 'e3', coursePlanId: 'p3', classId: 'c2', teacherId: 't2', roomId: 'r1', slotId: 's3', source: 'AUTO', locked: false },
  ];
  const result = {
    protocolVersion: '1.0',
    status: 'COMPLETED',
    entries,
    hardConstraintViolations: [],
    hasFeasibleSolution: true,
    elapsedMs: 1,
  };
  const data = {
    school: { id: 's', name: '测试' },
    classes,
    teachers: [{ id: 't1', name: '甲老师' }, { id: 't2', name: '乙老师' }],
    subjects: [{ id: 's1', name: '语文' }, { id: 's2', name: '实验' }],
    rooms,
    timeSlots: [{ id: 's1', day: 1, period: 1, label: '周一 第1节' }],
    coursePlans,
    candidate: result,
    published: null,
  };
  return { data, result };
}

test('regular lessons move to the class homeroom; special rooms stay', async () => {
  const { withFixedClassRooms } = await loadFixedRooms();
  const { data } = fixture();
  const fixed = withFixedClassRooms(data);
  const byId = new Map(fixed.candidate.entries.map((entry) => [entry.id, entry]));
  assert.equal(byId.get('e1').roomId, 'r1');
  assert.equal(byId.get('e2').roomId, 'r3');
  assert.equal(byId.get('e3').roomId, 'r2');
});

test('normalization keeps the input untouched and normalizes the published timetable', async () => {
  const { withFixedClassRooms } = await loadFixedRooms();
  const { data, result } = fixture();
  data.published = result;
  const fixed = withFixedClassRooms(data);
  assert.equal(data.candidate.entries[0].roomId, 'r2');
  assert.equal(fixed.published.entries[0].roomId, 'r1');
});

test('full room mode leaves the solver room assignment untouched', async () => {
  const { withFixedClassRooms } = await loadFixedRooms();
  const { data } = fixture();
  data.roomMode = 'full';
  const fixed = withFixedClassRooms(data);
  assert.equal(fixed.candidate.entries[0].roomId, 'r2');
});

test('simplified mode creates one fixed room per class when rooms are empty', async () => {
  const { withFixedClassRooms } = await loadFixedRooms();
  const { data } = fixture();
  data.rooms = [];
  data.candidate = null;
  const fixed = withFixedClassRooms(data);
  assert.equal(fixed.rooms.length, 2);
  assert.equal(fixed.rooms[0].name, '一年级1班教室');
});

test('classes without a matching or large-enough room keep the solver room', async () => {
  const { withFixedClassRooms } = await loadFixedRooms();
  const { data } = fixture();
  data.classes = [
    { id: 'c1', name: '三年级9班', size: 40, grade: '3' },
    { id: 'c2', name: '一年级2班', size: 45, grade: '1' },
  ];
  const fixed = withFixedClassRooms(data);
  const byId = new Map(fixed.candidate.entries.map((entry) => [entry.id, entry]));
  assert.equal(byId.get('e1').roomId, 'r2');
  assert.equal(byId.get('e3').roomId, 'r1');
});

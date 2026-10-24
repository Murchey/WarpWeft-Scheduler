const test = require('node:test');
const assert = require('node:assert/strict');

async function loadDnd() {
  return import('../apps/renderer/src/dnd.ts');
}

function base() {
  const timeSlots = [
    { id: 's1', day: 1, period: 1, label: '周一 第1节', kind: 'regular' },
    { id: 's2', day: 1, period: 2, label: '周一 第2节', kind: 'regular' },
    { id: 's3', day: 1, period: 3, label: '周一 第3节', kind: 'regular' },
    { id: 's4', day: 2, period: 1, label: '周二 第1节', kind: 'regular' },
    { id: 'm1', day: 1, period: 0, label: '周一 早读', kind: 'morning' },
  ];
  const coursePlans = [
    { id: 'p1', classId: 'c1', subjectId: 'sub1', teacherId: 't1', weeklyPeriods: 1 },
    { id: 'p2', classId: 'c1', subjectId: 'sub2', teacherId: 't2', weeklyPeriods: 1 },
    { id: 'p3', classId: 'c2', subjectId: 'sub1', teacherId: 't1', weeklyPeriods: 1 },
    { id: 'p4', classId: 'c1', subjectId: 'sub3', teacherId: 't3', weeklyPeriods: 1, fixedSlotId: 's1' },
  ];
  const entries = [
    { id: 'e1', coursePlanId: 'p1', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 's1', locked: false },
    { id: 'e2', coursePlanId: 'p2', classId: 'c1', teacherId: 't2', roomId: 'r2', slotId: 's2', locked: false },
    { id: 'e3', coursePlanId: 'p3', classId: 'c2', teacherId: 't1', roomId: 'r3', slotId: 's3', locked: false },
  ];
  const data = {
    school: { id: 's', name: '测试' }, classes: [{ id: 'c1', name: '一班' }, { id: 'c2', name: '二班' }],
    teachers: [], subjects: [], rooms: [], timeSlots, coursePlans, electiveGroups: [], unavailableSlots: [],
  };
  return { data, entries, timeSlots, coursePlans };
}

const ctx = (data, entries, overrides = {}) => ({ data, entries, view: 'class', overlay: false, ...overrides });

test('moving into an empty compatible slot is allowed', async () => {
  const { checkMove } = await loadDnd();
  const { data, entries, timeSlots } = base();
  assert.equal(checkMove(entries[0], timeSlots[3], ctx(data, entries)).ok, true);
});

test('study and aftercare plans can move into regular slots', async () => {
  const { checkMove } = await loadDnd();
  const { data, entries, timeSlots } = base();
  data.coursePlans[0] = { ...data.coursePlans[0], kind: 'study' };
  assert.equal(checkMove(entries[0], timeSlots[3], ctx(data, entries)).ok, true);
  data.coursePlans[0] = { ...data.coursePlans[0], kind: 'aftercare' };
  assert.equal(checkMove(entries[0], timeSlots[3], ctx(data, entries)).ok, true);
});

test('regular plans cannot move into an aftercare slot', async () => {
  const { checkMove } = await loadDnd();
  const { data, entries, timeSlots } = base();
  const aftercare = { id: 's5', day: 2, period: 2, label: '周二 课后服务', kind: 'aftercare' };
  const data2 = { ...data, timeSlots: [...timeSlots, aftercare] };
  assert.match(checkMove(entries[0], aftercare, ctx(data2, entries)).reason, /时段类型与课程不匹配/);
});

test('class, teacher, room and slot-kind clashes explain themselves', async () => {
  const { checkMove } = await loadDnd();
  const { data, entries, timeSlots } = base();
  const e1 = entries[0];
  const e2 = entries[1];
  assert.match(checkMove(e1, timeSlots[1], ctx(data, entries)).reason, /班级/);
  assert.equal(checkMove(e1, timeSlots[4], ctx(data, entries)).reason, '时段类型与课程不匹配');

  const data2 = { ...data, unavailableSlots: [{ teacherId: 't2', slotId: 's3' }] };
  assert.match(checkMove(e2, timeSlots[2], ctx(data2, entries)).reason, /教师.*不可用/);

  // Same room at the target slot, different class and teacher.
  const data3 = {
    ...data,
    coursePlans: [ ...data.coursePlans,
      { id: 'p9', classId: 'c3', subjectId: 's', teacherId: 't9', weeklyPeriods: 1 },
      { id: 'p10', classId: 'c4', subjectId: 's', teacherId: 't10', weeklyPeriods: 1 },
    ],
  };
  const e9 = { id: 'e9', coursePlanId: 'p9', classId: 'c3', teacherId: 't9', roomId: 'r3', slotId: 's4', locked: false };
  const e10 = { id: 'e10', coursePlanId: 'p10', classId: 'c4', teacherId: 't10', roomId: 'r3', slotId: 's1', locked: false };
  const move = checkMove(e10, timeSlots[3], ctx(data3, [...entries, e9, e10]));
  assert.match(move.reason, /教室/);
});

test('locked, fixed, group and overlay are rejected', async () => {
  const { checkMove } = await loadDnd();
  const { data, entries, timeSlots } = base();
  assert.match(checkMove({ ...entries[0], locked: true }, timeSlots[2], ctx(data, entries)).reason, /锁定/);
  const fixedEntry = { id: 'fx', coursePlanId: 'p4', classId: 'c1', teacherId: 't3', roomId: 'r4', slotId: 's2', locked: false };
  assert.match(checkMove(fixedEntry, timeSlots[2], ctx(data, [...entries, fixedEntry])).reason, /固定/);
  assert.match(checkMove({ ...entries[0], groupId: 'g1' }, timeSlots[2], ctx(data, entries)).reason, /走班/);
  assert.match(checkMove(entries[0], timeSlots[2], ctx(data, entries, { overlay: true })).reason, /只读/);
  assert.match(checkMove(entries[0], timeSlots[2], ctx(data, entries, { view: 'teacher' })).reason, /班级视图/);
});

test('odd and even lessons may share a slot, all-week lessons may not', async () => {
  const { checkMove } = await loadDnd();
  const { data, entries, timeSlots } = base();
  const data2 = {
    ...data,
    coursePlans: [
      ...data.coursePlans,
      { id: 'odd', classId: 'c1', subjectId: 's', teacherId: 't8', weeklyPeriods: 1, weeks: 'odd' },
      { id: 'even', classId: 'c1', subjectId: 's', teacherId: 't7', weeklyPeriods: 1, weeks: 'even' },
      { id: 'allp', classId: 'c1', subjectId: 's', teacherId: 't6', weeklyPeriods: 1 },
    ],
  };
  const evenEntry = { id: 'ev', coursePlanId: 'even', classId: 'c1', teacherId: 't7', roomId: 'r7', slotId: 's4', locked: false };
  const oddEntry = { id: 'od', coursePlanId: 'odd', classId: 'c1', teacherId: 't8', roomId: 'r8', slotId: 's3', locked: false };
  const allEntry = { id: 'al', coursePlanId: 'allp', classId: 'c1', teacherId: 't6', roomId: 'r6', slotId: 's3', locked: false };
  const entries2 = [...entries, evenEntry, oddEntry, allEntry];
  assert.equal(checkMove(oddEntry, timeSlots[3], ctx(data2, entries2)).ok, true);
  assert.match(checkMove(allEntry, timeSlots[3], ctx(data2, entries2)).reason, /班级/);
});

test('swap requires same class and two feasible directions', async () => {
  const { checkSwap } = await loadDnd();
  const { data, entries, timeSlots } = base();
  const e1 = entries[0];
  const e2 = entries[1];
  assert.equal(checkSwap(e1, e2, ctx(data, entries)).ok, true);
  assert.match(checkSwap(e1, { ...e2, classId: 'c2' }, ctx(data, entries)).reason, /不同班级/);
  assert.match(checkSwap(e1, { ...e2, locked: true }, ctx(data, entries)).reason, /锁定/);

  const data2 = { ...data, unavailableSlots: [{ teacherId: 't1', slotId: 's2' }] };
  assert.match(checkSwap(e1, e2, ctx(data2, entries)).reason, /目标时段/);

  const fixedEntry = { id: 'fx', coursePlanId: 'p4', classId: 'c1', teacherId: 't3', roomId: 'r4', slotId: 's3', locked: false };
  assert.match(checkSwap(e1, fixedEntry, ctx(data, [...entries, fixedEntry])).reason, /固定时间/);
  assert.equal(timeSlots.length, 5);
});



const test = require('node:test');
const assert = require('node:assert/strict');

async function loadStats() {
  return import('../packages/statistics/src.ts');
}

function baseInput() {
  return {
    timeSlots: [
      { id: 'd1-p1', day: 1, period: 1, label: '周一 第1节' },
      { id: 'd1-p2', day: 1, period: 2, label: '周一 第2节' },
      { id: 'd2-p1', day: 2, period: 1, label: '周二 第1节' },
      { id: 'd2-p2', day: 2, period: 2, label: '周二 第2节' },
    ],
    classes: [
      { id: 'c1', name: '一班', grade: '七年级' },
      { id: 'c2', name: '二班', grade: '七年级' },
    ],
    teachers: [
      { id: 't1', name: '甲老师' },
      { id: 't2', name: '乙老师' },
    ],
    subjects: [
      { id: 's1', name: '数学' },
      { id: 's2', name: '语文' },
    ],
    coursePlans: [
      { id: 'p1', classId: 'c1', subjectId: 's1', teacherId: 't1', weeklyPeriods: 2 },
      { id: 'p2', classId: 'c1', subjectId: 's2', teacherId: 't2', weeklyPeriods: 1 },
      { id: 'p3', classId: 'c2', subjectId: 's1', teacherId: 't1', weeklyPeriods: 1 },
    ],
    entries: [
      { id: 'e1', coursePlanId: 'p1', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 'd1-p1' },
      { id: 'e2', coursePlanId: 'p1', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 'd2-p1' },
      { id: 'e3', coursePlanId: 'p2', classId: 'c1', teacherId: 't2', roomId: 'r1', slotId: 'd1-p2' },
    ],
    unavailableSlots: [{ teacherId: 't1', slotId: 'd2-p2' }],
  };
}

test('plan and placed counts are reported separately', async () => {
  const { buildStats } = await loadStats();
  const report = buildStats(baseInput());
  assert.equal(report.summary.planned, 4);
  assert.equal(report.summary.placed, 3);
  assert.equal(report.summary.missing, 1);

  const teacher1 = report.teachers.find((row) => row.id === 't1');
  assert.equal(teacher1.planned, 3);
  assert.equal(teacher1.placed, 2);
  assert.equal(teacher1.missing, 1);
  // 4 slots minus 1 unavailable slot
  assert.equal(teacher1.capacity, 3);
  assert.equal(teacher1.ratio, 0.667);
  assert.deepEqual(teacher1.subjects, [{ subjectId: 's1', subjectName: '数学', planned: 3, placed: 2 }]);
});

test('subject rows aggregate classes and teachers', async () => {
  const { buildStats } = await loadStats();
  const report = buildStats(baseInput());
  const math = report.subjects.find((row) => row.id === 's1');
  assert.equal(math.planned, 3);
  assert.equal(math.placed, 2);
  assert.equal(math.classCount, 2);
  assert.equal(math.teacherCount, 1);

  const chinese = report.subjects.find((row) => row.id === 's2');
  assert.equal(chinese.classCount, 1);
  assert.equal(chinese.teacherCount, 1);
});

test('class rows expose free slots and per-day placement', async () => {
  const { buildStats } = await loadStats();
  const report = buildStats(baseInput());
  const class1 = report.classes.find((row) => row.id === 'c1');
  assert.equal(class1.planned, 3);
  assert.equal(class1.placed, 3);
  assert.equal(class1.missing, 0);
  assert.equal(class1.capacity, 4);
  assert.equal(class1.freeSlots, 1);
  assert.equal(class1.dayGaps, 0);
  assert.deepEqual(
    class1.byDay.map((row) => [row.day, row.placed]),
    [
      [1, 2],
      [2, 1],
    ],
  );

  const class2 = report.classes.find((row) => row.id === 'c2');
  assert.equal(class2.placed, 0);
  assert.equal(class2.missing, 1);
  assert.equal(class2.freeSlots, 4);
});

test('entries without a matching plan are ignored', async () => {
  const { buildStats } = await loadStats();
  const input = baseInput();
  input.entries.push({ id: 'ghost', coursePlanId: 'p-missing', classId: 'c2', teacherId: 't2', roomId: 'r1', slotId: 'd2-p2' });
  const report = buildStats(input);
  assert.equal(report.summary.placed, 3);
  assert.equal(report.summary.missing, 1);
});

test('export rows keep the 计划/已排 columns distinct', async () => {
  const { buildStats, teacherRowsForExport, subjectRowsForExport, classRowsForExport } = await loadStats();
  const report = buildStats(baseInput());
  const teacherRows = teacherRowsForExport(report);
  assert.deepEqual(Object.keys(teacherRows[0]), ['教师', '任教学科', '计划周课时', '已排课时', '走班课时', '未排课时', '可用时段', '占用率']);
  assert.equal(teacherRows[0].占用率, '66.7%');
  assert.equal(subjectRowsForExport(report).length, 2);
  assert.deepEqual(Object.keys(classRowsForExport(report)[0]), ['班级', '年级', '计划周课时', '已排课时', '未排课时', '可用时间格', '剩余容量', '日内空档']);
});

test('day gaps count only free periods between the first and last regular lesson', async () => {
  const { buildStats } = await loadStats();
  const input = baseInput();
  input.timeSlots = [
    { id: 'd1-p1', day: 1, period: 1, label: '周一 第1节' },
    { id: 'd1-p2', day: 1, period: 2, label: '周一 第2节' },
    { id: 'd1-p3', day: 1, period: 3, label: '周一 第3节' },
  ];
  input.coursePlans = [{ id: 'p1', classId: 'c1', subjectId: 's1', teacherId: 't1', weeklyPeriods: 2 }];
  input.entries = [
    { id: 'e1', coursePlanId: 'p1', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 'd1-p1' },
    { id: 'e2', coursePlanId: 'p1', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 'd1-p3' },
  ];
  const report = buildStats(input);
  const class1 = report.classes.find((row) => row.id === 'c1');
  assert.equal(class1.dayGaps, 1);
  assert.equal(class1.freeSlots, 1);
});

test('odd/even plans are halved in the average weekly load', async () => {
  const { buildStats } = await loadStats();
  const input = baseInput();
  input.coursePlans = [
    { id: 'p1', classId: 'c1', subjectId: 's1', teacherId: 't1', weeklyPeriods: 2, weeks: 'odd' },
    { id: 'p2', classId: 'c2', subjectId: 's1', teacherId: 't1', weeklyPeriods: 2, weeks: 'even' },
  ];
  input.entries = [];
  const report = buildStats(input);
  assert.equal(report.summary.planned, 4);
  assert.equal(report.summary.averagePlanned, 2);
});

test('workload is split by slot kind', async () => {
  const { buildStats } = await loadStats();
  const input = baseInput();
  input.timeSlots = [
    { id: 'mon-morning', day: 1, period: 0, label: '周一 早读', kind: 'morning' },
    ...input.timeSlots,
  ];
  input.coursePlans[0] = { ...input.coursePlans[0], weeklyPeriods: 1, kind: 'morning' };
  input.entries = [{ id: 'e1', coursePlanId: 'p1', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 'mon-morning' }];
  const report = buildStats(input);
  const morning = report.byKind.find((row) => row.kind === 'morning');
  assert.ok(morning);
  assert.equal(morning.planned, 1);
  assert.equal(morning.placed, 1);
  const regular = report.byKind.find((row) => row.kind === 'regular');
  assert.equal(regular.planned, 2); // p2 + p3
  assert.equal(regular.placed, 0);
});

test('elective blocks count toward teacher workload separately', async () => {
  const { buildStats, teacherRowsForExport } = await loadStats();
  const input = baseInput();
  input.electiveGroups = [{
    id: 'g1', name: '分层', subjectId: 's1', weeklyPeriods: 1, classIds: ['c1', 'c2'],
    blocks: [{ id: 'b1', teacherId: 't1' }, { id: 'b2', teacherId: 't2' }],
  }];
  input.entries = [
    { id: 'e1', coursePlanId: 'p1', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 'd1-p1' },
    { id: 'g-b1', coursePlanId: 'elective:b1', classId: 'g1', teacherId: 't1', roomId: 'r1', slotId: 'd2-p1', groupId: 'g1', blockId: 'b1' },
    { id: 'g-b2', coursePlanId: 'elective:b2', classId: 'g1', teacherId: 't2', roomId: 'r2', slotId: 'd2-p1', groupId: 'g1', blockId: 'b2' },
  ];
  const report = buildStats(input);
  assert.equal(report.summary.electivePlaced, 2);
  assert.equal(report.teachers.find((row) => row.id === 't1').elective, 1);
  assert.equal(report.teachers.find((row) => row.id === 't2').elective, 1);
  assert.equal(teacherRowsForExport(report).find((row) => row.教师 === '甲老师').走班课时, 1);
});

test('empty workspace produces zeroed rows instead of NaN', async () => {
  const { buildStats } = await loadStats();
  const report = buildStats({
    timeSlots: [],
    classes: [],
    teachers: [],
    subjects: [],
    coursePlans: [],
    entries: [],
    unavailableSlots: [],
  });
  assert.equal(report.summary.utilization, 0);
  assert.equal(report.teachers.length, 0);
  assert.equal(report.summary.missing, 0);
  assert.ok(Number.isFinite(report.summary.utilization));
});



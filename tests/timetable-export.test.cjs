const test = require('node:test');
const assert = require('node:assert/strict');

async function loadExport() {
  return import('../apps/renderer/src/timetableExport.ts');
}

function fixture() {
  const timeSlots = [
    { id: 'm1', day: 1, period: 1, label: '周一 第1节', kind: 'regular' },
    { id: 'm2', day: 1, period: 2, label: '周一 第2节', kind: 'regular' },
    { id: 't1', day: 2, period: 1, label: '周二 第1节', kind: 'regular' },
    { id: 't2', day: 2, period: 2, label: '周二 第2节', kind: 'regular' },
  ];
  const data = {
    school: { id: 's', name: '测试学校' },
    classes: [{ id: 'c1', name: '七年级1班', size: 40, grade: '七年级' }],
    teachers: [{ id: 't1', name: '王老师' }],
    subjects: [{ id: 'sub1', name: '数学' }],
    rooms: [{ id: 'r1', name: '一号教室', capacity: 50, type: '普通教室' }],
    timeSlots,
    coursePlans: [{ id: 'p1', classId: 'c1', subjectId: 'sub1', teacherId: 't1', weeklyPeriods: 2 }],
  };
  const result = {
    protocolVersion: '1.0',
    status: 'COMPLETED',
    entries: [
      { id: 'e1', coursePlanId: 'p1', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 'm1', weeks: 'all', source: 'AUTO', locked: false },
      { id: 'e2', coursePlanId: 'p1', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 't2', weeks: 'odd', source: 'AUTO', locked: false },
    ],
    hardConstraintViolations: [],
    hasFeasibleSolution: true,
    elapsedMs: 1,
  };
  return { data, result };
}

const settings = {
  view: 'class',
  entityId: 'c1',
  schoolName: '测试学校',
  title: '七年级1班 课表',
  weeks: 'all',
  showTeacher: true,
  showRoom: true,
  showWeeks: true,
};

test('grid keeps a weekday-column / period-row timetable shape', async () => {
  const { buildTimetableGrid } = await loadExport();
  const { data, result } = fixture();
  const grid = buildTimetableGrid(data, result, settings);
  assert.deepEqual(grid.days, [1, 2]);
  assert.deepEqual(grid.periods, [1, 2]);
  assert.equal(grid.rows[0][0], '测试学校');
  assert.equal(grid.rows[1][0], '七年级1班 课表');
  assert.deepEqual(grid.rows[4], ['节次', '周一', '周二']);
  assert.equal(grid.rows[5][0], '第1节');
  assert.match(String(grid.rows[5][1]), /数学/);
  assert.match(String(grid.rows[5][1]), /王老师/);
  assert.match(String(grid.rows[6][2]), /单周/);
  assert.equal(grid.merges.length, 3);
});

test('week filter excludes lessons of the other parity', async () => {
  const { buildTimetableGrid } = await loadExport();
  const { data, result } = fixture();
  const even = buildTimetableGrid(data, result, { ...settings, weeks: 'even' });
  assert.equal(String(even.rows[6][2] ?? ''), '');
  const odd = buildTimetableGrid(data, result, { ...settings, weeks: 'odd' });
  assert.match(String(odd.rows[6][2]), /单周/);
});

test('teacher view exports the same grid with classes in each cell', async () => {
  const { buildTimetableGrid } = await loadExport();
  const { data, result } = fixture();
  const grid = buildTimetableGrid(data, result, { ...settings, view: 'teacher', entityId: 't1', title: '教师课表' });
  assert.match(String(grid.rows[2][0]), /王老师/);
  assert.match(String(grid.rows[5][1]), /七年级1班/);
  assert.match(String(grid.rows[5][1]), /数学/);
});

test('a concrete school week overrides the odd/even filter', async () => {
  const { buildTimetableGrid } = await loadExport();
  const { data, result } = fixture();
  const evenWeek = buildTimetableGrid(data, result, { ...settings, weekNo: 2 });
  assert.equal(String(evenWeek.rows[6][2] ?? ''), '');
  assert.match(String(evenWeek.rows[2][0]), /第2周/);
  const oddWeek = buildTimetableGrid(data, result, { ...settings, weekNo: 1 });
  assert.match(String(oddWeek.rows[6][2]), /单周/);
});

test('batch timetable file name reflects the selected views and week', async () => {
  const { batchTimetableFileName } = await loadExport();
  const { data } = fixture();
  const both = batchTimetableFileName(data, { schoolName: '测试学校', weeks: 'all', weekNo: 3 }, { classes: true, teachers: true });
  assert.match(both, /^测试学校-批量课表-班级\+教师-第3周-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const classes = batchTimetableFileName(data, { schoolName: '', weeks: 'odd', weekNo: null }, { classes: true, teachers: false });
  assert.match(classes, /^测试学校-批量课表-班级课表-单周-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const teachers = batchTimetableFileName(data, { schoolName: '测试学校', weeks: 'all', weekNo: null }, { classes: false, teachers: true });
  assert.match(teachers, /批量课表-教师课表-/);
});

test('multi-file batch names identify every timetable and stay unique', async () => {
  const { batchTimetableEntryFileName, batchTimetableFolderName, uniqueFileName } = await loadExport();
  const { data } = fixture();
  const classFile = batchTimetableEntryFileName(data, {
    schoolName: '测试学校',
    view: 'class',
    entityId: 'c1',
    weeks: 'all',
    weekNo: 3,
  });
  assert.match(classFile, /^测试学校-班-七年级1班-第3周-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const teacherFile = batchTimetableEntryFileName(data, {
    schoolName: '',
    view: 'teacher',
    entityId: 't1',
    weeks: 'odd',
    weekNo: null,
  });
  assert.match(teacherFile, /^测试学校-师-王老师-单周-\d{4}-\d{2}-\d{2}\.xlsx$/);

  const folder = batchTimetableFolderName(data, { schoolName: '测试学校', weeks: 'all', weekNo: null }, { classes: true, teachers: true });
  assert.match(folder, /^测试学校-批量课表-班级\+教师-\d{4}-\d{2}-\d{2}$/);
  assert.doesNotMatch(folder, /\.xlsx$/);

  const used = new Set();
  assert.equal(uniqueFileName('课表.xlsx', used), '课表.xlsx');
  assert.equal(uniqueFileName('课表.xlsx', used), '课表·2.xlsx');
  assert.equal(uniqueFileName('课表.xlsx', used), '课表·3.xlsx');
});




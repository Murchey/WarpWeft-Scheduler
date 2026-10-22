const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');

const root = path.resolve(__dirname, '..');
const templates = {
  vertical: path.join(root, 'tests', 'test_data', '纵向课表模板.xlsx'),
  horizontal: path.join(root, 'tests', 'test_data', '横向课表模板.xlsx'),
};

async function loadTemplateFiller() {
  return import('../apps/renderer/src/timetableTemplate.ts');
}

function fixture() {
  const timeSlots = [1, 2, 3, 4].flatMap((period) => [
    { id: 'mon-' + period, day: 1, period, label: '周一 第' + period + '节', kind: 'regular' },
    { id: 'tue-' + period, day: 2, period, label: '周二 第' + period + '节', kind: 'regular' },
  ]);
  const data = {
    school: { id: 's', name: '模板测试中学' },
    classes: [{ id: 'c1', name: '七年级1班', size: 40, grade: '七年级' }],
    teachers: [{ id: 't1', name: '王老师' }],
    subjects: [{ id: 'sub1', name: '数学' }],
    rooms: [{ id: 'r1', name: '一号教室', capacity: 50, type: '普通教室' }],
    timeSlots,
    coursePlans: [{ id: 'p1', classId: 'c1', subjectId: 'sub1', teacherId: 't1', weeklyPeriods: 2 }],
    semester: { startDate: '2026-09-01', endDate: '2026-12-31' },
  };
  const result = {
    protocolVersion: '1.0',
    status: 'COMPLETED',
    entries: [
      { id: 'e1', coursePlanId: 'p1', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 'mon-1', weeks: 'all', source: 'AUTO', locked: false },
      { id: 'e2', coursePlanId: 'p1', classId: 'c1', teacherId: 't1', roomId: 'r1', slotId: 'tue-2', weeks: 'all', source: 'AUTO', locked: false },
    ],
    hardConstraintViolations: [],
    hasFeasibleSolution: true,
    elapsedMs: 1,
  };
  const settings = {
    view: 'class',
    entityId: 'c1',
    layout: 'vertical',
    schoolName: '模板测试中学',
    title: '七年级1班 课表',
    weeks: 'all',
    weekNo: null,
    showTeacher: true,
    showRoom: true,
    showWeeks: true,
  };
  return { data, result, settings };
}

async function fill(layout, overrides = {}) {
  const { fillTimetableTemplate } = await loadTemplateFiller();
  const { data, result, settings } = fixture();
  const buffer = fs.readFileSync(templates[layout]);
  const filled = await fillTimetableTemplate(buffer, data, result, { ...settings, layout, ...overrides });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(filled.buffer);
  return { filled, workbook };
}

test('vertical template keeps fonts, borders and page layout, with no metadata sheet', async () => {
  const { filled, workbook } = await fill('vertical');
  assert.equal(workbook.worksheets.length, 1);
  const sheet = workbook.getWorksheet('班级课表');
  assert.ok(sheet, 'template sheet is kept');
  assert.equal(sheet.getCell('A1').value, '模板测试中学');
  assert.equal(sheet.getCell('A2').value, '七年级1班 课表');
  assert.equal(sheet.getCell('A3').value, '七年级1班');
  assert.equal(sheet.getCell('B5').value, '数学 / 王老师 / 一号教室');
  assert.equal(sheet.getCell('C5').value, '');
  assert.equal(sheet.getCell('B5').font?.name, '宋体');
  assert.equal(sheet.getCell('B5').border?.top?.style, 'thin');
  assert.equal(sheet.getCell('B5').alignment?.wrapText, true);
  assert.ok(sheet.getCell('A1').font?.size >= 16);

  assert.equal(filled.pageSetup.orientation, 'portrait');
  assert.equal(filled.pageSetup.fitToPage, true);
  assert.equal(filled.pageSetup.fitToWidth, 1);
  assert.equal(filled.pageSetup.fitToHeight, 0);
  assert.equal(sheet.pageSetup.fitToPage, true);
  assert.equal(sheet.pageSetup.fitToWidth, 1);
  assert.equal(sheet.pageSetup.fitToHeight, 0);
});

test('the fourth period grows the template and inherits the period row style', async () => {
  const { workbook } = await fill('vertical');
  const sheet = workbook.getWorksheet('班级课表');
  assert.equal(sheet.getCell('A8').value, '第4节');
  assert.equal(sheet.getRow(8).height, 63);
  assert.equal(sheet.getCell('A8').font?.name, '宋体');
  assert.equal(sheet.getCell('B8').border?.top?.style, 'thin');
});

test('horizontal template keeps its own landscape page setup', async () => {
  const { filled, workbook } = await fill('horizontal');
  const sheet = workbook.getWorksheet('班级课表');
  assert.equal(filled.pageSetup.orientation, 'landscape');
  assert.equal(sheet.pageSetup.orientation, 'landscape');
  assert.equal(filled.pageSetup.fitToWidth, 1);
  assert.equal(filled.pageSetup.fitToHeight, 0);
});

test('teacher view fills the teacher name and class rows into the same template', async () => {
  const { workbook } = await fill('vertical', { view: 'teacher', entityId: 't1', title: '教师课表' });
  const sheet = workbook.getWorksheet('班级课表');
  assert.equal(sheet.getCell('A2').value, '教师课表');
  assert.equal(sheet.getCell('A3').value, '王老师');
  assert.match(String(sheet.getCell('B5').value), /七年级1班/);
  assert.match(String(sheet.getCell('B5').value), /数学/);
});

test('a concrete week is written into the title without app metadata', async () => {
  const { workbook } = await fill('vertical', { weekNo: 2 });
  const sheet = workbook.getWorksheet('班级课表');
  assert.match(String(sheet.getCell('A2').value), /第2周/);
  assert.match(String(sheet.getCell('A3').value), /第2周/);
  assert.equal(workbook.worksheets.length, 1);
});



test('semester export creates one sheet per distinct week pattern', async () => {
  const { fillSemesterTemplate } = await import('../apps/renderer/src/timetableTemplate.ts');
  const { data, result, settings } = fixture();
  const template = fs.readFileSync(templates.vertical);
  const filled = await fillSemesterTemplate(
    template,
    data,
    result,
    { ...settings, scope: 'semester', title: '班级课表' },
    [
      { label: '第1-2周', weeks: [1, 2], entries: result.entries },
      { label: '第3周', weeks: [3], entries: [result.entries[0]] },
    ],
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(filled.buffer);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['第1-2周', '第3周']);
  assert.match(String(workbook.getWorksheet('第1-2周').getCell('A2').value), /第1-2周/);
  assert.equal(workbook.getWorksheet('第3周').getCell('A1').value, '模板测试中学');
  assert.equal(filled.pageSetup.fitToWidth, 1);
  assert.equal(workbook.getWorksheet('第1-2周').pageSetup.orientation, 'portrait');
});

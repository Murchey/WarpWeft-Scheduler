const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');

async function loadModule() {
  return import('../packages/import-export/src.ts');
}

test('import template uses the new headers and required position notes', async () => {
  const { buildImportTemplate } = await loadModule();
  const bytes = buildImportTemplate();
  const workbook = XLSX.read(Buffer.from(bytes), { type: 'buffer' });

  const planHeader = XLSX.utils.sheet_to_json(workbook.Sheets['教学计划'], { header: 1 })[0];
  assert.deepEqual(planHeader, ['班级', '学科', '教师（选填）', '每周课时', '周次（选填）', '课程类型（选填）', '教室类型（选填）', '固定时间（选填）']);

  const teacherHeader = XLSX.utils.sheet_to_json(workbook.Sheets['教师'], { header: 1 })[0];
  assert.deepEqual(teacherHeader, ['姓名', '负责年级（选填）', '主要学科（选填）', '其他学科（选填）']);

  const classHeader = XLSX.utils.sheet_to_json(workbook.Sheets['班级'], { header: 1 })[0];
  assert.deepEqual(classHeader, ['名称', '年级（选填）', '人数（选填）']);

  const notes = XLSX.utils.sheet_to_json(workbook.Sheets['说明'], { header: 1 });
  assert.ok(notes.some((row) => row[0] === '学校' && row[1] === 'A2'));
  assert.ok(notes.some((row) => row[0] === '教师' && String(row[1]).includes('A2')));
  assert.ok(notes.some((row) => row[0] === '教室' && String(row[2]).includes('选填')));
  assert.ok(notes.some((row) => row[0] === '学科' && row[1] === 'A2' && String(row[3]).includes('第 1 列')));
  assert.ok(notes.some((row) => row[0] === '教学计划' && String(row[1]).includes('A2')));
});

test('the time-slot sheet carries max periods and weekday settings above its header', async () => {
  const { buildImportTemplate, readWorkbookWithMeta } = await loadModule();
  const bytes = buildImportTemplate();
  const workbook = XLSX.read(Buffer.from(bytes), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['时间段'], { header: 1 });
  assert.equal(rows[0][0], '每天最多节数');
  assert.equal(rows[0][1], 8);
  assert.equal(rows[1][0], '上课星期');
  assert.equal(rows[1][1], '周一至周五');
  assert.deepEqual(rows[3].slice(0, 3), ['节次', '开始时间（选填）', '时长（分钟，选填）']);

  const parsed = readWorkbookWithMeta(bytes);
  assert.equal(parsed.meta.maxPeriods, 8);
  assert.deepEqual(parsed.meta.weekdays, [1, 2, 3, 4, 5]);
  const slotRows = parsed.rows.filter((row) => row.sheet === '时间段');
  assert.equal(slotRows.length, 8);
  assert.equal(slotRows[0].values['开始时间'], '');
  assert.equal(slotRows[0].values['节次'], 1);
  assert.equal(slotRows[0].row, 5);
});



test('teacher grade lists accept Chinese, English and mixed semicolons', async () => {
  const { normalizeGradeList } = await loadModule();
  assert.equal(normalizeGradeList('1;2;3'), '1;2;3');
  assert.equal(normalizeGradeList('1；2；3'), '1;2;3');
  assert.equal(normalizeGradeList('3; 1；2'), '1;2;3');
  assert.equal(normalizeGradeList('1;2;2'), '1;2');
  assert.equal(normalizeGradeList('七年级'), '七年级');
});

test('per-day period settings override the full day', async () => {
  const { buildImportTemplate, readWorkbookWithMeta } = await loadModule();
  const workbook = XLSX.read(Buffer.from(buildImportTemplate()), { type: 'buffer' });
  const sheet = workbook.Sheets['时间段'];
  sheet.C16 = { t: 's', v: '1;2;3;4;5;8' };
  sheet.G16 = { t: 's', v: '1；2;3;4' };
  const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const parsed = readWorkbookWithMeta(bytes);
  assert.deepEqual(parsed.meta.dayPeriods[3], [1, 2, 3, 4, 5, 8]);
  assert.deepEqual(parsed.meta.dayPeriods[7], [1, 2, 3, 4]);
  assert.equal(parsed.rows.filter((row) => row.sheet === '时间段').length, 8);
});


test('current workspace data can be exported back into the template', async () => {
  const { buildImportTemplate, readWorkbookWithMeta } = await loadModule();
  const source = {
    schoolName: '实验中学',
    semester: { startDate: '2026-09-01', endDate: '2026-12-31' },
    classes: [{ id: 'c1', name: '七年级1班', grade: '七年级', size: 42 }],
    teachers: [{ id: 't1', name: '王老师', grade: '1;2;3', subject: '数学', subject2: '物理' }],
    subjects: [{ id: 's1', name: '数学' }],
    rooms: [{ id: 'r1', name: '一号教室', type: '普通教室', capacity: 50 }],
    timeSlots: [
      { id: 'slot1', day: 1, period: 1, start: '08:00', duration: 45, label: '周一 第1节' },
      { id: 'slot2', day: 2, period: 1, start: '08:00', duration: 45, label: '周二 第1节' },
    ],
    coursePlans: [
      { classId: 'c1', subjectId: 's1', teacherId: 't1', weeklyPeriods: 5, weeks: 'all', kind: 'regular', roomType: '普通教室' },
    ],
  };
  const bytes = buildImportTemplate(source);
  const workbook = XLSX.read(Buffer.from(bytes), { type: 'buffer' });
  assert.equal(workbook.Sheets['学校'].A2.v, '实验中学');
  assert.equal(workbook.Sheets['班级'].A2.v, '七年级1班');
  assert.equal(workbook.Sheets['教师'].B2.v, '1;2;3');
  assert.equal(workbook.Sheets['教师'].D2.v, '物理');
  assert.equal(workbook.Sheets['教学计划'].A2.v, '七年级1班');
  assert.equal(workbook.Sheets['教学计划'].C2.v, '王老师');
  assert.equal(workbook.Sheets['教学计划'].D2.v, 5);
  assert.equal(workbook.Sheets['时间段'].B1.v, 1);
  assert.equal(workbook.Sheets['时间段'].B2.v, '周一至周二');
  const parsed = readWorkbookWithMeta(bytes);
  assert.deepEqual(parsed.meta.weekdays, [1, 2]);
  assert.equal(parsed.meta.dayPeriods, undefined);
});



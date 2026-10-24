const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');

async function loadModule() {
  return import('../packages/import-export/src.ts');
}

test('import template uses the new headers and required position notes', async () => {
  const { buildImportTemplate } = await loadModule();
  const bytes = await buildImportTemplate();
  const workbook = XLSX.read(Buffer.from(bytes), { type: 'buffer' });

  const planHeader = XLSX.utils.sheet_to_json(workbook.Sheets['教学计划'], { header: 1 })[0];
  assert.deepEqual(planHeader, ['班级*', '学科*', '教师（选填）', '每周课时*', '周次（选填）', '课程类型（选填）', '教室类型（选填）', '固定时间（选填）']);

  const teacherHeader = XLSX.utils.sheet_to_json(workbook.Sheets['教师'], { header: 1 })[0];
  assert.deepEqual(teacherHeader, ['姓名*', '负责年级（选填）', '主要学科（选填）', '其他学科（选填）', '负责班级（选填）']);

  const classHeader = XLSX.utils.sheet_to_json(workbook.Sheets['班级'], { header: 1 })[0];
  assert.deepEqual(classHeader, ['名称*', '年级（选填）', '人数（选填）', '班主任（选填）']);

  const notes = XLSX.utils.sheet_to_json(workbook.Sheets['说明'], { header: 1 });
  assert.ok(notes.some((row) => row[0] === '【班级】'));
  assert.ok(notes.some((row) => row[0] === '名称' && row[1] === '是' && String(row[3]).includes('七年级1班')));
  assert.ok(notes.some((row) => row[0] === '【教学计划】'));
  assert.ok(notes.some((row) => row[0] === '每周课时' && row[1] === '是'));
  assert.equal(notes.some((row) => row.some((cell) => /\bA2\b/.test(String(cell)))), false);
});

test('simplified template omits the room sheet and room type column', async () => {
  const { buildImportTemplate } = await loadModule();
  const bytes = await buildImportTemplate(undefined, { simplified: true });
  const workbook = XLSX.read(Buffer.from(bytes), { type: 'buffer' });
  assert.equal(Boolean(workbook.Sheets['教室']), false);
  const planHeader = XLSX.utils.sheet_to_json(workbook.Sheets['教学计划'], { header: 1 })[0];
  assert.deepEqual(planHeader, ['班级*', '学科*', '教师（选填）', '每周课时*', '周次（选填）', '课程类型（选填）', '固定时间（选填）']);
  const classHeader = XLSX.utils.sheet_to_json(workbook.Sheets['班级'], { header: 1 })[0];
  assert.deepEqual(classHeader, ['名称*', '年级（选填）', '人数（选填）', '班主任（选填）']);
});


test('data sheets carry example rows, required styles, dropdowns and frozen headers', async () => {
  const { buildImportTemplate, readWorkbookWithMeta } = await loadModule();
  const ExcelJS = require('exceljs');
  const bytes = await buildImportTemplate();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes));

  const classes = workbook.getWorksheet('班级');
  assert.equal(classes.getCell('A1').value, '名称*');
  assert.equal(classes.getCell('A1').fill.fgColor.argb, 'FFFFC7CE');
  assert.equal(classes.getCell('A2').value, '示例班级');
  assert.ok(JSON.stringify(classes.getCell('A2').note).includes('示例行'));
  assert.equal(classes.views[0].state, 'frozen');
  assert.equal(classes.views[0].ySplit, 1);
  assert.ok(classes.autoFilter);
  assert.ok(JSON.stringify(classes.dataValidations.model).includes('_选项'));

  const plans = workbook.getWorksheet('教学计划');
  assert.equal(plans.getCell('A2').value, '示例班级');
  assert.ok(JSON.stringify(plans.getCell('A1').note).includes('一行'));
  assert.equal(plans.views[0].ySplit, 1);

  const parsed = readWorkbookWithMeta(bytes);
  assert.equal(parsed.rows.some((row) => row.values['名称'] === '示例班级'), false);
  assert.equal(parsed.rows.some((row) => row.values['班级'] === '示例班级'), false);
});

test('the time-slot sheet carries max periods and weekday settings above its header', async () => {
  const { buildImportTemplate, readWorkbookWithMeta } = await loadModule();
  const bytes = await buildImportTemplate();
  const workbook = XLSX.read(Buffer.from(bytes), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['时间段'], { header: 1 });
  assert.equal(rows[0][0], '每天最多节数');
  assert.equal(rows[0][1], 8);
  assert.equal(rows[1][0], '上课星期');
  assert.equal(rows[1][1], '周一至周五');
  assert.deepEqual(rows[3].slice(0, 3), ['节次*', '开始时间（选填）', '时长（分钟，选填）']);

  const parsed = readWorkbookWithMeta(bytes);
  assert.equal(parsed.meta.maxPeriods, 8);
  assert.deepEqual(parsed.meta.weekdays, [1, 2, 3, 4, 5]);
  const slotRows = parsed.rows.filter((row) => row.sheet === '时间段');
  assert.equal(slotRows.length, 8);
  assert.equal(slotRows[0].values['开始时间'], '');
  assert.equal(slotRows[0].values['节次'], 1);
  assert.equal(slotRows[0].row, 6);
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
  const workbook = XLSX.read(Buffer.from(await buildImportTemplate()), { type: 'buffer' });
  const sheet = workbook.Sheets['时间段'];
  sheet.C17 = { t: 's', v: '1;2;3;4;5;8' };
  sheet.G17 = { t: 's', v: '1；2;3;4' };
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
    classes: [{ id: 'c1', name: '七年级1班', grade: '七年级', size: 42, homeroomTeacherId: 't1' }],
    teachers: [{ id: 't1', name: '王老师', grade: '1;2;3', subject: '数学', subject2: '物理', classes: '七年级1班、七年级2班' }],
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
  const bytes = await buildImportTemplate(source);
  const workbook = XLSX.read(Buffer.from(bytes), { type: 'buffer' });
  assert.equal(workbook.Sheets['学校'].A2.v, '示例学校');
  assert.equal(workbook.Sheets['学校'].A3.v, '实验中学');
  assert.equal(workbook.Sheets['班级'].A3.v, '七年级1班');
  assert.equal(workbook.Sheets['班级'].D3.v, '王老师');
  assert.equal(workbook.Sheets['教师'].B3.v, '1;2;3');
  assert.equal(workbook.Sheets['教师'].D3.v, '物理');
  assert.equal(workbook.Sheets['教师'].E3.v, '七年级1班、七年级2班');
  assert.equal(workbook.Sheets['教学计划'].A3.v, '七年级1班');
  assert.equal(workbook.Sheets['教学计划'].C3.v, '王老师');
  assert.equal(workbook.Sheets['教学计划'].D3.v, 5);
  assert.equal(workbook.Sheets['时间段'].B1.v, 1);
  assert.equal(workbook.Sheets['时间段'].B2.v, '周一至周二');
  const parsed = readWorkbookWithMeta(bytes);
  assert.deepEqual(parsed.meta.weekdays, [1, 2]);
  assert.equal(parsed.meta.dayPeriods, undefined);
});



test('custom scheduling rules are exported as a documented template sheet', async () => {
  const { buildImportTemplate } = await loadModule();
  const source = {
    teachers: [{ id: 't1', name: '王老师' }],
    rules: [{
      id: 'r1',
      kind: 'TEACHER_MAX_DAILY',
      scope: { type: 'teacher', teacherId: 't1' },
      time: { type: 'weekday', days: [1, 2] },
      importance: 'prefer',
      params: { maxPerDay: 8 },
      enabled: true,
      note: '下午教研',
      createdAt: '2026-09-01T00:00:00.000Z',
      source: 'manual',
    }],
  };
  const workbook = XLSX.read(Buffer.from(await buildImportTemplate(source)), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['排课规则'], { header: 1 });
  assert.deepEqual(rows[0], ['规则类型*', '作用对象类型*', '作用对象', '适用时间', '重要程度', '参数', '备注']);
  const ruleRow = rows.find((row) => row[0] === '教师每日上限' && row[2] === '王老师');
  assert.ok(ruleRow);
  assert.equal(ruleRow[3], '周一至周二');
  assert.equal(ruleRow[4], '尽量');
  assert.equal(ruleRow[5], 'maxPerDay=8');
  const notes = XLSX.utils.sheet_to_json(workbook.Sheets['说明'], { header: 1 });
  assert.ok(notes.some((row) => row[0] === '【排课规则】'));
  assert.ok(notes.some((row) => row[0] === '规则类型' && String(row[2]).includes('教师每日上限')));
});


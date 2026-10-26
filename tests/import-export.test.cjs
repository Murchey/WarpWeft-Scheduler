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
  assert.deepEqual(planHeader, ['班级*', '学科*', '教师（选填）', '每周课时*', '周次（选填）', '课程类型（选填）', '教室类型（选填）', '固定时间（选填）', '连堂节数（选填）', '配对组（选填）']);

  const teacherHeader = XLSX.utils.sheet_to_json(workbook.Sheets['教师'], { header: 1 })[0];
  assert.deepEqual(teacherHeader, ['姓名*', '负责年级（选填，分号分隔）', '主要学科（选填）', '其他学科（选填，用、分隔）', '负责班级（选填，用、分隔）']);

  const classHeader = XLSX.utils.sheet_to_json(workbook.Sheets['班级'], { header: 1 })[0];
  assert.deepEqual(classHeader, ['名称*', '年级（选填）', '人数（选填）', '班主任（选填）']);

  const notes = XLSX.utils.sheet_to_json(workbook.Sheets['说明'], { header: 1 });
  assert.ok(notes.some((row) => row[0] === '【班级】'));
  assert.ok(notes.some((row) => row[0] === '名称' && row[1] === '是' && String(row[3]).includes('七年级1班')));
  assert.ok(notes.some((row) => row[0] === '【教学计划】'));
  assert.ok(notes.some((row) => row[0] === '每周课时' && row[1] === '是'));
  assert.ok(notes.some((row) => row[0] === '课程类型' && String(row[2]).includes('自习') && String(row[2]).includes('课后服务')));
  assert.ok(notes.some((row) => row[0] === '【快速上手】'));
  assert.ok(notes.some((row) => row[0] === '【批量填写示例】'));
  assert.ok(notes.some((row) => row[0] === '【填写细节】'));
  assert.ok(notes.some((row) => row[0] === '【规则参数示例】'));
  assert.ok(notes.some((row) => row[0] === '【常见错误】'));
  assert.ok(notes.some((row) => row[0] === '【导入行为】'));
  assert.ok(notes.some((row) => row[0] === '【导入前检查】'));
  assert.ok(notes.some((row) => row[0] === '配对组' && String(row[2]).includes('不同班')));
  assert.ok(notes.some((row) => row[0] === '时间偏好' && String(row[2]).includes('留空时按学科名推荐')));
  assert.ok(notes.some((row) => row[0] === '时间偏好' && String(row[2]).includes('填「不限」才表示不限制')));
  assert.ok(notes.some((row) => row[0] === '主科/副科时段'));
  assert.ok(notes.some((row) => row[0] === '规则类型' && String(row[2]).includes('教师每日上限')));
  assert.equal(notes.some((row) => row.some((cell) => /\bA2\b/.test(String(cell)))), false);

  const optionRows = XLSX.utils.sheet_to_json(workbook.Sheets['_选项'], { header: 1 });
  const kindOptions = optionRows.slice(1).map((row) => row[8]).filter(Boolean);
  assert.ok(kindOptions.includes('常规'));
  assert.ok(kindOptions.includes('自习'));
  assert.ok(kindOptions.includes('课后服务'));
});

test('simplified template omits the room sheet and room type column', async () => {
  const { buildImportTemplate } = await loadModule();
  const bytes = await buildImportTemplate(undefined, { simplified: true });
  const workbook = XLSX.read(Buffer.from(bytes), { type: 'buffer' });
  assert.equal(Boolean(workbook.Sheets['教室']), false);
  const planHeader = XLSX.utils.sheet_to_json(workbook.Sheets['教学计划'], { header: 1 })[0];
  assert.deepEqual(planHeader, ['班级*', '学科*', '教师（选填）', '每周课时*', '周次（选填）', '课程类型（选填）', '固定时间（选填）', '连堂节数（选填）', '配对组（选填）']);
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
  // No duplicate example row before period 1 any more.
  assert.equal(slotRows[0].row, 5);
  assert.equal(slotRows[0].values['开始时间'], '');
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
  assert.deepEqual(rows[0], ['规则类型*', '作用对象类型*', '作用对象', '适用时间', '重要程度', '参数（选填，多项用；分隔）', '备注']);
  const ruleRow = rows.find((row) => row[0] === '教师每日上限' && row[2] === '王老师');
  assert.ok(ruleRow);
  assert.equal(ruleRow[3], '周一至周二');
  assert.equal(ruleRow[4], '尽量');
  assert.equal(ruleRow[5], 'maxPerDay=8');
  const notes = XLSX.utils.sheet_to_json(workbook.Sheets['说明'], { header: 1 });
  assert.ok(notes.some((row) => row[0] === '【排课规则】'));
  assert.ok(notes.some((row) => row[0] === '规则类型' && String(row[2]).includes('教师每日上限')));
});


test('fixed lists, consecutive, pairing, subject preference and teacher time are exported', async () => {
  const { buildImportTemplate } = await loadModule();
  const source = {
    classes: [{ id: 'c1', name: '一班', size: 40 }],
    teachers: [{ id: 't1', name: '王老师' }],
    subjects: [
      { id: 's1', name: '数学', preference: 'morning' },
      { id: 's2', name: '活动', preference: 'afternoon' },
    ],
    timeSlots: [
      { id: 's1', day: 1, period: 1, label: '周一 第1节' },
      { id: 's2', day: 1, period: 2, label: '周一 第2节' },
      { id: 's3', day: 1, period: 3, label: '周一 第3节' },
    ],
    unavailableSlots: [{ teacherId: 't1', slotId: 's1' }],
    coursePlans: [
      { classId: 'c1', subjectId: 's1', teacherId: 't1', weeklyPeriods: 3, fixedSlotIds: ['s1', 's2'], consecutive: 2, pairId: '语数间周' },
    ],
  };
  const workbook = XLSX.read(Buffer.from(await buildImportTemplate(source)), { type: 'buffer' });
  const plan = XLSX.utils.sheet_to_json(workbook.Sheets['教学计划'], { header: 1 })[2];
  assert.deepEqual(plan.slice(0, 10), ['一班', '数学', '王老师', 3, '每周', '常规', '', '周一 第1节；周一 第2节', 2, '语数间周']);

  const subjectRows = XLSX.utils.sheet_to_json(workbook.Sheets['学科'], { header: 1 });
  assert.deepEqual(subjectRows[0], ['学科*', '时间偏好（选填）']);
  assert.equal(subjectRows[2][1], '上午');
  assert.equal(subjectRows[3][1], '下午');

  const teacherTime = XLSX.utils.sheet_to_json(workbook.Sheets['教师时间'], { header: 1 });
  assert.deepEqual(teacherTime[0], ['教师*', '星期*', '节次*']);
  assert.equal(teacherTime[2][0], '王老师');
  assert.equal(teacherTime[2][1], '周一');
  assert.equal(teacherTime[2][2], '1');
});

test('a real 7-period day exports exactly 7 period rows', async () => {
  const { buildImportTemplate, readWorkbookWithMeta } = await loadModule();
  const source = {
    timeSlots: Array.from({ length: 7 }, (_, index) => ({ id: 'p' + (index + 1), day: 1, period: index + 1, label: '周一 第' + (index + 1) + '节' })),
  };
  const bytes = await buildImportTemplate(source);
  const parsed = readWorkbookWithMeta(bytes);
  assert.equal(parsed.meta.maxPeriods, 7);
  assert.equal(parsed.rows.filter((row) => row.sheet === '时间段').length, 7);
  const workbook = XLSX.read(Buffer.from(bytes), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['时间段'], { header: 1 });
  assert.equal(rows[0][1], 7);
});

test('blank subject preferences are left empty so the importer can suggest one', async () => {
  const { buildImportTemplate } = await loadModule();
  const workbook = XLSX.read(Buffer.from(await buildImportTemplate({ subjects: [{ id: 's1', name: '数学' }] })), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['学科'], { header: 1 });
  assert.equal(rows[2][0], '数学');
  assert.equal(rows[2][1] ?? '', '');
});

test('example rows from older templates are still skipped after new columns are added', async () => {
  const { readWorkbookWithMeta } = await loadModule();
  const XLSX = require('xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
    { 学科: '示例学科' },
    { 学科: '语文' },
    { 学科: '数学' },
  ]), '学科');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
    { 班级: '示例班级', 学科: '示例学科', 教师: '示例老师', 每周课时: 1, 周次: '每周', 课程类型: '常规', 教室类型: '普通教室', 固定时间: '' },
    { 班级: '一年级1班', 学科: '语文', 教师: '王老师', 每周课时: 5, 周次: '每周', 课程类型: '常规', 教室类型: '普通教室', 固定时间: '周一 第1节' },
  ]), '教学计划');
  const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const parsed = readWorkbookWithMeta(bytes);
  const subjects = parsed.rows.filter((row) => row.sheet === '学科').map((row) => row.values['学科']);
  assert.deepEqual(subjects, ['语文', '数学']);
  const plans = parsed.rows.filter((row) => row.sheet === '教学计划');
  assert.equal(plans.length, 1);
  assert.equal(plans[0].values['班级'], '一年级1班');
});

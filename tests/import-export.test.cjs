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
  assert.deepEqual(planHeader, ['班级', '学科', '教师', '每周课时', '周次（选填）', '课程类型（选填）', '教室类型（选填）', '固定时间（选填）']);

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

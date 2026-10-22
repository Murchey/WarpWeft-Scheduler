const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');

async function loadModule() {
  return import('../packages/import-export/src.ts');
}

test('import template carries the week-parity column', async () => {
  const { buildImportTemplate } = await loadModule();
  const bytes = buildImportTemplate();
  const workbook = XLSX.read(Buffer.from(bytes), { type: 'buffer' });
  const planHeader = XLSX.utils.sheet_to_json(workbook.Sheets['教学计划'], { header: 1 })[0];
  assert.deepEqual(planHeader, ['班级', '学科', '教师', '周课时', '周次', '时段类型', '教室类型', '固定时间']);

  const slotHeader = XLSX.utils.sheet_to_json(workbook.Sheets['时间段'], { header: 1 })[0];
  assert.deepEqual(slotHeader, ['星期', '节次', '名称', '类型', '开始时间', '时长']);

  const notes = XLSX.utils.sheet_to_json(workbook.Sheets['说明'], { header: 1 });
  assert.ok(notes.some((row) => row[0] === '周次' && String(row[1]).includes('单周')));
  assert.ok(notes.some((row) => row[0] === '时段类型' && String(row[1]).includes('早读')));
});

test('import-export module is represented in the build surface', () => {
  assert.equal(require('fs').existsSync('packages/import-export/src.ts'), true);
});

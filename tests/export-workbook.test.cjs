const test = require('node:test');
const assert = require('node:assert/strict');

async function loadImportExport() {
  return import('../packages/import-export/src.ts');
}

async function loadDownload() {
  return import('../apps/renderer/src/download.ts');
}

test('exportWorkbook returns real XLSX bytes, not a string', async () => {
  const { exportWorkbook, readWorkbook } = await loadImportExport();
  const bytes = exportWorkbook({
    课表: [
      { 班级: '七年级1班', 星期: '周一', 节次: 1, 课程: '数学' },
      { 班级: '七年级1班', 星期: '周二', 节次: 2, 课程: '语文' },
    ],
    元数据: [{ 项目: '学校', 值: '测试中学' }],
  });

  // xlsx type:'array' yields an ArrayBuffer. The old code read `.buffer` from
  // it, which is undefined, so the file was the literal text "undefined".
  assert.ok(bytes instanceof ArrayBuffer, 'ArrayBuffer expected');
  assert.ok(bytes.byteLength > 1000, 'non-trivial file size');
  const head = new Uint8Array(bytes, 0, 4);
  assert.deepEqual(Array.from(head), [0x50, 0x4b, 0x03, 0x04], 'ZIP/XLSX signature');

  const rows = readWorkbook(bytes);
  const sheet = rows.filter((row) => row.sheet === '课表');
  assert.equal(sheet.length, 2);
  assert.equal(sheet[0].values['班级'], '七年级1班');
  assert.equal(sheet[1].values['课程'], '语文');
  assert.ok(rows.some((row) => row.sheet === '元数据' && row.values['值'] === '测试中学'));
});

test('the import template is a valid workbook too', async () => {
  const { buildImportTemplate, readWorkbook } = await loadImportExport();
  const bytes = buildImportTemplate();
  assert.ok(bytes instanceof ArrayBuffer);
  const head = new Uint8Array(bytes, 0, 4);
  assert.deepEqual(Array.from(head), [0x50, 0x4b, 0x03, 0x04]);
  // The template has header rows, so reading it must not throw and must keep
  // the sheet names the importer expects.
  const rows = readWorkbook(bytes);
  // 教学计划仅表头、没有数据行；说明表有内容，可证明工作簿结构完整。
  assert.ok(rows.some((row) => row.sheet === '说明'));
  assert.ok(rows.some((row) => row.sheet === '说明' && row.values['工作表'] === '教学计划'));
});

test('blobPartOf keeps the exact window of a typed-array view', async () => {
  const { blobPartOf } = await loadDownload();
  const backing = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const view = backing.subarray(2, 4);
  const part = blobPartOf(view);
  assert.ok(part instanceof Uint8Array);
  assert.equal(part.byteLength, 2);
  assert.deepEqual(Array.from(part), [3, 4]);

  const buffer = new ArrayBuffer(4);
  assert.equal(blobPartOf(buffer), buffer);
  assert.equal(blobPartOf('csv text'), 'csv text');
});

test('exportMessage stays silent on cancel and reports failures', async () => {
  const { exportMessage } = await loadDownload();
  assert.equal(exportMessage({ status: 'canceled' }, '导出'), null);
  assert.equal(exportMessage({ status: 'saved', path: 'C:/x.xlsx' }, '导出').tone, 'success');
  assert.match(exportMessage({ status: 'saved', path: 'C:/x.xlsx' }, '导出').text, /已保存到/);
  assert.equal(exportMessage({ status: 'downloaded' }, '导出').tone, 'success');
  assert.match(exportMessage({ status: 'downloaded' }, '导出').text, /已开始下载/);
  const failed = exportMessage({ status: 'failed', error: '磁盘已满' }, '导出');
  assert.equal(failed.tone, 'error');
  assert.match(failed.text, /磁盘已满/);
});



const test = require('node:test');
const assert = require('node:assert/strict');

test('downloadFiles hands every file to the Electron folder bridge', async () => {
  const calls = [];
  globalThis.window = {
    warpweft: {
      saveExports: async (folderName, files) => {
        calls.push({ folderName, files });
        return { status: 'saved', path: 'D:\\课表导出' };
      },
    },
  };
  try {
    const { downloadFiles } = await import('../apps/renderer/src/download.ts');
    const result = await downloadFiles(
      [
        { filename: '班-七年级1班.xlsx', data: new Uint8Array([80, 75, 3, 4]) },
        { filename: '师-王老师.xlsx', data: 'hello' },
      ],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '测试学校-批量课表',
    );
    assert.deepEqual(result, { status: 'saved', path: 'D:\\课表导出' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].folderName, '测试学校-批量课表');
    assert.deepEqual(calls[0].files.map((file) => file.filename), ['班-七年级1班.xlsx', '师-王老师.xlsx']);
    assert.deepEqual([...new Uint8Array(calls[0].files[0].data)], [80, 75, 3, 4]);
    assert.equal(new TextDecoder().decode(calls[0].files[1].data), 'hello');
  } finally {
    delete globalThis.window;
  }
});

test('downloadFiles treats a canceled folder picker as cancellation', async () => {
  globalThis.window = {
    warpweft: {
      saveExports: async () => ({ status: 'canceled' }),
    },
  };
  try {
    const { downloadFiles } = await import('../apps/renderer/src/download.ts');
    const result = await downloadFiles(
      [{ filename: '班-七年级1班.xlsx', data: new Uint8Array([1]) }],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '课表',
    );
    assert.deepEqual(result, { status: 'canceled' });
  } finally {
    delete globalThis.window;
  }
});

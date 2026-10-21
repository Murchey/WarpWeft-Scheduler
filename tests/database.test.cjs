const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../apps/desktop/database.cjs');

test('new workspace starts empty and does not inject demo data', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'warpweft-'));
  try {
    const data = openDatabase(process.cwd(), tempRoot).read();
    assert.equal(data.school.name, '未设置学校');
    assert.equal(data.classes.length, 0);
    assert.equal(data.coursePlans.length, 0);
    assert.notEqual(data.school.id, 'school-demo');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('legacy demo workspace is cleared during local store initialization', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'warpweft-demo-'));
  try {
    fs.writeFileSync(path.join(tempRoot, 'warpweft.json'), JSON.stringify({ school: { id: 'school-demo', name: '演示中学' }, classes: [{ id: 'class-1' }], coursePlans: [{ id: 'plan-1' }] }));
    const data = openDatabase(process.cwd(), tempRoot).read();
    assert.equal(data.school.id, 'school-local');
    assert.equal(data.classes.length, 0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

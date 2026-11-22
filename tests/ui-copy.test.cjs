const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'apps', 'renderer', 'src');

function readSource(name) {
  return fs.readFileSync(path.join(srcDir, name), 'utf8');
}

/**
 * 界面文案回归：只锁住最容易回退的几条硬约定，
 * 不做全文措辞校验（那会变成一堆没人看的失败）。
 */
test('界面不再直接渲染求解器原始状态', () => {
  const offenders = [];
  for (const file of fs.readdirSync(srcDir)) {
    if (!file.endsWith('.tsx') && !file.endsWith('.ts')) continue;
    const source = readSource(file);
    // 允许出现在逻辑判断里（includes/===），只禁止出现在 JSX 文本或模板字符串中输出。
    for (const match of source.matchAll(/\{\s*[a-zA-Z0-9_?.!]*result\.status\s*\}/g)) {
      offenders.push(file + ': ' + match[0]);
    }
  }
  assert.deepEqual(offenders, [], '这些位置直接把求解器状态渲染到界面，应改走 runResultText：' + offenders.join(' | '));
});

test('不再使用 window.confirm（原生确认框已被自绘对话框替代）', () => {
  const offenders = [];
  for (const file of fs.readdirSync(srcDir)) {
    if (!file.endsWith('.tsx') && !file.endsWith('.ts')) continue;
    if (file === 'confirm.tsx') continue;
    const source = readSource(file);
    if (/window\.confirm\s*\(/.test(source)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], '这些文件仍在使用 window.confirm：' + offenders.join(', '));
});

test('导航文案不再出现「最终课表」', () => {
  const nav = fs.readFileSync(path.join(srcDir, 'i18n', 'domains', 'nav.ts'), 'utf8');
  assert.ok(nav.includes("'nav.final': '课表检测'"), '导航应显示「课表检测」');
  assert.ok(!nav.includes("'最终课表'"), '导航文案里不应再有「最终课表」');
});

test('术语表记录了禁止说法', () => {
  const glossary = fs.readFileSync(path.join(root, 'docs', 'ui-glossary.md'), 'utf8');
  assert.ok(glossary.includes('无解'), '术语表应说明「无解」是禁止措辞');
  assert.ok(glossary.includes('课表检测'), '术语表应说明页面命名为「课表检测」');
});

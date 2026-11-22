const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const i18nDir = path.join(root, 'apps', 'renderer', 'src', 'i18n');

/** 取一个文件里所有 `'key':` 形式的词条键（中文真源与英文覆盖表结构一致）。 */
function keysOf(file) {
  const source = fs.readFileSync(file, 'utf8');
  return [...source.matchAll(/^\s*'([^']+)':/gm)].map((match) => match[1]);
}

function domainFiles() {
  const dir = path.join(i18nDir, 'domains');
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => path.join(dir, name));
}

test('中文真源与英文覆盖表的键集合一致', () => {
  const zh = new Set(domainFiles().flatMap(keysOf));
  const en = new Set(keysOf(path.join(i18nDir, 'locales', 'en-US.ts')));
  const missingInEn = [...zh].filter((key) => !en.has(key));
  const extraInEn = [...en].filter((key) => !zh.has(key));
  assert.deepEqual(missingInEn, [], '英文缺少这些键，运行时会回落中文：' + missingInEn.join(', '));
  assert.deepEqual(extraInEn, [], '英文存在中文真源里没有的键（改名后遗留）：' + extraInEn.join(', '));
});

test('词条键不重复定义', () => {
  const all = domainFiles().flatMap(keysOf);
  const seen = new Set();
  const duplicates = [];
  for (const key of all) {
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
  }
  assert.deepEqual(duplicates, [], '重复定义的键（后定义的会覆盖前者）：' + duplicates.join(', '));
});

test('导航与设置页的文案全部走词条', () => {
  const navKeys = new Set(keysOf(path.join(i18nDir, 'domains', 'nav.ts')));
  for (const key of ['nav.dashboard', 'nav.prepare', 'nav.runs', 'nav.preview', 'nav.adjust', 'nav.final', 'nav.stats', 'nav.server', 'nav.settings']) {
    assert.ok(navKeys.has(key), '缺少导航词条 ' + key);
  }
  const main = fs.readFileSync(path.join(root, 'apps', 'renderer', 'src', 'main.tsx'), 'utf8');
  const labelMap = main.match(/const TAB_LABEL_KEY[\s\S]*?\n};/);
  assert.ok(labelMap, '未找到 TAB_LABEL_KEY 映射');
  // 每个导航 id 都必须有对应的词条 key，不能有直接写死中文的项漏网。
  for (const key of labelMap[0].matchAll(/'nav\.[a-zA-Z]+'/g)) {
    assert.ok(navKeys.has(key[0].slice(1, -1)), 'TAB_LABEL_KEY 引用了不存在的词条 ' + key[0]);
  }
});

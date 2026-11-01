const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');

// siteConfig.ts 是 ESM + TypeScript；Node 26 可直接剥离类型执行。
const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'website', 'src', 'siteConfig.ts')).href;

test('官网配置归一化：缺字段回落默认值', async () => {
  const { normalizeSiteConfig, DEFAULT_SITE_CONFIG } = await import(moduleUrl);
  assert.deepEqual(normalizeSiteConfig({}), DEFAULT_SITE_CONFIG);
  assert.deepEqual(normalizeSiteConfig(null), DEFAULT_SITE_CONFIG);
  assert.deepEqual(normalizeSiteConfig([]), DEFAULT_SITE_CONFIG);
  assert.deepEqual(normalizeSiteConfig('nope'), DEFAULT_SITE_CONFIG);
});

test('官网配置归一化：privateInstance 只认严格 true', async () => {
  const { normalizeSiteConfig } = await import(moduleUrl);
  assert.equal(normalizeSiteConfig({ privateInstance: true }).privateInstance, true);
  // 字符串 "true" / 1 / "yes" 都不能误开启，否则运维改成 false 仍会显示提示。
  assert.equal(normalizeSiteConfig({ privateInstance: 'true' }).privateInstance, false);
  assert.equal(normalizeSiteConfig({ privateInstance: 1 }).privateInstance, false);
  assert.equal(normalizeSiteConfig({ privateInstance: 'yes' }).privateInstance, false);
});

test('官网配置归一化：文本字段去空白、限长、忽略非字符串', async () => {
  const { normalizeSiteConfig } = await import(moduleUrl);
  const padded = normalizeSiteConfig({ icp: '  京ICP备00000000号-1  ', announcement: ' 公告 ' });
  assert.equal(padded.icp, '京ICP备00000000号-1');
  assert.equal(padded.announcement, '公告');

  // 超长公告截断到 300 字符，避免有人把整篇文档塞进横幅撑破首屏。
  const long = normalizeSiteConfig({ announcement: 'A'.repeat(999) });
  assert.equal(long.announcement.length, 300);

  // 数字与对象不是有效文案，回落空串（空串 = 不显示）。
  assert.equal(normalizeSiteConfig({ icp: 12345 }).icp, '');
  assert.equal(normalizeSiteConfig({ police: { a: 1 } }).police, '');
});

test('官网配置归一化：未知字段被丢弃', async () => {
  const { normalizeSiteConfig } = await import(moduleUrl);
  const result = normalizeSiteConfig({ icp: 'x', evil: '<script>' });
  assert.equal(result.evil, undefined);
  assert.deepEqual(Object.keys(result).sort(), ['announcement', 'icp', 'police', 'privateInstance']);
});

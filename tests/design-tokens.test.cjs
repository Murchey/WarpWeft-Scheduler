const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const stylePath = path.join(root, 'apps', 'renderer', 'src', 'style.css');
const tokensPath = path.join(root, 'packages', 'theme', 'tokens.css');

/**
 * 把 `:root{--a:1;--b:2}` 的花括号内容解析成变量表。
 * 变量值里不会出现 `;`，按分号切分是安全的。
 */
function parseVars(block) {
  const vars = {};
  for (const part of block.split(';')) {
    const pair = part.trim();
    if (!pair) continue;
    const index = pair.indexOf(':');
    if (index <= 0) continue;
    vars[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
  }
  return vars;
}

/**
 * 取文件中**最后一个配色令牌块**。应用样式表里有多个同名选择器块
 * （例如 `:root{--titlebar-h:40px}`），只有带 `--paper` 的才是配色令牌；
 * 其中最靠后的一组会覆盖前面的，才是实际生效值。
 */
function lastBlock(source, pattern) {
  const blocks = Array.from(source.matchAll(pattern), (match) => match[1]).filter((block) =>
    block.includes('--paper'),
  );
  if (blocks.length === 0) throw new Error('未找到配色令牌块：' + String(pattern));
  return parseVars(blocks[blocks.length - 1]);
}

test('官网设计令牌与应用实际生效的令牌一致', () => {
  const style = fs.readFileSync(stylePath, 'utf8');
  const tokens = fs.readFileSync(tokensPath, 'utf8');

  const styleRoot = lastBlock(style, /:root\{([^}]*)\}/g);
  const styleDark = lastBlock(style, /html\[data-theme='dark'\]\{([^}]*)\}/g);
  const tokensRoot = lastBlock(tokens, /:root\{([^}]*)\}/g);
  const tokensDark = lastBlock(tokens, /html\[data-theme='dark'\]\{([^}]*)\}/g);

  assert.deepEqual(
    tokensRoot,
    styleRoot,
    'packages/theme/tokens.css 的浅色令牌与 style.css 生效值不一致，请同步后再提交',
  );
  assert.deepEqual(
    tokensDark,
    styleDark,
    'packages/theme/tokens.css 的深色令牌与 style.css 生效值不一致，请同步后再提交',
  );
  assert.ok(Object.keys(styleRoot).length >= 10, '解析到的浅色令牌数量异常');
});

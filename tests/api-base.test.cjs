const test = require('node:test');
const assert = require('node:assert/strict');

async function loadBase() {
  return import('../apps/renderer/src/apiBase.ts');
}

test('development builds point at the local API, production builds stay same-origin', async () => {
  const { resolveDefaultApiBase } = await loadBase();
  assert.equal(resolveDefaultApiBase(true, 'http://127.0.0.1:5173'), 'http://127.0.0.1:4317');
  assert.equal(resolveDefaultApiBase(false, 'http://192.168.1.20:4317'), 'http://192.168.1.20:4317');
  assert.equal(resolveDefaultApiBase(false, 'https://scheduler.example.edu'), 'https://scheduler.example.edu');
  assert.equal(resolveDefaultApiBase(false, 'https://scheduler.example.edu/'), 'https://scheduler.example.edu');
});

test('non-http origins fall back to the desktop local API', async () => {
  const { resolveDefaultApiBase } = await loadBase();
  assert.equal(resolveDefaultApiBase(false, 'file:///opt/warpweft/dist/index.html'), 'http://127.0.0.1:4317');
  assert.equal(resolveDefaultApiBase(false, 'not a url'), 'http://127.0.0.1:4317');
});

test('saved endpoints are normalized only when they are valid HTTP(S) URLs', async () => {
  const { normalizeApiEndpoint } = await loadBase();
  assert.equal(normalizeApiEndpoint(' http://10.0.0.5:4317/// ', 'http://fallback'), 'http://10.0.0.5:4317');
  assert.equal(normalizeApiEndpoint('https://school.example/api/', 'http://fallback'), 'https://school.example/api');
  assert.equal(normalizeApiEndpoint('', 'http://fallback'), 'http://fallback');
  assert.equal(normalizeApiEndpoint('ftp://school.example', 'http://fallback'), 'http://fallback');
  assert.equal(normalizeApiEndpoint('not a url', 'http://fallback'), 'http://fallback');
});

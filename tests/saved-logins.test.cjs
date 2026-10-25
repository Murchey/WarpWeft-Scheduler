const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.resolve(__dirname, '..', 'apps', 'renderer', 'src', 'savedLogins.ts')).href;

function fakeStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

test('saved logins are scoped, deduplicated and removable', async () => {
  global.window = { localStorage: fakeStorage() };
  const saved = await import(moduleUrl);
  assert.deepEqual(saved.readSavedLogins('https://a.example'), []);

  saved.rememberSavedLogin({ username: 'teacher1', password: 'old-pass' }, 'https://a.example');
  saved.rememberSavedLogin({ username: 'teacher1', password: 'new-pass' }, 'https://a.example');
  saved.rememberSavedLogin({ username: 'admin', password: 'admin-pass' }, 'https://a.example');
  assert.equal(saved.readSavedLogins('https://a.example').length, 2);
  assert.equal(saved.readSavedLogins('https://a.example')[0].username, 'admin');
  assert.equal(saved.readSavedLogins('https://a.example')[1].password, 'new-pass');

  assert.equal(saved.readSavedLogins('https://b.example').length, 0);
  saved.rememberSavedLogin({ username: 'teacher1', password: 'other-server' }, 'https://b.example');
  assert.equal(saved.readSavedLogins('https://b.example')[0].password, 'other-server');
  assert.equal(saved.readSavedLogins('https://a.example')[1].password, 'new-pass');

  assert.equal(saved.forgetSavedLogin('admin', 'https://a.example').length, 1);
  assert.equal(saved.clearSavedLogins('https://a.example').length, 0);
  assert.equal(saved.readSavedLogins('https://b.example').length, 1);
});

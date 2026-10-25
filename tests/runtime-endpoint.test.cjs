const test = require('node:test');
const assert = require('node:assert/strict');

const LOCAL = 'http://127.0.0.1:4317';

async function loadModule() {
  return import('../apps/renderer/src/runtimeEndpoint.ts');
}

function fakeStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test('switching to a local mode replaces a remote endpoint with the local API address', async () => {
  const { endpointForMode } = await loadModule();
  assert.equal(endpointForMode('single', { current: 'https://cloud.example.edu', localBase: LOCAL }), LOCAL);
  assert.equal(endpointForMode('lan-server', { current: 'https://cloud.example.edu', localBase: LOCAL }), LOCAL);
  assert.equal(endpointForMode('single', { current: LOCAL, localBase: LOCAL }), LOCAL);
  assert.equal(
    endpointForMode('single', {
      current: 'https://cloud.example.edu',
      remembered: { single: 'http://192.168.1.20:4317' },
      localBase: LOCAL,
    }),
    LOCAL,
  );
});

test('switching to cloud restores its remembered address instead of the local endpoint', async () => {
  const { CLOUD_ENDPOINT_PLACEHOLDER, endpointForMode, rememberEndpoint } = await loadModule();
  const memory = {};
  rememberEndpoint(memory, 'cloud', 'https://cloud.example.edu/', LOCAL);
  const local = endpointForMode('single', { current: 'https://cloud.example.edu', remembered: memory, localBase: LOCAL });
  assert.equal(local, LOCAL);
  assert.equal(endpointForMode('cloud', { current: local, remembered: memory, localBase: LOCAL }), 'https://cloud.example.edu');
  assert.equal(endpointForMode('cloud', { current: LOCAL, remembered: {}, localBase: LOCAL }), CLOUD_ENDPOINT_PLACEHOLDER);
});

test('opening settings keeps a pinned local-mode endpoint and drops a stale loopback cloud endpoint', async () => {
  const { CLOUD_ENDPOINT_PLACEHOLDER, initialEndpointForMode } = await loadModule();
  assert.equal(initialEndpointForMode('single', 'http://192.168.1.20:4317', {}, LOCAL), 'http://192.168.1.20:4317');
  assert.equal(initialEndpointForMode('single', '', {}, LOCAL), LOCAL);
  assert.equal(initialEndpointForMode('single', '', { single: 'http://192.168.1.20:4317' }, LOCAL), LOCAL);
  assert.equal(initialEndpointForMode('cloud', LOCAL, {}, LOCAL), CLOUD_ENDPOINT_PLACEHOLDER);
  assert.equal(
    initialEndpointForMode('cloud', LOCAL, { cloud: 'https://saved.example.edu' }, LOCAL),
    'https://saved.example.edu',
  );
  assert.equal(
    initialEndpointForMode('lan-client', '', { 'lan-client': 'http://10.0.0.5:4317' }, LOCAL),
    'http://10.0.0.5:4317',
  );
});

test('remote-mode endpoint memory is persisted and never stores loopback', async () => {
  const { readEndpointMemory, rememberEndpoint, writeEndpointMemory } = await loadModule();
  const storage = fakeStorage();
  const memory = readEndpointMemory(storage);
  rememberEndpoint(memory, 'cloud', ' https://cloud.example.edu/// ', LOCAL);
  rememberEndpoint(memory, 'cloud', LOCAL, LOCAL);
  rememberEndpoint(memory, 'single', LOCAL, LOCAL);
  rememberEndpoint(memory, 'lan-client', 'http://10.0.0.5:4317', LOCAL);
  writeEndpointMemory(memory, storage);
  assert.deepEqual(readEndpointMemory(storage), {
    'lan-client': 'http://10.0.0.5:4317',
    cloud: 'https://cloud.example.edu',
  });
});

test('invalid memory and unavailable storage fall back safely', async () => {
  const { CLOUD_ENDPOINT_PLACEHOLDER, initialEndpointForMode, readActiveEndpoint, readEndpointMemory, writeActiveEndpoint } = await loadModule();
  assert.deepEqual(
    readEndpointMemory(fakeStorage({ 'warpweft-runtime-endpoints': '{"cloud":"ftp://bad","single":"not a url"}' })),
    {},
  );
  assert.deepEqual(readEndpointMemory(fakeStorage({ 'warpweft-runtime-endpoints': 'not json' })), {});
  assert.deepEqual(
    readEndpointMemory(
      fakeStorage({ 'warpweft-runtime-endpoints': '{"single":"http://192.168.1.20:4317","cloud":"https://cloud.example.edu"}' }),
    ),
    { cloud: 'https://cloud.example.edu' },
  );
  assert.equal(initialEndpointForMode('single', '', undefined, LOCAL), LOCAL);
  assert.equal(
    initialEndpointForMode('cloud', '', undefined, LOCAL),
    CLOUD_ENDPOINT_PLACEHOLDER,
  );
  const broken = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  assert.equal(readActiveEndpoint(broken), '');
  assert.doesNotThrow(() => writeActiveEndpoint('https://cloud.example.edu', broken));
});

test('active endpoint helpers round-trip the stored address', async () => {
  const { readActiveEndpoint, writeActiveEndpoint } = await loadModule();
  const storage = fakeStorage();
  writeActiveEndpoint('https://cloud.example.edu', storage);
  assert.equal(readActiveEndpoint(storage), 'https://cloud.example.edu');
});

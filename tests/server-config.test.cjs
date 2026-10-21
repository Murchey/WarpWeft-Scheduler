const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULTS,
  memoryLimitFor,
  normalizeIp,
  validateCidr,
  cidrMatches,
  ipAllowed,
  normalizeConfig,
} = require('../apps/desktop/server-config.cjs');

test('defaults are conservative and LAN-safe', () => {
  assert.equal(DEFAULTS.bindAddress, 'loopback');
  assert.equal(DEFAULTS.maxClients, 8);
  assert.equal(DEFAULTS.maxConcurrentJobs, 1);
  assert.equal(DEFAULTS.queueCapacity, 24);
  assert.deepEqual(DEFAULTS.allowedCidrs, []);
});

test('normalizes IPv4-mapped and loopback addresses', () => {
  assert.equal(normalizeIp('::ffff:192.168.1.20'), '192.168.1.20');
  assert.equal(normalizeIp('::1'), '127.0.0.1');
  assert.equal(normalizeIp(' 10.0.0.5 '), '10.0.0.5');
  assert.equal(normalizeIp(undefined), '');
});

test('validates CIDR entries and only supports IPv4 ranges', () => {
  assert.equal(validateCidr('192.168.1.0/24'), null);
  assert.equal(validateCidr('10.0.0.0/8'), null);
  assert.equal(validateCidr('192.168.1.10'), null);
  assert.ok(validateCidr('192.168.1.0/33'));
  assert.ok(validateCidr('999.1.1.1/24'));
  assert.ok(validateCidr('fd00::/8'));
  assert.ok(validateCidr(''));
});

test('matches IPv4 CIDRs and treats an empty allowlist as allow-all', () => {
  assert.ok(cidrMatches('192.168.1.0/24', '192.168.1.77'));
  assert.ok(cidrMatches('192.168.1.0/24', '::ffff:192.168.1.5'));
  assert.ok(!cidrMatches('192.168.1.0/24', '192.168.2.5'));
  assert.ok(cidrMatches('0.0.0.0/0', '172.16.3.9'));
  assert.ok(ipAllowed('192.168.9.9', []));
  assert.ok(ipAllowed('192.168.9.9', ['192.168.9.0/24']));
  assert.ok(!ipAllowed('10.1.2.3', ['192.168.9.0/24']));
});

test('clamps out-of-range values and reports warnings', () => {
  const { config, warnings } = normalizeConfig(
    { maxClients: 99, maxConcurrentJobs: 0, queueCapacity: 2, jobTimeoutSeconds: 5, allowedCidrs: ['bad', '10.0.0.0/8'] },
    DEFAULTS,
  );
  assert.equal(config.maxClients, DEFAULTS.maxClients);
  assert.equal(config.maxConcurrentJobs, DEFAULTS.maxConcurrentJobs);
  assert.equal(config.queueCapacity, DEFAULTS.queueCapacity);
  assert.equal(config.jobTimeoutSeconds, DEFAULTS.jobTimeoutSeconds);
  assert.deepEqual(config.allowedCidrs, ['10.0.0.0/8']);
  assert.ok(warnings.length >= 4);
});

test('keeps per-client caps within the configured concurrency and queue', () => {
  const { config, warnings } = normalizeConfig(
    { maxConcurrentJobs: 2, perClientActive: 5, perClientQueued: 50, queueCapacity: 10 },
    DEFAULTS,
  );
  assert.equal(config.perClientActive, 2);
  assert.equal(config.perClientQueued, 10);
  assert.ok(warnings.length >= 2);
});

test('effective concurrency is bounded by memory and by the hard maximum', () => {
  const limitedMemory = normalizeConfig({ maxConcurrentJobs: 8 }, DEFAULTS, { totalMemory: 2 * 1024 * 1024 * 1024 });
  assert.equal(limitedMemory.effective.maxConcurrentJobs, 1);
  assert.ok(limitedMemory.warnings.some((warning) => warning.includes('内存限制')));

  const plenty = normalizeConfig({ maxConcurrentJobs: 8 }, DEFAULTS, { totalMemory: 128 * 1024 * 1024 * 1024 });
  assert.equal(plenty.effective.maxConcurrentJobs, 8);
  assert.equal(plenty.effective.memoryLimit, 8);
});

test('memory limit never drops below one job', () => {
  assert.equal(memoryLimitFor(256 * 1024 * 1024), 1);
});

test('bindAddress only accepts loopback or lan and records bad values', () => {
  const lan = normalizeConfig({ bindAddress: 'lan' }, DEFAULTS);
  assert.equal(lan.config.bindAddress, 'lan');
  const bad = normalizeConfig({ bindAddress: '0.0.0.0' }, DEFAULTS);
  assert.equal(bad.config.bindAddress, 'loopback');
  assert.ok(bad.warnings.some((warning) => warning.includes('bindAddress')));
});

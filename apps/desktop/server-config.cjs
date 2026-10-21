const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Server-side limits for LAN sharing. Kept in its own file (not in the synced
 * workspace JSON) because these values are machine-specific and must never be
 * pushed to clients.
 */
const DEFAULTS = Object.freeze({
  bindAddress: 'loopback',
  maxClients: 8,
  maxConcurrentJobs: 1,
  queueCapacity: 24,
  perClientActive: 1,
  perClientQueued: 4,
  jobTimeoutSeconds: 120,
  allowedCidrs: [],
});

const RANGES = {
  maxClients: [1, 32],
  maxConcurrentJobs: [1, 8],
  queueCapacity: [4, 100],
  perClientActive: [1, 8],
  perClientQueued: [0, 100],
  jobTimeoutSeconds: [30, 600],
};

/** Each concurrent solver is a JVM with -Xmx512m; keep half of the RAM free. */
const MEMORY_PER_JOB = 640 * 1024 * 1024;

function memoryLimitFor(totalMemory = os.totalmem()) {
  return Math.max(1, Math.min(8, Math.floor((totalMemory * 0.5) / MEMORY_PER_JOB)));
}

function clampInt(name, value, fallback, warnings) {
  const [min, max] = RANGES[name];
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max || Math.round(numeric) !== numeric) {
    if (value !== undefined && value !== null && value !== '') {
      warnings.push(`${name} 需为 ${min}–${max} 的整数，已回退为 ${fallback}`);
    }
    return fallback;
  }
  return numeric;
}

function normalizeIp(ip) {
  if (!ip) return '';
  const trimmed = String(ip).trim();
  if (trimmed.startsWith('::ffff:')) return trimmed.slice('::ffff:'.length);
  if (trimmed === '::1') return '127.0.0.1';
  return trimmed;
}

function ipv4ToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = (value * 256) + octet;
  }
  return value;
}

/** Returns null when valid, otherwise a human readable reason. */
function validateCidr(entry) {
  const text = String(entry ?? '').trim();
  if (!text) return '空的网段';
  const [ip, prefixText, extra] = text.split('/');
  if (extra !== undefined) return `网段格式无效：${text}`;
  const ipValue = ipv4ToInt(ip);
  if (ipValue === null) return `仅支持 IPv4 网段：${text}`;
  if (prefixText !== undefined) {
    const prefix = Number(prefixText);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return `前缀长度无效：${text}`;
  }
  return null;
}

function cidrMatches(entry, ip) {
  const [network, prefixText] = String(entry).split('/');
  const target = ipv4ToInt(normalizeIp(ip));
  const base = ipv4ToInt(network);
  if (target === null || base === null) return false;
  const prefix = prefixText === undefined ? 32 : Number(prefixText);
  if (prefix === 0) return true;
  const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
  return ((target & mask) >>> 0) === ((base & mask) >>> 0);
}

/** Empty allowlist means "trust the whole LAN" (no authentication by design). */
function ipAllowed(ip, allowedCidrs = []) {
  if (!Array.isArray(allowedCidrs) || allowedCidrs.length === 0) return true;
  return allowedCidrs.some((entry) => cidrMatches(entry, ip));
}

function normalizeConfig(patch = {}, current = DEFAULTS, { totalMemory } = {}) {
  const warnings = [];
  const next = { ...DEFAULTS, ...current };

  if (patch.bindAddress !== undefined) {
    const value = String(patch.bindAddress);
    if (value === 'loopback' || value === 'lan') next.bindAddress = value;
    else warnings.push('bindAddress 只能是 loopback 或 lan，已忽略');
  }

  for (const name of Object.keys(RANGES)) {
    if (patch[name] === undefined) continue;
    next[name] = clampInt(name, patch[name], next[name], warnings);
  }

  if (patch.allowedCidrs !== undefined) {
    const raw = patch.allowedCidrs;
    const list = Array.isArray(raw)
      ? raw
      : String(raw)
          .split(/[,\s]+/)
          .filter(Boolean);
    const valid = [];
    for (const entry of list) {
      const reason = validateCidr(entry);
      if (reason) warnings.push(reason);
      else valid.push(String(entry).trim());
    }
    next.allowedCidrs = Array.from(new Set(valid));
  }

  // Cross-field rules.
  if (next.perClientActive > next.maxConcurrentJobs) {
    warnings.push(`perClientActive ${next.perClientActive} 超过并发上限，已按 ${next.maxConcurrentJobs} 处理`);
    next.perClientActive = next.maxConcurrentJobs;
  }
  if (next.perClientQueued > next.queueCapacity) {
    next.perClientQueued = next.queueCapacity;
    warnings.push('perClientQueued 已按队列容量收窄');
  }

  const memoryLimit = memoryLimitFor(totalMemory);
  const effectiveConcurrentJobs = Math.max(1, Math.min(next.maxConcurrentJobs, memoryLimit));
  if (effectiveConcurrentJobs !== next.maxConcurrentJobs) {
    warnings.push(
      `并发数 ${next.maxConcurrentJobs} 受内存限制（${Math.round((totalMemory ?? os.totalmem()) / 1024 / 1024)}MB）钳制为 ${effectiveConcurrentJobs}`,
    );
  }

  return {
    config: next,
    effective: { maxConcurrentJobs: effectiveConcurrentJobs, memoryLimit },
    warnings,
  };
}

function loadConfig(file) {
  if (!file || !fs.existsSync(file)) {
    const { config, effective } = normalizeConfig(DEFAULTS, DEFAULTS);
    return { config, effective, warnings: [] };
  }
  let parsed = {};
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {
      ...normalizeConfig(DEFAULTS, DEFAULTS),
      warnings: ['服务端配置损坏，已回退为默认值'],
    };
  }
  return normalizeConfig(parsed, DEFAULTS);
}

function saveConfig(file, config) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

module.exports = {
  DEFAULTS,
  RANGES,
  MEMORY_PER_JOB,
  memoryLimitFor,
  normalizeIp,
  validateCidr,
  cidrMatches,
  ipAllowed,
  normalizeConfig,
  loadConfig,
  saveConfig,
};

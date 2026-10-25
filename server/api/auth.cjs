const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const SCRYPT = Object.freeze({ N: 16384, r: 8, p: 1, keylen: 64 });
const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function authError(message, code = 'AUTH_ERROR', statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function validateUsername(value) {
  const text = String(value ?? '').trim();
  if (!text) return '用户名不能为空';
  if (!USERNAME_PATTERN.test(text)) return '用户名需为 3–32 位字母、数字、下划线、点或短横线';
  return null;
}

function validatePassword(value) {
  const text = String(value ?? '');
  if (text.length < PASSWORD_MIN) return '密码至少需要 ' + PASSWORD_MIN + ' 位';
  if (text.length > PASSWORD_MAX) return '密码不能超过 ' + PASSWORD_MAX + ' 位';
  return null;
}

function hashPassword(password) {
  const reason = validatePassword(password);
  if (reason) throw authError(reason, 'INVALID_PASSWORD', 400);
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 64 * 1024 * 1024,
  });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored ?? '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, r, p, saltText, hashText] = parts;
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(hashText, 'base64url');
    const actual = crypto.scryptSync(String(password ?? ''), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    role: user.role === 'admin' ? 'admin' : 'user',
    disabled: Boolean(user.disabled),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

class UserStore {
  constructor(file) {
    this.file = file;
    this.data = this.load();
    this.mtimeMs = this.fileMtime();
  }

  fileMtime() {
    try {
      return fs.statSync(this.file).mtimeMs;
    } catch {
      return -1;
    }
  }

  reloadIfChanged() {
    const mtime = this.fileMtime();
    if (mtime === this.mtimeMs) return;
    this.data = this.load();
    this.mtimeMs = mtime;
  }

  load() {
    if (!fs.existsSync(this.file)) return { version: 1, users: [] };
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      throw authError('用户文件损坏，拒绝启动：' + this.file, 'USERS_CORRUPT', 500);
    }
    if (!parsed || !Array.isArray(parsed.users)) {
      throw authError('用户文件格式无效：' + this.file, 'USERS_CORRUPT', 500);
    }
    return { version: 1, users: parsed.users.filter((user) => user && typeof user.id === 'string' && typeof user.username === 'string') };
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { encoding: 'utf8', mode: 0o600 });
    try {
      fs.chmodSync(tmp, 0o600);
    } catch {
      // Windows and some filesystems do not support POSIX modes.
    }
    fs.renameSync(tmp, this.file);
    this.mtimeMs = this.fileMtime();
  }

  list() {
    this.reloadIfChanged();
    return this.data.users.map(publicUser);
  }

  findById(id) {
    this.reloadIfChanged();
    return this.data.users.find((user) => user.id === id) || null;
  }

  findByUsername(username) {
    this.reloadIfChanged();
    const wanted = String(username ?? '').trim().toLowerCase();
    return this.data.users.find((user) => String(user.username).toLowerCase() === wanted) || null;
  }

  adminCount() {
    return this.data.users.filter((user) => user.role === 'admin' && !user.disabled).length;
  }

  needsSetup() {
    this.reloadIfChanged();
    return this.adminCount() === 0;
  }

  create(input = {}) {
    this.reloadIfChanged();
    const username = String(input.username ?? '').trim();
    const usernameError = validateUsername(username);
    if (usernameError) throw authError(usernameError, 'INVALID_USERNAME', 400);
    if (this.findByUsername(username)) throw authError('用户名已存在', 'USER_EXISTS', 409);
    const passwordError = validatePassword(input.password);
    if (passwordError) throw authError(passwordError, 'INVALID_PASSWORD', 400);
    const now = new Date().toISOString();
    const user = {
      id: 'user-' + crypto.randomUUID(),
      username,
      displayName: String(input.displayName ?? '').trim() || username,
      role: input.role === 'admin' ? 'admin' : 'user',
      disabled: Boolean(input.disabled),
      passwordHash: hashPassword(input.password),
      createdAt: now,
      updatedAt: now,
    };
    this.data.users.push(user);
    this.save();
    return publicUser(user);
  }

  update(id, patch = {}) {
    this.reloadIfChanged();
    const user = this.findById(id);
    if (!user) throw authError('用户不存在', 'USER_NOT_FOUND', 404);
    if (patch.displayName !== undefined) {
      user.displayName = String(patch.displayName).trim() || user.username;
    }
    if (patch.role !== undefined) {
      const role = patch.role === 'admin' ? 'admin' : 'user';
      if (user.role === 'admin' && role !== 'admin' && this.adminCount() <= 1) {
        throw authError('不能移除最后一位管理员', 'LAST_ADMIN', 409);
      }
      user.role = role;
    }
    if (patch.disabled !== undefined) {
      const disabled = Boolean(patch.disabled);
      if (user.role === 'admin' && !user.disabled && disabled && this.adminCount() <= 1) {
        throw authError('不能禁用最后一位管理员', 'LAST_ADMIN', 409);
      }
      user.disabled = disabled;
    }
    if (patch.password !== undefined) {
      const passwordError = validatePassword(patch.password);
      if (passwordError) throw authError(passwordError, 'INVALID_PASSWORD', 400);
      user.passwordHash = hashPassword(patch.password);
    }
    user.updatedAt = new Date().toISOString();
    this.save();
    return publicUser(user);
  }

  remove(id) {
    this.reloadIfChanged();
    const user = this.findById(id);
    if (!user) throw authError('用户不存在', 'USER_NOT_FOUND', 404);
    if (user.role === 'admin' && !user.disabled && this.adminCount() <= 1) {
      throw authError('不能删除最后一位管理员', 'LAST_ADMIN', 409);
    }
    this.data.users = this.data.users.filter((item) => item.id !== id);
    this.save();
    return publicUser(user);
  }

  verify(username, password) {
    this.reloadIfChanged();
    const user = this.findByUsername(username);
    if (!user || user.disabled || !verifyPassword(password, user.passwordHash)) return null;
    return user;
  }
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('base64url');
}

class SessionStore {
  constructor({ ttlMs = DEFAULT_SESSION_TTL_MS } = {}) {
    this.ttlMs = ttlMs;
    this.sessions = new Map();
    this.timer = setInterval(() => this.prune(), 60_000);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  create(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + this.ttlMs;
    this.sessions.set(sha256(token), { userId, expiresAt });
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  get(token) {
    if (!token) return null;
    const key = sha256(token);
    const session = this.sessions.get(key);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(key);
      return null;
    }
    return session;
  }

  destroy(token) {
    if (token) this.sessions.delete(sha256(token));
  }

  destroyUser(userId, exceptToken = '') {
    const keep = exceptToken ? sha256(exceptToken) : '';
    for (const [key, session] of this.sessions) {
      if (session.userId === userId && key !== keep) this.sessions.delete(key);
    }
  }

  prune() {
    const now = Date.now();
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(key);
    }
  }
}

module.exports = {
  DEFAULT_SESSION_TTL_MS,
  authError,
  validateUsername,
  validatePassword,
  hashPassword,
  verifyPassword,
  publicUser,
  UserStore,
  SessionStore,
};

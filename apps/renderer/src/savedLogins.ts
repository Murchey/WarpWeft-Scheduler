export interface SavedLogin {
  username: string;
  password: string;
  updatedAt: string;
}

const PREFIX = 'warpweft-saved-logins:';
const MAX_ACCOUNTS = 8;

function keyFor(base: string): string {
  return PREFIX + base;
}

function currentBase(base: string): string {
  return String(base || '').replace(/\/+$/, '');
}

function valid(item: unknown): item is SavedLogin {
  if (!item || typeof item !== 'object') return false;
  const candidate = item as Partial<SavedLogin>;
  return (
    typeof candidate.username === 'string' &&
    candidate.username.trim().length > 0 &&
    typeof candidate.password === 'string' &&
    candidate.password.length > 0
  );
}

/**
 * These credentials live in the browser's localStorage because a plain
 * browser page has no OS credential vault. This is an explicit convenience
 * feature: the login screen warns about shared computers, and every saved
 * account can be removed individually. It must never be used as an
 * authentication source by the server.
 */
export function readSavedLogins(base: string): SavedLogin[] {
  try {
    const raw = window.localStorage.getItem(keyFor(currentBase(base)));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(valid)
      .map((item) => ({
        username: item.username.trim(),
        password: item.password,
        updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
      }))
      .slice(0, MAX_ACCOUNTS);
  } catch {
    return [];
  }
}

export function rememberSavedLogin(input: { username: string; password: string }, base: string): SavedLogin[] {
  const username = String(input.username || '').trim();
  const password = String(input.password || '');
  if (!username || !password) return readSavedLogins(base);
  const entry: SavedLogin = { username, password, updatedAt: new Date().toISOString() };
  const existing = readSavedLogins(base).filter(
    (item) => item.username.toLowerCase() !== username.toLowerCase(),
  );
  const next = [entry, ...existing].slice(0, MAX_ACCOUNTS);
  try {
    window.localStorage.setItem(keyFor(currentBase(base)), JSON.stringify(next));
  } catch {
    // Storage can be unavailable in hardened browser modes; login still works.
  }
  return next;
}

export function forgetSavedLogin(username: string, base: string): SavedLogin[] {
  const wanted = String(username || '').trim().toLowerCase();
  const next = readSavedLogins(base).filter(
    (item) => item.username.toLowerCase() !== wanted,
  );
  try {
    window.localStorage.setItem(keyFor(currentBase(base)), JSON.stringify(next));
  } catch {
    // Ignore storage failures.
  }
  return next;
}

export function clearSavedLogins(base: string): SavedLogin[] {
  try {
    window.localStorage.removeItem(keyFor(currentBase(base)));
  } catch {
    // Ignore storage failures.
  }
  return [];
}

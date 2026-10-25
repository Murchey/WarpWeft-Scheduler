const FALLBACK_API_BASE = 'http://127.0.0.1:4317';

/** The dev server is not the API server; every other deployment is same-origin. */
export function resolveDefaultApiBase(dev: boolean, origin: string): string {
  if (dev) return FALLBACK_API_BASE;
  try {
    const url = new URL(origin);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.host) {
      return origin.replace(/\/+$/, '');
    }
  } catch {
    // file:// or an opaque browser origin: fall back to the desktop local API.
  }
  return FALLBACK_API_BASE;
}

/** Keep a saved endpoint only when it is an absolute HTTP(S) URL. */
export function normalizeApiEndpoint(value: string | null | undefined, fallback: string): string {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  try {
    const url = new URL(text);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.host) {
      return text.replace(/\/+$/, '');
    }
  } catch {
    // fall through to the current-page default
  }
  return fallback;
}

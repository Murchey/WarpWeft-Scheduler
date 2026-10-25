import type { RunMode } from './types';
import { normalizeApiEndpoint } from './apiBase.ts';

export const RUNTIME_MODE_KEY = 'warpweft-runtime-mode';
export const RUNTIME_ENDPOINT_KEY = 'warpweft-runtime-endpoint';
export const RUNTIME_ENDPOINT_MEMORY_KEY = 'warpweft-runtime-endpoints';
export const CLOUD_ENDPOINT_PLACEHOLDER = 'https://';

export type EndpointMemory = Partial<Record<RunMode, string>>;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// Local modes always point at this machine, so only remote modes need memory.
const ENDPOINT_MODES: RunMode[] = ['lan-client', 'cloud'];

/** Trimmed, valid absolute HTTP(S) endpoint, or null. */
export function cleanEndpoint(value: string | null | undefined): string | null {
  return normalizeApiEndpoint(value, '') || null;
}

export function readActiveEndpoint(storage: StorageLike): string {
  try {
    return storage.getItem(RUNTIME_ENDPOINT_KEY) ?? '';
  } catch {
    return '';
  }
}

export function writeActiveEndpoint(value: string, storage: StorageLike): void {
  try {
    storage.setItem(RUNTIME_ENDPOINT_KEY, value);
  } catch {
    // localStorage can be unavailable in hardened browser modes.
  }
}

export function readEndpointMemory(storage: StorageLike): EndpointMemory {
  try {
    const raw = storage.getItem(RUNTIME_ENDPOINT_MEMORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const memory: EndpointMemory = {};
    for (const mode of ENDPOINT_MODES) {
      const value = (parsed as Record<string, unknown>)[mode];
      const cleaned = typeof value === 'string' ? cleanEndpoint(value) : null;
      if (cleaned) memory[mode] = cleaned;
    }
    return memory;
  } catch {
    return {};
  }
}

export function writeEndpointMemory(memory: EndpointMemory, storage: StorageLike): void {
  try {
    const cleaned: EndpointMemory = {};
    for (const mode of ENDPOINT_MODES) {
      const value = cleanEndpoint(memory[mode]);
      if (value) cleaned[mode] = value;
    }
    storage.setItem(RUNTIME_ENDPOINT_MEMORY_KEY, JSON.stringify(cleaned));
  } catch {
    // Keep the in-memory copy; persistence is best-effort.
  }
}

/**
 * Records the address a remote mode last used. Local modes always resolve to
 * the local API, and loopback is never a useful remote address, so neither is
 * remembered here.
 */
export function rememberEndpoint(
  memory: EndpointMemory,
  mode: RunMode,
  endpoint: string | null | undefined,
  localBase: string,
): EndpointMemory {
  if (mode !== 'lan-client' && mode !== 'cloud') return memory;
  const value = cleanEndpoint(endpoint);
  if (!value) return memory;
  const local = cleanEndpoint(localBase);
  if (local && value === local) return memory;
  memory[mode] = value;
  return memory;
}

/** Address to work with when the settings dialog is first opened. */
export function initialEndpointForMode(
  mode: RunMode,
  activeEndpoint: string | null | undefined,
  memory: EndpointMemory | undefined,
  localBase: string,
): string {
  const local = cleanEndpoint(localBase) ?? localBase;
  const active = cleanEndpoint(activeEndpoint);
  const remembered = cleanEndpoint(memory?.[mode]);
  if (mode === 'single' || mode === 'lan-server') {
    // A deep link may pin a remote endpoint to a local mode; show it as-is.
    return active ?? local;
  }
  if (mode === 'lan-client') {
    return active && active !== local ? active : remembered ?? local;
  }
  return active && active !== local ? active : remembered && remembered !== local ? remembered : CLOUD_ENDPOINT_PLACEHOLDER;
}

/**
 * Address to show after switching from another mode. Local modes must not keep
 * the previous remote address; remote modes reuse their own remembered address.
 */
export function endpointForMode(
  mode: RunMode,
  options: { current?: string | null; remembered?: EndpointMemory; localBase: string },
): string {
  const local = cleanEndpoint(options.localBase) ?? options.localBase;
  const remembered = cleanEndpoint(options.remembered?.[mode]);
  const current = cleanEndpoint(options.current);
  if (mode === 'single' || mode === 'lan-server') {
    return local;
  }
  if (mode === 'lan-client') {
    return remembered ?? (current && current !== local ? current : local);
  }
  return remembered && remembered !== local ? remembered : current && current !== local ? current : CLOUD_ENDPOINT_PLACEHOLDER;
}

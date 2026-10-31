/**
 * 官网使用的极薄 API 客户端。
 *
 * 刻意复用应用层 api.ts 的 getApiBase / getAuthToken / getClientId：
 * - 同一个 localStorage key（warpweft-auth-token:<origin>）让官网与 /app/ 应用共享会话；
 * - 同一个 X-Client-Id 让官网不会额外占用「已连接电脑」名额；
 * - dev 环境下同样解析到 http://127.0.0.1:4317，无需另配代理。
 */

import { getApiBase, getAuthToken, setAuthToken, clearAuthToken, getClientId } from '../../apps/renderer/src/api';

export interface HealthInfo {
  ok?: boolean;
  appVersion?: string;
  schemaVersion?: number;
  solverProtocol?: string;
  auth?: { required?: boolean; needsSetup?: boolean; mode?: string };
  solver?: { ready?: boolean; engine?: string };
}

export interface ServerStats {
  uptimeSeconds?: number;
  cpu?: { cores?: number; usage?: number };
  memory?: { usage?: number; process?: number };
  java?: { version?: string; available?: boolean };
  solver?: { ready?: boolean };
  queue?: { running?: number; queued?: number };
  clients?: { active?: number; max?: number };
  limits?: { maxConcurrentJobs?: number; queueCapacity?: number };
}

export interface JobSummary {
  id?: string;
  status?: string;
  lessons?: number;
  entries?: number;
  elapsedMs?: number;
  finishedAt?: string | null;
}

export interface LogItem {
  seq?: number;
  level?: string;
  time?: string;
  message?: string;
}

export interface Overview {
  stats?: ServerStats;
  jobs?: JobSummary[];
  logs?: { items?: LogItem[]; lastSeq?: number };
}

export interface LoginResult {
  token?: string;
  user?: { username?: string; role?: string };
  expiresAt?: string;
}

export class SiteApiError extends Error {
  status?: number;
  code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = 'SiteApiError';
    this.status = status;
    this.code = code;
  }
}

async function call<T>(path: string, init: RequestInit = {}, timeoutMs = 12000): Promise<T> {
  const base = getApiBase();
  const token = getAuthToken(base);
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(init.headers);
  headers.set('X-Client-Id', getClientId());
  if (init.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', 'Bearer ' + token);
  try {
    const response = await fetch(base + path, {
      ...init,
      headers,
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
    });
    if (response.status === 401 && !path.startsWith('/api/auth/login')) {
      // 会话过期（服务端重启或超过 12 小时）：只清本地凭证，不调用 logout，
      // 否则会把 /app/ 应用中正在使用的同一 token 一并注销。
      clearAuthToken(base);
      throw new SiteApiError('会话已过期', 401);
    }
    const text = await response.text();
    if (!response.ok) {
      let code: string | undefined;
      let message = 'HTTP ' + response.status;
      try {
        const body = JSON.parse(text) as { error?: string; code?: string };
        if (body.error) message = body.error;
        code = body.code;
      } catch {
        // 非 JSON 响应沿用默认文案
      }
      throw new SiteApiError(message, response.status, code);
    }
    return (text ? JSON.parse(text) : {}) as T;
  } finally {
    window.clearTimeout(timer);
  }
}

export function fetchHealth(): Promise<HealthInfo> {
  return call<HealthInfo>('/api/health');
}

export function fetchOverview(sinceLog = 0): Promise<Overview> {
  return call<Overview>(`/api/server/overview?sinceLog=${sinceLog}`);
}

export async function login(username: string, password: string): Promise<LoginResult> {
  const result = await call<LoginResult>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (result.token) setAuthToken(result.token);
  return result;
}

export function hasToken(): boolean {
  return Boolean(getAuthToken(getApiBase()));
}

export function forgetSession(): void {
  clearAuthToken(getApiBase());
}

/**
 * 日志脱敏：面板面向公网访客，不能泄漏内网 IP、绝对路径与账号名。
 */
export function maskText(value: string): string {
  return value
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '***.***.***.***')
    .replace(/[A-Za-z]:\\[^\s，,。]*/g, '<path>')
    .replace(/\/(?:var|opt|home|etc)\/[^\s，,。]*/g, '<path>')
    .replace(/\b([A-Za-z0-9_.-]{2})[A-Za-z0-9_.-]*(?=@)/g, '$1***');
}

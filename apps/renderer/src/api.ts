import type { SchoolData, SolverInput, SolverOutput } from './types';

export const DEFAULT_API_BASE = 'http://127.0.0.1:4317';

export function getApiBase(): string {
  const saved = window.localStorage.getItem('warpweft-runtime-endpoint');
  return (saved || DEFAULT_API_BASE).replace(/\/+$/, '');
}

async function failure(response: Response, text: string): Promise<string> {
  try {
    const body = JSON.parse(text) as { error?: string; explanation?: string };
    return body.error || body.explanation || `HTTP ${response.status}`;
  } catch {
    return text.trim() || `HTTP ${response.status}`;
  }
}

async function request(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

export async function loadData(): Promise<SchoolData> {
  const response = await request(`${getApiBase()}/api/data`, { cache: 'no-store' }, 15000);
  const text = await response.text();
  if (!response.ok) throw new Error(await failure(response, text));
  return JSON.parse(text) as SchoolData;
}

export async function saveData(data: SchoolData): Promise<SchoolData> {
  const response = await request(
    `${getApiBase()}/api/data`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
    15000,
  );
  const text = await response.text();
  if (!response.ok) throw new Error(await failure(response, text));
  return JSON.parse(text) as SchoolData;
}

export interface ServerStats {
  at: string;
  host: string;
  port: number;
  platform: string;
  arch: string;
  node: string;
  pid: number;
  uptimeSeconds: number;
  osUptimeSeconds: number;
  cpu: {
    model: string;
    cores: number;
    usage: number;
    load: number[];
  };
  memory: {
    total: number;
    free: number;
    used: number;
    usage: number;
    process: number;
  };
  java: {
    available: boolean;
    version: string | null;
    command: string;
    output: string;
  };
  solver: {
    engine: string;
    jar: string;
    ready: boolean;
  };
  queue: {
    queued: number;
    running: number;
    completed: number;
    failed: number;
    activeJob: string | null;
  };
  totalJobs: number;
}

export interface ServerJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'timeout' | string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  elapsedMs: number;
  queuePosition: number;
  lessons: number;
  classes: number;
  plans: number;
  entries: number;
  resultStatus: string | null;
  error: string | null;
}

export interface ServerLog {
  seq: number;
  at: string;
  level: 'info' | 'warn' | 'error' | 'debug' | string;
  message: string;
  jobId?: string | null;
}

async function getJson<T>(path: string, timeoutMs = 10000): Promise<T> {
  const response = await request(`${getApiBase()}${path}`, { cache: 'no-store' }, timeoutMs);
  const text = await response.text();
  if (!response.ok) throw new Error(await failure(response, text));
  return JSON.parse(text) as T;
}

export async function fetchServerStats(): Promise<ServerStats> {
  return getJson<ServerStats>('/api/server/stats');
}

export async function fetchServerJobs(): Promise<{ jobs: ServerJob[] }> {
  return getJson<{ jobs: ServerJob[] }>('/api/server/jobs');
}

export async function fetchServerLogs(since: number): Promise<{ logs: ServerLog[]; lastSeq: number }> {
  return getJson<{ logs: ServerLog[]; lastSeq: number }>('/api/server/logs?since=' + since);
}

export async function solveSchedule(input: SolverInput): Promise<SolverOutput> {
  const response = await request(
    `${getApiBase()}/api/solve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    (input.timeLimitSeconds + 20) * 1000,
  );
  const text = await response.text();
  if (!response.ok) throw new Error(await failure(response, text));
  try {
    return JSON.parse(text) as SolverOutput;
  } catch {
    throw new Error('本地求解器返回了无法解析的内容');
  }
}

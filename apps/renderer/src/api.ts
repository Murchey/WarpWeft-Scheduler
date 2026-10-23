import type { SchoolData, SolverInput, SolverOutput } from './types';
import { withFixedClassRooms } from './fixedClassrooms';

export const DEFAULT_API_BASE = 'http://127.0.0.1:4317';

const CLIENT_ID_KEY = 'warpweft-client-id';
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_.:-]{3,64}$/;

let fallbackClientId: string | null = null;

export function getApiBase(): string {
  const saved = window.localStorage.getItem('warpweft-runtime-endpoint');
  return (saved || DEFAULT_API_BASE).replace(/\/+$/, '');
}

function createClientId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      const uuid = crypto.randomUUID();
      if (CLIENT_ID_PATTERN.test(uuid)) return uuid;
    }
  } catch {
    // fall through to the random string below
  }
  const random = Math.random().toString(36).slice(2, 12);
  const stamp = Date.now().toString(36);
  return ('web-' + stamp + '-' + random).slice(0, 64);
}

/**
 * Stable per-browser admission id. It is only used for counting connected
 * computers and per-client quotas — never for authentication.
 */
export function getClientId(): string {
  try {
    const saved = window.localStorage.getItem(CLIENT_ID_KEY);
    if (saved && CLIENT_ID_PATTERN.test(saved)) return saved;
    const created = createClientId();
    window.localStorage.setItem(CLIENT_ID_KEY, created);
    return created;
  } catch {
    if (!fallbackClientId) fallbackClientId = createClientId();
    return fallbackClientId;
  }
}

export class ApiError extends Error {
  code?: string;
  status?: number;
  retryAfter?: number;

  constructor(message: string, details: { code?: string; status?: number; retryAfter?: number } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = details.code;
    this.status = details.status;
    this.retryAfter = details.retryAfter;
  }
}

interface FailureBody {
  error?: string;
  explanation?: string;
  code?: string;
  retryAfterSeconds?: number;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds);
  const at = Date.parse(value);
  if (!Number.isNaN(at)) return Math.max(0, Math.round((at - Date.now()) / 1000));
  return undefined;
}

function failure(response: Response, text: string): ApiError {
  const retryAfter = parseRetryAfter(response.headers.get('Retry-After'));
  try {
    const body = JSON.parse(text) as FailureBody;
    const message = body.error || body.explanation || 'HTTP ' + response.status;
    const seconds = Number(body.retryAfterSeconds);
    return new ApiError(message, {
      code: typeof body.code === 'string' ? body.code : undefined,
      status: response.status,
      retryAfter: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : retryAfter,
    });
  } catch {
    return new ApiError(text.trim() || 'HTTP ' + response.status, { status: response.status, retryAfter });
  }
}

async function request(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  // timeoutMs <= 0 disables the client-side timer. Queued solves must not be
  // aborted just because they waited behind other computers; the server owns
  // the per-job timeout instead.
  const timer = timeoutMs > 0 ? window.setTimeout(() => controller.abort(), timeoutMs) : 0;
  const headers = new Headers(init.headers);
  headers.set('X-Client-Id', getClientId());
  try {
    return await fetch(url, { ...init, headers, signal: controller.signal });
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

export async function loadData(): Promise<SchoolData> {
  const response = await request(`${getApiBase()}/api/data`, { cache: 'no-store' }, 15000);
  const text = await response.text();
  if (!response.ok) throw failure(response, text);
  return withFixedClassRooms(JSON.parse(text) as SchoolData);
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
  if (!response.ok) throw failure(response, text);
  return withFixedClassRooms(JSON.parse(text) as SchoolData);
}

export interface ServerAddress {
  name: string;
  address: string;
}

export interface ServerConfig {
  bindAddress: 'loopback' | 'lan';
  maxClients: number;
  maxConcurrentJobs: number;
  queueCapacity: number;
  perClientActive: number;
  perClientQueued: number;
  jobTimeoutSeconds: number;
  allowedCidrs: string[];
}

export interface ServerLimits {
  maxClients: number;
  maxConcurrentJobs: number;
  queueCapacity: number;
  perClientActive: number;
  perClientQueued: number;
  jobTimeoutSeconds: number;
}

export interface ServerEffective {
  maxConcurrentJobs: number;
  memoryLimit: number;
}

export interface ServerStats {
  at: string;
  host: string;
  port: number;
  addresses: ServerAddress[];
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
    cancelled: number;
    capacity: number;
    concurrency: number;
    activeJob: string | null;
    activeJobs: string[];
  };
  clients: {
    active: number;
    max: number;
  };
  limits: ServerLimits;
  effective: ServerEffective;
  config: ServerConfig;
  warnings: string[];
  totalJobs: number;
}

export interface ServerClient {
  id: string;
  idShort: string;
  ip: string;
  anonymous: boolean;
  firstSeen: number;
  lastSeen: number;
  requests: number;
  running: number;
  queued: number;
}

export interface ServerJob {
  id: string;
  clientId: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled' | string;
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

export interface ServerOverview {
  stats: ServerStats;
  jobs: ServerJob[];
  logs: { items: ServerLog[]; lastSeq: number };
  config: ServerConfig;
  effective: ServerEffective;
  clients: ServerClient[];
}

export interface ServerConfigResult {
  config: ServerConfig;
  effective: ServerEffective;
  requiresRestart: boolean;
  warnings: string[];
  clients: { active: number; max: number };
  bind: { mode: ServerConfig['bindAddress']; host: string; port: number };
  rebinding?: boolean;
}

export interface ServerClientsResult {
  clients: ServerClient[];
  max: number;
}

async function getJson<T>(path: string, timeoutMs = 10000): Promise<T> {
  const response = await request(`${getApiBase()}${path}`, { cache: 'no-store' }, timeoutMs);
  const text = await response.text();
  if (!response.ok) throw failure(response, text);
  return JSON.parse(text) as T;
}

async function sendJson<T>(path: string, method: string, body?: unknown, timeoutMs = 10000): Promise<T> {
  const response = await request(
    `${getApiBase()}${path}`,
    {
      method,
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    timeoutMs,
  );
  const text = await response.text();
  if (!response.ok) throw failure(response, text);
  if (!text.trim()) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError('服务端返回了无法解析的内容', { status: response.status });
  }
}

export async function fetchServerStats(): Promise<ServerStats> {
  return getJson<ServerStats>('/api/server/stats');
}

export async function fetchServerOverview(sinceLog = 0): Promise<ServerOverview> {
  const since = Math.max(0, Math.floor(Number(sinceLog) || 0));
  return getJson<ServerOverview>('/api/server/overview?sinceLog=' + since);
}

export async function fetchServerJobs(): Promise<{ jobs: ServerJob[] }> {
  return getJson<{ jobs: ServerJob[] }>('/api/server/jobs');
}

export async function fetchServerLogs(since: number): Promise<{ logs: ServerLog[]; lastSeq: number }> {
  return getJson<{ logs: ServerLog[]; lastSeq: number }>('/api/server/logs?since=' + since);
}

export async function fetchServerClients(): Promise<ServerClientsResult> {
  return getJson<ServerClientsResult>('/api/server/clients');
}

export async function updateServerConfig(patch: Partial<ServerConfig>): Promise<ServerConfigResult> {
  return sendJson<ServerConfigResult>('/api/server/config', 'PUT', patch);
}

export async function deleteServerClient(
  id: string,
): Promise<{ ok: boolean; clients: ServerClient[] }> {
  return sendJson<{ ok: boolean; clients: ServerClient[] }>(
    '/api/server/clients/' + encodeURIComponent(id),
    'DELETE',
  );
}

export async function cancelServerJob(id: string): Promise<{ ok: boolean; status: string }> {
  return sendJson<{ ok: boolean; status: string }>(
    '/api/server/jobs/' + encodeURIComponent(id) + '/cancel',
    'POST',
  );
}

/** Readable Chinese copy for admission errors while keeping code/status for callers. */
function solveLimitError(error: ApiError): ApiError | null {
  const retry = error.retryAfter ? '约 ' + error.retryAfter + ' 秒后重试' : '稍后重试';
  if (error.code === 'CLIENT_LIMIT') {
    return new ApiError('服务端已满：已连接的电脑数已达上限，请' + retry + '，或在服务端断开闲置电脑。', error);
  }
  if (error.code === 'CLIENT_QUEUE_FULL') {
    return new ApiError('服务端已满：这台电脑在跑或排队的任务已达上限，请' + retry + '。', error);
  }
  if (error.code === 'QUEUE_FULL') {
    return new ApiError('服务端已满：求解队列已满，请' + retry + '。', error);
  }
  return null;
}

export async function solveSchedule(input: SolverInput): Promise<SolverOutput> {
  const response = await request(
    `${getApiBase()}/api/solve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    // No client-side timeout: a queued task may wait for other computers. The
    // server kills it at jobTimeoutSeconds and answers 504 TIMEOUT.
    0,
  );
  const text = await response.text();
  if (!response.ok) {
    const error = failure(response, text);
    throw solveLimitError(error) ?? error;
  }
  try {
    return JSON.parse(text) as SolverOutput;
  } catch {
    throw new ApiError('本地求解器返回了无法解析的内容', { status: response.status });
  }
}

// ---------------------------------------------------------------------------
// Long-running solve jobs (checkpointed, pausable, resumable)
// ---------------------------------------------------------------------------

export interface LongJob {
  id: string;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  elapsedMs: number;
  timeLimitSeconds: number;
  stagnationSeconds: number;
  lessons: number;
  total: number;
  placed: number;
  unplaced: number;
  score: number | null;
  rounds: number;
  error: string | null;
  hasFeasibleSolution: boolean;
  canResume: boolean;
  taskUuid?: string | null;
  snapshotId?: string | null;
}

export interface LongJobDetail extends LongJob {
  bestEntries: SolverOutput['entries'];
  bestUpdatedAt: string | null;
  inputSummary: {
    timeSlots: number;
    classes: number;
    teachers: number;
    rooms: number;
    plans: number;
    locked: number;
  };
}

export async function startLongJob(input: SolverInput, taskUuid?: string, snapshotId?: string): Promise<{ job: LongJob; reused?: boolean }> {
  return sendJson<{ job: LongJob; reused?: boolean }>('/api/solve/long', 'POST', { ...input, taskUuid, snapshotId }, 20000);
}

export async function fetchLongJobs(): Promise<{ jobs: LongJob[]; running: string | null }> {
  return getJson<{ jobs: LongJob[]; running: string | null }>('/api/solve/jobs');
}

export async function fetchLongJob(id: string): Promise<LongJobDetail> {
  return getJson<LongJobDetail>('/api/solve/jobs/' + encodeURIComponent(id));
}

export async function fetchLongJobByUuid(taskUuid: string): Promise<LongJobDetail> {
  return getJson<LongJobDetail>('/api/solve/jobs/by-uuid/' + encodeURIComponent(taskUuid));
}

export async function pauseLongJob(id: string): Promise<{ job: LongJob }> {
  return sendJson<{ job: LongJob }>('/api/solve/jobs/' + encodeURIComponent(id) + '/pause', 'POST');
}

export async function resumeLongJob(id: string): Promise<{ job: LongJob }> {
  return sendJson<{ job: LongJob }>('/api/solve/jobs/' + encodeURIComponent(id) + '/resume', 'POST');
}

export async function cancelLongJob(id: string): Promise<{ job: LongJob }> {
  return sendJson<{ job: LongJob }>('/api/solve/jobs/' + encodeURIComponent(id) + '/cancel', 'POST');
}

export async function deleteLongJob(id: string): Promise<{ deleted: boolean; id: string }> {
  return sendJson<{ deleted: boolean; id: string }>('/api/solve/jobs/' + encodeURIComponent(id), 'DELETE');
}

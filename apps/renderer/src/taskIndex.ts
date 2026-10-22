export interface TaskRecord {
  /** Client-generated task identifier (not an access credential). */
  taskUuid: string;
  jobId: string;
  /** Hash of the submitted snapshot, used for idempotent retries. */
  snapshotId: string;
  /** Server base URL, so switching servers never mixes task indexes. */
  endpoint: string;
  submittedAt: string;
}

const STORAGE_KEY = 'warpweft-task-index-v1';
const LIMIT = 20;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function isRecord(value: unknown): value is TaskRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as TaskRecord;
  return (
    typeof record.taskUuid === 'string' &&
    typeof record.jobId === 'string' &&
    typeof record.snapshotId === 'string' &&
    typeof record.endpoint === 'string'
  );
}

export function readTaskRecords(storage: StorageLike): TaskRecord[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecord).slice(0, LIMIT);
  } catch {
    return [];
  }
}

function write(storage: StorageLike, records: TaskRecord[]): TaskRecord[] {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, LIMIT)));
  } catch {
    // A full/disabled localStorage must not break task submission.
  }
  return records.slice(0, LIMIT);
}

export function rememberTask(storage: StorageLike, record: TaskRecord): TaskRecord[] {
  const records = readTaskRecords(storage).filter(
    (item) => item.taskUuid !== record.taskUuid && item.jobId !== record.jobId,
  );
  return write(storage, [record, ...records]);
}

export function forgetTask(storage: StorageLike, taskUuid: string): TaskRecord[] {
  return write(storage, readTaskRecords(storage).filter((item) => item.taskUuid !== taskUuid));
}

export function latestTaskForEndpoint(storage: StorageLike, endpoint: string): TaskRecord | null {
  return readTaskRecords(storage).find((item) => item.endpoint === endpoint) ?? null;
}

export function newTaskUuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the timestamp + random fallback
  }
  return 'task-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/**
 * Stable short hash of a solver input. Identical retries produce the same id;
 * a changed workspace produces a different one, which lets the server reject a
 * re-used task UUID instead of silently returning a stale result.
 */
export function snapshotIdOf(input: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(input) ?? '';
  } catch {
    text = String(input);
  }
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return text.length.toString(16) + '-' + hash.toString(16).padStart(8, '0');
}

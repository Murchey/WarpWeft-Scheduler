export type ToastTone = 'error' | 'success' | 'warning' | 'info';
export type ToastDismissReason = 'timeout' | 'closed' | 'replaced';

export interface ToastLogEntry {
  id: number;
  at: number;
  tone: ToastTone;
  title: string;
  message: string;
  reason: ToastDismissReason;
}

const STORAGE_KEY = 'warpweft-toast-log';
const MAX_LOGS = 100;

export function readToastLogs(): ToastLogEntry[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is ToastLogEntry =>
        Boolean(item && typeof item.message === 'string' && typeof item.title === 'string' && typeof item.at === 'number'),
      )
      .slice(0, MAX_LOGS);
  } catch {
    return [];
  }
}

export function saveToastLogs(entries: ToastLogEntry[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_LOGS)));
  } catch {
    // A blocked localStorage must not break the workbench.
  }
}

export function appendToastLog(
  entries: ToastLogEntry[],
  entry: Omit<ToastLogEntry, 'id'> & { id?: number },
): ToastLogEntry[] {
  const next: ToastLogEntry = {
    id: entry.id ?? Date.now() + entries.length,
    at: entry.at,
    tone: entry.tone,
    title: entry.title,
    message: entry.message,
    reason: entry.reason,
  };
  return [next, ...entries].slice(0, MAX_LOGS);
}

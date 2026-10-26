import type { SchoolData } from './types';

export const IMPORT_COLLECTIONS = [
  ['classes', '班级'], ['teachers', '教师'], ['subjects', '学科'], ['rooms', '教室'],
  ['timeSlots', '时间段'], ['coursePlans', '教学计划'], ['rules', '排课规则'],
  ['unavailableSlots', '教师不可用时间'], ['adjustments', '调代课记录'], ['lessonLogs', '授课记录'],
] as const;

function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.entries(value).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + stable(v)).join(',') + '}';
  }
  return JSON.stringify(value) ?? '';
}

export function importChanges(before: SchoolData, after: SchoolData) {
  return IMPORT_COLLECTIONS.map(([key, label]) => {
    const prev = before[key] ?? [];
    const next = after[key] ?? [];
    const id = (row: unknown) => {
      const r = row as { id?: string; teacherId?: string; slotId?: string };
      return r.id ?? JSON.stringify([r.teacherId, r.slotId]);
    };
    const oldRows = new Map(prev.map(row => [id(row), stable(row)]));
    const nextRows = new Map(next.map(row => [id(row), stable(row)]));
    return {
      key, label, before: prev.length, after: next.length,
      added: [...nextRows.keys()].filter(k => !oldRows.has(k)).length,
      changed: [...nextRows.keys()].filter(k => oldRows.has(k) && oldRows.get(k) !== nextRows.get(k)).length,
      removed: [...oldRows.keys()].filter(k => !nextRows.has(k)).length,
      unchanged: [...nextRows.keys()].filter(k => oldRows.get(k) === nextRows.get(k)).length,
    };
  });
}

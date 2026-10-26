import type { ScheduleEntry, SchoolData, SolverOutput } from './types';
import { findClass, findRoom, findSubject, findTeacher, planOf } from './selectors.ts';

export type TimetableDiffKind = 'added' | 'removed' | 'changed';

export interface TimetableDiffItem {
  id: string;
  kind: TimetableDiffKind;
  label: string;
  detail: string;
}

export interface TimetableDiffSummary {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  items: TimetableDiffItem[];
}

function entryLabel(data: SchoolData, entry: ScheduleEntry): string {
  const plan = planOf(data, entry);
  const subject = findSubject(data, plan?.subjectId ?? '')?.name ?? '课程';
  const klass = findClass(data, entry.classId)?.name ?? entry.classId;
  const teacher = findTeacher(data, entry.teacherId)?.name ?? entry.teacherId;
  return `${klass} · ${subject} · ${teacher}`;
}

function positionLabel(data: SchoolData, entry: ScheduleEntry | undefined): string {
  if (!entry) return '未排';
  const slot = data.timeSlots.find((item) => item.id === entry.slotId);
  const time = slot ? `周${slot.day}第${slot.period}节` : entry.slotId;
  const room = findRoom(data, entry.roomId)?.name ?? entry.roomId;
  return `${time} · ${room}`;
}

function changedFields(data: SchoolData, before: ScheduleEntry, after: ScheduleEntry): string[] {
  const fields: string[] = [];
  if (before.slotId !== after.slotId) fields.push(`时间 ${positionLabel(data, before)} → ${positionLabel(data, after)}`);
  if (before.teacherId !== after.teacherId) {
    fields.push(`教师 ${findTeacher(data, before.teacherId)?.name ?? before.teacherId} → ${findTeacher(data, after.teacherId)?.name ?? after.teacherId}`);
  }
  if (before.roomId !== after.roomId) {
    fields.push(`教室 ${findRoom(data, before.roomId)?.name ?? before.roomId} → ${findRoom(data, after.roomId)?.name ?? after.roomId}`);
  }
  if (before.locked !== after.locked) fields.push(after.locked ? '已锁定' : '已解锁');
  if (before.source !== after.source) fields.push(after.source === 'MANUAL' ? '改为手动调整' : '改为自动排课');
  return fields;
}

export function diffTimetables(data: SchoolData, before: SolverOutput, after: SolverOutput): TimetableDiffSummary {
  const beforeById = new Map(before.entries.map((entry) => [entry.id, entry]));
  const afterById = new Map(after.entries.map((entry) => [entry.id, entry]));
  const items: TimetableDiffItem[] = [];
  let unchanged = 0;

  for (const entry of after.entries) {
    const previous = beforeById.get(entry.id);
    if (!previous) {
      items.push({ id: entry.id, kind: 'added', label: entryLabel(data, entry), detail: `新增：${positionLabel(data, entry)}` });
      continue;
    }
    const fields = changedFields(data, previous, entry);
    if (fields.length === 0) {
      unchanged += 1;
      continue;
    }
    items.push({ id: entry.id, kind: 'changed', label: entryLabel(data, entry), detail: fields.join('；') });
  }

  for (const entry of before.entries) {
    if (!afterById.has(entry.id)) {
      items.push({ id: entry.id, kind: 'removed', label: entryLabel(data, entry), detail: `移除：${positionLabel(data, entry)}` });
    }
  }

  return {
    added: items.filter((item) => item.kind === 'added').length,
    removed: items.filter((item) => item.kind === 'removed').length,
    changed: items.filter((item) => item.kind === 'changed').length,
    unchanged,
    items,
  };
}

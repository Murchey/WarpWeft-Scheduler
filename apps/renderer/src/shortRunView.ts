import type { SchoolData } from './types';
import type { ShortRunRecord } from './runConfig';
import { findClass, findRoom, findTeacher, planOf, planSubjectName } from './selectors.ts';

export interface ShortRunEntryRow {
  id: string;
  day: number;
  period: number;
  time: string;
  className: string;
  subject: string;
  teacher: string;
  room: string;
  weeks: string;
}

const WEEK_LABELS: Record<string, string> = {
  all: '每周',
  odd: '单周',
  even: '双周',
};

/**
 * Read-only view model for one short-run snapshot. Entries are ordered like a
 * timetable (day, period, class) instead of the solver's insertion order.
 */
export function shortRunEntryRows(data: SchoolData, run: ShortRunRecord): ShortRunEntryRow[] {
  const slots = new Map(data.timeSlots.map((slot) => [slot.id, slot]));
  const rows = run.result.entries.map((entry) => {
    const slot = slots.get(entry.slotId);
    const plan = planOf(data, entry);
    const weeks = entry.weeks ?? plan?.weeks ?? 'all';
    return {
      id: entry.id,
      day: slot?.day ?? Number.MAX_SAFE_INTEGER,
      period: slot?.period ?? Number.MAX_SAFE_INTEGER,
      time: slot?.label ?? entry.slotId,
      className: findClass(data, entry.classId)?.name ?? entry.classId,
      subject: plan ? planSubjectName(data, plan) : '未知课程',
      teacher: findTeacher(data, entry.teacherId)?.name ?? (entry.teacherId || '未指定'),
      room: findRoom(data, entry.roomId)?.name ?? (entry.roomId || '未指定'),
      weeks: WEEK_LABELS[weeks] ?? weeks,
    };
  });
  return rows.sort(
    (a, b) =>
      a.day - b.day ||
      a.period - b.period ||
      a.className.localeCompare(b.className, 'zh-Hans-CN') ||
      a.subject.localeCompare(b.subject, 'zh-Hans-CN'),
  );
}

/**
 * Count entries that point at data removed since the snapshot was taken. The
 * detail dialog uses that to warn that some labels may be raw IDs.
 */
export function shortRunMissingRefs(data: SchoolData, run: ShortRunRecord): number {
  const planIds = new Set(data.coursePlans.map((item) => item.id));
  const classIds = new Set(data.classes.map((item) => item.id));
  const teacherIds = new Set(data.teachers.map((item) => item.id));
  const roomIds = new Set(data.rooms.map((item) => item.id));
  const slotIds = new Set(data.timeSlots.map((item) => item.id));
  return run.result.entries.filter(
    (entry) =>
      !planIds.has(entry.coursePlanId) ||
      !classIds.has(entry.classId) ||
      (Boolean(entry.teacherId) && !teacherIds.has(entry.teacherId)) ||
      (Boolean(entry.roomId) && !roomIds.has(entry.roomId)) ||
      !slotIds.has(entry.slotId),
  ).length;
}

import type { SchoolData, SolverOutput } from './types';
import { findClass, findRoom, findSubject, findTeacher, planOf } from './selectors.ts';

export type TemplateLayout = 'vertical' | 'horizontal';

export interface TimetableExportSettings {
  /** Which approved workbook template to fill. */
  layout: TemplateLayout;
  classId: string;
  schoolName: string;
  title: string;
  weeks: 'all' | 'odd' | 'even';
  showTeacher: boolean;
  showRoom: boolean;
  showWeeks: boolean;
  /** Concrete school week; when set it overrides the odd/even filter. */
  weekNo?: number | null;
}

export interface TimetableGrid {
  rows: (string | number)[][];
  merges: { s: { r: number; c: number }; e: { r: number; c: number } }[];
  widths: number[];
  days: number[];
  periods: number[];
}

const DAYS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const WEEK_LABEL: Record<string, string> = { all: '每周', odd: '单周', even: '双周' };

function entryWeeks(entry: SolverOutput['entries'][number], data: SchoolData): 'all' | 'odd' | 'even' {
  return (entry.weeks ?? planOf(data, entry)?.weeks ?? 'all') as 'all' | 'odd' | 'even';
}

function weekMatches(value: 'all' | 'odd' | 'even', filter: 'all' | 'odd' | 'even'): boolean {
  return filter === 'all' || value === 'all' || value === filter;
}

export function buildTimetableGrid(data: SchoolData, result: SolverOutput, settings: TimetableExportSettings): TimetableGrid {
  const klass = findClass(data, settings.classId);
  const groupClassIds = new Set((data.electiveGroups ?? []).filter((group) => group.classIds.includes(settings.classId)).map((group) => group.id));
  const effectiveWeeks = settings.weekNo ? (settings.weekNo % 2 === 1 ? 'odd' : 'even') : settings.weeks;
  const entries = result.entries.filter(
    (entry) =>
      (entry.classId === settings.classId || (entry.groupId !== undefined && groupClassIds.has(entry.groupId))) &&
      weekMatches(entryWeeks(entry, data), effectiveWeeks),
  );
  const days = Array.from(new Set(data.timeSlots.map((slot) => slot.day))).sort((a, b) => a - b);
  const periods = Array.from(new Set(data.timeSlots.map((slot) => slot.period))).sort((a, b) => a - b);
  const slotAt = (day: number, period: number) => data.timeSlots.find((slot) => slot.day === day && slot.period === period);

  const header = ['节次', ...days.map((day) => DAYS[day] ?? '第' + day + '天')];
  const rows: (string | number)[][] = [
    [settings.schoolName],
    [settings.title],
    [
      (klass?.name ?? settings.classId) +
        ' · ' +
        (settings.weekNo ? '第' + settings.weekNo + '周' : settings.weeks === 'all' ? '全周' : WEEK_LABEL[settings.weeks]) +
        ' · 导出 ' +
        new Date().toLocaleString('zh-CN'),
    ],
    [],
    header,
  ];

  for (const period of periods) {
    const row: (string | number)[] = ['第' + period + '节'];
    for (const day of days) {
      const slot = slotAt(day, period);
      if (!slot) {
        row.push('');
        continue;
      }
      const cell = entries.filter((entry) => entry.slotId === slot.id);
      if (cell.length === 0) {
        row.push('');
        continue;
      }
      const lines: string[] = [];
      const seenGroups = new Set<string>();
      for (const entry of cell) {
        const plan = planOf(data, entry);
        const group = entry.groupId ? (data.electiveGroups ?? []).find((item) => item.id === entry.groupId) : undefined;
        const subject = findSubject(data, group?.subjectId ?? plan?.subjectId ?? '')?.name ?? '课程';
        if (group) {
          if (seenGroups.has(group.id)) continue;
          seenGroups.add(group.id);
          lines.push(subject + '·走班');
          continue;
        }
        const parts = [subject];
        if (settings.showTeacher) parts.push(findTeacher(data, entry.teacherId)?.name ?? '');
        if (settings.showRoom) parts.push(findRoom(data, entry.roomId)?.name ?? '');
        if (settings.showWeeks && entryWeeks(entry, data) !== 'all') parts.push(WEEK_LABEL[entryWeeks(entry, data)]);
        lines.push(parts.filter(Boolean).join(' / '));
      }
      row.push(lines.join('\n'));
    }
    rows.push(row);
  }

  const merges = [0, 1, 2].map((r) => ({ s: { r, c: 0 }, e: { r, c: Math.max(1, header.length - 1) } }));
  const widths = [12, ...days.map(() => 26)];
  return { rows, merges, widths, days, periods };
}

export function timetableFileName(data: SchoolData, settings: TimetableExportSettings): string {
  const klass = findClass(data, settings.classId)?.name ?? settings.classId;
  const stamp = new Date().toISOString().slice(0, 10);
  return [settings.schoolName || data.school.name, klass, settings.title || '课表', settings.weekNo ? '第' + settings.weekNo + '周' : '', stamp]
    .join('-')
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 120) + '.xlsx';
}











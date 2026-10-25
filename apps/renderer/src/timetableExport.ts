import type { ScheduleEntry, SchoolData, SolverOutput } from './types';
import { findClass, findRoom, findSubject, findTeacher, planOf } from './selectors.ts';

export type TemplateLayout = 'vertical' | 'horizontal';
export type ExportView = 'class' | 'teacher' | 'room';

export interface TimetableExportSettings {
  /** Which approved workbook template to fill. */
  layout: TemplateLayout;
  /** Class / teacher / room timetable. */
  view: ExportView;
  entityId: string;
  schoolName: string;
  title: string;
  weeks: 'all' | 'odd' | 'even';
  showTeacher: boolean;
  showRoom: boolean;
  showWeeks: boolean;
  /** Concrete school week; when set it overrides the odd/even filter. */
  weekNo?: number | null;
  /** one week, or all distinct weeks of the semester. */
  scope?: 'single' | 'semester';
}


export type BatchTimetableOutput = 'workbook' | 'files';

export interface BatchTimetableSelection {
  classes: boolean;
  teachers: boolean;
  /** One workbook with many sheets (default), or one workbook per timetable. */
  output?: BatchTimetableOutput;
}

function batchScopeLabel(selection: BatchTimetableSelection): string {
  if (selection.classes && selection.teachers) return '班级+教师';
  return selection.classes ? '班级课表' : '教师课表';
}

function batchWeekLabel(settings: Pick<TimetableExportSettings, 'weeks' | 'weekNo'>): string {
  if (settings.weekNo) return '第' + settings.weekNo + '周';
  return settings.weeks === 'all' ? '' : settings.weeks === 'odd' ? '单周' : '双周';
}

function safeExportName(value: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 120)
    .replace(/[. ]+$/g, '');
  return cleaned || '课表';
}

/** File name for one workbook containing many class/teacher timetables. */
export function batchTimetableFileName(
  data: SchoolData,
  settings: Pick<TimetableExportSettings, 'schoolName' | 'weeks' | 'weekNo'>,
  selection: BatchTimetableSelection,
): string {
  const parts = [settings.schoolName || data.school.name, '批量课表', batchScopeLabel(selection)];
  const week = batchWeekLabel(settings);
  if (week) parts.push(week);
  parts.push(new Date().toISOString().slice(0, 10));
  return safeExportName(parts.join('-')) + '.xlsx';
}

/** Suggested folder when every timetable is written to its own workbook. */
export function batchTimetableFolderName(
  data: SchoolData,
  settings: Pick<TimetableExportSettings, 'schoolName' | 'weeks' | 'weekNo'>,
  selection: BatchTimetableSelection,
): string {
  const parts = [settings.schoolName || data.school.name, '批量课表', batchScopeLabel(selection)];
  const week = batchWeekLabel(settings);
  if (week) parts.push(week);
  parts.push(new Date().toISOString().slice(0, 10));
  return safeExportName(parts.join('-'));
}

/** File name for one timetable inside a multi-file export. */
export function batchTimetableEntryFileName(
  data: SchoolData,
  settings: Pick<TimetableExportSettings, 'schoolName' | 'view' | 'entityId' | 'weeks' | 'weekNo'>,
): string {
  const entity = exportEntityName(data, settings);
  const prefix = settings.view === 'teacher' ? '师-' : '班-';
  const parts = [settings.schoolName || data.school.name, prefix + entity];
  const week = batchWeekLabel(settings);
  if (week) parts.push(week);
  parts.push(new Date().toISOString().slice(0, 10));
  return safeExportName(parts.join('-')) + '.xlsx';
}

/** Make a download name unique on case-insensitive file systems. */
export function uniqueFileName(base: string, used: Set<string>): string {
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const extension = dot > 0 ? base.slice(dot) : '';
  let name = base;
  let suffix = 2;
  while (used.has(name) || used.has(name.toLowerCase())) {
    name = stem + '·' + suffix + extension;
    suffix += 1;
  }
  used.add(name);
  used.add(name.toLowerCase());
  return name;
}

export interface TimetableGrid {
  rows: (string | number)[][];
  merges: { s: { r: number; c: number }; e: { r: number; c: number } }[];
  widths: number[];
  days: number[];
  periods: number[];
}

export const VIEW_LABELS: Record<ExportView, string> = {
  class: '班级课表',
  teacher: '教师课表',
  room: '教室课表',
};

const DAYS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const WEEK_LABEL: Record<string, string> = { all: '每周', odd: '单周', even: '双周' };

function entryWeeks(entry: ScheduleEntry, data: SchoolData): 'all' | 'odd' | 'even' {
  return (entry.weeks ?? planOf(data, entry)?.weeks ?? 'all') as 'all' | 'odd' | 'even';
}

function weekMatches(value: 'all' | 'odd' | 'even', filter: 'all' | 'odd' | 'even'): boolean {
  return filter === 'all' || value === 'all' || value === filter;
}

export function exportEntityName(data: SchoolData, settings: Pick<TimetableExportSettings, 'view' | 'entityId'>): string {
  if (settings.view === 'teacher') return findTeacher(data, settings.entityId)?.name ?? settings.entityId;
  if (settings.view === 'room') return findRoom(data, settings.entityId)?.name ?? settings.entityId;
  return findClass(data, settings.entityId)?.name ?? settings.entityId;
}

export function entryMatchesView(
  data: SchoolData,
  entry: ScheduleEntry,
  settings: Pick<TimetableExportSettings, 'view' | 'entityId'>,
): boolean {
  if (settings.view === 'teacher') return entry.teacherId === settings.entityId;
  if (settings.view === 'room') return entry.roomId === settings.entityId;
  if (entry.classId === settings.entityId) return true;
  if (!entry.groupId) return false;
  return Boolean(
    (data.electiveGroups ?? []).some(
      (group) => group.id === entry.groupId && group.classIds.includes(settings.entityId),
    ),
  );
}

/** One lesson as displayed in the chosen view (no week suffix). */
export function entryCellText(
  data: SchoolData,
  entry: ScheduleEntry,
  settings: Pick<TimetableExportSettings, 'view' | 'showTeacher' | 'showRoom' | 'showWeeks'>,
): string {
  const plan = planOf(data, entry);
  const group = entry.groupId ? (data.electiveGroups ?? []).find((item) => item.id === entry.groupId) : undefined;
  const subject = findSubject(data, group?.subjectId ?? plan?.subjectId ?? '')?.name ?? '课程';
  if (group) return subject + '·走班';
  const klass = findClass(data, entry.classId)?.name ?? entry.classId;
  const teacher = findTeacher(data, entry.teacherId)?.name ?? entry.teacherId;
  const room = findRoom(data, entry.roomId)?.name ?? entry.roomId;
  const parts: string[] = [];
  if (settings.view === 'teacher') {
    parts.push(klass, subject);
    if (settings.showRoom) parts.push(room);
  } else if (settings.view === 'room') {
    parts.push(klass, subject);
    if (settings.showTeacher) parts.push(teacher);
  } else {
    parts.push(subject);
    if (settings.showTeacher) parts.push(teacher);
    if (settings.showRoom) parts.push(room);
  }
  if (settings.showWeeks && entryWeeks(entry, data) !== 'all') parts.push(WEEK_LABEL[entryWeeks(entry, data)]);
  return parts.filter(Boolean).join(' / ');
}

export function buildTimetableGrid(data: SchoolData, result: SolverOutput, settings: TimetableExportSettings): TimetableGrid {
  const entityName = exportEntityName(data, settings);
  const effectiveWeeks = settings.weekNo ? (settings.weekNo % 2 === 1 ? 'odd' : 'even') : settings.weeks;
  const entries = result.entries.filter(
    (entry) => entryMatchesView(data, entry, settings) && weekMatches(entryWeeks(entry, data), effectiveWeeks),
  );
  const days = Array.from(new Set(data.timeSlots.map((slot) => slot.day))).sort((a, b) => a - b);
  const periods = Array.from(new Set(data.timeSlots.map((slot) => slot.period))).sort((a, b) => a - b);
  const slotAt = (day: number, period: number) => data.timeSlots.find((slot) => slot.day === day && slot.period === period);

  const header = ['节次', ...days.map((day) => DAYS[day] ?? '第' + day + '天')];
  const rows: (string | number)[][] = [
    [settings.schoolName],
    [settings.title],
    [
      entityName +
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
        if (entry.groupId) {
          if (seenGroups.has(entry.groupId)) continue;
          seenGroups.add(entry.groupId);
        }
        lines.push(entryCellText(data, entry, settings));
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
  const entityName = exportEntityName(data, settings);
  const stamp = new Date().toISOString().slice(0, 10);
  return [settings.schoolName || data.school.name, entityName, settings.title || '课表', settings.scope === 'semester' ? '整学期' : '', settings.weekNo ? '第' + settings.weekNo + '周' : '', stamp]
    .join('-')
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 120) + '.xlsx';
}

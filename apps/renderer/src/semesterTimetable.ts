import { effectiveEntries } from '../../../packages/adjustments/src.ts';
import { semesterWeeks } from '../../../packages/semester/src.ts';
import type { Adjustment, SchoolData, ScheduleEntry, SolverOutput } from './types';
import { entryMatchesView } from './timetableExport.ts';
import type { TimetableExportSettings } from './timetableExport';

export interface WeekPattern {
  label: string;
  weeks: number[];
  entries: ScheduleEntry[];
}

function addDays(date: string, days: number): string {
  const base = new Date(date + 'T00:00:00Z');
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  return ((new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1;
}

/** Effective week timetable for one school week, with date adjustments applied. */
export function adjustedWeekEntries(
  data: SchoolData,
  result: SolverOutput,
  adjustments: Adjustment[],
  weekStart: string,
): ScheduleEntry[] {
  const merged = new Map<string, ScheduleEntry>();
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(weekStart, offset);
    const weekday = weekdayOf(date);
    const entries = effectiveEntries({ ...data, entries: result.entries as never }, date, adjustments) as unknown as ScheduleEntry[];
    for (const entry of entries) {
      const slot = data.timeSlots.find((item) => item.id === entry.slotId);
      if (!slot || slot.day !== weekday) continue;
      merged.set(entry.slotId + '|' + entry.classId + '|' + (entry.groupId ?? ''), entry);
    }
  }
  return Array.from(merged.values());
}

function signatureOf(entries: ScheduleEntry[], settings: TimetableExportSettings, data: SchoolData): string {
  return entries
    .filter((entry) => entryMatchesView(data, entry, settings))
    .map((entry) => [entry.slotId, entry.classId, entry.teacherId, entry.roomId, entry.groupId ?? '', entry.blockId ?? '', entry.coursePlanId].join('~'))
    .sort()
    .join('|');
}

function labelForWeeks(weeks: number[]): string {
  if (weeks.length === 1) return '第' + weeks[0] + '周';
  const odd = weeks.every((week) => week % 2 === 1);
  const even = weeks.every((week) => week % 2 === 0);
  if (odd) return '单周（共' + weeks.length + '周）';
  if (even) return '双周（共' + weeks.length + '周）';
  const ranges: string[] = [];
  let start = weeks[0];
  let end = weeks[0];
  for (let index = 1; index < weeks.length; index += 1) {
    if (weeks[index] === end + 1) {
      end = weeks[index];
      continue;
    }
    ranges.push(start === end ? String(start) : start + '-' + end);
    start = weeks[index];
    end = weeks[index];
  }
  ranges.push(start === end ? String(start) : start + '-' + end);
  return '第' + ranges.join('、') + '周';
}

/**
 * Split a semester into week patterns. Weeks whose effective timetable is
 * identical share one exported sheet; differing weeks get their own label.
 */
export function semesterPatterns(
  data: SchoolData,
  result: SolverOutput,
  adjustments: Adjustment[],
  settings: TimetableExportSettings,
): WeekPattern[] {
  const groups = new Map<string, WeekPattern>();
  for (const week of semesterWeeks(data.semester)) {
    const entries = adjustedWeekEntries(data, result, adjustments, week.startDate);
    const signature = signatureOf(entries, settings, data);
    const existing = groups.get(signature);
    if (existing) {
      existing.weeks.push(week.index);
    } else {
      groups.set(signature, { label: '', weeks: [week.index], entries });
    }
  }
  const patterns = Array.from(groups.values());
  for (const pattern of patterns) pattern.label = labelForWeeks(pattern.weeks);
  return patterns;
}



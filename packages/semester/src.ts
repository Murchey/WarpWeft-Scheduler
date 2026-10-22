export interface Semester {
  startDate: string;
  endDate: string;
}

export type WeekParity = 'odd' | 'even';

export interface SemesterWeek {
  /** 1-based school week number. */
  index: number;
  /** First day of this week (YYYY-MM-DD). */
  startDate: string;
  /** Last day of this week (YYYY-MM-DD); clipped to the semester end. */
  endDate: string;
  parity: WeekParity;
  label: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

export function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}


/**
 * Accept the date shapes Excel and users actually produce: 2026-09-01,
 * 2026/9/1, 2026.9.1, 2026年9月1日, optional time suffix, Date objects and
 * Excel serial numbers. Returns a padded YYYY-MM-DD or null.
 */
export function parseDateInput(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return parseIsoDate(year + '-' + month + '-' + day) ? year + '-' + month + '-' + day : null;
  }
  const raw = value === null || value === undefined ? '' : String(value).trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:$|[T\s])/);
  if (match) {
    const candidate = match[1] + '-' + match[2].padStart(2, '0') + '-' + match[3].padStart(2, '0');
    return parseIsoDate(candidate) ? candidate : null;
  }
  const serial = Number(raw);
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    return formatIsoDate(new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * DAY_MS));
  }
  return null;
}
export function isValidSemester(value: Semester | null | undefined): boolean {
  if (!value) return false;
  const start = parseIsoDate(value.startDate);
  const end = parseIsoDate(value.endDate);
  if (!start || !end) return false;
  return start.getTime() <= end.getTime();
}

export function parityOfWeek(index: number): WeekParity {
  return index % 2 === 1 ? 'odd' : 'even';
}

/**
 * Split a semester into 7-day school weeks. Week 1 starts on `startDate`;
 * the last week is clipped to `endDate` (inclusive). A Monday start therefore
 * yields Monday–Sunday weeks; other start days are still 7-day blocks.
 */
export function semesterWeeks(semester: Semester | null | undefined): SemesterWeek[] {
  if (!isValidSemester(semester)) return [];
  const start = parseIsoDate(semester!.startDate)!;
  const end = parseIsoDate(semester!.endDate)!;
  const total = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
  const count = Math.ceil(total / 7);
  const weeks: SemesterWeek[] = [];
  for (let index = 1; index <= count; index += 1) {
    const weekStart = new Date(start.getTime() + (index - 1) * 7 * DAY_MS);
    const weekEnd = new Date(Math.min(end.getTime(), weekStart.getTime() + 6 * DAY_MS));
    const parity = parityOfWeek(index);
    weeks.push({
      index,
      startDate: formatIsoDate(weekStart),
      endDate: formatIsoDate(weekEnd),
      parity,
      label: '第' + index + '周（' + formatIsoDate(weekStart).slice(5) + ' ~ ' + formatIsoDate(weekEnd).slice(5) + '）',
    });
  }
  return weeks;
}

export function semesterWeekCount(semester: Semester | null | undefined): number {
  return semesterWeeks(semester).length;
}

/** Which school week does `date` fall into? Returns null outside the semester. */
export function weekOfDate(semester: Semester | null | undefined, date: string): number | null {
  if (!isValidSemester(semester)) return null;
  const start = parseIsoDate(semester!.startDate)!;
  const target = parseIsoDate(date);
  if (!target) return null;
  const diff = Math.floor((target.getTime() - start.getTime()) / DAY_MS);
  if (diff < 0) return null;
  const days = Math.floor((parseIsoDate(semester!.endDate)!.getTime() - start.getTime()) / DAY_MS);
  if (diff > days) return null;
  return Math.floor(diff / 7) + 1;
}

export function weekByIndex(semester: Semester | null | undefined, index: number): SemesterWeek | null {
  return semesterWeeks(semester).find((week) => week.index === index) ?? null;
}


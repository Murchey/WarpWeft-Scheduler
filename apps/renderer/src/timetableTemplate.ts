import type { ScheduleEntry, SchoolData, SolverOutput } from './types';
import type { TimetableExportSettings } from './timetableExport';
import { findClass, findRoom, findSubject, findTeacher, planOf } from './selectors.ts';
import { semesterWeeks } from '../../../packages/semester/src.ts';

export type TemplateLayout = 'vertical' | 'horizontal';

export interface PageSetupSummary {
  orientation: string;
  fitToPage: boolean;
  fitToWidth: number;
  fitToHeight: number;
  horizontalCentered: boolean;
  paperSize: number;
}

export interface FilledTemplate {
  buffer: Uint8Array;
  pageSetup: PageSetupSummary;
}

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const WEEK_LABEL: Record<string, string> = { all: '全周', odd: '单周', even: '双周' };
const TEMPLATE_FIRST_DATA_ROW = 5;
const TEMPLATE_PERIOD_ROWS = 3;

function entryWeeks(entry: ScheduleEntry, data: SchoolData): 'all' | 'odd' | 'even' {
  return (entry.weeks ?? planOf(data, entry)?.weeks ?? 'all') as 'all' | 'odd' | 'even';
}

function entryText(data: SchoolData, entry: ScheduleEntry, settings: TimetableExportSettings): string {
  const plan = planOf(data, entry);
  const group = entry.groupId ? (data.electiveGroups ?? []).find((item) => item.id === entry.groupId) : undefined;
  const parts = [findSubject(data, group?.subjectId ?? plan?.subjectId ?? '')?.name ?? '课程'];
  if (settings.showTeacher) parts.push(findTeacher(data, entry.teacherId)?.name ?? '');
  if (settings.showRoom) parts.push(findRoom(data, entry.roomId)?.name ?? '');
  if (settings.showWeeks && entryWeeks(entry, data) !== 'all') parts.push(WEEK_LABEL[entryWeeks(entry, data)]);
  return parts.filter(Boolean).join(' / ');
}

/**
 * Fill one of the two approved timetable templates, preserving its fonts,
 * borders, merged title rows and page layout. The template's "fit to width"
 * settings are read first and re-applied explicitly.
 */
export async function fillTimetableTemplate(
  templateBuffer: ArrayBuffer | Uint8Array,
  data: SchoolData,
  result: SolverOutput,
  settings: TimetableExportSettings,
): Promise<FilledTemplate> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(templateBuffer as ArrayBuffer);
  for (const sheet of [...workbook.worksheets]) {
    if (sheet.name !== '班级课表') workbook.removeWorksheet(sheet.id);
  }
  const sheet = workbook.getWorksheet('班级课表') ?? workbook.worksheets[0];
  if (!sheet) throw new Error('课表模板缺少工作表');

  const setup = sheet.pageSetup;
  const pageSetup: PageSetupSummary = {
    orientation: String(setup.orientation ?? 'portrait'),
    fitToPage: setup.fitToPage !== false,
    fitToWidth: Number(setup.fitToWidth ?? 1) || 1,
    fitToHeight: Number(setup.fitToHeight ?? 0),
    horizontalCentered: Boolean(setup.horizontalCentered),
    paperSize: Number(setup.paperSize ?? 9),
  };
  sheet.pageSetup.fitToPage = true;
  sheet.pageSetup.fitToWidth = pageSetup.fitToWidth;
  sheet.pageSetup.fitToHeight = pageSetup.fitToHeight;
  if (setup.horizontalCentered !== undefined) sheet.pageSetup.horizontalCentered = pageSetup.horizontalCentered;

  const periods = Array.from(new Set(data.timeSlots.map((slot) => slot.period))).sort((a, b) => a - b);
  const count = Math.max(periods.length, 1);
  if (count < TEMPLATE_PERIOD_ROWS) {
    sheet.spliceRows(TEMPLATE_FIRST_DATA_ROW + count, TEMPLATE_PERIOD_ROWS - count);
  } else if (count > TEMPLATE_PERIOD_ROWS) {
    const model = sheet.getRow(TEMPLATE_FIRST_DATA_ROW + TEMPLATE_PERIOD_ROWS - 1);
    for (let index = TEMPLATE_PERIOD_ROWS; index < count; index += 1) {
      const row = sheet.insertRow(TEMPLATE_FIRST_DATA_ROW + index, []);
      row.height = model.height ?? 63;
      for (let column = 1; column <= 8; column += 1) {
        const from = model.getCell(column);
        const to = row.getCell(column);
        to.style = from.style;
        to.alignment = { ...from.alignment };
      }
    }
  }

  const semester = data.semester;
  const week = settings.weekNo ? semesterWeeks(semester).find((item) => item.index === settings.weekNo) : null;
  const klass = findClass(data, settings.classId);
  const weekText = week
    ? ' · 第' + week.index + '周（' + week.startDate.slice(5) + '~' + week.endDate.slice(5) + '，' + (week.parity === 'odd' ? '单周' : '双周') + '）'
    : settings.weeks !== 'all'
      ? ' · ' + WEEK_LABEL[settings.weeks]
      : '';
  sheet.getCell('A1').value = settings.schoolName || data.school.name;
  sheet.getCell('A2').value = (settings.title || '班级课表') + weekText;
  sheet.getCell('A3').value = (klass?.name ?? settings.classId) + weekText;
  for (const id of ['A1', 'A2', 'A3']) {
    sheet.getCell(id).alignment = { ...sheet.getCell(id).alignment, shrinkToFit: true };
  }

  for (let day = 1; day <= 7; day += 1) {
    sheet.getCell(4, day + 1).value = DAYS[day - 1];
  }

  const effectiveWeeks = settings.weekNo ? (settings.weekNo % 2 === 1 ? 'odd' : 'even') : settings.weeks;
  const groupClassIds = new Set(
    (data.electiveGroups ?? [])
      .filter((group) => group.classIds.includes(settings.classId))
      .map((group) => group.id),
  );
  const entries = result.entries.filter((entry) => {
    const belongs = entry.classId === settings.classId || (entry.groupId !== undefined && groupClassIds.has(entry.groupId));
    if (!belongs) return false;
    const weeks = entryWeeks(entry, data);
    return effectiveWeeks === 'all' || weeks === 'all' || weeks === effectiveWeeks;
  });

  for (let index = 0; index < count; index += 1) {
    const period = periods[index] ?? index + 1;
    const row = sheet.getRow(TEMPLATE_FIRST_DATA_ROW + index);
    row.getCell(1).value = '第' + period + '节';
    for (let day = 1; day <= 7; day += 1) {
      const slot = data.timeSlots.find((item) => item.day === day && item.period === period);
      const cell = row.getCell(day + 1);
      if (!slot) {
        cell.value = '';
        continue;
      }
      const cellEntries = entries.filter((entry) => entry.slotId === slot.id);
      const seenGroups = new Set<string>();
      const lines: string[] = [];
      for (const entry of cellEntries) {
        if (entry.groupId) {
          if (seenGroups.has(entry.groupId)) continue;
          seenGroups.add(entry.groupId);
          const group = (data.electiveGroups ?? []).find((item) => item.id === entry.groupId);
          const subject = findSubject(data, group?.subjectId ?? '')?.name ?? '课程';
          lines.push(subject + '·走班');
          continue;
        }
        lines.push(entryText(data, entry, settings));
      }
      cell.value = lines.join('\n');
      cell.alignment = { ...cell.alignment, wrapText: true, vertical: 'middle' };
    }
  }

  const output = await workbook.xlsx.writeBuffer();
  const buffer = output instanceof Uint8Array ? output : new Uint8Array(output as ArrayBuffer);
  return { buffer, pageSetup };
}






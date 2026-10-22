import type { ScheduleEntry, SchoolData, SolverOutput } from './types';
import type { TimetableExportSettings } from './timetableExport';
import { entryCellText, entryMatchesView, exportEntityName } from './timetableExport.ts';
import { planOf } from './selectors.ts';
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
  const entityName = exportEntityName(data, settings);
  const weekText = week
    ? ' · 第' + week.index + '周（' + week.startDate.slice(5) + '~' + week.endDate.slice(5) + '，' + (week.parity === 'odd' ? '单周' : '双周') + '）'
    : settings.weeks !== 'all'
      ? ' · ' + WEEK_LABEL[settings.weeks]
      : '';
  sheet.getCell('A1').value = settings.schoolName || data.school.name;
  sheet.getCell('A2').value = (settings.title || '班级课表') + weekText;
  sheet.getCell('A3').value = entityName + weekText;
  for (const id of ['A1', 'A2', 'A3']) {
    sheet.getCell(id).alignment = { ...sheet.getCell(id).alignment, shrinkToFit: true };
  }

  for (let day = 1; day <= 7; day += 1) {
    sheet.getCell(4, day + 1).value = DAYS[day - 1];
  }

  const effectiveWeeks = settings.weekNo ? (settings.weekNo % 2 === 1 ? 'odd' : 'even') : settings.weeks;
  const entries = result.entries.filter((entry) => {
    if (!entryMatchesView(data, entry, settings)) return false;
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
        }
        lines.push(entryCellText(data, entry, settings));
      }
      cell.value = lines.join('\n');
      cell.alignment = { ...cell.alignment, wrapText: true, vertical: 'middle' };
    }
  }

  const output = await workbook.xlsx.writeBuffer();
  const buffer = output instanceof Uint8Array ? output : new Uint8Array(output as ArrayBuffer);
  return { buffer, pageSetup };
}

export interface WeekPatternInput {
  label: string;
  weeks: number[];
  entries: ScheduleEntry[];
}

export interface FilledSemester {
  buffer: Uint8Array;
  pageSetup: PageSetupSummary;
  sheets: { name: string; weeks: number[] }[];
}

function copySheet(source: import('exceljs').Worksheet, target: import('exceljs').Worksheet): void {
  const pageSetup = source.pageSetup;
  target.pageSetup = { ...pageSetup };
  for (let column = 1; column <= 8; column += 1) {
    const width = source.getColumn(column).width;
    if (width) target.getColumn(column).width = width;
  }
  source.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const dest = target.getRow(rowNumber);
    dest.height = row.height;
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const copy = target.getCell(rowNumber, columnNumber);
      copy.value = cell.value;
      copy.style = cell.style;
    });
  });
  for (const range of source.model.merges ?? []) target.mergeCells(range);
}

/**
 * Export several distinct week patterns into one workbook. Weeks with identical
 * effective timetables share a sheet; the sheet name is the week label.
 */
export async function fillSemesterTemplate(
  templateBuffer: ArrayBuffer | Uint8Array,
  data: SchoolData,
  result: SolverOutput,
  settings: TimetableExportSettings,
  patterns: WeekPatternInput[],
): Promise<FilledSemester> {
  const ExcelJS = (await import('exceljs')).default;
  const output = new ExcelJS.Workbook();
  let pageSetup: PageSetupSummary | null = null;
  const sheets: { name: string; weeks: number[] }[] = [];
  for (const pattern of patterns) {
    const filled = await fillTimetableTemplate(
      templateBuffer,
      data,
      { ...result, entries: pattern.entries },
      { ...settings, weekNo: null, title: settings.title + ' · ' + pattern.label },
    );
    const temporary = new ExcelJS.Workbook();
    await temporary.xlsx.load(filled.buffer as never);
    const source = temporary.getWorksheet('班级课表') ?? temporary.worksheets[0];
    if (!source) continue;
    let name = pattern.label.slice(0, 28);
    let suffix = 2;
    while (output.getWorksheet(name)) {
      name = (pattern.label.slice(0, 26) + '·' + suffix).slice(0, 31);
      suffix += 1;
    }
    const target = output.addWorksheet(name);
    copySheet(source, target);
    pageSetup = pageSetup ?? filled.pageSetup;
    sheets.push({ name, weeks: pattern.weeks });
  }
  if (!pageSetup) throw new Error('没有可导出的周课表');
  const written = await output.xlsx.writeBuffer();
  const buffer = written instanceof Uint8Array ? written : new Uint8Array(written as ArrayBuffer);
  return { buffer, pageSetup, sheets };
}












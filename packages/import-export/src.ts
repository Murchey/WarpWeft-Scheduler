import * as XLSX from 'xlsx';

export interface ImportRow { sheet: string; row: number; values: Record<string, unknown>; }
export interface ImportIssue { sheet: string; row: number; field?: string; message: string; }

export interface WorkbookMeta {
  /** Required in the 时间段 sheet: maximum periods per school day. */
  maxPeriods?: number;
  /** Optional weekdays (1=Monday) from the 时间段 sheet. */
  weekdays?: number[];
}

export interface ReadWorkbookResult {
  rows: ImportRow[];
  meta: WorkbookMeta;
}

const DAY_INDEX: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7,
};

function cellText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

/** Headers may carry （选填）/（可选） markers; the importer still reads the base field. */
function normalizeHeader(value: unknown): string {
  return cellText(value).replace(/[（(][^）)]*(?:选填|可选)[^）)]*[）)]\s*$/, '').trim();
}

function parseWeekdays(value: string): number[] | undefined {
  const text = value.replace(/\s/g, '');
  if (!text) return undefined;
  const days = Array.from(text.matchAll(/周([一二三四五六日天])/g)).map((match) => DAY_INDEX[match[1]]);
  if (days.length >= 2 && /至|到|-|~/.test(text)) {
    const start = Math.min(...days);
    const end = Math.max(...days);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }
  if (days.length) return Array.from(new Set(days)).sort((a, b) => a - b);
  const numeric = text.match(/([1-7])\s*(?:至|到|-|~)\s*([1-7])/);
  if (numeric) {
    const start = Number(numeric[1]);
    const end = Number(numeric[2]);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }
  return undefined;
}

/**
 * Read every sheet into header-based rows. The 时间段 sheet may start with a
 * settings block (每天最多节数 / 上课星期) above its header row, so its header
 * row is detected instead of assuming row 1.
 */
export function readWorkbookWithMeta(buffer: ArrayBuffer): ReadWorkbookResult {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const rows: ImportRow[] = [];
  const meta: WorkbookMeta = {};
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: '' });
    let headerRow = 0;
    if (/时间段|时间|slot/i.test(sheetName)) {
      const found = aoa.findIndex((row) => row.some((cell) => cellText(cell) === '节次'));
      if (found > 0) {
        headerRow = found;
        for (let index = 0; index < found; index += 1) {
          const row = aoa[index];
          for (let column = 0; column < row.length; column += 1) {
            const label = cellText(row[column]);
            if (label === '每天最多节数') {
              const value = Number(row[column + 1]);
              if (Number.isInteger(value) && value > 0) meta.maxPeriods = value;
            }
            if (label === '上课星期') {
              const weekdays = parseWeekdays(cellText(row[column + 1]));
              if (weekdays?.length) meta.weekdays = weekdays;
            }
          }
        }
      }
    }
    const headers = (aoa[headerRow] ?? []).map((cell) => normalizeHeader(cell));
    if (!headers.some(Boolean)) continue;
    for (let index = headerRow + 1; index < aoa.length; index += 1) {
      const cells = aoa[index] ?? [];
      const values: Record<string, unknown> = {};
      let hasValue = false;
      headers.forEach((header, column) => {
        if (!header) return;
        const value = cells[column] ?? '';
        values[header] = value;
        if (cellText(value) !== '') hasValue = true;
      });
      if (!hasValue) continue;
      rows.push({ sheet: sheetName, row: index + 1, values });
    }
  }
  return { rows, meta };
}

export function readWorkbook(buffer: ArrayBuffer): ImportRow[] {
  return readWorkbookWithMeta(buffer).rows;
}


/**
 * Normalize a teacher's grade list. Semicolons may be Chinese, English or
 * mixed: 1;2;3 / 1；2；3 / 1;2；3 all become 1;2;3. Non-numeric legacy values
 * (for example 七年级) are preserved as-is.
 */
export function normalizeGradeList(value: unknown): string {
  const raw = cellText(value);
  if (!raw) return '';
  const parts = raw.split(/[;；]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length > 0 && parts.every((part) => /^\d+$/.test(part))) {
    const grades = Array.from(new Set(parts.map(Number))).sort((a, b) => a - b);
    return grades.join(';');
  }
  return raw;
}
export function validateRequired(rows: ImportRow[], fields: string[]): ImportIssue[] {
  const issues: ImportIssue[] = [];
  for (const row of rows) for (const field of fields) if (row.values[field] === undefined || row.values[field] === '') issues.push({ sheet: row.sheet, row: row.row, field, message: `缺少必填字段：${field}` });
  return issues;
}

export function exportCsv(rows: Record<string, unknown>[]): string {
  return XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(rows));
}

/**
 * XLSX.write with type 'array' returns an ArrayBuffer (not a typed array).
 * Declaring that honestly keeps callers from reading `.buffer` off it, which
 * silently produced a corrupt file (the literal text "undefined").
 */
export function exportWorkbook(sheets: Record<string, Record<string, unknown>[]>): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), name.slice(0, 31));
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
}

export interface AoaSheet {
  name: string;
  rows: (string | number)[][];
  merges?: { s: { r: number; c: number }; e: { r: number; c: number } }[];
  widths?: number[];
}

/** Grid-oriented workbook export (timetable layout, merged title rows). */
export function exportWorkbookAoa(sheets: AoaSheet[]): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
    if (sheet.merges?.length) worksheet['!merges'] = sheet.merges;
    if (sheet.widths?.length) worksheet['!cols'] = sheet.widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31));
  }
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
}

const INSTRUCTIONS: (string | number)[][] = [
  ['工作表', '填写位置', '是否必填', '填写说明', '示例'],
  ['总则', '—', '—', '每个工作表第 1 行是表头，一行填一条记录；不要修改、合并或移动表头。', ''],
  ['总则', '—', '—', '“填写位置”按 Excel 单元格写法：A2 表示第 2 行第 1 列，B2 表示第 2 行第 2 列。', ''],
  ['总则', '—', '—', '表头带“（选填）”的列可以整列留空；“教室”整张表也可以留空。', ''],
  ['总则', '—', '—', '名称必须与前面工作表中的写法完全一致（前后空格会被忽略）。', ''],
  ['', '', '', '', ''],
  ['学校', 'A2', '选填', '学校全称；留空则保留当前学校名称。', '实验中学'],
  ['学期', 'A2', '选填', '学期开始日期。可写 2026-09-01、2026/9/1 或 2026年9月1日，Excel 自动改格式也能识别。', '2026-09-01'],
  ['学期', 'B2', '选填', '学期结束日期，格式同上，不能早于开始日期。', '2026-12-31'],
  ['班级', 'A2', '必填', '班级名称，一行一个班。', '七年级1班'],
  ['班级', 'B2', '选填', '年级。', '七年级'],
  ['班级', 'C2', '选填', '班级人数；留空默认 40。', '40'],
  ['教师', 'A2', '必填', '教师姓名。', '王老师'],
  ['教师', 'B2', '选填', '负责年级。多个年级用分号分隔，如 1;2;3；中英文分号均可混用。', '1;2;3'],
  ['教师', 'C2', '选填', '主要学科。', '数学'],
  ['教师', 'D2', '选填', '其他学科，可写多个，用“、”分隔。', '物理、化学'],
  ['学科', 'A2', '至少一行', '只填第 1 列：本校实际开设的学科名称，不要加其他列。', '语文'],
  ['教室', 'A2', '整表选填', '教室名称，一行一间。', '一号教室'],
  ['教室', 'B2', '整表选填', '教室类型；留空按“普通教室”。', '普通教室'],
  ['教室', 'C2', '整表选填', '容量；留空取最大班级人数。', '45'],
  ['教室', '整表', '整表选填', '整张表留空时，系统按“每个班一间普通教室”自动生成。', ''],
  ['时间段', 'B1', '必填', '每天最多节数，例如 8。', '8'],
  ['时间段', 'B2', '选填', '上课星期；可写“周一至周五”或“1-5”，默认周一至周五。', '周一至周五'],
  ['时间段', 'A4', '表头', '第 4 行是表头：节次（必填）/ 开始时间（选填）/ 时长（选填）。', ''],
  ['时间段', 'A5', '至少一行', '从第 5 行开始写节次（1、2、3…）。', '1'],
  ['时间段', 'B5', '选填', '该节开始时间，格式 HH:MM。', '08:00'],
  ['时间段', 'C5', '选填', '该节时长（分钟）。', '45'],
  ['教学计划', '整表', '排课时必填', '只导入基础资料时可留空；但排课前至少要有一行，否则没有可排的课。', ''],
  ['教学计划', 'A2', '必填', '班级名称，须与“班级”工作表一致。', '七年级1班'],
  ['教学计划', 'B2', '必填', '学科名称，须与“学科”工作表一致。', '语文'],
  ['教学计划', 'C2', '必填', '教师姓名，须与“教师”工作表一致。', '李老师'],
  ['教学计划', 'D2', '必填', '每周课时数，正整数。', '5'],
  ['教学计划', 'E2', '选填', '每周 / 单周 / 双周；留空按每周。', '每周'],
  ['教学计划', 'F2', '选填', '课程类型：常规 / 早读 / 晚自习 / 补课。', '常规'],
  ['教学计划', 'G2', '选填', '教室类型，须与“教室”表一致；留空不限。', '普通教室'],
  ['教学计划', 'H2', '选填', '固定时间，如“周一 第1节”；留空由系统排。', ''],
  ['教学计划', '第2行', '示例', '完整示例按 A→H 顺序填写：', ''],
  ['教学计划示例', '', '', '七年级1班 / 语文 / 李老师 / 5 / 每周 / 常规 / 普通教室 / 空', ''],
  ['重复导入', '—', '—', '基础资料按名称复用已有记录；教学计划工作表会整体替换原计划。', ''],
  ['空行', '—', '—', '完全空白的行会被忽略。', ''],
];

export function buildImportTemplate(): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  const sheets: AoaSheet[] = [
    {
      name: '说明',
      rows: INSTRUCTIONS,
      widths: [12, 14, 20, 55, 30],
    },
    { name: '学校', rows: [['名称（选填）']], widths: [30] },
    { name: '学期', rows: [['开始日期（选填）', '结束日期（选填）']], widths: [20, 20] },
    { name: '班级', rows: [['名称', '年级（选填）', '人数（选填）']], widths: [24, 18, 18] },
    { name: '教师', rows: [['姓名', '负责年级（选填）', '主要学科（选填）', '其他学科（选填）']], widths: [16, 20, 20, 24] },
    { name: '学科', rows: [['学科']], widths: [24] },
    { name: '教室', rows: [['教室名称（选填）', '类型（选填）', '容量（选填）']], widths: [26, 20, 16] },
    {
      name: '时间段',
      rows: [
        ['每天最多节数', 8, '', ''],
        ['上课星期', '周一至周五', '', ''],
        ['', '', '', ''],
        ['节次', '开始时间（选填）', '时长（分钟，选填）'],
        ...Array.from({ length: 8 }, (_, index) => [index + 1, '', '']),
      ],
      widths: [14, 22, 20, 20],
    },
    {
      name: '教学计划',
      rows: [['班级', '学科', '教师', '每周课时', '周次（选填）', '课程类型（选填）', '教室类型（选填）', '固定时间（选填）']],
      widths: [22, 16, 16, 12, 14, 16, 18, 20],
    },
  ];
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
    if (sheet.widths?.length) worksheet['!cols'] = sheet.widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
  }
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
}



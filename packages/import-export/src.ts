import * as XLSX from 'xlsx';
import { IMPORTANCE_LABELS, RULE_DEFINITIONS } from '../constraints/src.ts';
import type { RuleInstance } from '../constraints/src.ts';
import {
  consecutiveOf,
  fixedSlotIdsOf,
  SUBJECT_PREFERENCE_LABELS,
} from '../contracts/src.ts';

export interface ImportRow { sheet: string; row: number; values: Record<string, unknown>; }
export interface ImportIssue { sheet: string; row: number; field?: string; message: string; }

export interface WorkbookMeta {
  /** Required in the 时间段 sheet: maximum periods per school day. */
  maxPeriods?: number;
  /** Optional weekdays (1=Monday) from the 时间段 sheet. */
  weekdays?: number[];
  /** Per-day period overrides from 单日节次设置; absent/empty means all periods. */
  dayPeriods?: Record<number, number[]>;
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
  return cellText(value)
    .replace(/\*+\s*$/, '')
    .replace(/[（(][^）)]*(?:选填|可选)[^）)]*[）)]\s*$/, '')
    .trim();
}

const EXAMPLE_ROWS: Record<string, Record<string, string | number>> = {
  学校: { 名称: '示例学校' },
  学期: { 开始日期: '2099-09-01', 结束日期: '2099-12-31' },
  班级: { 名称: '示例班级', 年级: '示例年级', 人数: 1, 班主任: '示例老师' },
  教师: {
    姓名: '示例老师',
    负责年级: '1',
    主要学科: '示例学科',
    其他学科: '示例学科2',
    负责班级: '示例班级',
  },
  学科: { 学科: '示例学科', 时间偏好: '上午' },
  教室: { 教室名称: '示例教室', 类型: '普通教室', 容量: 1 },
  时间段: { 节次: 1, 开始时间: '07:00', 时长: 1 },
  教学计划: {
    班级: '示例班级',
    学科: '示例学科',
    教师: '示例老师',
    每周课时: 1,
    周次: '每周',
    课程类型: '常规',
    教室类型: '普通教室',
    固定时间: '',
    连堂节数: '',
    配对组: '',
  },
  教师时间: { 教师: '示例老师', 星期: '周一', 节次: '1;2' },
  排课规则: {
    规则类型: '教师每日上限',
    作用对象类型: '教师',
    作用对象: '示例老师',
    适用时间: '全周',
    重要程度: '必须',
    参数: 'maxPerDay=1',
    备注: '示例行',
  },
};

function exampleForSheet(sheetName: string): Record<string, string | number> | undefined {
  // Exact names win: "教师时间" must not inherit the "教师" example row.
  const exact = Object.entries(EXAMPLE_ROWS).find(([name]) => sheetName === name);
  if (exact) return exact[1];
  return Object.entries(EXAMPLE_ROWS).find(([name]) => sheetName.includes(name))?.[1];
}

function isTemplateExampleRow(sheetName: string, values: Record<string, unknown>): boolean {
  const example = exampleForSheet(sheetName);
  if (!example) return false;
  // Old templates do not have the newest columns (e.g. 时间偏好). A field that
  // is not present in the header set must not stop the example row from being
  // recognised, otherwise "示例学科" would be imported as a real subject.
  return Object.entries(example).every(([field, value]) => !(field in values) || cellText(values[field]) === cellText(value));
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

function dayNumber(value: unknown): number | null {
  const text = cellText(value);
  const match = text.match(/^(?:周|星期)([一二三四五六日天])$/);
  if (match) return DAY_INDEX[match[1]];
  if (/^[1-7]$/.test(text)) return Number(text);
  return null;
}

function parsePeriodList(value: unknown): number[] {
  return Array.from(
    new Set(
      cellText(value)
        .split(/[;；,，、\s]+/)
        .map(Number)
        .filter((period) => Number.isInteger(period) && period > 0),
    ),
  ).sort((a, b) => a - b);
}
export function readWorkbookWithMeta(buffer: ArrayBuffer): ReadWorkbookResult {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const rows: ImportRow[] = [];
  const meta: WorkbookMeta = {};
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: '' });
    let headerRow = 0;
    if (/时间段|时间|slot/i.test(sheetName)) {
      const found = aoa.findIndex((row) => row.some((cell) => normalizeHeader(cell) === '节次'));
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
    const sectionRow = /时间段|时间|slot/i.test(sheetName)
      ? aoa.findIndex((row, index) => index > headerRow && row.some((cell) => cellText(cell).startsWith('单日节次设置')))
      : -1;
    const dataEnd = sectionRow > headerRow ? sectionRow : aoa.length;
    for (let index = headerRow + 1; index < dataEnd; index += 1) {
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
      if (isTemplateExampleRow(sheetName, values)) continue;
      rows.push({ sheet: sheetName, row: index + 1, values });
    }
    if (sectionRow > headerRow) {
      const dayHeaderIndex = aoa.findIndex((row, index) => index > sectionRow && row.some((cell) => dayNumber(cell) !== null));
      if (dayHeaderIndex >= 0) {
        const dayHeader = aoa[dayHeaderIndex] ?? [];
        const dayValues = aoa[dayHeaderIndex + 1] ?? [];
        dayHeader.forEach((cell, column) => {
          const day = dayNumber(cell);
          if (!day) return;
          const periods = parsePeriodList(dayValues[column]);
          if (periods.length) {
            if (!meta.dayPeriods) meta.dayPeriods = {};
            meta.dayPeriods[day] = periods;
          }
        });
      }
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

function buildInstructions(simplified: boolean): (string | number)[][] {
  const rows: (string | number)[][] = [
    ['导入模板使用说明', '', '', ''],
    ['三步走', '', '① 下载模板 → ② 填 3 张必填表（班级 / 学科 / 教学计划）→ ③ 导入', ''],
    ['填写规则', '', '第 1 行是表头，不要修改；第 2 行是灰色示例行，导入前请删除。时间段表没有示例行，直接在节次列填写。', ''],
    ['必填标记', '', '表头带 * 的列必须填写；带（选填）的列可以留空。名称须与前面工作表中的写法一致。', ''],
    ['填写顺序', '', '建议：学校 / 学期 → 班级 → 教师 → 学科 → 教室 → 时间段 → 教学计划 → 教师时间 → 排课规则。', ''],
    ['名称关联', '', '班级、学科、教师、教室、时间名称都是关联键；必须与对应工作表中的写法完全一致，前后空格也会导致找不到。', ''],
    ['只填必填', '', '只填三张必填表也能导入；教师留空表示未指定，简化模式下教室由系统按每班一间自动生成。', ''],
    ['导入结果', '', '基础资料按名称复用/更新；教学计划整表替换；任何一行校验失败，整次导入都不会写入。', ''],
    ['', '', '', ''],
    ['【快速上手】', '', '', ''],
    ['1', '先填班级', '一行一个班；名称建议用「七年级1班」这类全称，后面所有表都用同一个写法。', '七年级1班'],
    ['2', '再填学科', '一行一个学科；学科名称会作为教学计划的关联键。', '语文'],
    ['3', '最后填教学计划', '一行 = 一个班的一门课；同班多门课写多行，同学科多个班也每班一行。', '七年级1班 / 语文 / 王老师 / 5'],
    ['4', '教师、教室可后补', '教师表留空的教学计划会显示「未指定」；之后可在 UI 单个或批量补教师。', ''],
    ['5', '批量填写', '先在 Excel 里准备好班级和学科名称，再复制教学计划行；只要名称一致，导入会按名称自动关联。', ''],
    ['', '', '', ''],
  ];
  const section = (name: string, fields: [string, string, string, string][]) => {
    if (simplified && name === '教室') return;
    rows.push([`【${name}】`, '', '', '']);
    rows.push(['字段', '必填', '说明', '示例']);
    for (const field of fields) rows.push(field);
    rows.push(['', '', '', '']);
  };
  section('学校', [
    ['名称', '否', '学校全称；留空保留当前学校名称。', '实验中学'],
  ]);
  section('学期', [
    ['开始日期', '否', '学期开始日期，支持 2026-09-01 / 2026/9/1 / 2026年9月1日。', '2026-09-01'],
    ['结束日期', '否', '学期结束日期，不能早于开始日期。', '2026-12-31'],
  ]);
  section('班级', [
    ['名称', '是', '班级名称，一行一个班。', '七年级1班'],
    ['年级', '否', '年级名称或数字。', '七年级'],
    ['人数', '否', '正整数；留空默认 40。', '42'],
    ['班主任', '否', '教师姓名，须与「教师」表一致。', '王老师'],
  ]);
  section('教师', [
    ['姓名', '是', '教师姓名。', '王老师'],
    ['负责年级', '否', '多个年级用分号分隔，如 1;2;3。', '1;2;3'],
    ['主要学科', '否', '主要任教学科。', '数学'],
    ['其他学科', '否', '可写多个，用「、」分隔。', '物理、化学'],
    ['负责班级', '否', '多个班级用「、」分隔；留空表示不限。', '七年级1班、七年级2班'],
  ]);
  section('学科', [
    ['学科', '是', '本校实际开设的学科名称，一行一个；名称必须与教学计划完全一致。', '语文'],
    ['时间偏好', '否', '上午 / 下午 / 不限；留空表示不限。只有旧版没有此列的模板才会按学科名套用推荐值。', '上午'],
  ]);
  section('教室', [
    ['教室名称', '整表选填', '一行一间；整张表留空时按每班一间普通教室生成。', '一号教室'],
    ['类型', '否', '用于匹配教学计划的教室类型。', '普通教室'],
    ['容量', '否', '正整数；留空取最大班级人数。', '45'],
  ]);
  section('时间段', [
    ['每天最多节数', '是', '填写在时间段表顶部，例如 8。', '8'],
    ['上课星期', '否', '周一至周五，或 1-5。', '周一至周五'],
    ['节次', '是', '表头下方的数据列，从 1 开始。', '1'],
    ['开始时间', '否', 'HH:MM。', '08:00'],
    ['时长', '否', '分钟数；常规课通常 45。', '45'],
    ['单日节次设置', '否', '某天少排几节时填写，分号分隔。', '1;2;3;4'],
  ]);
  section('教学计划', [
    ['班级', '是', '须与「班级」表完全一致。', '七年级1班'],
    ['学科', '是', '须与「学科」表完全一致。', '语文'],
    ['教师', '否', '留空表示未定。', '王老师'],
    ['每周课时', '是', '正整数，一周上几节；同一班所有计划之和应接近可用时间格数。', '5'],
    ['周次', '否', '每周 / 单周 / 双周；留空按每周。', '每周'],
    ['课程类型', '否', '常规 / 早读 / 自习 / 课后服务 / 晚自习 / 补课；留空按常规。', '常规'],
    ...(simplified ? [] : [['教室类型', '否', '须与「教室」表类型一致；留空不限。', '普通教室']] as [string, string, string, string][]),
    ['固定时间', '否', '填写时段名称，多个用「；」分隔，按顺序固定第 1、2…次课；数量不能超过每周课时；配对组两侧必须完全一致。', '周一 第1节；周四 第6节'],
    ['连堂节数', '否', '2–4 表示连续几节一起排（连堂），不能超过每周课时；留空不连堂。', '2'],
    ['配对组', '否', '同一班单周/双周两条计划填完全相同的名称，会排在同一时间格；不同班必须用不同名称（如「语数间周-七1」），否则会被当成同一组。', '语数间周-七1'],
  ]);
  section('教师时间', [
    ['教师', '是', '教师姓名，须与「教师」表一致。', '王老师'],
    ['星期', '是', '周一至周日。', '周一'],
    ['节次', '是', '可写多个节次，用分号分隔，如 1;2;3。', '1;2'],
    ['说明', '—', '这里填「不可用时间」而不是可用时间；填写后会整体替换教师不可用时间，空表表示没有不可用时间。', ''],
  ]);
  section('排课规则', [
    ['规则类型', '是', '教师每日上限 / 教师连续上限 / 教师半天无课 / 学科每日上限 / 学科时间偏好 / 避开首末节 / 学科分散 / 连堂双节。', '教师每日上限'],
    ['作用对象类型', '是', '全校 / 年级 / 教师 / 班级 / 学科 / 教室。', '教师'],
    ['作用对象', '按类型', '填写对应的教师、班级、学科或教室名称；全校可留空。', '王老师'],
    ['适用时间', '否', '全周 / 周一至周五 / 第1-4节 / 周一至周五 第1-4节。', '周一至周五'],
    ['重要程度', '否', '必须 / 尽量 / 避免；留空用规则默认值。', '尽量'],
    ['参数', '否', 'key=value，多项用分号，如 maxPerDay=8。', 'maxPerDay=8'],
    ['备注', '否', '自由备注。', '下午教研'],
  ]);
  rows.push(['【规则参数示例】', '', '', '']);
  rows.push(['规则类型', '', '参数与说明', '示例']);
  rows.push(['教师每日上限', '', 'maxPerDay=4：一位教师一天最多几节', 'maxPerDay=4']);
  rows.push(['教师连续上限', '', 'maxConsecutive=2：连续上课不超过几节', 'maxConsecutive=2']);
  rows.push(['教师半天无课', '', 'minFreeHalfDays=1：每周至少几个半天不排课', 'minFreeHalfDays=1']);
  rows.push(['学科每日上限', '', 'maxPerDay=2：同班同学科一天最多几节', 'maxPerDay=2']);
  rows.push(['学科时间偏好', '', 'preference=morning 或 afternoon：尽量安排在上午/下午', 'preference=afternoon']);
  rows.push(['避开首末节', '', 'avoid=first 或 last：尽量避开第一节/最后一节', 'avoid=first']);
  rows.push(['学科分散', '', 'maxPerDay=2：同一学科尽量分散到一周', 'maxPerDay=2']);
  rows.push(['连堂/双节', '', 'periods=2：连续排几节，当前支持 2–4', 'periods=2']);
  rows.push(['','','','']);
  rows.push(['【批量填写示例】', '', '', '']);
  rows.push(['场景', '行数', '填写方式', '说明']);
  rows.push(['同班多科', '2 行', '七年级1班 / 语文 / 王老师 / 5；七年级1班 / 数学 / 李老师 / 5', '同一班每门课一行']);
  rows.push(['同科多班', '2 行', '七年级1班 / 语文 / 王老师 / 5；七年级2班 / 语文 / 王老师 / 5', '同一学科每个班一行']);
  rows.push(['单双周配对', '2 行', '七年级1班 / 语文 / 王老师 / 1 / 单周 / 常规 / 周五 第7节 / 空 / 语数间周-七1；七年级1班 / 数学 / 李老师 / 1 / 双周 / 常规 / 周五 第7节 / 空 / 语数间周-七1', '周次不同、配对组相同、固定时间相同']);
  rows.push(['作文连堂', '1 行', '七年级1班 / 作文 / 王老师 / 2 / 每周 / 常规 / 周四 第6节；周四 第7节 / 2 / 空', '每周2节、连堂2、两个固定节次']);
  rows.push(['先留空教师', '1 行', '七年级1班 / 语文 / 空 / 5 / 每周 / 常规 / 空 / 空 / 空', '导入后可用教学计划表批量补教师']);
  rows.push(['','','','']);
  rows.push(['【填写细节】', '', '', '']);
  rows.push(['项目', '', '说明', '示例']);
  rows.push(['教师负责班级', '', '留空 = 不限制班级；填写多个班级用「、」；批量设置负责班级时，同一组教师会得到相同的班级集合。', '七年级1班、七年级2班']);
  rows.push(['教室表', '', simplified ? '简化模式下不生成教室表，系统按每班一间普通教室自动生成。' : '整张教室表可以留空，系统会按每班一间普通教室生成；填写类型后，教学计划的教室类型必须能在教室表中找到。', '']);
  rows.push(['时间段', '', '每天最多节数必须填；节次从 1 开始且不要重复；某天少排几节时用「单日节次设置」，例如周五填 1;2;3;4;5;6。', '']);
  rows.push(['教学计划重复', '', '同班 + 同学科 + 同教师 + 同周次 + 同配对组算重复；同班同学科不同教师可以分行。', '']);
  rows.push(['固定时间顺序', '', '例：填「周一 第1节；周四 第6节」表示第 1 次课固定在周一第1节，第 2 次课固定在周四第6节。', '']);
  rows.push(['','','','']);
  rows.push(['【常见错误】', '', '', '']);
  rows.push(['现象', '原因', '处理', '示例']);
  rows.push(['找不到班级/学科/教师', '名称有空格或写法不一致', '复制目标表里的名称，不要手打简称', '「七年级1班」不是「七1班」']);
  rows.push(['每周课时必须是正整数', '填了 0/空/文字', '改成 1、2、3…', '5']);
  rows.push(['固定时间不存在', '名称不一致或节次不存在', '从时间段表复制名称，确认节次存在', '周一 第1节']);
  rows.push(['固定时间超过周课时', '固定数大于周课时', '减少固定时间，或提高周课时', '2 个固定时间配 2 周课时']);
  rows.push(['连堂超过周课时', '连堂数大于周课时', '改成 2–4 且不超过周课时', '2']);
  rows.push(['配对组只有一条', '只写了单周或双周', '补齐两条并填相同配对组', '语数间周-七1']);
  rows.push(['配对组周次重叠', '同组出现两条单周/双周', '改成一条单周 + 一条双周', '单周 + 双周']);
  rows.push(['不同班被当成同一配对组', '多个班复用了同一名称', '每个班加班级后缀', '语数间周-七1、语数间周-七2']);
  rows.push(['教学计划重复', '同键出现两次', '合并或改周次/教师/配对组', '—']);
  rows.push(['每天最多节数未填', '时间段表 B1 为空', '填写实际最大节次', '7']);
  rows.push(['导入后课表没变化', '未重新运行排课', '到排课任务重新排课', '—']);
  rows.push(['','','','']);
  rows.push(['【导入行为】', '', '', '']);
  rows.push(['项目', '', '说明', '']);
  rows.push(['基础资料', '', '班级 / 教师 / 学科 / 教室 / 时间段按名称复用：已存在则更新，不存在则新增。', '']);
  rows.push(['教学计划', '', '有数据时整表替换：Excel 中没有的计划会被删除，候选课表会失效；空表保留现有计划。', '']);
  rows.push(['教师时间', '', '有数据时整体替换；空表保留现有教师不可用时间，如需清空请在 UI 操作。', '']);
  rows.push(['排课规则', '', '有数据时整体替换自定义规则；空表保留现有规则。', '']);
  rows.push(['空行与示例', '', '完全空白的行会跳过；灰色示例行会自动跳过，但建议手工删除。', '']);
  rows.push(['失败处理', '', '任何一行校验失败，整次导入都不写入；错误会带工作表名和行号，第 1 行是表头。', '']);
  rows.push(['导入后', '', '先看「排课准备 → 数据检查」，再运行一次排课；已存在的候选课表会被清空。', '']);
  rows.push(['','','','']);
  rows.push(['【导入前检查】', '', '', '']);
  rows.push(['检查项', '', '说明', '']);
  rows.push(['1 名称一致', '', '班级、学科、教师、教室、时间名称必须与对应工作表完全一致；建议复制，不要手打简称。', '']);
  rows.push(['2 示例行', '', '删除灰色示例行；保留也会自动跳过，但删除更容易检查。', '']);
  rows.push(['3 保存', '', '另存为 .xlsx / .xls，关闭文件后再导入；文件被 Excel 占用时可能读取失败。', '']);
  rows.push(['4 导入后', '', '先看「排课准备 → 数据检查」，再运行排课；候选课表会被清空并需要重新生成。', '']);
  return rows;
}

export interface TemplateSource {
  schoolName?: string;
  semester?: { startDate: string; endDate: string } | null;
  classes?: { id: string; name: string; grade?: string; size?: number; homeroomTeacherId?: string }[];
  teachers?: { id: string; name: string; grade?: string; subject?: string; subject2?: string; classes?: string }[];
  subjects?: { id: string; name: string; preference?: 'morning' | 'afternoon' }[];
  rooms?: { id: string; name: string; type?: string; capacity?: number }[];
  timeSlots?: { id: string; day: number; period: number; start?: string; duration?: number; label?: string }[];
  unavailableSlots?: { teacherId: string; slotId: string }[];
  rules?: RuleInstance[];
  coursePlans?: {
    classId: string;
    subjectId: string;
    teacherId?: string;
    weeklyPeriods: number;
    weeks?: 'all' | 'odd' | 'even';
    kind?: 'morning' | 'regular' | 'study' | 'aftercare' | 'evening' | 'makeup';
    roomType?: string;
    fixedSlotId?: string;
    fixedSlotIds?: string[];
    consecutive?: number;
    pairId?: string;
  }[];
}

const DAY_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const WEEK_LABELS: Record<string, string> = { all: '每周', odd: '单周', even: '双周' };
const KIND_LABELS: Record<string, string> = { regular: '常规', morning: '早读', study: '自习', aftercare: '课后服务', evening: '晚自习', makeup: '补课' };

function weekdayText(days: number[]): string {
  const unique = Array.from(new Set(days)).filter((day) => day >= 1 && day <= 7).sort((a, b) => a - b);
  if (unique.length === 0) return '周一至周五';
  const consecutive = unique.every((day, index) => index === 0 || day === unique[index - 1] + 1);
  if (consecutive && unique.length > 1) return DAY_NAMES[unique[0]] + '至' + DAY_NAMES[unique[unique.length - 1]];
  return unique.map((day) => DAY_NAMES[day]).join('、');
}

function templateTimeSlotRows(source?: TemplateSource): { rows: (string | number)[][]; widths: number[] } {
  const slots = source?.timeSlots ?? [];
  const actualMax = Math.max(0, ...slots.map((slot) => slot.period));
  const maxPeriod = actualMax || 8;
  // Keep a real workspace's 7-period day at 7 rows; only a blank template
  // falls back to 8. Emitting a minimum of 8 made 7-period schools import an
  // extra slot of capacity and an unusable eighth row.
  const periodCount = maxPeriod;
  const days = Array.from(new Set(slots.map((slot) => slot.day))).sort((a, b) => a - b);
  const periods = Array.from({ length: periodCount }, (_, index) => index + 1);
  const requiredPeriods = Array.from({ length: maxPeriod }, (_, index) => index + 1);
  const firstSlot = (period: number) => slots.find((slot) => slot.period === period);
  const dayPeriods = new Map<number, number[]>();
  for (const day of days) {
    dayPeriods.set(day, slots.filter((slot) => slot.day === day).map((slot) => slot.period).sort((a, b) => a - b));
  }
  const rows: (string | number)[][] = [
    ['每天最多节数', maxPeriod, '', ''],
    ['上课星期', weekdayText(days), '', ''],
    ['', '', '', ''],
    ['节次', '开始时间（选填）', '时长（分钟，选填）'],
    ...periods.map((period) => {
      const slot = firstSlot(period);
      return [period, slot?.start ?? '', slot?.duration ?? ''];
    }),
    ['', '', '', ''],
    ['单日节次设置（不写等于满节次；多个节次用分号分隔）', '', '', ''],
    ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    [1, 2, 3, 4, 5, 6, 7].map((day) => {
      const list = dayPeriods.get(day);
      if (!list?.length) return '';
      const full = requiredPeriods.every((period) => list.includes(period));
      return full ? '' : list.join(';');
    }),
  ];
  return { rows, widths: [14, 18, 18, 18, 18, 18, 18] };
}

export interface ImportTemplateOptions {
  /** Simplified schools do not need a room sheet or per-plan room type. */
  simplified?: boolean;
}


function columnLetter(index: number): string {
  let value = index;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function exampleValues(sheet: string, headers: string[]): (string | number)[] {
  const example = EXAMPLE_ROWS[sheet] ?? {};
  return headers.map((header) => example[normalizeHeader(header)] ?? '');
}

function uniqueValues(values: (string | number | undefined | null)[]): string[] {
  return Array.from(new Set(values.map((value) => cellText(value)).filter(Boolean)));
}

export async function buildImportTemplate(
  source?: TemplateSource,
  options: ImportTemplateOptions = {},
): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'WarpWeft Scheduler';
  workbook.created = new Date();
  const simplified = Boolean(options.simplified);
  const classById = new Map((source?.classes ?? []).map((item) => [item.id, item]));
  const subjectById = new Map((source?.subjects ?? []).map((item) => [item.id, item]));
  const teacherById = new Map((source?.teachers ?? []).map((item) => [item.id, item]));
  const slotById = new Map((source?.timeSlots ?? []).map((item) => [item.id, item]));
  const ruleRows: (string | number)[][] = (source?.rules ?? []).map((rule) => {
    const definition = RULE_DEFINITIONS.find((item) => item.kind === rule.kind);
    const scope = rule.scope;
    const scopeType = scope.type === 'all' ? '全校' : scope.type === 'grade' ? '年级' : scope.type === 'teacher' ? '教师' : scope.type === 'class' ? '班级' : scope.type === 'subject' ? '学科' : '教室';
    const scopeName = scope.type === 'all' ? ''
      : scope.type === 'grade' ? scope.grade
      : scope.type === 'teacher' ? (teacherById.get(scope.teacherId)?.name ?? '')
      : scope.type === 'class' ? (classById.get(scope.classId)?.name ?? '')
      : scope.type === 'subject' ? (subjectById.get(scope.subjectId)?.name ?? '')
      : (source?.rooms ?? []).find((room) => room.id === scope.roomId)?.name ?? '';
    const days = rule.time.type === 'weekday' ? rule.time.days : rule.time.type === 'periodRange' ? (rule.time.days ?? []) : [];
    const time = rule.time.type === 'all' ? '全周'
      : rule.time.type === 'weekday' ? weekdayText(days)
      : (days.length ? weekdayText(days) + ' ' : '') + '第' + rule.time.from + '-' + rule.time.to + '节';
    const params = Object.entries(rule.params).map(([key, value]) => key + '=' + value).join('; ');
    return [
      definition?.label ?? rule.kind,
      scopeType,
      scopeName,
      time,
      IMPORTANCE_LABELS[rule.importance],
      params,
      rule.note ?? '',
    ];
  });

  const instructionSheet = workbook.addWorksheet('说明');
  for (const row of buildInstructions(simplified)) instructionSheet.addRow(row);
  instructionSheet.columns = [{ width: 16 }, { width: 12 }, { width: 64 }, { width: 34 }];
  instructionSheet.properties.tabColor = { argb: 'FFE8DC18' };
  instructionSheet.mergeCells('A1:D1');
  instructionSheet.getCell('A1').value = '导入模板使用说明';
  instructionSheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  instructionSheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF171817' } };
  instructionSheet.getCell('A1').alignment = { vertical: 'middle' };
  instructionSheet.getRow(1).height = 34;
  instructionSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const first = cellText(row.getCell(1).value);
    if (first.startsWith('【')) {
      instructionSheet.mergeCells(rowNumber, 1, rowNumber, 4);
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8DC18' } };
      row.getCell(1).font = { bold: true, size: 12, color: { argb: 'FF171817' } };
      row.height = 24;
      return;
    }
    if (first === '字段') {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E5DF' } };
        cell.font = { bold: true, color: { argb: 'FF171817' } };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FF171817' } } };
      });
    }
    if (first === '三步走' || first === '填写规则' || first === '必填标记') {
      row.getCell(2).font = { bold: true, color: { argb: 'FF171817' } };
      row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
      row.getCell(3).alignment = { wrapText: true, vertical: 'top' };
    }
    row.getCell(3).alignment = { wrapText: true, vertical: 'top' };
    row.getCell(4).alignment = { wrapText: true, vertical: 'top' };
    let longest = 0;
    row.eachCell((cell) => { longest = Math.max(longest, cellText(cell.value).length); });
    if (longest > 30) row.height = Math.min(150, 15 * Math.ceil(longest / 30));
  });

  const addDataSheet = (config: {
    name: string;
    headers: string[];
    rows: (string | number)[][];
    widths: number[];
    required?: string[];
    validations?: Record<number, string>;
    hint?: string;
  }) => {
    const worksheet = workbook.addWorksheet(config.name, {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    const required = new Set(config.required ?? []);
    const displayHeaders = config.headers.map((header) => (required.has(header) ? header + '*' : header));
    worksheet.addRow(displayHeaders);
    worksheet.addRow(exampleValues(config.name, config.headers));
    for (const row of config.rows) worksheet.addRow(row);
    worksheet.columns = config.widths.map((width) => ({ width }));
    const header = worksheet.getRow(1);
    header.height = 34;
    header.eachCell((cell, column) => {
      const base = config.headers[column - 1] ?? '';
      const isRequired = required.has(base);
      cell.font = { bold: true, color: { argb: isRequired ? 'FF9C0006' : 'FF171817' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: isRequired ? 'FFFFC7CE' : 'FFE5E5DF' },
      };
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF171817' } } };
    });
    const exampleRow = worksheet.getRow(2);
    exampleRow.height = 22;
    exampleRow.eachCell((cell) => {
      cell.font = { italic: true, color: { argb: 'FF6D716C' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
      cell.alignment = { vertical: 'middle' };
    });
    worksheet.getCell('A2').note = '示例行，导入前请删除';
    for (const [column, optionColumn] of Object.entries(config.validations ?? {})) {
      const letter = columnLetter(Number(column));
      (worksheet as unknown as {
        dataValidations: { add: (range: string, options: Record<string, unknown>) => void };
      }).dataValidations.add(`${letter}3:${letter}500`, {
        type: 'list',
        allowBlank: true,
        formulae: [`'_选项'!$${optionColumn}$2:$${optionColumn}$500`],
        showErrorMessage: false,
      });
    }
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(500, worksheet.rowCount), column: displayHeaders.length },
    };
    if (config.hint) worksheet.getCell('A1').note = config.hint;
    return worksheet;
  };

  if (source?.schoolName) {
    addDataSheet({
      name: '学校',
      headers: ['名称（选填）'],
      rows: [[source.schoolName]],
      widths: [30],
    });
  } else {
    addDataSheet({ name: '学校', headers: ['名称（选填）'], rows: [], widths: [30] });
  }
  if (source?.semester) {
    addDataSheet({
      name: '学期',
      headers: ['开始日期（选填）', '结束日期（选填）'],
      rows: [[source.semester.startDate, source.semester.endDate]],
      widths: [20, 20],
    });
  } else {
    addDataSheet({ name: '学期', headers: ['开始日期（选填）', '结束日期（选填）'], rows: [], widths: [20, 20] });
  }
  addDataSheet({
    name: '班级',
    headers: ['名称', '年级（选填）', '人数（选填）', '班主任（选填）'],
    rows: (source?.classes ?? []).map((klass) => [
      klass.name,
      klass.grade ?? '',
      klass.size ?? '',
      teacherById.get(klass.homeroomTeacherId ?? '')?.name ?? '',
    ]),
    widths: [24, 18, 18, 24],
    required: ['名称'],
    validations: { 4: 'B' },
  });
  addDataSheet({
    name: '教师',
    headers: [
      '姓名',
      '负责年级（选填，分号分隔）',
      '主要学科（选填）',
      '其他学科（选填，用、分隔）',
      '负责班级（选填，用、分隔）',
    ],
    rows: (source?.teachers ?? []).map((teacher) => [
      teacher.name,
      teacher.grade ?? '',
      teacher.subject ?? '',
      teacher.subject2 ?? '',
      teacher.classes ?? '',
    ]),
    widths: [16, 20, 20, 24, 30],
    required: ['姓名'],
    validations: { 3: 'C', 4: 'C' },
  });
  addDataSheet({
    name: '学科',
    headers: ['学科', '时间偏好（选填）'],
    rows: (source?.subjects ?? []).map((subject) => [subject.name, subject.preference ? SUBJECT_PREFERENCE_LABELS[subject.preference] : '']),
    widths: [24, 20],
    required: ['学科'],
    validations: { 2: 'J' },
    hint: '时间偏好只影响「学科时段偏好」软约束；留空时导入会按学科名套用推荐值。',
  });
  if (!simplified) {
    addDataSheet({
      name: '教室',
      headers: ['教室名称（选填）', '类型（选填）', '容量（选填）'],
      rows: (source?.rooms ?? []).map((room) => [room.name, room.type ?? '', room.capacity ?? '']),
      widths: [26, 20, 16],
      validations: { 2: 'D' },
      hint: '整张教室表可以留空，系统会按每班一间普通教室生成。',
    });
  }

  const timeSlots = templateTimeSlotRows(source);
  const timeHeaderIndex = timeSlots.rows.findIndex((row) => cellText(row[0]) === '节次');
  const timeSheet = workbook.addWorksheet('时间段', {
    views: [{ state: 'frozen', ySplit: timeHeaderIndex + 1 }],
  });
  // No example row here: a grey "节次 1 / 07:00" row duplicated the real first
  // period and, when left in place, overwrote period 1 on import.
  const timeRows = [
    ...timeSlots.rows.slice(0, timeHeaderIndex),
    ['节次*', '开始时间（选填）', '时长（分钟，选填）'],
    ...timeSlots.rows.slice(timeHeaderIndex + 1),
  ];
  for (const row of timeRows) timeSheet.addRow(row);
  timeSheet.columns = timeSlots.widths.map((width) => ({ width }));
  const timeHeader = timeSheet.getRow(timeHeaderIndex + 1);
  timeHeader.height = 26;
  timeHeader.eachCell((cell, column) => {
    const required = column === 1;
    cell.font = { bold: true, color: { argb: required ? 'FF9C0006' : 'FF171817' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: required ? 'FFFFC7CE' : 'FFE5E5DF' },
    };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF171817' } } };
  });
  timeSheet.getCell('A1').font = { bold: true };
  timeSheet.getCell('A2').font = { bold: true };
  timeSheet.getCell(`A${timeHeaderIndex + 1}`).note = '示例：节次 1 / 开始时间 07:00 / 时长 45；直接填写即可，不需要额外示例行。';
  timeSheet.autoFilter = {
    from: { row: timeHeaderIndex + 1, column: 1 },
    to: { row: Math.max(500, timeSheet.rowCount), column: 3 },
  };

  const planHeaders = simplified
    ? ['班级', '学科', '教师（选填）', '每周课时', '周次（选填）', '课程类型（选填）', '固定时间（选填）', '连堂节数（选填）', '配对组（选填）']
    : ['班级', '学科', '教师（选填）', '每周课时', '周次（选填）', '课程类型（选填）', '教室类型（选填）', '固定时间（选填）', '连堂节数（选填）', '配对组（选填）'];
  const planRows = (source?.coursePlans ?? []).map((plan) => {
    const klass = classById.get(plan.classId);
    const subject = subjectById.get(plan.subjectId);
    const teacher = plan.teacherId ? teacherById.get(plan.teacherId) : undefined;
    const fixedText = fixedSlotIdsOf(plan)
      .map((slotId) => slotById.get(slotId)?.label ?? '')
      .filter(Boolean)
      .join('；');
    const consecutive = consecutiveOf(plan);
    const base = [
      klass?.name ?? '',
      subject?.name ?? '',
      teacher?.name ?? '',
      plan.weeklyPeriods,
      WEEK_LABELS[plan.weeks ?? 'all'] ?? '每周',
      KIND_LABELS[plan.kind ?? 'regular'] ?? '常规',
    ];
    const tail = [fixedText, consecutive >= 2 ? consecutive : '', plan.pairId ?? ''];
    return simplified ? [...base, ...tail] : [...base, plan.roomType ?? '', ...tail];
  });
  const planSheet = addDataSheet({
    name: '教学计划',
    headers: planHeaders,
    rows: planRows,
    widths: simplified ? [22, 16, 16, 12, 14, 16, 24, 14, 18] : [22, 16, 16, 12, 14, 18, 18, 24, 14, 18],
    required: ['班级', '学科', '每周课时'],
    validations: simplified ? { 1: 'A', 2: 'C', 3: 'B', 5: 'H', 6: 'I' } : { 1: 'A', 2: 'C', 3: 'B', 5: 'H', 6: 'I', 7: 'D' },
    hint: '一行 = 一门课一个学期；有数据时整表替换，空表保留现有计划；固定时间可填多个（用；分隔）；连堂填 2–4；单双周配对填同一个配对组。',
  });
  planSheet.getCell('A1').note = '一行 = 一门课一个学期；有数据时整表替换，空表保留现有计划；固定时间可填多个（用；分隔）；连堂填 2–4；单双周配对填同一个配对组。';

  const teacherTimeGroups = new Map<string, { teacherId: string; day: number; periods: number[] }>();
  for (const item of source?.unavailableSlots ?? []) {
    const slot = slotById.get(item.slotId);
    const teacher = teacherById.get(item.teacherId);
    if (!slot || !teacher) continue;
    const key = item.teacherId + '|' + slot.day;
    const group = teacherTimeGroups.get(key) ?? { teacherId: item.teacherId, day: slot.day, periods: [] };
    group.periods.push(slot.period);
    teacherTimeGroups.set(key, group);
  }
  const teacherTimeRows = [...teacherTimeGroups.values()]
    .sort((a, b) => (teacherById.get(a.teacherId)?.name ?? '').localeCompare(teacherById.get(b.teacherId)?.name ?? '') || a.day - b.day)
    .map((group) => [
      teacherById.get(group.teacherId)?.name ?? '',
      DAY_NAMES[group.day] ?? '',
      Array.from(new Set(group.periods)).sort((a, b) => a - b).join(';'),
    ]);
  addDataSheet({
    name: '教师时间',
    headers: ['教师', '星期', '节次'],
    rows: teacherTimeRows,
    widths: [16, 12, 26],
    required: ['教师', '星期', '节次'],
    hint: '填写教师不可用的时间；节次可写多个（用；分隔）。有数据时整体替换「教师不可用时间」，空表保留现有设置。',
  });

  addDataSheet({
    name: '排课规则',
    headers: [
      '规则类型',
      '作用对象类型',
      '作用对象',
      '适用时间',
      '重要程度',
      '参数（选填，多项用；分隔）',
      '备注',
    ],
    rows: ruleRows,
    widths: [24, 16, 20, 24, 12, 34, 30],
    required: ['规则类型', '作用对象类型'],
    validations: { 1: 'E', 2: 'F', 5: 'G' },
    hint: '有数据时整体替换当前自定义规则；空表保留现有规则。',
  });

  const optionSheet = workbook.addWorksheet('_选项');
  optionSheet.addRow(['班级', '教师', '学科', '教室类型', '规则类型', '作用对象类型', '重要程度', '周次', '课程类型', '时间偏好']);
  const roomTypes = uniqueValues([
    ...(source?.rooms ?? []).map((room) => room.type),
    '普通教室',
    '实验室',
    '功能室',
    '体育场',
  ]);
  const optionRows: (string | number)[][] = [
    uniqueValues((source?.classes ?? []).map((item) => item.name)),
    uniqueValues((source?.teachers ?? []).map((item) => item.name)),
    uniqueValues((source?.subjects ?? []).map((item) => item.name)),
    roomTypes,
    RULE_DEFINITIONS.map((definition) => definition.label),
    ['全校', '年级', '教师', '班级', '学科', '教室'],
    ['必须', '尽量', '避免'],
    ['每周', '单周', '双周'],
    ['常规', '早读', '自习', '课后服务', '晚自习', '补课'],
    ['上午', '下午', '不限'],
  ];
  const optionRowCount = Math.max(...optionRows.map((column) => column.length), 0);
  for (let row = 0; row < optionRowCount; row += 1) {
    optionSheet.addRow(optionRows.map((column) => column[row] ?? ''));
  }
  optionSheet.columns = Array.from({ length: 10 }, () => ({ width: 18 }));
  optionSheet.state = 'hidden';

  const output = await workbook.xlsx.writeBuffer();
  const bytes = output instanceof Uint8Array ? output : new Uint8Array(output as ArrayBuffer);
  return bytes.slice().buffer;
}



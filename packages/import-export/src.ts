import * as XLSX from 'xlsx';

export interface ImportRow { sheet: string; row: number; values: Record<string, unknown>; }
export interface ImportIssue { sheet: string; row: number; field?: string; message: string; }

export function readWorkbook(buffer: ArrayBuffer): ImportRow[] {
  const workbook = XLSX.read(buffer, { type: 'array' });
  return workbook.SheetNames.flatMap(sheet => {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheet], { defval: '' });
    return rows.map((values, index) => ({ sheet, row: index + 2, values }));
  });
}

export function validateRequired(rows: ImportRow[], fields: string[]): ImportIssue[] {
  const issues: ImportIssue[] = [];
  for (const row of rows) for (const field of fields) if (row.values[field] === undefined || row.values[field] === '') issues.push({ sheet: row.sheet, row: row.row, field, message: `缺少必填字段：${field}` });
  return issues;
}

export function exportCsv(rows: Record<string, unknown>[]): string {
  return XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(rows));
}

export function exportWorkbook(sheets: Record<string, Record<string, unknown>[]>): Uint8Array {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), name.slice(0, 31));
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
}

export function buildImportTemplate(): Uint8Array {
  const workbook = XLSX.utils.book_new();
  const sheets: { name: string; headers: string[]; rows: (string | number)[][] }[] = [
    {
      name: '说明',
      headers: ['项目', '说明'],
      rows: [
        ['导入顺序', '可先填写学校名称，再填写班级、教师、学科、教室、时间段，最后填写教学计划。'],
        ['学校名称', '可在“学校”工作表填写；留空则保留当前名称。'],
        ['名称引用', '教学计划通过“班级/学科/教师”名称引用，请与前面工作表保持一致。'],
        ['星期', '填写周一至周日，或 1-7。'],
        ['固定时间', '可留空；需要固定时填写“周一 第1节”或时间段 ID。'],
        ['周次', '教学计划可填“每周/单周/双周”，留空按每周处理；单周课与双周课可以共用同一时段。'],
        ['时段类型', '时间段和教学计划都可填“早读/常规/晚自习/补课”，留空按常规处理；早读计划只会排进早读时段。'],
        ['开始时间与时长', '时间段可填开始时间（HH:MM）和分钟数；填写后工作台才能高亮当前节次。'],
        ['重复导入', '基础资料按名称复用已有记录；教学计划工作表会整体替换原计划。'],
        ['空行', '完全空白的行会被忽略。'],
      ],
    },
    { name: '学校', headers: ['名称'], rows: [] },
    { name: '班级', headers: ['名称', '年级', '人数'], rows: [] },
    { name: '教师', headers: ['名称'], rows: [] },
    { name: '学科', headers: ['名称'], rows: [] },
    { name: '教室', headers: ['名称', '容量', '类型'], rows: [] },
    { name: '时间段', headers: ['星期', '节次', '名称', '类型', '开始时间', '时长'], rows: [] },
    { name: '教学计划', headers: ['班级', '学科', '教师', '周课时', '周次', '时段类型', '教室类型', '固定时间'], rows: [] },
  ];
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet([sheet.headers, ...sheet.rows]);
    worksheet['!cols'] = sheet.headers.map((header) => ({ wch: Math.max(12, Math.min(30, header.length * 2 + 8)) }));
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
  }
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as Uint8Array;
}

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

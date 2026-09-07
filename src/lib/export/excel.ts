import 'server-only';
import ExcelJS from 'exceljs';

/**
 * Excel and CSV export (BRD 134). Exports carry a branded header row and
 * respect the same column definitions across the platform.
 */

export interface ExportColumn<T> {
  header: string;
  key: string;
  width?: number;
  value: (row: T) => string | number | null;
  /** Number format string for Excel numeric cells. */
  numFmt?: string;
}

export interface ExportOptions {
  title: string;
  sheetName?: string;
  subtitle?: string;
  generatedBy?: string;
}

const BRAND_BROWN = 'FF3A2B1F';
const BRAND_GOLD = 'FFC9A96A';

export async function buildWorkbook<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  options: ExportOptions,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'RIFTARA';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(options.sheetName ?? 'Export', {
    views: [{ state: 'frozen', ySplit: 4 }],
  });

  sheet.columns = columns.map((column) => ({ key: column.key, width: column.width ?? 18 }));

  // Title band
  sheet.mergeCells(1, 1, 1, columns.length);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = `RIFTARA — ${options.title}`;
  titleCell.font = { bold: true, size: 15, color: { argb: BRAND_BROWN } };
  sheet.getRow(1).height = 24;

  sheet.mergeCells(2, 1, 2, columns.length);
  const subtitleCell = sheet.getCell(2, 1);
  subtitleCell.value =
    options.subtitle ??
    `Generated ${new Date().toISOString().slice(0, 10)}${options.generatedBy ? ` by ${options.generatedBy}` : ''}`;
  subtitleCell.font = { size: 10, color: { argb: 'FF6B6B68' } };

  // Header row
  const headerRow = sheet.getRow(4);
  columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = column.header;
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_BROWN } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });
  headerRow.height = 18;

  // Data rows
  rows.forEach((row) => {
    const values = columns.map((column) => column.value(row));
    const added = sheet.addRow(values);
    columns.forEach((column, index) => {
      if (column.numFmt) added.getCell(index + 1).numFmt = column.numFmt;
    });
  });

  // Gold accent under the header
  const accentRow = sheet.getRow(3);
  accentRow.height = 3;
  for (let i = 1; i <= columns.length; i += 1) {
    accentRow.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_GOLD } };
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

export function buildCsv<T>(rows: T[], columns: ExportColumn<T>[]): string {
  const escape = (value: string | number | null): string => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const header = columns.map((column) => escape(column.header)).join(',');
  const body = rows.map((row) => columns.map((column) => escape(column.value(row))).join(',')).join('\n');
  return `${header}\n${body}`;
}

/** Content-Disposition-safe filename with a date stamp. */
export function exportFilename(base: string, extension: 'xlsx' | 'csv'): string {
  const date = new Date().toISOString().slice(0, 10);
  return `riftara-${base}-${date}.${extension}`;
}

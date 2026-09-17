import 'server-only';
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import { validationError } from '@/lib/errors';

/**
 * Bulk-import file handling (Phase 20A / BRD 135): parses an uploaded
 * workbook or CSV into plain row objects keyed by header, and builds the
 * downloadable templates. Nothing here persists the uploaded file — it is
 * parsed in memory for the duration of the request only.
 */

export type RawRow = Record<string, string | number | Date | null>;

export interface ParsedSheet {
  name: string;
  headers: string[];
  rows: RawRow[];
}

const MAX_ROWS = 20_000;

function cellToValue(cell: ExcelJS.Cell): string | number | Date | null {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'object') {
    // Rich text / formula result / hyperlink cells.
    if ('result' in v && v.result !== undefined) return cellResultToValue(v.result);
    if ('text' in v && typeof (v as { text?: unknown }).text === 'string') return (v as { text: string }).text;
    if ('richText' in v) return (v as { richText: Array<{ text: string }> }).richText.map((r) => r.text).join('');
    return null;
  }
  return v;
}

function cellResultToValue(result: unknown): string | number | Date | null {
  if (result === null || result === undefined) return null;
  if (result instanceof Date) return result;
  if (typeof result === 'number' || typeof result === 'string') return result;
  return null;
}

function sheetToParsed(sheet: ExcelJS.Worksheet): ParsedSheet {
  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const text = String(cell.value ?? '').trim();
    if (text) headers[colNumber - 1] = text;
  });

  const rows: RawRow[] = [];
  const rowCount = Math.min(sheet.rowCount, MAX_ROWS + 1);
  for (let r = 2; r <= rowCount; r += 1) {
    const row = sheet.getRow(r);
    if (row.cellCount === 0) continue;
    let hasValue = false;
    const obj: RawRow = {};
    headers.forEach((header, index) => {
      if (!header) return;
      const value = cellToValue(row.getCell(index + 1));
      obj[header] = value;
      if (value !== null && String(value).trim() !== '') hasValue = true;
    });
    if (hasValue) rows.push(obj);
  }
  return { name: sheet.name, headers: headers.filter(Boolean), rows };
}

/** Parses an uploaded .xlsx or .csv buffer into one or more named sheets. */
export async function parseUploadedWorkbook(buffer: Buffer, filename: string): Promise<ParsedSheet[]> {
  const ext = filename.toLowerCase().split('.').pop();
  const workbook = new ExcelJS.Workbook();

  if (ext === 'csv') {
    const sheet = await workbook.csv.read(Readable.from(buffer));
    sheet.name = sheet.name || 'CSV';
    return [sheetToParsed(sheet)];
  }
  if (ext === 'xlsx') {
    try {
      // exceljs's own .d.ts declares a conflicting global Buffer type — cast through any.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await workbook.xlsx.load(buffer as any);
    } catch {
      throw validationError('The uploaded file is not a valid Excel workbook.');
    }
    return workbook.worksheets.map(sheetToParsed);
  }
  throw validationError('Only .xlsx and .csv files are supported.');
}

/** Finds a sheet by (case-insensitive) name, or returns null. */
export function findSheet(sheets: ParsedSheet[], name: string): ParsedSheet | null {
  return sheets.find((s) => s.name.trim().toLowerCase() === name.toLowerCase()) ?? null;
}

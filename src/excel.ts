import ExcelJS from 'exceljs';
import type { AssistantFile } from './tools';

/**
 * Excel export for assistant tools (Node only: uses exceljs). Columns are
 * typed so money, dates and percentages stay real numbers and dates in Excel,
 * formatted for the reader, instead of preformatted strings.
 */

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type CellValue = string | number | boolean | Date | null | undefined;

export type ColumnType = 'text' | 'number' | 'integer' | 'money' | 'percent' | 'date' | 'month' | 'datetime';

export interface ExcelColumn {
  key: string;
  type?: ColumnType;
  /** Header text. Otherwise `translate(headerKey ?? key)`, then the key itself. */
  header?: string;
  headerKey?: string;
  /** Custom Excel number format, overriding the type's default. */
  format?: string;
  /** Character width; otherwise fitted to the content (10–48). */
  width?: number;
  /** Maps stored values (e.g. a category key) to a display label. */
  label?: (value: string) => string | null | undefined;
}

export interface ExcelSheet {
  /** Sheet tab name; sanitised and de-duplicated automatically. */
  name: string;
  /** Optional bold line above the header, e.g. "Expenses · 1–31 May 2026". */
  title?: string;
  columns: ExcelColumn[];
  rows: Array<Record<string, CellValue>>;
}

export interface WorkbookOptions {
  /** Translates header keys; return null/undefined when a key is missing. */
  translate?: (key: string) => string | null | undefined;
  creator?: string;
  /** Decimal places for money. Default 0 (whole currency units). */
  moneyDecimals?: number;
  /** `whole`: 12.5 means 12.5 % (default). `fraction`: 0.125 means 12.5 %. */
  percentScale?: 'whole' | 'fraction';
  dateFormat?: string;
  monthFormat?: string;
  dateTimeFormat?: string;
}

const EXCEL_SHEET_NAME_MAX = 31;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

/** Excel forbids : \ / ? * [ ] in sheet names and caps them at 31 characters. */
export function safeSheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[:\\/?*[\]]/g, ' ').replace(/^'+|'+$/g, '').replace(/\s+/g, ' ').trim().slice(0, EXCEL_SHEET_NAME_MAX).trim() || 'Sheet';
  let candidate = base;
  for (let index = 2; used.has(candidate.toLowerCase()); index += 1) {
    const suffix = ` (${index})`;
    candidate = `${base.slice(0, EXCEL_SHEET_NAME_MAX - suffix.length)}${suffix}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/** A file name without characters that break downloads on common systems. */
export function safeFileName(name: string, extension = 'xlsx'): string {
  const base = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'export';
  return base.toLowerCase().endsWith(`.${extension}`) ? base : `${base}.${extension}`;
}

function numberFormat(type: ColumnType, options: WorkbookOptions): string | undefined {
  const decimals = options.moneyDecimals ?? 0;
  switch (type) {
    case 'money':
      return decimals > 0 ? `#,##0.${'0'.repeat(decimals)}` : '#,##0';
    case 'integer':
      return '#,##0';
    case 'number':
      return '#,##0.##';
    case 'percent':
      return options.percentScale === 'fraction' ? '0.0%' : '0.0"%"';
    case 'date':
      return options.dateFormat ?? 'dd.mm.yyyy';
    case 'month':
      return options.monthFormat ?? 'mm.yyyy';
    case 'datetime':
      return options.dateTimeFormat ?? 'dd.mm.yyyy hh:mm';
    default:
      return undefined;
  }
}

/** Converts a stored value to what Excel should hold for the column type. */
export function cellValue(column: ExcelColumn, value: CellValue): ExcelJS.CellValue {
  if (value === null || value === undefined || value === '') return null;
  const type = column.type ?? 'text';
  if (type === 'date' || type === 'month' || type === 'datetime') {
    if (value instanceof Date) return value;
    if (typeof value === 'string') {
      if (ISO_DATE.test(value)) return new Date(`${value}T00:00:00Z`);
      if (ISO_MONTH.test(value)) return new Date(`${value}-01T00:00:00Z`);
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? value : parsed;
    }
    return String(value);
  }
  if (type === 'money' || type === 'number' || type === 'integer' || type === 'percent') {
    const number = typeof value === 'number' ? value : Number(String(value).replace(/[\s ]/g, '').replace(',', '.'));
    return Number.isFinite(number) ? number : String(value);
  }
  if (typeof value === 'string') return column.label?.(value) || value;
  return value;
}

function headerText(column: ExcelColumn, options: WorkbookOptions): string {
  return column.header ?? options.translate?.(column.headerKey ?? column.key) ?? column.key;
}

function displayLength(value: ExcelJS.CellValue): number {
  if (value === null || value === undefined) return 0;
  if (value instanceof Date) return 10;
  if (typeof value === 'number') return value.toLocaleString('en-US').length;
  return String(value).length;
}

/** Builds an .xlsx with one formatted sheet per entry. */
export async function buildWorkbook(sheets: ExcelSheet[], options: WorkbookOptions = {}): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = options.creator ?? 'hoggish-assistant';
  workbook.created = new Date();
  const usedNames = new Set<string>();

  for (const sheetSpec of sheets.length ? sheets : [{ name: 'Sheet', columns: [], rows: [] }]) {
    const sheet = workbook.addWorksheet(safeSheetName(sheetSpec.name, usedNames));
    let headerRowNumber = 1;
    if (sheetSpec.title) {
      sheet.addRow([sheetSpec.title]).font = { bold: true, size: 13 };
      sheet.addRow([]);
      headerRowNumber = 3;
    }
    if (sheetSpec.columns.length === 0) continue;

    const header = sheet.addRow(sheetSpec.columns.map((column) => headerText(column, options)));
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF9AA9BF' } } };
    });

    const widths = sheetSpec.columns.map((column) => headerText(column, options).length);
    sheetSpec.rows.forEach((row, rowIndex) => {
      const values = sheetSpec.columns.map((column) => cellValue(column, row[column.key]));
      const added = sheet.addRow(values);
      sheetSpec.columns.forEach((column, index) => {
        const format = column.format ?? numberFormat(column.type ?? 'text', options);
        if (format) added.getCell(index + 1).numFmt = format;
        if (rowIndex < 500) widths[index] = Math.max(widths[index]!, displayLength(values[index]));
      });
    });

    sheetSpec.columns.forEach((column, index) => {
      sheet.getColumn(index + 1).width = column.width ?? Math.min(48, Math.max(10, widths[index]! + 4));
    });
    sheet.views = [{ state: 'frozen', ySplit: headerRowNumber }];
    if (sheetSpec.rows.length > 0) {
      sheet.autoFilter = {
        from: { row: headerRowNumber, column: 1 },
        to: { row: headerRowNumber, column: sheetSpec.columns.length },
      };
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

/** Builds a workbook ready for `attachFile` in a tool. */
export async function excelFile(fileName: string, sheets: ExcelSheet[], options?: WorkbookOptions): Promise<AssistantFile> {
  return { fileName: safeFileName(fileName), mimeType: XLSX_MIME, data: await buildWorkbook(sheets, options) };
}

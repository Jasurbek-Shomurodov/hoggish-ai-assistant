import ExcelJS from 'exceljs';
import { AssistantFile } from './server.js';
import 'ai';

/**
 * Excel export for assistant tools (Node only: uses exceljs). Columns are
 * typed so money, dates and percentages stay real numbers and dates in Excel,
 * formatted for the reader, instead of preformatted strings.
 */
declare const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
type CellValue = string | number | boolean | Date | null | undefined;
type ColumnType = 'text' | 'number' | 'integer' | 'money' | 'percent' | 'date' | 'month' | 'datetime';
interface ExcelColumn {
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
interface ExcelSheet {
    /** Sheet tab name; sanitised and de-duplicated automatically. */
    name: string;
    /** Optional bold line above the header, e.g. "Expenses · 1–31 May 2026". */
    title?: string;
    columns: ExcelColumn[];
    rows: Array<Record<string, CellValue>>;
}
interface WorkbookOptions {
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
/** Excel forbids : \ / ? * [ ] in sheet names and caps them at 31 characters. */
declare function safeSheetName(name: string, used: Set<string>): string;
/** A file name without characters that break downloads on common systems. */
declare function safeFileName(name: string, extension?: string): string;
/** Converts a stored value to what Excel should hold for the column type. */
declare function cellValue(column: ExcelColumn, value: CellValue): ExcelJS.CellValue;
/** Builds an .xlsx with one formatted sheet per entry. */
declare function buildWorkbook(sheets: ExcelSheet[], options?: WorkbookOptions): Promise<Uint8Array>;
/** Builds a workbook ready for `attachFile` in a tool. */
declare function excelFile(fileName: string, sheets: ExcelSheet[], options?: WorkbookOptions): Promise<AssistantFile>;

export { XLSX_MIME, buildWorkbook, cellValue, excelFile, safeFileName, safeSheetName };
export type { CellValue, ColumnType, ExcelColumn, ExcelSheet, WorkbookOptions };

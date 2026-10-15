import ExcelJS from 'exceljs';

// src/excel.ts
var XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
var EXCEL_SHEET_NAME_MAX = 31;
var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
var ISO_MONTH = /^\d{4}-\d{2}$/;
function safeSheetName(name, used) {
  const base = name.replace(/[:\\/?*[\]]/g, " ").replace(/^'+|'+$/g, "").replace(/\s+/g, " ").trim().slice(0, EXCEL_SHEET_NAME_MAX).trim() || "Sheet";
  let candidate = base;
  for (let index = 2; used.has(candidate.toLowerCase()); index += 1) {
    const suffix = ` (${index})`;
    candidate = `${base.slice(0, EXCEL_SHEET_NAME_MAX - suffix.length)}${suffix}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}
function safeFileName(name, extension = "xlsx") {
  const base = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "export";
  return base.toLowerCase().endsWith(`.${extension}`) ? base : `${base}.${extension}`;
}
function numberFormat(type, options) {
  const decimals = options.moneyDecimals ?? 0;
  switch (type) {
    case "money":
      return decimals > 0 ? `#,##0.${"0".repeat(decimals)}` : "#,##0";
    case "integer":
      return "#,##0";
    case "number":
      return "#,##0.##";
    case "percent":
      return options.percentScale === "fraction" ? "0.0%" : '0.0"%"';
    case "date":
      return options.dateFormat ?? "dd.mm.yyyy";
    case "month":
      return options.monthFormat ?? "mm.yyyy";
    case "datetime":
      return options.dateTimeFormat ?? "dd.mm.yyyy hh:mm";
    default:
      return void 0;
  }
}
function cellValue(column, value) {
  if (value === null || value === void 0 || value === "") return null;
  const type = column.type ?? "text";
  if (type === "date" || type === "month" || type === "datetime") {
    if (value instanceof Date) return value;
    if (typeof value === "string") {
      if (ISO_DATE.test(value)) return /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
      if (ISO_MONTH.test(value)) return /* @__PURE__ */ new Date(`${value}-01T00:00:00Z`);
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? value : parsed;
    }
    return String(value);
  }
  if (type === "money" || type === "number" || type === "integer" || type === "percent") {
    const number = typeof value === "number" ? value : Number(String(value).replace(/[\s ]/g, "").replace(",", "."));
    return Number.isFinite(number) ? number : String(value);
  }
  if (typeof value === "string") return column.label?.(value) || value;
  return value;
}
function headerText(column, options) {
  return column.header ?? options.translate?.(column.headerKey ?? column.key) ?? column.key;
}
function displayLength(value) {
  if (value === null || value === void 0) return 0;
  if (value instanceof Date) return 10;
  if (typeof value === "number") return value.toLocaleString("en-US").length;
  return String(value).length;
}
async function buildWorkbook(sheets, options = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = options.creator ?? "hoggish-assistant";
  workbook.created = /* @__PURE__ */ new Date();
  const usedNames = /* @__PURE__ */ new Set();
  for (const sheetSpec of sheets.length ? sheets : [{ name: "Sheet", columns: [], rows: [] }]) {
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
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } };
      cell.border = { bottom: { style: "thin", color: { argb: "FF9AA9BF" } } };
    });
    const widths = sheetSpec.columns.map((column) => headerText(column, options).length);
    sheetSpec.rows.forEach((row, rowIndex) => {
      const values = sheetSpec.columns.map((column) => cellValue(column, row[column.key]));
      const added = sheet.addRow(values);
      sheetSpec.columns.forEach((column, index) => {
        const format = column.format ?? numberFormat(column.type ?? "text", options);
        if (format) added.getCell(index + 1).numFmt = format;
        if (rowIndex < 500) widths[index] = Math.max(widths[index], displayLength(values[index]));
      });
    });
    sheetSpec.columns.forEach((column, index) => {
      sheet.getColumn(index + 1).width = column.width ?? Math.min(48, Math.max(10, widths[index] + 4));
    });
    sheet.views = [{ state: "frozen", ySplit: headerRowNumber }];
    if (sheetSpec.rows.length > 0) {
      sheet.autoFilter = {
        from: { row: headerRowNumber, column: 1 },
        to: { row: headerRowNumber, column: sheetSpec.columns.length }
      };
    }
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
async function excelFile(fileName, sheets, options) {
  return { fileName: safeFileName(fileName), mimeType: XLSX_MIME, data: await buildWorkbook(sheets, options) };
}

export { XLSX_MIME, buildWorkbook, cellValue, excelFile, safeFileName, safeSheetName };
//# sourceMappingURL=excel.js.map
//# sourceMappingURL=excel.js.map
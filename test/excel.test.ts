import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildWorkbook, cellValue, excelFile, safeFileName, safeSheetName, XLSX_MIME } from '../src/excel';

async function load(data: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data as never);
  return workbook;
}

describe('safeSheetName', () => {
  it('removes forbidden characters, caps length and de-duplicates', () => {
    const used = new Set<string>();
    expect(safeSheetName('Income: May/June [2026]?', used)).toBe('Income May June 2026');
    expect(safeSheetName('A'.repeat(40), used)).toHaveLength(31);
    expect(safeSheetName('Expenses', used)).toBe('Expenses');
    expect(safeSheetName('expenses', used)).toBe('expenses (2)');
    expect(safeSheetName('***', used)).toBe('Sheet');
  });

  it('builds safe file names', () => {
    expect(safeFileName('Report: May/June')).toBe('Report May June.xlsx');
    expect(safeFileName('a.xlsx')).toBe('a.xlsx');
    expect(safeFileName('')).toBe('export.xlsx');
  });
});

describe('cellValue', () => {
  it('converts by column type', () => {
    expect(cellValue({ key: 'd', type: 'date' }, '2026-05-01')).toEqual(new Date('2026-05-01T00:00:00Z'));
    expect(cellValue({ key: 'm', type: 'month' }, '2026-05')).toEqual(new Date('2026-05-01T00:00:00Z'));
    expect(cellValue({ key: 'a', type: 'money' }, '1 000 000')).toBe(1_000_000);
    expect(cellValue({ key: 'a', type: 'money' }, 'n/a')).toBe('n/a');
    expect(cellValue({ key: 'c', label: (value) => (value === 'rent' ? 'Arenda' : null) }, 'rent')).toBe('Arenda');
    expect(cellValue({ key: 'c' }, null)).toBeNull();
  });
});

describe('buildWorkbook', () => {
  it('writes typed, translated, formatted sheets', async () => {
    const data = await buildWorkbook([
      {
        name: 'Expenses: May',
        title: 'Expenses · May 2026',
        columns: [
          { key: 'date', type: 'date' },
          { key: 'category', label: (value) => ({ rent: 'Rent' })[value] },
          { key: 'amount', type: 'money' },
          { key: 'share', type: 'percent', header: 'Share' },
        ],
        rows: [
          { date: '2026-05-02', category: 'rent', amount: 5_000_000, share: 62.5 },
          { date: '2026-05-03', category: 'salary', amount: 3_000_000, share: 37.5 },
        ],
      },
      { name: 'Expenses: May', columns: [{ key: 'x', type: 'integer' }], rows: [] },
    ], { translate: (key) => ({ date: 'Sana', category: 'Kategoriya', amount: 'Summa' })[key] ?? null, creator: 'Test' });

    const workbook = await load(data);
    expect(workbook.creator).toBe('Test');
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Expenses May', 'Expenses May (2)']);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.getCell('A1').value).toBe('Expenses · May 2026');
    expect(sheet.getRow(3).values).toEqual([undefined, 'Sana', 'Kategoriya', 'Summa', 'Share']);
    expect(sheet.getCell('A4').value).toEqual(new Date('2026-05-02T00:00:00Z'));
    expect(sheet.getCell('A4').numFmt).toBe('dd.mm.yyyy');
    expect(sheet.getCell('B4').value).toBe('Rent');
    expect(sheet.getCell('B5').value).toBe('salary');
    expect(sheet.getCell('C4').value).toBe(5_000_000);
    expect(sheet.getCell('C4').numFmt).toBe('#,##0');
    expect(sheet.getCell('D4').numFmt).toBe('0.0"%"');
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 3 });
  });

  it('supports decimals and fraction percentages', async () => {
    const workbook = await load(await buildWorkbook([
      { name: 'S', columns: [{ key: 'p', type: 'money' }, { key: 'r', type: 'percent' }], rows: [{ p: 12.345, r: 0.125 }] },
    ], { moneyDecimals: 2, percentScale: 'fraction' }));
    const sheet = workbook.worksheets[0]!;
    expect(sheet.getCell('A2').numFmt).toBe('#,##0.00');
    expect(sheet.getCell('B2').numFmt).toBe('0.0%');
  });

  it('wraps a workbook as an assistant file', async () => {
    const file = await excelFile('May report', [{ name: 'S', columns: [{ key: 'a' }], rows: [{ a: 'x' }] }]);
    expect(file.fileName).toBe('May report.xlsx');
    expect(file.mimeType).toBe(XLSX_MIME);
    expect(file.data).toBeInstanceOf(Uint8Array);
  });
});

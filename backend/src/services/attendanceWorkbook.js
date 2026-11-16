import ExcelJS from 'exceljs';
import { reportPeriod } from './reportExportOverview.js';

const navy = 'FF18324D';
const stripe = 'FFF1F5F9';
const text = 'FF18324D';

function fill(color) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
}

function heading(row) {
  row.fill = fill(navy);
  row.font = { color: { argb: 'FFFFFFFF' }, bold: true };
  row.alignment = { vertical: 'middle', wrapText: true };
  row.height = 28;
}

function timeValue(time) {
  if (!time) return null;
  const [hours, minutes] = time.split(':').map(Number);
  return (hours * 60 + minutes) / 1440;
}

function addOverview(workbook, data) {
  const { title, company, group, overview, rows } = data;
  const sheet = workbook.addWorksheet('Overview', { views: [{ showGridLines: false }] });
  sheet.columns = [{ width: 29 }, { width: 80 }];
  heading(sheet.addRow([title]));
  sheet.mergeCells('A1:B1');
  sheet.addRow(['Company', company]);
  sheet.addRow(['Report category', group]);
  sheet.addRow(reportPeriod(data));
  sheet.addRow(['Exported rows', rows.length]);
  sheet.addRow(['Generated', overview.generated]);
  if (overview.description) {
    const notes = sheet.addRow(['Methodology', overview.description]);
    notes.height = 44;
    notes.alignment = { wrapText: true, vertical: 'top' };
  }
  for (const [label, items] of [['Filters', overview.filterDetails], ['Summary of exported records', overview.metrics]]) {
    if (!items.length) continue;
    sheet.addRow([]);
    const section = sheet.addRow([label]);
    heading(section);
    sheet.mergeCells(section.number, 1, section.number, 2);
    for (const item of items) sheet.addRow(item);
  }
}

export async function attendanceWorkbook(data) {
  const { title, company, date, asOf, group, columns, rows, generatedAt, overview } = data;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = company;
  if (generatedAt) workbook.created = generatedAt;
  const sheet = workbook.addWorksheet(group ?? 'Attendance', {
    views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
    pageSetup: { orientation: columns.length > 5 ? 'landscape' : 'portrait', fitToPage: true,
      fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:4' },
    headerFooter: { oddFooter: '&RPage &P of &N' },
  });
  const widths = [18, 32, 26, 14, 14, 16];
  columns.forEach((column, index) => { sheet.getColumn(index + 1).width = column.width ?? widths[index] ?? 14; });
  const titleRow = sheet.addRow([title]);
  heading(titleRow);
  titleRow.font = { ...titleRow.font, size: 16 };
  sheet.mergeCells(1, 1, 1, Math.max(4, columns.length));
  sheet.addRow([company]).font = { color: { argb: text }, bold: true };
  sheet.mergeCells(2, 1, 2, Math.max(4, columns.length));
  const [periodLabel, periodValue] = reportPeriod(data);
  const periodRow = sheet.addRow([periodLabel, date || asOf ? new Date(periodValue + 'T00:00:00Z') : periodValue, 'Rows', rows.length]);
  if (date || asOf) periodRow.getCell(2).numFmt = 'yyyy-mm-dd';
  periodRow.getCell(2).alignment = { wrapText: true };
  periodRow.height = data.period ? 32 : 20;
  heading(sheet.addRow(columns.map(column => column.header)));
  for (const record of rows) {
    const row = sheet.addRow(columns.map(({ key, type }) => {
      if (key === 'checkInTime' || key === 'checkOutTime') return timeValue(record[key]);
      if (key === 'workDate' || type === 'date') return record[key] ? new Date(record[key] + 'T00:00:00Z') : null;
      return record[key];
    }));
    row.alignment = { wrapText: true, vertical: 'top' };
    if (row.number % 2 === 0) row.fill = fill(stripe);
    columns.forEach(({ key, type }, index) => {
      if (key === 'checkInTime' || key === 'checkOutTime') row.getCell(index + 1).numFmt = 'hh:mm';
      if (key === 'workDate' || type === 'date') row.getCell(index + 1).numFmt = 'yyyy-mm-dd';
      if (type === 'money') row.getCell(index + 1).numFmt = '#,##0.00';
    });
  }
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: sheet.rowCount, column: columns.length } };
  if (overview) addOverview(workbook, data);
  return workbook.xlsx.writeBuffer();
}

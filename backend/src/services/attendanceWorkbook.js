import ExcelJS from 'exceljs';

function timeValue(time) {
  if (!time) return null;
  const [hours, minutes] = time.split(':').map(Number);
  return (hours * 60 + minutes) / 1440;
}

export async function attendanceWorkbook({ title, company, date, month, period, columns, rows }) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Attendance', { views: [{ state: 'frozen', ySplit: 4 }] });
  const widths = [18, 32, 26, 14, 14, 16];
  columns.forEach((column, index) => { sheet.getColumn(index + 1).width = column.width ?? widths[index] ?? 14; });
  sheet.addRow([title]).font = { bold: true, size: 15 };
  sheet.mergeCells(1, 1, 1, columns.length);
  sheet.addRow([company]);
  sheet.mergeCells(2, 1, 2, columns.length);
  const periodRow = sheet.addRow(date
    ? ['Date', new Date(date + 'T00:00:00Z'), 'Records', rows.length]
    : month ? ['Month', month, 'Groups', rows.length] : ['Range', period, 'Records', rows.length]);
  if (date) periodRow.getCell(2).numFmt = 'yyyy-mm-dd';
  if (period) {
    periodRow.getCell(2).alignment = { wrapText: true };
    periodRow.height = 30;
  }
  const header = sheet.addRow(columns.map(column => column.header));
  header.font = { bold: true };
  for (const record of rows) {
    const row = sheet.addRow(columns.map(({ key }) => {
      if (key === 'checkInTime' || key === 'checkOutTime') return timeValue(record[key]);
      if (key === 'workDate') return new Date(record[key] + 'T00:00:00Z');
      return record[key];
    }));
    row.alignment = { wrapText: true, vertical: 'top' };
    columns.forEach(({ key }, index) => {
      if (key === 'checkInTime' || key === 'checkOutTime') row.getCell(index + 1).numFmt = 'hh:mm';
      if (key === 'workDate') row.getCell(index + 1).numFmt = 'yyyy-mm-dd';
    });
  }
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: sheet.rowCount, column: columns.length } };
  return workbook.xlsx.writeBuffer();
}

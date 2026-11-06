import { createRequire } from 'node:module';
import PDFDocument from 'pdfkit';

const require = createRequire(import.meta.url);
const font = require.resolve('@expo-google-fonts/noto-sans-ethiopic/400Regular/NotoSansEthiopic_400Regular.ttf');
const MARGIN = 36;
const DAILY_WIDTHS = [73, 144, 118, 58, 58, 72];
const PADDING = 5;

export function attendancePdf({ title, company, date, month, period, asOf, columns, rows }) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, layout: date ? 'portrait' : 'landscape', autoFirstPage: false, info: { Title: title } });
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.once('end', () => resolve(Buffer.concat(chunks)));
    doc.once('error', reject);

    const tableWidth = date ? 523 : 769;
    const weights = date ? DAILY_WIDTHS : columns.map(column => column.width ?? 14);
    const weightTotal = weights.reduce((total, width) => total + width, 0);
    const widths = weights.map(weight => tableWidth * weight / weightTotal);
    let page = 0;
    let y;

    function drawRow(values, heading = false) {
      doc.fontSize(9);
      const options = index => ({ width: widths[index] - 2 * PADDING, lineGap: 1 });
      const height = Math.max(...values.map((value, index) => doc.heightOfString(value, options(index)))) + 2 * PADDING;
      if (!heading && y + height > doc.page.height - MARGIN - 18) addPage();
      if (heading) doc.rect(MARGIN, y, tableWidth, height).fill('#e8edf3');

      let x = MARGIN;
      doc.fillColor('#17212b');
      values.forEach((value, index) => {
        doc.text(value, x + PADDING, y + PADDING, options(index));
        x += widths[index];
      });
      y += height;
      doc.moveTo(MARGIN, y).lineTo(MARGIN + tableWidth, y).lineWidth(0.5).strokeColor('#cdd5df').stroke();
    }

    function addPage() {
      doc.addPage().font(font);
      page += 1;
      doc.fontSize(9).fillColor('#405267').text(`Page ${page}`, MARGIN, doc.page.height - MARGIN - 14, {
        width: tableWidth, align: 'right', lineBreak: false,
      });
      doc.fontSize(11).fillColor('#405267').text(company, MARGIN, MARGIN, { width: tableWidth });
      doc.fontSize(18).fillColor('#17212b').text(title, MARGIN, doc.y + 5, { width: tableWidth });
      doc.fontSize(10).text(date ? `Date: ${date}    Records: ${rows.length}` : month ? `Month: ${month}    Groups: ${rows.length}` : `${period ? `Range: ${period}` : `As of: ${asOf}`}    Records: ${rows.length}`, MARGIN, doc.y + 5, { width: tableWidth });
      y = doc.y + 12;
      drawRow(columns.map(column => column.header), true);
    }

    addPage();
    for (const row of rows) drawRow(columns.map(({ key }) => String(row[key] ?? '')));
    if (!rows.length) doc.fontSize(10).text('No saved records match these filters.', MARGIN, y + 12);
    doc.end();
  });
}

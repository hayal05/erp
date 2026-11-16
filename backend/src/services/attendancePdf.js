import { createRequire } from 'node:module';
import PDFDocument from 'pdfkit';
import { reportPeriod } from './reportExportOverview.js';

const require = createRequire(import.meta.url);
const font = require.resolve('@expo-google-fonts/noto-sans-ethiopic/400Regular/NotoSansEthiopic_400Regular.ttf');
const MARGIN = 36;
const PADDING = 5;
const NAVY = '#18324d';
const MUTED = '#43566b';
const money = new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function attendancePdf(data) {
  const { title, company, date, columns, rows, group, overview, layout = date ? 'portrait' : 'landscape' } = data;
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, layout, autoFirstPage: false,
    info: { Title: title, Author: company, Subject: group } });
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.once('end', () => resolve(Buffer.concat(chunks)));
    doc.once('error', reject);

    const tableWidth = (layout === 'portrait' ? 595.28 : 841.89) - 2 * MARGIN;
    const weights = date && columns.length === 6 ? [73, 144, 118, 58, 58, 72] : columns.map(column => column.width ?? 14);
    const weightTotal = weights.reduce((total, width) => total + width, 0);
    const widths = weights.map(weight => tableWidth * weight / weightTotal);
    const [periodLabel, periodValue] = reportPeriod(data);
    let page = 0;
    let y;
    let tableTop;

    function bottom() {
      return doc.page.height - MARGIN - 22;
    }

    function section(label, entries) {
      if (!entries.length) return;
      doc.fontSize(10).fillColor(NAVY).text(label, MARGIN, doc.y + 7, { width: tableWidth });
      doc.fontSize(9).fillColor(MUTED).text(entries.map(([key, value]) => `${key}: ${value}`).join('  •  '),
        MARGIN, doc.y + 3, { width: tableWidth, lineGap: 2 });
    }

    function addPage(first = false) {
      doc.addPage().font(font);
      page += 1;
      doc.fontSize(8).fillColor(MUTED).text(`Page ${page}`, MARGIN, doc.page.height - MARGIN - 12,
        { width: tableWidth, align: 'right', lineBreak: false });
      doc.rect(MARGIN, MARGIN, tableWidth, 3).fill(NAVY);
      doc.fontSize(10).fillColor(MUTED).text(first && group ? `${company}  /  ${group}` : company,
        MARGIN, MARGIN + 11, { width: tableWidth });
      doc.fontSize(first ? 20 : 14).fillColor(NAVY).text(title, MARGIN, doc.y + 3, { width: tableWidth });
      doc.fontSize(9).fillColor(MUTED).text(`${periodLabel}: ${periodValue}    •    Exported rows: ${rows.length}`,
        MARGIN, doc.y + 4, { width: tableWidth });
      if (first && overview) {
        doc.text(`Generated: ${overview.generated}`, MARGIN, doc.y + 3, { width: tableWidth });
        section('Filters', overview.filterDetails);
        section('Summary of exported records', overview.metrics);
        if (overview.description) section('Methodology', [['Basis', overview.description]]);
      }
      y = doc.y + 13;
      // Keep the table heading with at least one data row on the first page.
      if (first && rows.length && bottom() - y < 105) {
        addPage();
        return;
      }
      drawRow(columns.map(column => column.header), { heading: true });
      tableTop = y;
    }

    function drawRow(values, { heading = false, index = 0 } = {}) {
      doc.fontSize(9);
      const options = i => ({ width: widths[i] - 2 * PADDING, lineGap: 1 });
      const measured = values.map((value, i) => doc.heightOfString(value, options(i)));
      const heightLimit = heading ? Infinity : Math.max(12, bottom() - tableTop - 2 * PADDING);
      const heights = measured.map((height, i) => heading ? height : Math.min(height, heightLimit, columns[i].pdfMaxHeight ?? Infinity));
      const height = Math.max(...heights) + 2 * PADDING;
      if (!heading && y + height > bottom() && y > tableTop) {
        addPage();
        drawRow(values, { index });
        return;
      }
      if (heading || index % 2) doc.rect(MARGIN, y, tableWidth, height).fill(heading ? NAVY : '#f1f5f9');
      let x = MARGIN;
      doc.fillColor(heading ? '#ffffff' : '#17212b');
      values.forEach((value, i) => {
        const cell = options(i);
        if (!heading && (heights[i] < measured[i] || y + height > bottom())) {
          Object.assign(cell, { height: Math.min(heights[i] + 1, bottom() - y - PADDING), ellipsis: true });
        }
        if (!heading && columns[i].type === 'money') cell.align = 'right';
        doc.text(value, x + PADDING, y + PADDING, cell);
        x += widths[i];
      });
      y += height;
    }

    addPage(true);
    rows.forEach((row, index) => drawRow(columns.map(({ key, type }) =>
      type === 'money' && typeof row[key] === 'number' ? money.format(row[key]) : String(row[key] ?? '')), { index }));
    if (!rows.length) doc.fontSize(10).fillColor(MUTED).text('No saved records match these filters.', MARGIN, y + 12);
    doc.end();
  });
}

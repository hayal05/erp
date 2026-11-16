import {
  AlignmentType, Document, Footer, HeadingLevel, Packer, PageNumber, PageOrientation, Paragraph,
  Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType,
} from 'docx';
import { reportPeriod } from './reportExportOverview.js';

const navy = '18324D';
const muted = '43566B';
const tableWidth = 14000;

export function attendanceWord(data) {
  const { title, company, group, count, columns, rows, overview } = data;
  const weights = columns.map(column => column.width ?? 14);
  const weightTotal = weights.reduce((total, width) => total + width, 0);
  const widths = weights.map(weight => Math.floor(tableWidth * weight / weightTotal));
  function row(values, header = false, striped = false) {
    return new TableRow({
      tableHeader: header,
      cantSplit: true,
      children: values.map((value, index) => new TableCell({
        width: { size: widths[index], type: WidthType.DXA },
        margins: { top: 75, bottom: 75, left: 100, right: 100 },
        shading: header ? { fill: navy } : striped ? { fill: 'F1F5F9' } : undefined,
        children: [new Paragraph({ children: [new TextRun({
          text: String(value ?? ''), bold: header, size: 19, color: header ? 'FFFFFF' : navy,
        })] })],
      })),
    });
  }
  const [periodLabel, periodValue] = reportPeriod(data);
  const contents = [
    new Paragraph({ children: [new TextRun({ text: group ? `${company}  /  ${group}` : company, color: muted })] }),
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
    new Paragraph({ text: `${periodLabel}: ${periodValue}    •    ${count === undefined ? 'Exported rows' : 'Matching attendance records'}: ${count ?? rows.length}`, spacing: { after: 100 } }),
  ];
  if (overview) {
    contents.push(new Paragraph({ text: `Generated: ${overview.generated}`, spacing: { after: 100 } }));
    const sections = [['Filters', overview.filterDetails], ['Summary of exported records', overview.metrics],
      ['Methodology', overview.description ? [['Basis', overview.description]] : []]];
    for (const [label, entries] of sections) {
      if (!entries.length) continue;
      contents.push(new Paragraph({ text: label, heading: HeadingLevel.HEADING_2, keepNext: true }));
      contents.push(new Paragraph({ text: entries.map(([key, value]) => `${key}: ${value}`).join('  •  '), spacing: { after: 120 } }));
    }
  }
  if (rows.length) {
    contents.push(new Table({
      width: { size: tableWidth, type: WidthType.DXA },
      columnWidths: widths,
      layout: TableLayoutType.FIXED,
      rows: [row(columns.map(column => column.header), true),
        ...rows.map((record, index) => row(columns.map(column => record[column.key]), false, index % 2 === 1))],
    }));
  } else {
    contents.push(new Paragraph('No saved records match these filters.'));
  }
  return Packer.toBuffer(new Document({
    title,
    creator: company,
    sections: [{
      properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { left: 920, right: 920 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT,
        children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], color: muted, size: 18 })],
      })] }) },
      children: contents,
    }],
  }));
}

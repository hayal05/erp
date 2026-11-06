import {
  Document, HeadingLevel, Packer, PageOrientation, Paragraph,
  Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType,
} from 'docx';

export function attendanceWord({ title, company, month, period, asOf, count, note, columns, rows }) {
  const weights = columns.map(column => column.width ?? 14);
  const weightTotal = weights.reduce((total, width) => total + width, 0);
  const widths = weights.map(weight => Math.floor(14000 * weight / weightTotal));
  function row(values, header = false) {
    return new TableRow({
      tableHeader: header,
      cantSplit: true,
      children: values.map((value, index) => new TableCell({
        width: { size: widths[index], type: WidthType.DXA },
        shading: header ? { fill: 'E8EDF3' } : undefined,
        children: [new Paragraph({ children: [new TextRun({
          text: String(value ?? ''), bold: header, size: 19,
        })] })],
      })),
    });
  }
  const contents = [
    new Paragraph({ text: company }),
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
    new Paragraph({ text: month ? `Month: ${month}    Groups: ${rows.length}` : `${period ? `Range: ${period}` : `As of: ${asOf}`}    Records: ${count ?? rows.length}`, spacing: { after: 180 } }),
  ];
  if (note) contents.push(new Paragraph({ text: note, spacing: { after: 180 } }));
  if (rows.length) {
    contents.push(new Table({
      width: { size: 14000, type: WidthType.DXA },
      columnWidths: widths,
      layout: TableLayoutType.FIXED,
      rows: [row(columns.map(column => column.header), true),
        ...rows.map(record => row(columns.map(column => record[column.key])))],
    }));
  } else {
    contents.push(new Paragraph('No saved records match these filters.'));
  }
  return Packer.toBuffer(new Document({
    title,
    sections: [{
      properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { left: 920, right: 920 } } },
      children: contents,
    }],
  }));
}

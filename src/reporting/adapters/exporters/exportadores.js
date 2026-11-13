import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';

import { DEFINICIONES, seguroExcel, COP } from '../../domain/definicionesReporte.js';

export { DEFINICIONES, seguroExcel };

export async function generarXlsx(tipo, filas) {
  const def = DEFINICIONES[tipo];
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Pastel Stock';
  const ws = wb.addWorksheet(def.titulo.slice(0, 31));
  ws.columns = def.columnas.map(([header, key, fmt]) => ({ header, key, width: Math.max(14, header.length + 4), style: fmt === 'cop' ? { numFmt: '"$"#,##0' } : {} }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8B4513' } };
  for (const f of filas) ws.addRow(Object.fromEntries(def.columnas.map(([, k]) => [k, seguroExcel(f[k])])));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function generarPdf(tipo, filas, { usuarioNombre, fecha }) {
  const def = DEFINICIONES[tipo];
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Pastel Stock - ${def.titulo}`, Author: 'Pastel Stock' } });
    const partes = [];
    doc.on('data', (c) => partes.push(c));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    doc.fontSize(18).fillColor('#6d3610').text('Dulce Hogar · Pastel Stock');
    doc.fontSize(12).fillColor('#1F2937').text(def.titulo);
    doc.fontSize(9).fillColor('#6B7280').text(`Generado el ${fecha} por ${usuarioNombre}`);
    doc.moveDown();

    const ancho = (doc.page.width - 80) / def.columnas.length;
    const pintarFila = (valores, y, cabecera) => {
      if (cabecera) doc.rect(40, y - 3, doc.page.width - 80, 16).fill('#8B4513');
      doc.fillColor(cabecera ? '#FFFFFF' : '#1F2937').fontSize(8.5);
      valores.forEach((v, i) => doc.text(String(v ?? ''), 44 + i * ancho, y, { width: ancho - 6, height: 12, ellipsis: true, lineBreak: false }));
    };
    let y = doc.y;
    pintarFila(def.columnas.map(([h]) => h), y, true);
    y += 18;
    for (const f of filas) {
      if (y > doc.page.height - 60) { doc.addPage(); y = 50; pintarFila(def.columnas.map(([h]) => h), y, true); y += 18; }
      pintarFila(def.columnas.map(([, k, fmt]) => (fmt === 'cop' ? COP.format(f[k]) : f[k])), y, false);
      y += 15;
    }
    if (!filas.length) doc.fillColor('#6B7280').text('Sin registros.', 44, y);
    doc.end();
  });
}

export const TIPOS_CONTENIDO = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

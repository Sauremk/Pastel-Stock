// Exportación PDF / Excel sin servidor: mismas definiciones y mismo formato que el servidor (pdfkit y exceljs),
// usando sus versiones para navegador. Se cargan solo la primera vez que alguien exporta (pesan ≈ 3,5 MB).
import { DEFINICIONES, seguroExcel, COP } from '../src/reporting/domain/definicionesReporte.js';

const cargados = new Map();
function cargarScript(src) {
  if (!cargados.has(src)) {
    cargados.set(src, new Promise((ok, falla) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = () => ok(); s.onerror = () => { cargados.delete(src); falla(new Error('No se pudo cargar el generador de archivos. Revisa tu conexión la primera vez.')); };
      document.head.appendChild(s);
    }));
  }
  return cargados.get(src);
}

async function xlsx(tipo, filas) {
  await cargarScript('vendor/exceljs.min.js');
  const def = DEFINICIONES[tipo];
  const wb = new globalThis.ExcelJS.Workbook();
  wb.creator = 'Pastel Stock';
  const ws = wb.addWorksheet(def.titulo.slice(0, 31));
  ws.columns = def.columnas.map(([header, key, fmt]) => ({ header, key, width: Math.max(14, header.length + 4), style: fmt === 'cop' ? { numFmt: '"$"#,##0' } : {} }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8A3B12' } };
  for (const f of filas) ws.addRow(Object.fromEntries(def.columnas.map(([, k]) => [k, seguroExcel(f[k])])));
  return new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

async function pdf(tipo, filas, { usuarioNombre, fecha }) {
  await cargarScript('vendor/pdfkit.standalone.js');
  const def = DEFINICIONES[tipo];
  return new Promise((resolve, reject) => {
    const doc = new globalThis.PDFDocument({ size: 'A4', margin: 40, info: { Title: `Pastel Stock - ${def.titulo}`, Author: 'Pastel Stock' } });
    const partes = [];
    doc.on('data', (c) => partes.push(c));
    doc.on('end', () => resolve(new Blob(partes, { type: 'application/pdf' })));
    doc.on('error', reject);
    doc.fontSize(18).fillColor('#6E2E0D').text('Dulce Hogar · Pastel Stock');
    doc.fontSize(12).fillColor('#2A1D15').text(def.titulo);
    doc.fontSize(9).fillColor('#6A5B50').text(`Generado el ${fecha} por ${usuarioNombre}`);
    doc.moveDown();
    const ancho = (doc.page.width - 80) / def.columnas.length;
    const pintarFila = (valores, y, cabecera) => {
      if (cabecera) doc.rect(40, y - 3, doc.page.width - 80, 16).fill('#8A3B12');
      doc.fillColor(cabecera ? '#FFFFFF' : '#2A1D15').fontSize(8.5);
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
    if (!filas.length) doc.fillColor('#6A5B50').text('Sin registros.', 44, y);
    doc.end();
  });
}

export const generarArchivo = (tipo, formato, filas, meta) => (formato === 'pdf' ? pdf(tipo, filas, meta) : xlsx(tipo, filas));

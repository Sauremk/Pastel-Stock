import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { crearEntorno } from '../helpers/entorno.js';

let e; let admin; let operador; let contador;
before(async () => { e = await crearEntorno(); admin = await e.como('admin'); operador = await e.como('operador'); contador = await e.como('contador'); });
after(async () => { await e.cerrar(); });

const binario = (res, cb) => { const partes = []; res.on('data', (c) => partes.push(c)); res.on('end', () => cb(null, Buffer.concat(partes))); };

test('dashboard: KPI calculados desde los datos reales (no simulados, DT-10)', async () => {
  const r = await e.api.get('/api/v1/reportes/dashboard').set(operador);
  assert.equal(r.status, 200);
  const d = r.body;
  // Σ stock × costo: 62.500 + 24.000 + 36.000 + 17.000 + 225.000
  assert.equal(d.valorInventarioInsumos, 364500);
  // Entradas demo: 5000×2,5 + 3000×3 + 1×12000 + 1000×8,5
  assert.equal(d.comprasUltimos30Dias, 42000);
  // 8×35.000 + 45×1.500 + 60×800 + 4×28.000
  assert.equal(d.valorProductosTerminados, 507500);
  assert.equal(d.totalIngredientesCriticos, 2);
  assert.deepEqual(d.ingredientesCriticos.map((i) => [i.codigo, i.estado]), [['MP003', 'BAJO'], ['MP004', 'BAJO']]);
  assert.equal(d.productosPorVencer, 3); // vencen en 1, 1 y 2 días
  assert.equal(d.productosVencidos, 0);
  assert.equal(d.comprasUltimos7Dias.length, 7);
  assert.equal(d.comprasUltimos7Dias[0].fecha, '2026-10-31');
  assert.equal(d.comprasUltimos7Dias[6].fecha, '2026-11-06');
  // 31-oct 0 · 1-nov 12.500 (harina) · 2-nov 0 · 3-nov 9.000 (azúcar) · 4-nov 8.500 (mantequilla) · 5-nov 12.000 (huevos) · 6-nov 0
  assert.deepEqual(d.comprasUltimos7Dias.map((x) => x.total), [0, 12500, 0, 9000, 8500, 12000, 0]);
  assert.deepEqual(d.topProductosPorValor.map((p) => p.sku), ['PT001', 'PT004', 'PT002', 'PT003']);
  assert.equal(d.stockPorCategoria.find((c) => c.categoria === 'Saborizantes').valor, 225000);
});

test('dashboard: una entrada nueva se refleja de inmediato en compras y en el valor del inventario', async () => {
  const antes = (await e.api.get('/api/v1/reportes/dashboard').set(admin)).body;
  await e.api.post('/api/v1/movimientos/entradas').set(operador).send({ codigo: 'MP002', cantidad: 1000, proveedor: 'Distribuidora La Esperanza' });
  const despues = (await e.api.get('/api/v1/reportes/dashboard').set(admin)).body;
  assert.equal(despues.comprasUltimos30Dias, antes.comprasUltimos30Dias + 3000);
  assert.equal(despues.valorInventarioInsumos, antes.valorInventarioInsumos + 3000);
  assert.equal(despues.comprasUltimos7Dias[6].total, 3000); // "hoy" = reloj fijo 6-nov
});

test('dashboard: productos vencidos se cuentan cuando pasa la fecha', async () => {
  await e.pool.query("UPDATE productos SET caducidad = '2026-11-05' WHERE sku = 'PT002'");
  const d = (await e.api.get('/api/v1/reportes/dashboard').set(admin)).body;
  assert.equal(d.productosVencidos, 1);
  assert.equal(d.productosPorVencer, 2);
});

test('exportar Excel: archivo .xlsx válido con los datos reales y fórmulas neutralizadas', async () => {
  await e.api.post('/api/v1/materias-primas').set(admin).send({ codigo: 'MP020', nombre: '=HYPERLINK("http://malo.example","clic")', categoria: 'Frutas', unidad: 'g', minimo: 1, costo: 1, stock: 1 });
  const r = await e.api.get('/api/v1/reportes/export?tipo=materias&formato=xlsx').set(contador).buffer(true).parse(binario);
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /spreadsheetml\.sheet/);
  assert.match(r.headers['content-disposition'], /attachment; filename="reporte-materias-2026-11-06\.xlsx"/);
  assert.equal(r.body.subarray(0, 2).toString(), 'PK');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(r.body);
  const ws = wb.worksheets[0];
  assert.deepEqual(ws.getRow(1).values.slice(1), ['Código', 'Nombre', 'Categoría', 'Stock', 'Unidad', 'Mínimo', 'Costo (COP)']);
  assert.equal(ws.getRow(2).getCell(2).value, 'Harina de Trigo');
  const peligrosa = ws.getRow(ws.rowCount).getCell(2).value;
  assert.ok(typeof peligrosa === 'string' && peligrosa.startsWith("'="), `la fórmula debe quedar neutralizada, quedó: ${JSON.stringify(peligrosa)}`);
});

test('exportar PDF de cada tipo: archivo PDF válido', async () => {
  for (const tipo of ['materias', 'productos', 'recetas']) {
    const r = await e.api.get(`/api/v1/reportes/export?tipo=${tipo}&formato=pdf`).set(admin).buffer(true).parse(binario);
    assert.equal(r.status, 200, tipo);
    assert.equal(r.headers['content-type'], 'application/pdf');
    assert.equal(r.body.subarray(0, 5).toString(), '%PDF-');
    assert.ok(r.body.length > 1000);
  }
});

test('exportar: tipo o formato inválidos → 400; operador sin permiso → 403; sin token → 401', async () => {
  assert.equal((await e.api.get('/api/v1/reportes/export?tipo=usuarios&formato=pdf').set(admin)).status, 400);
  assert.equal((await e.api.get('/api/v1/reportes/export?tipo=materias&formato=docx').set(admin)).status, 400);
  assert.equal((await e.api.get('/api/v1/reportes/export?tipo=materias').set(admin)).status, 400);
  assert.equal((await e.api.get('/api/v1/reportes/export?tipo=materias&formato=pdf').set(operador)).status, 403);
  assert.equal((await e.api.get('/api/v1/reportes/export?tipo=materias&formato=pdf')).status, 401);
});

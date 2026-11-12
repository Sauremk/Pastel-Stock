import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearEntorno } from '../helpers/entorno.js';

// v1.1: tablero con ventas reales, costeo de recetas, alertas de caducidad y ajustes por conteo físico.
// Reloj fijo: 06-nov-2026 (Bogotá). Siembra: 6 ventas entre el 31-oct y el 05-nov.
let e; let admin; let operador; let contador;
before(async () => { e = await crearEntorno(); admin = await e.como('admin'); operador = await e.como('operador'); contador = await e.como('contador'); });
after(async () => { await e.cerrar(); });

test('tablero: ventas, costo, margen y ROI de 30 días calculados desde las ventas registradas', async () => {
  const d = (await e.api.get('/api/v1/reportes/dashboard').set(contador)).body;
  // Ventas siembra: 34.000 + 82.000 + 40.000 + 58.000 + 161.000 + 77.500
  assert.equal(d.ventasUltimos30Dias, 452500);
  assert.equal(d.numeroVentasUltimos30Dias, 6);
  // Costos: 13.400 + 23.500 + 16.150 + 18.450 + 51.050 + 26.100
  assert.equal(d.costoVentasUltimos30Dias, 148650);
  assert.equal(d.margenBrutoUltimos30Dias, 303850);
  assert.equal(d.margenPorcentaje30Dias, 67.15); // 303.850 / 452.500
  assert.equal(d.roi30Dias, 204.41); // 303.850 / 148.650
  assert.equal(d.perdidasUltimos30Dias, 0);
  assert.deepEqual(d.ventasUltimos7Dias.map((x) => x.total), [34000, 82000, 40000, 58000, 161000, 77500, 0]);
  assert.equal(d.ventasUltimos7Dias[6].fecha, '2026-11-06');
  assert.deepEqual(d.topProductosVendidos.map((p) => [p.sku, p.unidades, p.total]), [['PT001', 7, 245000], ['PT004', 3, 84000], ['PT002', 45, 67500], ['PT003', 70, 56000]]);
});

test('alertas: por vencer dentro de la ventana, vencidos con stock y su valor en riesgo', async () => {
  await e.api.post('/api/v1/productos').set(admin).send({ sku: 'PT080', nombre: 'Croissant', categoria: 'Panes', stock: 2, precio: 3000, caducidad: '2026-11-01', costoUnitario: 1000 });
  await e.api.post('/api/v1/productos').set(admin).send({ sku: 'PT081', nombre: 'Brownie viejo', categoria: 'Postres', stock: 0, precio: 3000, caducidad: '2026-10-01' });
  const r = await e.api.get('/api/v1/reportes/alertas').set(operador);
  assert.equal(r.status, 200);
  assert.equal(r.body.diasAviso, 3);
  assert.deepEqual(r.body.porVencer.map((p) => [p.sku, p.diasRestantes]), [['PT002', 1], ['PT004', 1], ['PT001', 2]]);
  assert.deepEqual(r.body.vencidos.map((p) => [p.sku, p.diasRestantes, p.valorACosto]), [['PT080', -5, 2000]], 'sin stock no es alerta (PT081)');
  // 45 × 600 + 4 × 11.500 + 8 × 9.350 + 2 × 1.000
  assert.equal(r.body.valorEnRiesgoACosto, 149800);
  assert.deepEqual(r.body.ingredientesCriticos.map((i) => i.codigo), ['MP003', 'MP004']);
  assert.equal(r.body.total, 6);
  const amplia = await e.api.get('/api/v1/reportes/alertas?dias=10').set(operador);
  assert.ok(amplia.body.porVencer.some((p) => p.sku === 'PT003'));
  for (const mal of ['-1', '31', 'abc', '1.5']) assert.equal((await e.api.get(`/api/v1/reportes/alertas?dias=${mal}`).set(operador)).status, 422, mal);
});

test('costeo de receta: costo estándar con conversión de unidades y margen sobre el precio', async () => {
  const r = await e.api.get('/api/v1/recetas/1/costeo').set(contador);
  assert.equal(r.status, 200);
  // 500 g × 2,5 + 300 g × 3 + 4 unid (= 0,333333 docena) × 12.000 + 200 g × 8,5 + 100 g × 15
  assert.equal(r.body.costoUnitario, 9350);
  assert.equal(r.body.margenUnitario, 25650);
  assert.equal(r.body.margenPorcentaje, 73.29);
  const huevos = r.body.ingredientes.find((i) => i.codigoMateriaPrima === 'MP003');
  assert.deepEqual([huevos.cantidadEnUnidadInventario, huevos.unidadInventario, huevos.costo], [0.333333, 'docena', 4000]);
  assert.equal((await e.api.get('/api/v1/recetas/999/costeo').set(contador)).status, 404);
});

test('producir: costea el lote, recalcula el costo promedio ponderado y actualiza la caducidad', async () => {
  // El cacao sube de $15 a $25 por gramo: el lote nuevo cuesta 100 g × 10 más por unidad
  const mp = (await e.api.get('/api/v1/materias-primas/MP005').set(admin)).body;
  await e.api.put('/api/v1/materias-primas/MP005').set(admin).send({ nombre: mp.nombre, categoria: mp.categoria, unidad: mp.unidad, minimo: mp.minimo, costo: 25 });
  const r = await e.api.post('/api/v1/recetas/1/producir').set(operador).send({ unidades: 2, caducidad: '2026-11-10' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.costoLote, 20700);
  assert.equal(r.body.costoUnitarioLote, 10350);
  assert.equal(r.body.costoPromedioProducto, 9550); // (8 × 9.350 + 2 × 10.350) / 10
  assert.equal(r.body.caducidadProducto, '2026-11-10');
  const p = (await e.api.get('/api/v1/productos/PT001').set(admin)).body;
  assert.deepEqual([p.stock, p.costoUnitario, p.caducidad], [10, 9550, '2026-11-10']);
  const k = (await e.api.get('/api/v1/productos/PT001/movimientos').set(admin)).body.datos[0];
  assert.deepEqual([k.tipo, k.cantidad, k.costoUnitario], ['PRODUCCION', 2, 10350]);
});

test('ajuste de materia prima por conteo físico: resta o suma la diferencia y la deja en el kardex con su motivo', async () => {
  // Azúcar: 8.000 g de la siembra − 600 g de la producción anterior = 7.400 g en el sistema; se cuentan 6.900
  const menos = await e.api.post('/api/v1/movimientos/ajustes').set(operador).send({ codigo: 'MP002', stockContado: 6900, motivo: 'MERMA', nota: 'Bolsa rota' });
  assert.equal(menos.status, 201, JSON.stringify(menos.body));
  assert.deepEqual([menos.body.stockAnterior, menos.body.stockNuevo, menos.body.diferencia, menos.body.valorDiferencia], [7400, 6900, -500, -1500]);
  const mov = (await e.api.get('/api/v1/movimientos?codigo=MP002&tipo=AJUSTE_NEGATIVO').set(contador)).body.datos[0];
  assert.deepEqual([mov.tipo, mov.cantidad, mov.motivo, mov.nota], ['AJUSTE_NEGATIVO', 500, 'MERMA', 'Bolsa rota']);

  // Huevos: 3 docenas − 8 unidades producidas = 2,333333 docenas; se cuentan 3 (sobran 8 huevos)
  const mas = await e.api.post('/api/v1/movimientos/ajustes').set(admin).send({ codigo: 'MP003', stockContado: 3, motivo: 'CONTEO_FISICO' });
  assert.deepEqual([mas.body.diferencia, mas.body.stockNuevo, mas.body.valorDiferencia], [0.666667, 3, 8000]);

  const igual = await e.api.post('/api/v1/movimientos/ajustes').set(admin).send({ codigo: 'MP002', stockContado: 6900, motivo: 'CONTEO_FISICO' });
  assert.deepEqual([igual.status, igual.body.diferencia, igual.body.movimientoId], [201, 0, null]);

  for (const mal of [{ codigo: 'MP002', stockContado: -1, motivo: 'MERMA' }, { codigo: 'MP002', stockContado: 1, motivo: 'STOCK_INICIAL' }, { codigo: 'MP002', stockContado: 1 }]) {
    assert.equal((await e.api.post('/api/v1/movimientos/ajustes').set(admin).send(mal)).status, 422, JSON.stringify(mal));
  }
  assert.equal((await e.api.post('/api/v1/movimientos/ajustes').set(admin).send({ codigo: 'MP404', stockContado: 1, motivo: 'MERMA' })).status, 404);
  assert.equal((await e.api.post('/api/v1/movimientos/ajustes').set(contador).send({ codigo: 'MP002', stockContado: 1, motivo: 'MERMA' })).status, 403);

  // Un conteo físico es historial: la materia prima ya no se puede borrar
  await e.api.post('/api/v1/materias-primas').set(admin).send({ codigo: 'MP040', nombre: 'Coco', categoria: 'Frutas', unidad: 'g', minimo: 10, costo: 20, stock: 100 });
  await e.api.post('/api/v1/movimientos/ajustes').set(admin).send({ codigo: 'MP040', stockContado: 90, motivo: 'CONTEO_FISICO' });
  assert.equal((await e.api.delete('/api/v1/materias-primas/MP040').set(admin)).status, 409);
});

test('baja de producto vencido: stock 0 con motivo VENCIMIENTO deja una BAJA y suma a las pérdidas del tablero', async () => {
  const r = await e.api.post('/api/v1/productos/PT080/ajustes').set(operador).send({ stockContado: 0, motivo: 'VENCIMIENTO' });
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.stockAnterior, r.body.stockNuevo, r.body.diferencia, r.body.valorDiferencia], [2, 0, -2, -2000]);
  const k = (await e.api.get('/api/v1/productos/PT080/movimientos').set(admin)).body.datos[0];
  assert.deepEqual([k.tipo, k.cantidad, k.motivo], ['BAJA', 2, 'VENCIMIENTO']);
  const alertas = (await e.api.get('/api/v1/reportes/alertas').set(admin)).body;
  assert.equal(alertas.vencidos.length, 0);
  // Un producto con una baja ya no se puede borrar (es historial)
  assert.equal((await e.api.delete('/api/v1/productos/PT080').set(admin)).status, 409);

  const conteo = await e.api.post('/api/v1/productos/PT003/ajustes').set(admin).send({ stockContado: 62, motivo: 'CONTEO_FISICO' });
  assert.deepEqual([conteo.body.diferencia, (await e.api.get('/api/v1/productos/PT003/movimientos').set(admin)).body.datos[0].tipo], [2, 'AJUSTE']);
  assert.equal((await e.api.post('/api/v1/productos/PT003/ajustes').set(admin).send({ stockContado: 1.5, motivo: 'MERMA' })).status, 422);
  assert.equal((await e.api.post('/api/v1/productos/PT404/ajustes').set(admin).send({ stockContado: 1, motivo: 'MERMA' })).status, 404);

  // Pérdidas: baja 2 × 1.000 + merma de azúcar 500 g × 3 + conteo de coco 10 g × 20 (test anterior). La base fecha los movimientos con
  // su propio reloj; se llevan al "hoy" fijo de las pruebas para que caigan en la ventana de 30 días.
  await e.pool.query("UPDATE movimientos_producto SET creado_en = '2026-11-06T15:00:00Z' WHERE tipo IN ('BAJA','AJUSTE_NEGATIVO')");
  await e.pool.query("UPDATE movimientos SET creado_en = '2026-11-06T15:00:00Z' WHERE tipo = 'AJUSTE_NEGATIVO'");
  assert.equal((await e.api.get('/api/v1/reportes/dashboard').set(admin)).body.perdidasUltimos30Dias, 3700);
});

test('editar el stock directamente queda en el kardex como corrección (DT-22)', async () => {
  const p = (await e.api.get('/api/v1/productos/PT003').set(admin)).body;
  await e.api.put('/api/v1/productos/PT003').set(admin).send({ nombre: p.nombre, categoria: p.categoria, stock: p.stock - 5, precio: p.precio, caducidad: p.caducidad });
  const k = (await e.api.get('/api/v1/productos/PT003/movimientos').set(admin)).body.datos[0];
  assert.deepEqual([k.tipo, k.cantidad, k.motivo], ['AJUSTE_NEGATIVO', 5, 'CORRECCION']);
});

test('rentabilidad: costo de receta o costo promedio, margen y ventas de 30 días por producto', async () => {
  const r = await e.api.get('/api/v1/reportes/rentabilidad').set(contador);
  assert.equal(r.status, 200);
  const por = Object.fromEntries(r.body.datos.map((d) => [d.sku, d]));
  // PT001 con receta: costo estándar con el cacao a $25 → 10.350
  assert.deepEqual([por.PT001.costoReceta, por.PT001.margenUnitario, por.PT001.unidadesVendidas30Dias, por.PT001.ventas30Dias], [10350, 24650, 7, 245000]);
  assert.equal(por.PT001.margen30Dias, 179550); // 7 × (35.000 − 9.350), costo congelado al vender
  // PT002 sin receta: usa el costo promedio registrado
  assert.deepEqual([por.PT002.costoReceta, por.PT002.costoPromedio, por.PT002.margenUnitario, por.PT002.margenPorcentaje], [null, 600, 900, 60]);
  assert.equal((await e.api.get('/api/v1/reportes/rentabilidad').set(operador)).status, 403);
});

test('exportar ventas a Excel (contador)', async () => {
  const r = await e.api.get('/api/v1/reportes/export?tipo=ventas&formato=xlsx').set(contador).buffer(true);
  assert.equal(r.status, 200);
  assert.match(r.headers['content-disposition'], /reporte-ventas-2026-11-06\.xlsx/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costearReceta, margen, costoPromedio } from '../../src/catalog/domain/costeo.js';
import { tipoDeAjuste } from '../../src/inventory/domain/ajustes.js';
import { liquidarVenta, bloqueosDeVenta, validarLineas } from '../../src/sales/domain/venta.js';
import { armarAlertasCaducidad, armarDashboard } from '../../src/reporting/domain/dashboard.js';
import { esBaseNoDisponible } from '../../src/shared/errors.js';
import { registrarMetricasPool } from '../../src/shared/metricas.js';

const MP = new Map([
  ['MP001', { nombre: 'Harina', unidad: 'kg', costo: 2500 }],
  ['MP003', { nombre: 'Huevos', unidad: 'docena', costo: 12000 }],
]);

test('costearReceta convierte cada ingrediente a la unidad de inventario antes de multiplicar por su costo', () => {
  const { costoUnitario, detalle } = costearReceta([
    { codigoMateriaPrima: 'MP001', cantidad: 500, unidad: 'g' }, // 0,5 kg × 2.500
    { codigoMateriaPrima: 'MP003', cantidad: 3, unidad: 'unid' }, // 0,25 docena × 12.000
  ], MP);
  assert.equal(costoUnitario, 4250);
  assert.deepEqual(detalle.map((d) => [d.cantidadEnUnidadInventario, d.costo]), [[0.5, 1250], [0.25, 3000]]);
  assert.throws(() => costearReceta([{ codigoMateriaPrima: 'MP009', cantidad: 1, unidad: 'g' }], MP), /MP009/);
  assert.throws(() => costearReceta([{ codigoMateriaPrima: 'MP003', cantidad: 1, unidad: 'g' }], MP), /incompatibles/i);
});

test('margen: bruto sobre el precio; null si el precio es 0', () => {
  assert.deepEqual(margen(35000, 9350), { margenUnitario: 25650, margenPorcentaje: 73.29 });
  assert.deepEqual(margen(0, 100), { margenUnitario: -100, margenPorcentaje: null });
  assert.deepEqual(margen(1000, 1200), { margenUnitario: -200, margenPorcentaje: -20 });
});

test('costoPromedio pondera el lote nuevo con lo que había; sin stock o sin costo previo, es el del lote', () => {
  assert.equal(costoPromedio({ stockAnterior: 8, costoAnterior: 9350, unidades: 2, costoLote: 20700 }), 9550);
  assert.equal(costoPromedio({ stockAnterior: 0, costoAnterior: 9350, unidades: 4, costoLote: 40000 }), 10000);
  assert.equal(costoPromedio({ stockAnterior: 10, costoAnterior: 0, unidades: 4, costoLote: 40000 }), 10000);
});

test('tipoDeAjuste: sobrante → AJUSTE, faltante → AJUSTE_NEGATIVO, igual → null (6 decimales)', () => {
  assert.deepEqual(tipoDeAjuste(10, 12.5), { tipo: 'AJUSTE', cantidad: 2.5 });
  assert.deepEqual(tipoDeAjuste(2.333333, 2), { tipo: 'AJUSTE_NEGATIVO', cantidad: 0.333333 });
  assert.equal(tipoDeAjuste(5, 5), null);
  assert.equal(tipoDeAjuste(5, 5.0000001), null);
});

test('liquidarVenta congela precio (de lista o pactado) y costo, y suma total, costo y margen', () => {
  const productos = new Map([['PT001', { sku: 'PT001', nombre: 'Pastel', precio: 35000, costoUnitario: 9350 }], ['PT003', { sku: 'PT003', nombre: 'Galletas', precio: 800, costoUnitario: 310 }]]);
  const r = liquidarVenta([{ sku: 'PT001', cantidad: 1 }, { sku: 'PT003', cantidad: 3, precioUnitario: 700 }], productos);
  assert.deepEqual([r.total, r.costoTotal, r.margen], [37100, 10280, 26820]);
  assert.deepEqual(r.lineas.map((l) => [l.precioUnitario, l.subtotal]), [[35000, 35000], [700, 2100]]);
});

test('bloqueosDeVenta detecta faltantes y vencidos (la caducidad de hoy todavía se vende)', () => {
  const productos = new Map([['PT1', { sku: 'PT1', stock: 2, caducidad: '2026-11-06' }], ['PT2', { sku: 'PT2', stock: 9, caducidad: '2026-11-05' }]]);
  const { faltantes, vencidos } = bloqueosDeVenta([{ sku: 'PT1', cantidad: 3 }, { sku: 'PT2', cantidad: 1 }], productos, '2026-11-06');
  assert.deepEqual(faltantes, [{ sku: 'PT1', solicitado: 3, disponible: 2 }]);
  assert.deepEqual(vencidos, [{ sku: 'PT2', caducidad: '2026-11-05' }]);
  assert.throws(() => validarLineas([{ sku: 'PT1' }, { sku: 'PT1' }]), /repetidos/);
});

test('armarAlertasCaducidad separa vencidos de por vencer y valoriza el riesgo', () => {
  const r = armarAlertasCaducidad([
    { sku: 'A', nombre: 'a', categoria: 'Panes', stock: 2, caducidad: '2026-11-01', precio: 1000, costoUnitario: 400, dias: -5 },
    { sku: 'B', nombre: 'b', categoria: 'Panes', stock: 3, caducidad: '2026-11-06', precio: 500, costoUnitario: 100, dias: 0 },
  ]);
  assert.deepEqual(r.vencidos.map((v) => v.sku), ['A']);
  assert.deepEqual(r.porVencer.map((v) => [v.sku, v.valorAPrecio]), [['B', 1500]]);
  assert.equal(r.valorEnRiesgoACosto, 1100);
});

test('armarDashboard sin ventas: margen 0 y porcentajes null (no divide por cero)', () => {
  const d = armarDashboard({ materias: [], valorProductos: 0, compras30: 0, compras7: [], stockPorCategoria: [], topProductos: [], productosPorVencer: 0, productosVencidos: 0 });
  assert.deepEqual([d.ventasUltimos30Dias, d.margenBrutoUltimos30Dias, d.margenPorcentaje30Dias, d.roi30Dias], [0, 0, null, null]);
});

test('DT-20: esBaseNoDisponible reconoce caídas de la base y no confunde errores de datos', () => {
  for (const err of [{ code: 'ECONNREFUSED' }, { code: '57P01' }, { code: '08006' }, { code: '53300' }, new Error('timeout exceeded when trying to connect'),
    new Error('Connection terminated unexpectedly'), { errors: [{ code: 'ECONNREFUSED' }, { code: 'ECONNREFUSED' }], message: '' }]) {
    assert.ok(esBaseNoDisponible(err), JSON.stringify(err) + String(err.message ?? ''));
  }
  for (const err of [{ code: '23505' }, { code: '22P02' }, new Error('Cannot read properties of undefined'), null]) assert.equal(esBaseNoDisponible(err), false);
});

test('DT-15: registrarMetricasPool expone total, en uso, esperando y máximo del pool', () => {
  const observados = {}; let callback;
  const meter = {
    createObservableGauge: (nombre) => ({ nombre }),
    addBatchObservableCallback: (cb) => { callback = cb; },
    removeBatchObservableCallback: () => { callback = null; },
  };
  const pool = { totalCount: 7, idleCount: 2, waitingCount: 3, options: { max: 10 } };
  const m = registrarMetricasPool(pool, meter);
  callback({ observe: (g, v) => { observados[g.nombre] = v; } });
  assert.deepEqual(observados, { pastel_db_pool_total: 7, pastel_db_pool_en_uso: 5, pastel_db_pool_esperando: 3, pastel_db_pool_max: 10 });
  m.detener();
  assert.equal(callback, null);
});

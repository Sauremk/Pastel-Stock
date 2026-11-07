import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertir, sonCompatibles } from '../../src/inventory/domain/unidades.js';
import { estadoStock } from '../../src/inventory/domain/stock.js';
import { armarDashboard, sumarDias, fechaLocal } from '../../src/reporting/domain/dashboard.js';
import { seguroExcel } from '../../src/reporting/adapters/exporters/exportadores.js';
import { traducirErrorPg, AppError } from '../../src/shared/errors.js';
import { abreviarNombre } from '../../src/inventory/adapters/pg/movimientosRepo.js';
import { cargarConfig, validarConfig } from '../../src/config.js';

test('convertir: 4 unid de huevo equivalen a 0,333 docena (DT-09)', () => {
  assert.equal(convertir(4, 'unid', 'docena'), 0.333);
  assert.equal(convertir(500, 'g', 'kg'), 0.5);
  assert.equal(convertir(2, 'L', 'ml'), 2000);
  assert.equal(convertir(3, 'docena', 'unid'), 36);
});

test('convertir: dimensiones distintas lanzan 422', () => {
  assert.throws(() => convertir(1, 'g', 'unid'), (e) => e instanceof AppError && e.status === 422);
  assert.equal(sonCompatibles('g', 'kg'), true);
  assert.equal(sonCompatibles('g', 'ml'), false);
  assert.equal(sonCompatibles('g', 'nada'), false);
});

test('estadoStock reproduce las reglas del MVP (calcularEstado)', () => {
  assert.equal(estadoStock(2500, 5000), 'CRITICO');   // = 50 % del mínimo
  assert.equal(estadoStock(2501, 5000), 'BAJO');
  assert.equal(estadoStock(5000, 5000), 'BAJO');      // = mínimo
  assert.equal(estadoStock(5001, 5000), 'OPTIMO');
  assert.equal(estadoStock(3, 5), 'BAJO');            // Huevos del MVP
  assert.equal(estadoStock(2000, 3000), 'BAJO');      // Mantequilla del MVP
  assert.equal(estadoStock(0, 0), 'CRITICO');
});

test('fechas: sumarDias y fechaLocal no dependen de la zona del servidor', () => {
  assert.equal(sumarDias('2026-11-06', 3), '2026-11-09');
  assert.equal(sumarDias('2026-03-01', -1), '2026-02-28');
  assert.equal(fechaLocal(new Date('2026-11-07T03:00:00Z')), '2026-11-06'); // 22:00 en Bogotá
});

test('armarDashboard calcula KPI reales y filtra solo los ingredientes en riesgo', () => {
  const d = armarDashboard({
    materias: [
      { codigo: 'MP001', nombre: 'Harina', stock: 100, minimo: 10, costo: 2, unidad: 'g' },
      { codigo: 'MP002', nombre: 'Azúcar', stock: 4, minimo: 10, costo: 3, unidad: 'g' },
      { codigo: 'MP003', nombre: 'Sal', stock: 10, minimo: 10, costo: 1, unidad: 'g' },
    ],
    valorProductos: 1234.567, compras30: 99.999, compras7: [{ fecha: '2026-11-06', total: 5.555 }],
    stockPorCategoria: [{ categoria: 'Harinas', valor: 200 }], topProductos: [{ sku: 'PT001', nombre: 'P', valor: 10 }],
    productosPorVencer: 1, productosVencidos: 2,
  });
  assert.equal(d.valorInventarioInsumos, 100 * 2 + 4 * 3 + 10 * 1);
  assert.equal(d.totalIngredientesCriticos, 2);
  assert.deepEqual(d.ingredientesCriticos.map((i) => [i.codigo, i.estado]), [['MP002', 'CRITICO'], ['MP003', 'BAJO']]);
  assert.equal(d.valorProductosTerminados, 1234.57);
  assert.equal(d.comprasUltimos30Dias, 100);
  assert.equal(d.comprasUltimos7Dias[0].total, 5.56);
});

test('seguroExcel neutraliza inyección de fórmulas', () => {
  assert.equal(seguroExcel('=HYPERLINK("http://x")'), '\'=HYPERLINK("http://x")');
  assert.equal(seguroExcel('+cmd'), "'+cmd");
  assert.equal(seguroExcel('Harina'), 'Harina');
  assert.equal(seguroExcel(5), 5);
});

test('traducirErrorPg mapea SQLSTATE a errores de aplicación', () => {
  assert.equal(traducirErrorPg({ code: '23505' }).status, 409);
  assert.equal(traducirErrorPg({ code: '23503' }).status, 409);
  assert.equal(traducirErrorPg({ code: '23514', constraint: 'x' }).status, 422);
  assert.equal(traducirErrorPg({ code: '22P02' }).status, 422);
  const otro = new Error('x');
  assert.equal(traducirErrorPg(otro), otro);
});

test('abreviarNombre no expone el apellido completo', () => {
  assert.equal(abreviarNombre('Carlos López'), 'Carlos L.');
  assert.equal(abreviarNombre('María'), 'María');
  assert.equal(abreviarNombre(null), undefined);
});

test('configuración: falta de secretos detiene el arranque (DT-01)', () => {
  assert.throws(() => validarConfig(cargarConfig({})), /DATABASE_URL/);
  assert.throws(() => validarConfig(cargarConfig({ DATABASE_URL: 'x', JWT_SECRET: 'corto' })), /JWT_SECRET/);
  assert.doesNotThrow(() => validarConfig(cargarConfig({ DATABASE_URL: 'x', JWT_SECRET: 'x'.repeat(32) })));
});

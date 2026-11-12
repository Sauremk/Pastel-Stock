import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  numeroDe, validarMateria, validarProducto, validarEntrada, validarReceta, validarProduccion, validarCredenciales,
} from '../../web/js/validacion.js';

test('numeroDe: acepta coma decimal y rechaza basura', () => {
  assert.equal(numeroDe('1500,5'), 1500.5);
  assert.equal(numeroDe(' 12 '), 12);
  assert.ok(Number.isNaN(numeroDe('')));
  assert.ok(Number.isNaN(numeroDe('abc')));
  assert.ok(Number.isNaN(numeroDe(null)));
});

const materiaOk = { codigo: 'mp006', nombre: 'Harina de almendra', categoria: 'Harinas', unidad: 'g', stock: '1500,5', minimo: '500', costo: '4200' };

test('validarMateria: crear válido normaliza código y conserva decimales (sin parseInt)', () => {
  const r = validarMateria(materiaOk);
  assert.equal(r.valido, true);
  assert.equal(r.datos.codigo, 'MP006');
  assert.equal(r.datos.stock, 1500.5);
});

test('validarMateria: errores por campo', () => {
  const r = validarMateria({ codigo: 'X1', nombre: 'A', categoria: '', unidad: 'tazas', stock: '-1', minimo: '', costo: 'abc' });
  assert.deepEqual(Object.keys(r.errores).sort(), ['categoria', 'codigo', 'costo', 'minimo', 'nombre', 'stock', 'unidad']);
  assert.equal(r.valido, false);
});

test('validarMateria: en edición no exige ni envía código ni stock', () => {
  const r = validarMateria({ nombre: 'Harina', categoria: 'Harinas', unidad: 'kg', minimo: '1', costo: '2' }, { modo: 'editar' });
  assert.equal(r.valido, true);
  assert.equal('codigo' in r.datos, false);
  assert.equal('stock' in r.datos, false);
});

test('validarProducto: stock entero y fecha real', () => {
  const ok = { sku: 'pt005', nombre: 'Red Velvet', categoria: 'Pasteles', stock: '5', precio: '38000', caducidad: '2030-02-28' };
  assert.equal(validarProducto(ok).valido, true);
  assert.equal(validarProducto(ok).datos.sku, 'PT005');
  assert.ok(validarProducto({ ...ok, stock: '2,5' }).errores.stock);
  assert.ok(validarProducto({ ...ok, caducidad: '2030-02-31' }).errores.caducidad);   // 31 de febrero no existe
  assert.ok(validarProducto({ ...ok, caducidad: '' }).errores.caducidad);
  assert.ok(validarProducto({ ...ok, precio: '-1' }).errores.precio);
  assert.ok(validarProducto({ ...ok, sku: 'MP001' }).errores.sku);
});

test('validarEntrada: la cantidad debe ser > 0 (corrige DT-08)', () => {
  const base = { codigo: 'MP004', cantidad: '1500', proveedor: 'Lácteos del Norte', nota: '' };
  assert.equal(validarEntrada(base).valido, true);
  assert.equal(validarEntrada({ ...base, cantidad: '-5' }).errores.cantidad, 'La cantidad debe ser mayor que cero.');
  assert.equal(validarEntrada({ ...base, cantidad: '0' }).errores.cantidad, 'La cantidad debe ser mayor que cero.');
  assert.ok(validarEntrada({ ...base, cantidad: 'x' }).errores.cantidad);
  assert.ok(validarEntrada({ ...base, proveedor: ' ' }).errores.proveedor);
  assert.ok(validarEntrada({ ...base, codigo: '' }).errores.codigo);
  assert.ok(validarEntrada({ ...base, nota: 'n'.repeat(201) }).errores.nota);
  assert.equal('nota' in validarEntrada(base).datos, false);
});

test('validarReceta: ingredientes por código, sin repetidos, cantidades > 0', () => {
  const fila = (c, q = '100', u = 'g') => ({ codigoMateriaPrima: c, cantidad: q, unidad: u });
  const ok = validarReceta({ productoSku: 'PT001', ingredientes: [fila('MP001'), fila('MP002', '2,5', 'kg')] });
  assert.equal(ok.valido, true);
  assert.equal(ok.datos.ingredientes[1].cantidad, 2.5);

  assert.ok(validarReceta({ productoSku: '', ingredientes: [fila('MP001')] }).errores.productoSku);
  assert.ok(validarReceta({ productoSku: 'PT001', ingredientes: [] }).errores.ingredientes);
  const dup = validarReceta({ productoSku: 'PT001', ingredientes: [fila('MP001'), fila('MP001')] });
  assert.match(dup.errores.filas[1].codigoMateriaPrima, /ya está/);
  const mal = validarReceta({ productoSku: 'PT001', ingredientes: [fila('', '0', 'x')] });
  assert.deepEqual(Object.keys(mal.errores.filas[0]).sort(), ['cantidad', 'codigoMateriaPrima', 'unidad']);
  // en edición no se pide productoSku
  assert.equal(validarReceta({ ingredientes: [fila('MP001')] }, { modo: 'editar' }).valido, true);
});

test('validarProduccion: entero entre 1 y 1000', () => {
  assert.equal(validarProduccion({ unidades: '1' }).valido, true);
  assert.equal(validarProduccion({ unidades: '1000' }).valido, true);
  for (const malo of ['0', '1001', '2,5', '', 'x', '-3']) assert.ok(validarProduccion({ unidades: malo }).errores.unidades, malo);
  assert.equal(validarProduccion({ unidades: '3', nota: ' lote 4 ' }).datos.nota, 'lote 4');
});

test('validarCredenciales: mínimos del contrato', () => {
  assert.equal(validarCredenciales({ usuario: 'admin', contrasena: '12345678' }).valido, true);
  assert.ok(validarCredenciales({ usuario: 'ab', contrasena: '12345678' }).errores.usuario);
  assert.ok(validarCredenciales({ usuario: 'admin', contrasena: '1234567' }).errores.contrasena);
  assert.equal(validarCredenciales({ usuario: '  admin  ', contrasena: 'x'.repeat(8) }).datos.usuario, 'admin');
});

test('validarAjuste: stock contado ≥ 0, entero para productos, motivo del catálogo', async () => {
  const { validarAjuste } = await import('../../web/js/validacion.js');
  assert.deepEqual(validarAjuste({ stockContado: '24,5', motivo: 'MERMA', nota: ' bolsa rota ' }).datos, { stockContado: 24.5, motivo: 'MERMA', nota: 'bolsa rota' });
  assert.ok(validarAjuste({ stockContado: '-1', motivo: 'MERMA' }).errores.stockContado);
  assert.ok(validarAjuste({ stockContado: '1.5', motivo: 'MERMA' }, { entero: true }).errores.stockContado);
  assert.ok(validarAjuste({ stockContado: '3', motivo: 'STOCK_INICIAL' }).errores.motivo);
  assert.equal(validarAjuste({ stockContado: '0', motivo: 'VENCIMIENTO' }, { entero: true }).valido, true);
});

test('validarVenta: producto obligatorio y sin repetir, cantidad entera ≤ stock, precio vacío = de lista', async () => {
  const { validarVenta } = await import('../../web/js/validacion.js');
  const stockPorSku = new Map([['PT001', 8], ['PT003', 60]]);
  const ok = validarVenta([{ sku: 'PT001', cantidad: '2', precioUnitario: '' }, { sku: 'PT003', cantidad: '10', precioUnitario: '700' }], { stockPorSku });
  assert.equal(ok.valido, true);
  assert.deepEqual(ok.items, [{ sku: 'PT001', cantidad: 2 }, { sku: 'PT003', cantidad: 10, precioUnitario: 700 }]);
  const mal = validarVenta([{ sku: 'PT001', cantidad: '9' }, { sku: 'PT001', cantidad: '1' }, { sku: '', cantidad: '0' }], { stockPorSku });
  assert.equal(mal.errores.filas[0].cantidad, 'Solo hay 8.');
  assert.match(mal.errores.filas[1].sku, /otra línea/);
  assert.ok(mal.errores.filas[2].sku && mal.errores.filas[2].cantidad);
  assert.ok(validarVenta([]).errores.general);
});

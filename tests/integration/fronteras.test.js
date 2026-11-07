// Guía II-04: casos de frontera y de seguridad del flujo «producir».
// Oráculo (escrito ANTES de ejecutar): producir es posible si y solo si stock >= necesario (la igualdad SÍ alcanza).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearEntorno } from '../helpers/entorno.js';
import { convertir } from '../../src/inventory/domain/unidades.js';

let e; let admin; let operador;
before(async () => { e = await crearEntorno(); admin = await e.como('admin'); operador = await e.como('operador'); });
after(async () => { await e.cerrar(); });

let n = 10; // códigos MP0nn / PT0nn únicos por caso
async function preparar(stock) {
  const i = n++;
  const mp = `MP0${i}`; const sku = `PT0${i}`;
  assert.equal((await e.api.post('/api/v1/materias-primas').set(admin).send({ codigo: mp, nombre: `Insumo ${i}`, categoria: 'Harinas', unidad: 'g', minimo: 100, costo: 1, stock })).status, 201);
  assert.equal((await e.api.post('/api/v1/productos').set(admin).send({ sku, nombre: `Producto ${i}`, categoria: 'Panes', stock: 0, precio: 1000, caducidad: '2026-12-31' })).status, 201);
  const r = await e.api.post('/api/v1/recetas').set(admin).send({ productoSku: sku, ingredientes: [{ codigoMateriaPrima: mp, cantidad: 100, unidad: 'g' }] });
  assert.equal(r.status, 201);
  return { mp, sku, receta: r.body.id };
}
const producir = (cab, receta, cuerpo) => e.api.post(`/api/v1/recetas/${receta}/producir`).set(cab).send(cuerpo);
const stockDe = async (mp) => (await e.api.get(`/api/v1/materias-primas/${mp}`).set(admin)).body.stock;

test('F1 necesario = stock + 100: 409 con faltantes y sin cambios', async () => {
  const { mp, receta } = await preparar(500);
  const r = await producir(operador, receta, { unidades: 6 });
  assert.equal(r.status, 409);
  assert.deepEqual(r.body.faltantes.map((f) => [f.codigoMateriaPrima, f.necesario, f.disponible]), [[mp, 600, 500]]);
  assert.equal(await stockDe(mp), 500);
});

test('F2 necesario = stock EXACTO: 201, stock 0 y estado CRITICO (la igualdad alcanza)', async () => {
  const { mp, receta } = await preparar(500);
  const r = await producir(operador, receta, { unidades: 5 });
  assert.equal(r.status, 201);
  assert.equal(r.body.consumos[0].stockRestante, 0);
  assert.equal(r.body.consumos[0].estado, 'CRITICO');
  assert.equal(await stockDe(mp), 0);
});

test('F3 stock 499,999999 y necesario 500: 409 (distingue un millonésimo, DT-18)', async () => {
  const { mp, receta } = await preparar(499.999999);
  assert.equal((await producir(operador, receta, { unidades: 5 })).status, 409);
  assert.equal(await stockDe(mp), 499.999999);
});

test('F4 stock 500,000001 y necesario 500: 201 y queda 0,000001', async () => {
  const { mp, receta } = await preparar(500.000001);
  assert.equal((await producir(operador, receta, { unidades: 5 })).status, 201);
  assert.equal(await stockDe(mp), 0.000001);
});

test('F5 un usuarioId ajeno en el cuerpo se rechaza (422) y el autor del movimiento es el del token', async () => {
  const { mp, receta } = await preparar(500);
  assert.equal((await producir(operador, receta, { unidades: 1, usuarioId: 1 })).status, 422);
  assert.equal(await stockDe(mp), 500);
  assert.equal((await producir(operador, receta, { unidades: 1 })).status, 201);
  const { rows } = await e.pool.query("SELECT u.usuario FROM movimientos m JOIN usuarios u ON u.id = m.usuario_id WHERE m.materia_prima_codigo = $1 AND m.tipo = 'SALIDA'", [mp]);
  assert.deepEqual(rows.map((x) => x.usuario), ['operador']);
});

test('F6 un token con la firma alterada es 401 y no produce nada', async () => {
  const { mp, receta } = await preparar(500);
  const token = operador.Authorization.replace('Bearer ', '');
  const [h, p, s] = token.split('.');
  const alterado = `${h}.${p}.${s.slice(0, -2)}${s.endsWith('AA') ? 'BB' : 'AA'}`;
  assert.equal((await producir({ Authorization: `Bearer ${alterado}` }, receta, { unidades: 1 })).status, 401);
  assert.equal(await stockDe(mp), 500);
});

test('P1 propiedad (semilla fija): dividir una producción en tandas no cambia el consumo total de huevos', () => {
  let semilla = 42; const azar = () => (semilla = (semilla * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let caso = 0; caso < 200; caso++) {
    const tandas = Array.from({ length: 1 + Math.floor(azar() * 12) }, () => 1 + Math.floor(azar() * 8));
    const total = tandas.reduce((s, x) => s + x, 0);
    const porTandas = tandas.reduce((s, x) => s + convertir(4 * x, 'unid', 'docena'), 0);
    assert.ok(Math.abs(porTandas - convertir(4 * total, 'unid', 'docena')) < 1e-5, `caso ${caso}: ${tandas}`);
  }
});

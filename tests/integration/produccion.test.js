import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearEntorno } from '../helpers/entorno.js';

let e; let admin; let operador; let contador;
before(async () => { e = await crearEntorno(); admin = await e.como('admin'); operador = await e.como('operador'); contador = await e.como('contador'); });
after(async () => { await e.cerrar(); });

const stocks = async () => Object.fromEntries((await e.api.get('/api/v1/materias-primas?limite=100').set(admin)).body.datos.map((m) => [m.codigo, m.stock]));

test('producir 2 pasteles consume los ingredientes (con conversión unid→docena), suma al producto y deja SALIDAs', async () => {
  const antes = await stocks();
  const prodAntes = (await e.api.get('/api/v1/productos/PT001').set(admin)).body.stock;
  const r = await e.api.post('/api/v1/recetas/1/producir').set(operador).send({ unidades: 2 });
  assert.equal(r.status, 201);
  assert.equal(r.body.productoSku, 'PT001');
  assert.equal(r.body.stockProducto, prodAntes + 2);
  const consumo = Object.fromEntries(r.body.consumos.map((c) => [c.codigoMateriaPrima, c.cantidadConsumida]));
  assert.deepEqual(consumo, { MP001: 1000, MP002: 600, MP003: 0.666667, MP004: 400, MP005: 200 }); // 8 unid de huevo = 0,666667 docena (DT-18)
  const despues = await stocks();
  assert.equal(despues.MP001, antes.MP001 - 1000);
  assert.ok(Math.abs(despues.MP003 - (antes.MP003 - 0.666667)) < 0.0000005);
  const salidas = await e.api.get('/api/v1/movimientos?limite=100').set(admin);
  assert.equal(salidas.body.datos.filter((m) => m.tipo === 'SALIDA').length, 5);
});

test('stock insuficiente → 409 con el detalle de faltantes y SIN ningún cambio (transacción atómica)', async () => {
  const antes = await stocks();
  const prodAntes = (await e.api.get('/api/v1/productos/PT001').set(admin)).body.stock;
  const movAntes = (await e.api.get('/api/v1/movimientos?limite=1').set(admin)).body.paginacion.total;
  const r = await e.api.post('/api/v1/recetas/1/producir').set(admin).send({ unidades: 500 });
  assert.equal(r.status, 409);
  assert.ok(r.body.faltantes.length >= 1);
  assert.match(r.body.detail, /se necesitan/);
  assert.deepEqual(await stocks(), antes);
  assert.equal((await e.api.get('/api/v1/productos/PT001').set(admin)).body.stock, prodAntes);
  assert.equal((await e.api.get('/api/v1/movimientos?limite=1').set(admin)).body.paginacion.total, movAntes);
});

test('concurrencia: dos producciones que juntas exceden la mantequilla → una gana y la otra recibe 409; nunca queda negativo', async () => {
  const antes = (await stocks()).MP004; // 1600 g tras la primera prueba; cada unidad usa 200 g
  const unidades = Math.floor(antes / 200 / 2) + 1; // dos de estas no caben juntas
  const [a, b] = await Promise.all([
    e.api.post('/api/v1/recetas/1/producir').set(operador).send({ unidades }),
    e.api.post('/api/v1/recetas/1/producir').set(admin).send({ unidades }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  const despues = (await stocks()).MP004;
  assert.equal(despues, antes - unidades * 200);
  assert.ok(despues >= 0);
});

test('validaciones: unidades 0, negativas, decimales, excesivas o campos extra → 422; receta inexistente → 404', async () => {
  for (const cuerpo of [{ unidades: 0 }, { unidades: -1 }, { unidades: 1.5 }, { unidades: 1001 }, {}, { unidades: 1, extra: true }]) {
    assert.equal((await e.api.post('/api/v1/recetas/1/producir').set(admin).send(cuerpo)).status, 422, JSON.stringify(cuerpo));
  }
  assert.equal((await e.api.post('/api/v1/recetas/999/producir').set(admin).send({ unidades: 1 })).status, 404);
  assert.equal((await e.api.post('/api/v1/recetas/abc/producir').set(admin).send({ unidades: 1 })).status, 422);
});

test('el contador no puede producir (403) y sin token es 401', async () => {
  assert.equal((await e.api.post('/api/v1/recetas/1/producir').set(contador).send({ unidades: 1 })).status, 403);
  assert.equal((await e.api.post('/api/v1/recetas/1/producir').send({ unidades: 1 })).status, 401);
});

test('invariante: tras producir y fallar, stock = Σ kardex en todas las materias primas', async () => {
  const { rows } = await e.pool.query(`
    SELECT m.codigo, m.stock, COALESCE(SUM(CASE WHEN v.tipo = 'SALIDA' THEN -v.cantidad ELSE v.cantidad END), 0) AS kardex
      FROM materias_primas m LEFT JOIN movimientos v ON v.materia_prima_codigo = m.codigo GROUP BY m.codigo, m.stock`);
  for (const r of rows) assert.ok(Math.abs(r.stock - r.kardex) < 0.002, `${r.codigo}: ${r.stock} vs ${r.kardex}`);
});

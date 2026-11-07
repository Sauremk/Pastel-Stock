import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearEntorno } from '../helpers/entorno.js';

let e; let admin; let operador; let contador;
before(async () => { e = await crearEntorno(); admin = await e.como('admin'); operador = await e.como('operador'); contador = await e.como('contador'); });
after(async () => { await e.cerrar(); });

const nueva = (extra = {}) => ({ codigo: 'MP006', nombre: 'Harina de Almendra', categoria: 'Harinas', unidad: 'g', minimo: 1000, costo: 20, stock: 500, ...extra });

test('listado: 5 materias del demo, con estado calculado como en el MVP (Huevos y Mantequilla en BAJO)', async () => {
  const r = await e.api.get('/api/v1/materias-primas').set(admin);
  assert.equal(r.status, 200);
  assert.equal(r.body.paginacion.total, 5);
  const estados = Object.fromEntries(r.body.datos.map((m) => [m.codigo, m.estado]));
  assert.deepEqual(estados, { MP001: 'OPTIMO', MP002: 'OPTIMO', MP003: 'BAJO', MP004: 'BAJO', MP005: 'OPTIMO' });
  assert.equal(typeof r.body.datos[0].stock, 'number'); // NUMERIC llega como número, no como texto
});

test('listado: filtros por texto, categoría y estado, y paginación', async () => {
  const q = await e.api.get('/api/v1/materias-primas?q=hari').set(contador);
  assert.deepEqual(q.body.datos.map((m) => m.codigo), ['MP001']);
  const cat = await e.api.get('/api/v1/materias-primas?categoria=' + encodeURIComponent('Lácteos')).set(contador);
  assert.deepEqual(cat.body.datos.map((m) => m.codigo), ['MP004']);
  const bajo = await e.api.get('/api/v1/materias-primas?estado=BAJO').set(contador);
  assert.deepEqual(bajo.body.datos.map((m) => m.codigo), ['MP003', 'MP004']);
  const pag = await e.api.get('/api/v1/materias-primas?limite=2&pagina=3').set(contador);
  assert.deepEqual(pag.body.datos.map((m) => m.codigo), ['MP005']);
  assert.deepEqual(pag.body.paginacion, { pagina: 3, limite: 2, total: 5 });
});

test('listado: parámetros inválidos → 422', async () => {
  for (const url of ['?pagina=0', '?limite=1000', '?pagina=abc', '?estado=RARO', '?categoria=Zapatos', `?q=${'x'.repeat(61)}`]) {
    const r = await e.api.get(`/api/v1/materias-primas${url}`).set(admin);
    assert.equal(r.status, 422, url);
  }
});

test('búsqueda: un intento de inyección SQL en q es solo texto (DT del ejercicio 3 de la Guía 1)', async () => {
  const r = await e.api.get('/api/v1/materias-primas').query({ q: "x' OR '1'='1" }).set(admin);
  assert.equal(r.status, 200);
  assert.equal(r.body.paginacion.total, 0);
  const r2 = await e.api.get('/api/v1/materias-primas').query({ q: "'; DROP TABLE materias_primas; --" }).set(admin);
  assert.equal(r2.status, 200);
  assert.equal((await e.api.get('/api/v1/materias-primas').set(admin)).body.paginacion.total, 5);
  // los comodines de LIKE se escapan: "%" no equivale a "todo"
  assert.equal((await e.api.get('/api/v1/materias-primas').query({ q: '%' }).set(admin)).body.paginacion.total, 0);
});

test('crear: 201 con Location, stock inicial registrado en el kardex como AJUSTE', async () => {
  const r = await e.api.post('/api/v1/materias-primas').set(admin).send(nueva());
  assert.equal(r.status, 201);
  assert.equal(r.headers.location, '/api/v1/materias-primas/MP006');
  assert.equal(r.body.estado, 'CRITICO'); // 500 = 50 % del mínimo (1000): borde inclusivo, igual que el MVP
});

test('crear: el kardex registra el stock inicial (AJUSTE) con su nota', async () => {
  const r = await e.api.get('/api/v1/materias-primas/MP006').set(admin);
  assert.equal(r.body.estado, 'CRITICO');
  const mov = await e.api.get('/api/v1/movimientos?codigo=MP006').set(admin);
  assert.equal(mov.body.datos.length, 1);
  assert.equal(mov.body.datos[0].tipo, 'AJUSTE');
  assert.equal(mov.body.datos[0].cantidad, 500);
  assert.equal(mov.body.datos[0].nota, 'Stock inicial');
});

test('crear: duplicado → 409; datos inválidos → 422; sin permiso → 403', async () => {
  assert.equal((await e.api.post('/api/v1/materias-primas').set(admin).send(nueva())).status, 409);
  for (const mal of [nueva({ codigo: 'XX1' }), nueva({ stock: -1 }), nueva({ unidad: 'libra' }), nueva({ categoria: 'Zapatos' }), nueva({ nombre: 'A' }), { codigo: 'MP007' }]) {
    assert.equal((await e.api.post('/api/v1/materias-primas').set(admin).send(mal)).status, 422, JSON.stringify(mal));
  }
  assert.equal((await e.api.post('/api/v1/materias-primas').set(operador).send(nueva({ codigo: 'MP099' }))).status, 403);
});

test('XSS: un nombre con HTML se almacena y se devuelve como texto inerte en JSON (DT-03: el front lo pinta con textContent)', async () => {
  const payload = '<img src=x onerror=alert(1)>';
  const r = await e.api.post('/api/v1/materias-primas').set(admin).send(nueva({ codigo: 'MP008', nombre: payload }));
  assert.equal(r.status, 201);
  assert.equal(r.body.nombre, payload);
  assert.match(r.headers['content-type'], /application\/json/);
  await e.api.delete('/api/v1/materias-primas/MP008').set(admin);
});

test('actualizar: no modifica el stock; cambiar la unidad con historial → 422', async () => {
  const antes = (await e.api.get('/api/v1/materias-primas/MP002').set(admin)).body;
  const ok = await e.api.put('/api/v1/materias-primas/MP002').set(admin).send({ nombre: 'Azúcar refinada', categoria: 'Endulzantes', unidad: 'g', minimo: 6000, costo: 3.2 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.stock, antes.stock);
  assert.equal(ok.body.nombre, 'Azúcar refinada');
  const cambioUnidad = await e.api.put('/api/v1/materias-primas/MP002').set(admin).send({ nombre: 'Azúcar refinada', categoria: 'Endulzantes', unidad: 'kg', minimo: 6, costo: 3200 });
  assert.equal(cambioUnidad.status, 422);
  assert.equal((await e.api.put('/api/v1/materias-primas/MP404').set(admin).send({ nombre: 'Nada', categoria: 'Harinas', unidad: 'g', minimo: 1, costo: 1 })).status, 404);
  assert.equal((await e.api.put('/api/v1/materias-primas/MP002').set(admin).send({ nombre: 'Azúcar', categoria: 'Endulzantes', unidad: 'g', minimo: 5000, costo: 3, stock: 99999 })).status, 200); // "stock" extra se ignora
  assert.equal((await e.api.get('/api/v1/materias-primas/MP002').set(admin)).body.stock, antes.stock);
});

test('eliminar: en uso por receta → 409; con historial → 409; sin uso → 204 y luego 404', async () => {
  const enReceta = await e.api.delete('/api/v1/materias-primas/MP001').set(admin);
  assert.equal(enReceta.status, 409);
  assert.match(enReceta.body.title, /receta/);
  await e.api.post('/api/v1/materias-primas').set(admin).send(nueva({ codigo: 'MP010', nombre: 'Esencia de vainilla', categoria: 'Saborizantes', stock: 100 }));
  await e.api.post('/api/v1/movimientos/entradas').set(operador).send({ codigo: 'MP010', cantidad: 10, proveedor: 'Proveedor Uno' });
  const conHistorial = await e.api.delete('/api/v1/materias-primas/MP010').set(admin);
  assert.equal(conHistorial.status, 409);
  assert.match(conHistorial.body.title, /historial/);
  await e.api.post('/api/v1/materias-primas').set(admin).send(nueva({ codigo: 'MP011', nombre: 'Colorante', categoria: 'Saborizantes' }));
  assert.equal((await e.api.delete('/api/v1/materias-primas/MP011').set(admin)).status, 204);
  assert.equal((await e.api.get('/api/v1/materias-primas/MP011').set(admin)).status, 404);
  assert.equal((await e.api.delete('/api/v1/materias-primas/MP011').set(admin)).status, 404);
});

test('entrada: suma stock, deja movimiento y operador puede registrarla', async () => {
  const antes = (await e.api.get('/api/v1/materias-primas/MP004').set(admin)).body.stock;
  const r = await e.api.post('/api/v1/movimientos/entradas').set(operador).send({ codigo: 'MP004', cantidad: 1500, proveedor: 'Lácteos del Norte', nota: 'Pedido semanal' });
  assert.equal(r.status, 201);
  assert.equal(r.body.stock, antes + 1500);
  assert.equal(r.body.estado, 'OPTIMO');
  assert.ok(Number.isInteger(r.body.movimientoId));
  const mov = await e.api.get('/api/v1/movimientos?codigo=MP004&limite=1').set(contador);
  assert.equal(mov.body.datos[0].tipo, 'ENTRADA');
  assert.equal(mov.body.datos[0].registradoPor, 'Carlos L.');
  assert.equal(mov.body.datos[0].proveedor, 'Lácteos del Norte');
  assert.equal(mov.body.datos[0].usuario, undefined);
  assert.equal(mov.body.datos[0].usuarioId, undefined);
});

test('DT-08: una entrada con cantidad negativa, cero o texto ya NO puede restar stock', async () => {
  const antes = (await e.api.get('/api/v1/materias-primas/MP005').set(admin)).body.stock;
  for (const cantidad of [-500, 0, '10', null]) {
    const r = await e.api.post('/api/v1/movimientos/entradas').set(admin).send({ codigo: 'MP005', cantidad, proveedor: 'Proveedor' });
    assert.equal(r.status, 422, String(cantidad));
  }
  assert.equal((await e.api.get('/api/v1/materias-primas/MP005').set(admin)).body.stock, antes);
});

test('entrada: código inexistente → 404; faltan campos / campos extra → 422; contador → 403', async () => {
  assert.equal((await e.api.post('/api/v1/movimientos/entradas').set(admin).send({ codigo: 'MP999', cantidad: 1, proveedor: 'Proveedor' })).status, 404);
  assert.equal((await e.api.post('/api/v1/movimientos/entradas').set(admin).send({ codigo: 'MP001', cantidad: 1 })).status, 422);
  assert.equal((await e.api.post('/api/v1/movimientos/entradas').set(admin).send({ codigo: 'MP001', cantidad: 1, proveedor: 'P', precio: 1 })).status, 422);
  assert.equal((await e.api.post('/api/v1/movimientos/entradas').set(contador).send({ codigo: 'MP001', cantidad: 1, proveedor: 'Proveedor' })).status, 403);
});

test('concurrencia: 25 entradas simultáneas de 10 suman EXACTAMENTE 250 y dejan 25 movimientos', async () => {
  const antes = (await e.api.get('/api/v1/materias-primas/MP001').set(admin)).body.stock;
  const movAntes = (await e.api.get('/api/v1/movimientos?codigo=MP001&limite=100').set(admin)).body.paginacion.total;
  const resultados = await Promise.all(Array.from({ length: 25 }, () => e.api.post('/api/v1/movimientos/entradas').set(operador).send({ codigo: 'MP001', cantidad: 10, proveedor: 'Molinos del Valle' })));
  assert.ok(resultados.every((r) => r.status === 201));
  assert.equal(new Set(resultados.map((r) => r.body.movimientoId)).size, 25);
  assert.equal((await e.api.get('/api/v1/materias-primas/MP001').set(admin)).body.stock, antes + 250);
  assert.equal((await e.api.get('/api/v1/movimientos?codigo=MP001&limite=100').set(admin)).body.paginacion.total, movAntes + 25);
});

test('kardex: filtros por fecha y paginación; fechas inválidas → 422', async () => {
  const todo = await e.api.get('/api/v1/movimientos?limite=100').set(admin);
  const dia = await e.api.get('/api/v1/movimientos?desde=2026-11-01&hasta=2026-11-01').set(admin);
  assert.deepEqual(dia.body.datos.filter((m) => m.codigo === 'MP001').map((m) => m.tipo), ['ENTRADA']); // la entrada demo del 1-nov
  assert.ok(todo.body.paginacion.total > dia.body.paginacion.total);
  assert.equal((await e.api.get('/api/v1/movimientos?desde=ayer').set(admin)).status, 422);
  assert.equal((await e.api.get('/api/v1/movimientos?codigo=XX').set(admin)).status, 422);
});

test('invariante del kardex: para cada materia prima, stock = Σ(ENTRADA + AJUSTE) − Σ SALIDA', async () => {
  const { rows } = await e.pool.query(`
    SELECT m.codigo, m.stock,
           COALESCE(SUM(CASE WHEN v.tipo = 'SALIDA' THEN -v.cantidad ELSE v.cantidad END), 0) AS kardex
      FROM materias_primas m LEFT JOIN movimientos v ON v.materia_prima_codigo = m.codigo GROUP BY m.codigo, m.stock`);
  assert.ok(rows.length >= 5);
  for (const r of rows) assert.ok(Math.abs(r.stock - r.kardex) < 0.0005, `${r.codigo}: stock ${r.stock} ≠ kardex ${r.kardex}`);
});

test('la base impide stock negativo aunque falle la lógica de la aplicación (CHECK)', async () => {
  await assert.rejects(e.pool.query("UPDATE materias_primas SET stock = -1 WHERE codigo = 'MP005'"), (err) => err.code === '23514');
});

test('parámetros de ruta inválidos → 422', async () => {
  assert.equal((await e.api.get('/api/v1/materias-primas/xyz').set(admin)).status, 422);
  assert.equal((await e.api.get('/api/v1/materias-primas/MP1').set(admin)).status, 422);
});

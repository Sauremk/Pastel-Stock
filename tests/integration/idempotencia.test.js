import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearEntorno } from '../helpers/entorno.js';

let e; let admin; let operador;
before(async () => { e = await crearEntorno(); admin = await e.como('admin'); operador = await e.como('operador'); });
after(async () => { await e.cerrar(); });

const producir = (cab, unidades, clave, extra = {}) => {
  let r = e.api.post('/api/v1/recetas/1/producir').set(cab);
  if (clave) r = r.set('Idempotency-Key', clave);
  return r.send({ unidades, ...extra });
};
const stockProducto = async () => (await e.api.get('/api/v1/productos/PT001').set(admin)).body.stock;
const salidas = async () => (await e.api.get('/api/v1/movimientos?limite=100').set(admin)).body.datos.filter((m) => m.tipo === 'SALIDA').length;

test('misma clave y mismo cuerpo: la segunda petición repite la respuesta y NO vuelve a producir', async () => {
  const antes = await stockProducto(); const sAntes = await salidas();
  const a = await producir(operador, 1, 'clave-prueba-0001');
  const b = await producir(operador, 1, 'clave-prueba-0001');
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.equal(a.headers['idempotency-replayed'], 'false');
  assert.equal(b.headers['idempotency-replayed'], 'true');
  assert.deepEqual(b.body, a.body);
  assert.equal(await stockProducto(), antes + 1);   // una sola producción
  assert.equal(await salidas(), sAntes + 5);        // cinco SALIDAs, no diez
});

test('misma clave con OTRO cuerpo → 422 y sin efectos', async () => {
  const antes = await stockProducto();
  const r = await producir(operador, 2, 'clave-prueba-0001');
  assert.equal(r.status, 422);
  assert.equal(await stockProducto(), antes);
});

test('dos peticiones simultáneas con la misma clave producen UNA sola vez', async () => {
  const antes = await stockProducto();
  const [a, b] = await Promise.all([producir(operador, 1, 'clave-concurrente-1'), producir(operador, 1, 'clave-concurrente-1')]);
  assert.deepEqual([a.status, b.status], [201, 201]);
  assert.deepEqual([a.headers['idempotency-replayed'], b.headers['idempotency-replayed']].sort(), ['false', 'true']);
  assert.equal(await stockProducto(), antes + 1);
});

test('una producción fallida (409) NO consume la clave: se puede reintentar con ella', async () => {
  const antes = await stockProducto();
  const fallo = await producir(operador, 1000, 'clave-reintento-01');
  assert.equal(fallo.status, 409);
  const ok = await producir(operador, 1, 'clave-reintento-01');
  assert.equal(ok.status, 201);
  assert.equal(ok.headers['idempotency-replayed'], 'false');
  assert.equal(await stockProducto(), antes + 1);
});

test('la clave es por usuario: otro usuario puede usar la misma clave', async () => {
  const antes = await stockProducto();
  const r = await producir(admin, 1, 'clave-prueba-0001');
  assert.equal(r.status, 201);
  assert.equal(r.headers['idempotency-replayed'], 'false');
  assert.equal(await stockProducto(), antes + 1);
});

test('sin clave el comportamiento no cambia: cada petición produce (política documentada)', async () => {
  const antes = await stockProducto();
  assert.equal((await producir(operador, 1)).status, 201);
  assert.equal((await producir(operador, 1)).status, 201);
  assert.equal(await stockProducto(), antes + 2);
  assert.equal((await producir(operador, 1)).headers['idempotency-replayed'], undefined);
});

test('clave con formato inválido → 422', async () => {
  for (const clave of ['corta', 'tiene espacios en medio', 'x'.repeat(65), 'caracter-inválido-ñ1']) {
    assert.equal((await producir(operador, 1, clave)).status, 422, clave);
  }
});

test('invariante: tras reintentos y fallos, stock = Σ kardex en todas las materias primas', async () => {
  const { rows } = await e.pool.query(`SELECT m.codigo, m.stock,
    COALESCE(SUM(CASE WHEN x.tipo = 'SALIDA' THEN -x.cantidad ELSE x.cantidad END), 0) AS kardex
    FROM materias_primas m LEFT JOIN movimientos x ON x.materia_prima_codigo = m.codigo GROUP BY m.codigo, m.stock`);
  assert.ok(rows.length >= 5);
  for (const r of rows) assert.ok(Math.abs(Number(r.kardex) - Number(r.stock)) < 1e-5, `${r.codigo}: kardex ${r.kardex} vs stock ${r.stock}`);
});

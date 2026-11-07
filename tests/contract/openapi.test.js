import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearEntorno } from '../helpers/entorno.js';
import { validadorRespuesta, contrato, operaciones } from '../helpers/contrato.js';

let e; let admin; let operador;
before(async () => { e = await crearEntorno(); admin = await e.como('admin'); operador = await e.como('operador'); });
after(async () => { await e.cerrar(); });

function cumple(ruta, metodo, estado, cuerpo, tipo) {
  const v = validadorRespuesta(ruta, metodo, estado, tipo);
  assert.ok(v(cuerpo), `${metodo.toUpperCase()} ${ruta} → ${estado} no cumple el contrato: ${JSON.stringify(v.errors?.slice(0, 3))}\ncuerpo: ${JSON.stringify(cuerpo).slice(0, 300)}`);
}

test('el contrato OpenAPI es 3.1 y declara seguridad global bearerAuth con excepciones explícitas', () => {
  assert.match(contrato.openapi, /^3\.1/);
  assert.deepEqual(contrato.security, [{ bearerAuth: [] }]);
  const publicas = operaciones().filter(({ op }) => Array.isArray(op.security) && op.security.length === 0).map(({ ruta }) => ruta).sort();
  assert.deepEqual(publicas, ['/auth/login', '/auth/refresh', '/health']);
});

test('toda operación tiene operationId único y declara x-roles si es protegida', () => {
  const ids = operaciones().map(({ op }) => op.operationId);
  assert.equal(new Set(ids).size, ids.length);
  for (const { ruta, metodo, op } of operaciones()) {
    const publica = Array.isArray(op.security) && op.security.length === 0;
    if (!publica) assert.ok(Array.isArray(op['x-roles']) && op['x-roles'].length, `${metodo} ${ruta} sin x-roles`);
  }
});

test('las respuestas REALES cumplen el esquema del contrato (contract testing)', async () => {
  const get = async (url, h = admin) => (await e.api.get(url).set(h));
  cumple('/health', 'get', 200, (await e.api.get('/api/v1/health')).body);

  const login = await e.api.post('/api/v1/auth/login').send({ usuario: 'admin', contrasena: 'Clave-Admin-1' });
  cumple('/auth/login', 'post', 200, login.body);
  const refresh = await e.api.post('/api/v1/auth/refresh').send({ refreshToken: login.body.refreshToken });
  cumple('/auth/refresh', 'post', 200, refresh.body);

  cumple('/materias-primas', 'get', 200, (await get('/api/v1/materias-primas')).body);
  cumple('/materias-primas/{codigo}', 'get', 200, (await get('/api/v1/materias-primas/MP003')).body);
  const creada = await e.api.post('/api/v1/materias-primas').set(admin).send({ codigo: 'MP030', nombre: 'Nueces', categoria: 'Frutas', unidad: 'g', minimo: 100, costo: 30, stock: 400 });
  cumple('/materias-primas', 'post', 201, creada.body);
  const put = await e.api.put('/api/v1/materias-primas/MP030').set(admin).send({ nombre: 'Nueces picadas', categoria: 'Frutas', unidad: 'g', minimo: 100, costo: 31 });
  cumple('/materias-primas/{codigo}', 'put', 200, put.body);

  const entrada = await e.api.post('/api/v1/movimientos/entradas').set(operador).send({ codigo: 'MP030', cantidad: 50, proveedor: 'Frutos Secos SAS', nota: 'prueba' });
  cumple('/movimientos/entradas', 'post', 201, entrada.body);
  cumple('/movimientos', 'get', 200, (await get('/api/v1/movimientos?limite=100')).body);

  cumple('/productos', 'get', 200, (await get('/api/v1/productos')).body);
  cumple('/productos/{sku}', 'get', 200, (await get('/api/v1/productos/PT001')).body);
  const prod = await e.api.post('/api/v1/productos').set(admin).send({ sku: 'PT009', nombre: 'Brownie', categoria: 'Postres', stock: 4, precio: 6000, caducidad: '2026-11-12' });
  cumple('/productos', 'post', 201, prod.body);

  cumple('/recetas', 'get', 200, (await get('/api/v1/recetas')).body);
  cumple('/recetas/{id}', 'get', 200, (await get('/api/v1/recetas/1')).body);
  const rec = await e.api.post('/api/v1/recetas').set(admin).send({ productoSku: 'PT009', ingredientes: [{ codigoMateriaPrima: 'MP005', cantidad: 50, unidad: 'g' }] });
  cumple('/recetas', 'post', 201, rec.body);
  cumple('/recetas/{id}', 'put', 200, (await e.api.put(`/api/v1/recetas/${rec.body.id}`).set(admin).send({ ingredientes: [{ codigoMateriaPrima: 'MP005', cantidad: 60, unidad: 'g' }] })).body);
  cumple('/recetas/{id}/producir', 'post', 201, (await e.api.post(`/api/v1/recetas/${rec.body.id}/producir`).set(operador).send({ unidades: 2 })).body);

  cumple('/reportes/dashboard', 'get', 200, (await get('/api/v1/reportes/dashboard')).body);
});

test('los errores REALES cumplen el esquema Problema (application/problem+json)', async () => {
  const P = 'application/problem+json';
  cumple('/auth/login', 'post', 401, (await e.api.post('/api/v1/auth/login').send({ usuario: 'admin', contrasena: 'mala-clave-1' })).body, P);
  cumple('/auth/login', 'post', 400, (await e.api.post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{')).body, P);
  cumple('/materias-primas', 'get', 401, (await e.api.get('/api/v1/materias-primas')).body, P);
  cumple('/materias-primas', 'post', 403, (await e.api.post('/api/v1/materias-primas').set(operador).send({})).body, P);
  cumple('/materias-primas/{codigo}', 'get', 404, (await e.api.get('/api/v1/materias-primas/MP404').set(admin)).body, P);
  cumple('/materias-primas', 'post', 409, (await e.api.post('/api/v1/materias-primas').set(admin).send({ codigo: 'MP001', nombre: 'Repetida', categoria: 'Harinas', unidad: 'g', minimo: 1, costo: 1, stock: 1 })).body, P);
  cumple('/movimientos/entradas', 'post', 422, (await e.api.post('/api/v1/movimientos/entradas').set(admin).send({ codigo: 'MP001', cantidad: -5, proveedor: 'Proveedor' })).body, P);
  cumple('/recetas/{id}/producir', 'post', 409, (await e.api.post('/api/v1/recetas/1/producir').set(admin).send({ unidades: 900 })).body, P);
});

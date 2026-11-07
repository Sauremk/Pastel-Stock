import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearAuth } from '../../web/js/auth.js';
import { crearApi } from '../../web/js/api.js';
import { ApiError } from '../../web/js/format.js';

const respuesta = (status, cuerpo, cabeceras = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => cabeceras[k.toLowerCase()] ?? null },
  json: async () => { if (cuerpo === undefined) throw new Error('sin cuerpo'); return cuerpo; },
  blob: async () => ({ tamano: 3, tipo: 'application/pdf' }),
});
const par = (n, rol = 'admin') => ({ accessToken: `acc${n}`, refreshToken: `ref${n}`, expiraEn: 900, rol, nombre: 'Ana García' });
const almacen = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), _m: m }; };

test('auth: access token solo en memoria; refresh token en sessionStorage', async () => {
  const storage = almacen();
  const auth = crearAuth({ storage, fetchImpl: async () => respuesta(200, par(1)) });
  const u = await auth.iniciarSesion('admin', 'clave-larga-1');
  assert.deepEqual(u, { nombre: 'Ana García', rol: 'admin' });
  assert.equal(auth.token(), 'acc1');
  assert.equal(storage.getItem('ps.refresh'), 'ref1');
  assert.deepEqual([...storage._m.values()].includes('acc1'), false); // el access token nunca se persiste
  auth.cerrarSesion();
  assert.equal(auth.token(), null);
  assert.equal(storage.getItem('ps.refresh'), null);
});

test('auth: login fallido propaga el título problem+json y el Retry-After del 429', async () => {
  const a1 = crearAuth({ storage: almacen(), fetchImpl: async () => respuesta(401, { title: 'Usuario o contraseña incorrectos' }) });
  await assert.rejects(() => a1.iniciarSesion('x', 'y'), (e) => e instanceof ApiError && e.status === 401 && /incorrectos/.test(e.message));
  const a2 = crearAuth({ storage: almacen(), fetchImpl: async () => respuesta(429, { title: 'Demasiados intentos' }, { 'retry-after': '60' }) });
  await assert.rejects(() => a2.iniciarSesion('x', 'y'), /Reintenta en 60 s/);
});

test('auth: renovar es de una sola vez aunque se llame en paralelo (el servidor rota el refresh)', async () => {
  const storage = almacen(); storage.setItem('ps.refresh', 'ref0');
  let llamadas = 0;
  const auth = crearAuth({ storage, fetchImpl: async (url, init) => { llamadas += 1; assert.match(url, /\/auth\/refresh$/); assert.equal(JSON.parse(init.body).refreshToken, 'ref0'); return respuesta(200, par(2)); } });
  await Promise.all([auth.renovar(), auth.renovar(), auth.renovar()]);
  assert.equal(llamadas, 1);
  assert.equal(auth.token(), 'acc2');
  assert.equal(storage.getItem('ps.refresh'), 'ref2');
});

test('auth: restaurar — sin refresh no hace nada; 401 limpia; corte de red conserva el refresh', async () => {
  const vacio = crearAuth({ storage: almacen(), fetchImpl: async () => { throw new Error('no debe llamarse'); } });
  assert.equal(await vacio.restaurar(), false);

  const s1 = almacen(); s1.setItem('ps.refresh', 'viejo');
  const rechazado = crearAuth({ storage: s1, fetchImpl: async () => respuesta(401, { title: 'Refresh inválido' }) });
  assert.equal(await rechazado.restaurar(), false);
  assert.equal(s1.getItem('ps.refresh'), null);

  const s2 = almacen(); s2.setItem('ps.refresh', 'vigente');
  const sinRed = crearAuth({ storage: s2, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.equal(await sinRed.restaurar(), false);
  assert.equal(s2.getItem('ps.refresh'), 'vigente');

  const s3 = almacen(); s3.setItem('ps.refresh', 'bueno');
  const ok = crearAuth({ storage: s3, fetchImpl: async () => respuesta(200, par(3, 'contador')) });
  assert.equal(await ok.restaurar(), true);
  assert.equal(ok.usuario().rol, 'contador');
});

test('auth: puede() — permisos de interfaz por rol', async () => {
  const con = async (rol) => { const a = crearAuth({ storage: almacen(), fetchImpl: async () => respuesta(200, par(1, rol)) }); await a.iniciarSesion('u', 'p'); return a; };
  const admin = await con('admin'); const op = await con('operador'); const cont = await con('contador');
  assert.deepEqual([admin.puede('catalogo'), admin.puede('movimientos'), admin.puede('reportes')], [true, true, true]);
  assert.deepEqual([op.puede('catalogo'), op.puede('movimientos'), op.puede('producir'), op.puede('reportes')], [false, true, true, false]);
  assert.deepEqual([cont.puede('catalogo'), cont.puede('movimientos'), cont.puede('reportes')], [false, false, true]);
  assert.equal(admin.puede('inexistente'), false);
  assert.equal(crearAuth({ storage: almacen() }).puede('catalogo'), false); // sin sesión
});

function entorno(respuestas) {
  const storage = almacen(); storage.setItem('ps.refresh', 'ref0');
  const llamadas = [];
  const cola = [...respuestas];
  const fetchImpl = async (url, init = {}) => { llamadas.push({ url, init }); const r = cola.shift(); if (r instanceof Error) throw r; return r; };
  const auth = crearAuth({ storage, fetchImpl });
  let expirada = 0;
  const api = crearApi({ auth, fetchImpl, alSesionExpirada: () => { expirada += 1; } });
  return { auth, api, llamadas, storage, expiradas: () => expirada };
}

test('api: envía Bearer y arma la consulta omitiendo vacíos', async () => {
  const e = entorno([respuesta(200, par(1)), respuesta(200, { datos: [], paginacion: { pagina: 1, limite: 20, total: 0 } })]);
  await e.auth.iniciarSesion('a', 'b');
  const r = await e.api.get('/materias-primas', { pagina: 1, q: '', categoria: 'Harinas' });
  assert.equal(r.paginacion.total, 0);
  const { url, init } = e.llamadas[1];
  assert.equal(url, '/api/v1/materias-primas?pagina=1&categoria=Harinas');
  assert.equal(init.headers.Authorization, 'Bearer acc1');
  assert.equal(init.method, 'GET');
});

test('api: 401 → renueva el token y reintenta UNA vez', async () => {
  const e = entorno([respuesta(200, par(1)), respuesta(401, { title: 'Token vencido' }), respuesta(200, par(2)), respuesta(200, { ok: true })]);
  await e.auth.iniciarSesion('a', 'b');
  assert.deepEqual(await e.api.get('/reportes/dashboard'), { ok: true });
  assert.equal(e.llamadas.length, 4);
  assert.match(e.llamadas[2].url, /\/auth\/refresh$/);
  assert.equal(e.llamadas[3].init.headers.Authorization, 'Bearer acc2');
  assert.equal(e.expiradas(), 0);
});

test('api: si el refresh también falla cierra la sesión y avisa', async () => {
  const e = entorno([respuesta(200, par(1)), respuesta(401, {}), respuesta(401, { title: 'Refresh usado' })]);
  await e.auth.iniciarSesion('a', 'b');
  await assert.rejects(() => e.api.get('/productos'), (err) => err instanceof ApiError && err.status === 401);
  assert.equal(e.expiradas(), 1);
  assert.equal(e.auth.token(), null);
  assert.equal(e.storage.getItem('ps.refresh'), null);
});

test('api: un segundo 401 tras renovar no entra en bucle', async () => {
  const e = entorno([respuesta(200, par(1)), respuesta(401, {}), respuesta(200, par(2)), respuesta(401, { title: 'Sigue sin permiso' })]);
  await e.auth.iniciarSesion('a', 'b');
  await assert.rejects(() => e.api.get('/productos'), /Sigue sin permiso/);
  assert.equal(e.llamadas.length, 4);
  assert.equal(e.expiradas(), 1);
});

test('api: sin red lanza ApiError(0) y NO cierra la sesión', async () => {
  const e = entorno([respuesta(200, par(1)), new TypeError('Failed to fetch')]);
  await e.auth.iniciarSesion('a', 'b');
  await assert.rejects(() => e.api.get('/productos'), (err) => err.status === 0 && /conexión/.test(err.message));
  assert.equal(e.auth.token(), 'acc1');
  assert.equal(e.expiradas(), 0);
});

test('api: errores problem+json (409/422) llegan con título y detalle', async () => {
  const e = entorno([respuesta(200, par(1)), respuesta(409, { title: 'Stock insuficiente', detail: 'No alcanza: Huevos.', status: 409 })]);
  await e.auth.iniciarSesion('a', 'b');
  await assert.rejects(() => e.api.post('/recetas/1/producir', { unidades: 1000 }), (err) => err.status === 409 && err.message === 'Stock insuficiente. No alcanza: Huevos.');
});

test('api: POST con JSON, 204 sin cuerpo y descarga de archivos', async () => {
  const e = entorno([respuesta(200, par(1)), respuesta(201, { codigo: 'MP004' }), respuesta(204), respuesta(200, undefined, { 'content-disposition': 'attachment; filename="r.pdf"' })]);
  await e.auth.iniciarSesion('a', 'b');
  assert.deepEqual(await e.api.post('/movimientos/entradas', { codigo: 'MP004', cantidad: 5, proveedor: 'X' }), { codigo: 'MP004' });
  assert.equal(e.llamadas[1].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(e.llamadas[1].init.body), { codigo: 'MP004', cantidad: 5, proveedor: 'X' });
  assert.equal(await e.api.del('/productos/PT001'), null);
  const f = await e.api.descargar('/reportes/export', { tipo: 'materias', formato: 'pdf' });
  assert.equal(f.nombre, 'r.pdf');
  assert.equal(f.blob.tipo, 'application/pdf');
  assert.match(e.llamadas[3].url, /tipo=materias&formato=pdf$/);
});

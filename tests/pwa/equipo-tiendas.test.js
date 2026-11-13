// App sin servidor (v1.5, ADR-19): equipo con las mismas reglas que el servidor Node y tiendas nuevas vacías.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { crearServidorLocal, hashClave } from '../../pwa/servidor.js';
import { CLAVE_DEMO, crearDatosTienda } from '../../pwa/semilla.js';

const AHORA = new Date('2026-11-06T15:00:00Z');
const memoria = (t = null) => ({ leer: () => t, guardar: (x) => { t = x; } });
let srv;

const cliente = (s) => async (metodo, ruta, { cuerpo, token } = {}) => {
  const r = await s.fetch(`/api/v1${ruta}`, { method: metodo, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const texto = r.status === 204 ? '' : await r.text();
  return { status: r.status, body: texto ? JSON.parse(texto) : null };
};
let llamar;
const entrar = async (usuario, contrasena = CLAVE_DEMO) => (await llamar('POST', '/auth/login', { cuerpo: { usuario, contrasena } })).body;

beforeEach(() => { srv = crearServidorLocal({ almacen: memoria(), reloj: () => AHORA }); llamar = cliente(srv); });

test('demo: el login trae usuario y tienda; solo el admin ve el equipo', async () => {
  const a = await entrar('admin');
  assert.equal(a.usuario, 'admin');
  assert.equal(a.tienda, 'Dulce Hogar');
  const lista = await llamar('GET', '/usuarios', { token: a.accessToken });
  assert.equal(lista.status, 200);
  assert.equal(lista.body.datos.length, 3);
  assert.ok(lista.body.datos.every((u) => u.activo === true && u.hash === undefined && u.sal === undefined));
  assert.equal((await llamar('GET', '/usuarios', { token: (await entrar('operador')).accessToken })).status, 403);
});

test('agregar, desactivar (cierra su sesión), reactivar y restablecer contraseña', async () => {
  const a = (await entrar('admin')).accessToken;
  const nuevo = await llamar('POST', '/usuarios', { token: a, cuerpo: { usuario: 'Maria.P', nombre: 'María Pérez', rol: 'operador', contrasena: 'Clave-Maria-1' } });
  assert.equal(nuevo.status, 201);
  assert.equal(nuevo.body.usuario, 'maria.p');
  assert.equal((await llamar('POST', '/usuarios', { token: a, cuerpo: { usuario: 'maria.p', nombre: 'Otra', rol: 'operador', contrasena: 'Clave-Otra-1' } })).status, 409);
  assert.equal((await llamar('POST', '/usuarios', { token: a, cuerpo: { usuario: 'con espacio', nombre: 'X', rol: 'operador', contrasena: 'Clave-1234' } })).status, 422);

  const sesion = await entrar('maria.p', 'Clave-Maria-1');
  assert.equal((await llamar('GET', '/productos', { token: sesion.accessToken })).status, 200);
  assert.equal((await llamar('PATCH', `/usuarios/${nuevo.body.id}`, { token: a, cuerpo: { activo: false } })).status, 200);
  assert.equal((await llamar('GET', '/productos', { token: sesion.accessToken })).status, 401, 'la sesión abierta se cierra');
  assert.equal((await llamar('POST', '/auth/refresh', { cuerpo: { refreshToken: sesion.refreshToken } })).status, 401);
  assert.equal((await llamar('POST', '/auth/login', { cuerpo: { usuario: 'maria.p', contrasena: 'Clave-Maria-1' } })).status, 401);

  assert.equal((await llamar('PATCH', `/usuarios/${nuevo.body.id}`, { token: a, cuerpo: { activo: true, rol: 'contador' } })).body.rol, 'contador');
  assert.equal((await llamar('POST', `/usuarios/${nuevo.body.id}/contrasena`, { token: a, cuerpo: { contrasena: 'Nueva-Clave-9' } })).status, 204);
  assert.equal((await llamar('POST', '/auth/login', { cuerpo: { usuario: 'maria.p', contrasena: 'Clave-Maria-1' } })).status, 401);
  assert.equal((await entrar('maria.p', 'Nueva-Clave-9')).rol, 'contador');
});

test('nunca sin administrador; nadie se quita su propio acceso', async () => {
  const a = (await entrar('admin')).accessToken;
  assert.equal((await llamar('PATCH', '/usuarios/1', { token: a, cuerpo: { rol: 'operador' } })).status, 409);
  assert.equal((await llamar('PATCH', '/usuarios/1', { token: a, cuerpo: { activo: false } })).status, 409);
  assert.equal((await llamar('PATCH', '/usuarios/1', { token: a, cuerpo: {} })).status, 422);
  assert.equal((await llamar('PATCH', '/usuarios/99', { token: a, cuerpo: { nombre: 'Nadie' } })).status, 404);
  assert.equal((await llamar('PATCH', '/usuarios/1', { token: a, cuerpo: { nombre: 'Ana G.' } })).body.nombre, 'Ana G.');
});

test('tienda nueva: arranca vacía con su nombre y su administrador; no vuelve a la demo', async () => {
  const datos = await crearDatosTienda({ nombreTienda: 'Panadería La Espiga', admin: { usuario: 'rosa', nombre: 'Rosa Díaz', contrasena: 'Clave-Rosa-1' }, ahora: AHORA, hashClave });
  const t = crearServidorLocal({ almacen: memoria(JSON.stringify(datos)), reloj: () => AHORA, inicial: () => { throw new Error('no debe sembrar'); } });
  llamar = cliente(t);
  const a = await entrar('rosa', 'Clave-Rosa-1');
  assert.equal(a.tienda, 'Panadería La Espiga');
  assert.equal(a.rol, 'admin');
  assert.equal((await llamar('POST', '/auth/login', { cuerpo: { usuario: 'admin', contrasena: CLAVE_DEMO } })).status, 401, 'sin usuarios de prueba');
  assert.equal((await llamar('GET', '/productos', { token: a.accessToken })).body.paginacion.total, 0);
  const tablero = await llamar('GET', '/reportes/dashboard', { token: a.accessToken });
  assert.equal(tablero.status, 200);
  assert.equal(tablero.body.ventasUltimos30Dias, 0);
  assert.equal((await llamar('GET', '/reportes/alertas', { token: a.accessToken })).body.total, 0);
  assert.equal((await llamar('POST', '/local/reiniciar', { token: a.accessToken })).status, 422, 'una tienda real no se reemplaza por la demo');
});

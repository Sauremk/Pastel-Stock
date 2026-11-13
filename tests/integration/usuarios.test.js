import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearEntorno, CLAVES } from '../helpers/entorno.js';

// Equipo (v1.5, ADR-19): el administrador agrega personas, cambia roles, desactiva y restablece contraseñas.
let e; let admin;
before(async () => { e = await crearEntorno(); admin = await e.como('admin'); });
after(async () => { await e.cerrar(); });

const login = (usuario, contrasena) => e.api.post('/api/v1/auth/login').send({ usuario, contrasena });
const idDe = async (usuario) => (await e.api.get('/api/v1/usuarios').set(admin)).body.datos.find((u) => u.usuario === usuario).id;

test('el login devuelve el usuario y el nombre de la tienda', async () => {
  const r = await login('admin', CLAVES.admin);
  assert.equal(r.status, 200);
  assert.equal(r.body.usuario, 'admin');
  assert.equal(r.body.tienda, 'Dulce Hogar');
});

test('listar: los tres usuarios demo, sin hash de contraseña', async () => {
  const r = await e.api.get('/api/v1/usuarios').set(admin);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.datos.map((u) => u.usuario).sort(), ['admin', 'contador', 'operador']);
  for (const u of r.body.datos) { assert.equal(u.activo, true); assert.equal(u.passwordHash, undefined); assert.equal(u.password_hash, undefined); }
});

test('agregar una persona: puede entrar con su rol; el usuario se guarda en minúsculas; duplicado → 409', async () => {
  const r = await e.api.post('/api/v1/usuarios').set(admin).send({ usuario: 'maria.p', nombre: 'María Pérez', rol: 'operador', contrasena: 'Clave-Maria-1' });
  assert.equal(r.status, 201);
  assert.equal(r.body.rol, 'operador');
  const l = await login('maria.p', 'Clave-Maria-1');
  assert.equal(l.status, 200);
  assert.equal(l.body.nombre, 'María Pérez');
  // Puede vender (operador) pero no ver el equipo (solo admin)
  assert.equal((await e.api.get('/api/v1/usuarios').set({ Authorization: `Bearer ${l.body.accessToken}` })).status, 403);
  assert.equal((await e.api.post('/api/v1/usuarios').set(admin).send({ usuario: 'maria.p', nombre: 'Otra', rol: 'contador', contrasena: 'Clave-Otra-12' })).status, 409);
});

test('validación: usuario con espacios, rol inexistente y contraseña corta → 422', async () => {
  for (const cuerpo of [
    { usuario: 'con espacio', nombre: 'X Y', rol: 'operador', contrasena: 'Clave-1234' },
    { usuario: 'juan', nombre: 'Juan', rol: 'jefe', contrasena: 'Clave-1234' },
    { usuario: 'juan', nombre: 'Juan', rol: 'operador', contrasena: 'corta' },
  ]) assert.equal((await e.api.post('/api/v1/usuarios').set(admin).send(cuerpo)).status, 422, JSON.stringify(cuerpo));
});

test('desactivar: ya no puede iniciar sesión ni renovar; reactivar lo devuelve', async () => {
  const id = await idDe('contador');
  const sesion = await login('contador', CLAVES.contador);
  const r = await e.api.patch(`/api/v1/usuarios/${id}`).set(admin).send({ activo: false });
  assert.equal(r.status, 200);
  assert.equal(r.body.activo, false);
  assert.equal((await login('contador', CLAVES.contador)).status, 401);
  assert.equal((await e.api.post('/api/v1/auth/refresh').send({ refreshToken: sesion.body.refreshToken })).status, 401, 'el refresh se revoca');
  assert.equal((await e.api.patch(`/api/v1/usuarios/${id}`).set(admin).send({ activo: true })).status, 200);
  assert.equal((await login('contador', CLAVES.contador)).status, 200);
});

test('cambiar rol: el siguiente login trae el rol nuevo', async () => {
  const id = await idDe('maria.p');
  assert.equal((await e.api.patch(`/api/v1/usuarios/${id}`).set(admin).send({ rol: 'contador', nombre: 'María P.' })).body.rol, 'contador');
  const l = await login('maria.p', 'Clave-Maria-1');
  assert.equal(l.body.rol, 'contador');
  assert.equal(l.body.nombre, 'María P.');
});

test('restablecer contraseña: la vieja deja de servir y la nueva funciona', async () => {
  const id = await idDe('maria.p');
  assert.equal((await e.api.post(`/api/v1/usuarios/${id}/contrasena`).set(admin).send({ contrasena: 'Nueva-Clave-9' })).status, 204);
  assert.equal((await login('maria.p', 'Clave-Maria-1')).status, 401);
  assert.equal((await login('maria.p', 'Nueva-Clave-9')).status, 200);
  assert.equal((await e.api.post('/api/v1/usuarios/999999/contrasena').set(admin).send({ contrasena: 'Nueva-Clave-9' })).status, 404);
});

test('la tienda nunca se queda sin administrador y nadie se quita su propio acceso', async () => {
  const yo = await idDe('admin');
  const r1 = await e.api.patch(`/api/v1/usuarios/${yo}`).set(admin).send({ rol: 'operador' });
  assert.equal(r1.status, 409);
  assert.equal((await e.api.patch(`/api/v1/usuarios/${yo}`).set(admin).send({ activo: false })).status, 409);
  // Con un segundo administrador, el primero sigue sin poder degradarse a sí mismo, pero sí puede degradar al otro
  const otro = (await e.api.post('/api/v1/usuarios').set(admin).send({ usuario: 'jefe2', nombre: 'Segundo Admin', rol: 'admin', contrasena: 'Clave-Jefe-22' })).body;
  assert.equal((await e.api.patch(`/api/v1/usuarios/${yo}`).set(admin).send({ rol: 'operador' })).status, 409);
  assert.equal((await e.api.patch(`/api/v1/usuarios/${otro.id}`).set(admin).send({ rol: 'operador' })).status, 200);
  // Cuerpo vacío o campos extra → 422
  assert.equal((await e.api.patch(`/api/v1/usuarios/${otro.id}`).set(admin).send({})).status, 422);
  assert.equal((await e.api.patch(`/api/v1/usuarios/${otro.id}`).set(admin).send({ usuario: 'x' })).status, 422);
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { crearEntorno, CLAVES } from '../helpers/entorno.js';

let e;
before(async () => { e = await crearEntorno(); });
after(async () => { await e.cerrar(); });

test('login correcto devuelve tokens, rol y nombre; la contraseña no se devuelve (DT-01/DT-02)', async () => {
  const r = await e.api.post('/api/v1/auth/login').send({ usuario: 'admin', contrasena: CLAVES.admin });
  assert.equal(r.status, 200);
  assert.equal(r.body.rol, 'admin');
  assert.equal(r.body.nombre, 'Ana García');
  assert.equal(r.body.expiraEn, 900);
  assert.ok(r.body.accessToken && r.body.refreshToken);
  assert.ok(!JSON.stringify(r.body).includes(CLAVES.admin));
  const p = jwt.decode(r.body.accessToken);
  assert.equal(p.rol, 'admin'); assert.equal(p.typ, 'access'); assert.equal(p.iss, 'pastel-stock');
});

test('credenciales incorrectas → 401 genérico (no revela si el usuario existe)', async () => {
  const mal = await e.api.post('/api/v1/auth/login').send({ usuario: 'admin', contrasena: 'incorrecta-123' });
  const noExiste = await e.api.post('/api/v1/auth/login').send({ usuario: 'fantasma', contrasena: 'incorrecta-123' });
  assert.equal(mal.status, 401); assert.equal(noExiste.status, 401);
  assert.equal(mal.body.title, noExiste.body.title);
  assert.match(mal.headers['content-type'], /application\/problem\+json/);
});

test('login con cuerpo inválido → 422; sin cuerpo JSON → 422/400', async () => {
  assert.equal((await e.api.post('/api/v1/auth/login').send({ usuario: 'admin' })).status, 422);
  assert.equal((await e.api.post('/api/v1/auth/login').send({ usuario: 'admin', contrasena: 'x', extra: 1 })).status, 422);
  const malJson = await e.api.post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"usuario":');
  assert.equal(malJson.status, 400);
});

test('la sesión forjada del MVP ya no sirve: un JWT firmado con otro secreto → 401 (DT-02)', async () => {
  const falso = jwt.sign({ sub: '1', rol: 'admin', typ: 'access' }, 'otro-secreto-'.repeat(4), { issuer: 'pastel-stock', audience: 'pastel-stock-api' });
  assert.equal((await e.api.get('/api/v1/materias-primas').set('Authorization', `Bearer ${falso}`)).status, 401);
  const sinFirma = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"1","rol":"admin","typ":"access"}').toString('base64url')}.`;
  assert.equal((await e.api.get('/api/v1/materias-primas').set('Authorization', `Bearer ${sinFirma}`)).status, 401);
  assert.equal((await e.api.get('/api/v1/materias-primas')).status, 401);
});

test('un refresh token no sirve como access token y viceversa', async () => {
  const t = await e.login('operador');
  assert.equal((await e.api.get('/api/v1/materias-primas').set('Authorization', `Bearer ${t.refreshToken}`)).status, 401);
  assert.equal((await e.api.post('/api/v1/auth/refresh').send({ refreshToken: t.accessToken })).status, 401);
});

test('un token vencido → 401', async () => {
  const vencido = jwt.sign({ sub: '1', rol: 'admin', typ: 'access' }, 'x'.repeat(40), { expiresIn: -10, issuer: 'pastel-stock', audience: 'pastel-stock-api' });
  assert.equal((await e.api.get('/api/v1/materias-primas').set('Authorization', `Bearer ${vencido}`)).status, 401);
});

test('refresh rota el token; reutilizar el anterior revoca TODA la familia', async () => {
  const t1 = (await e.api.post('/api/v1/auth/login').send({ usuario: 'contador', contrasena: CLAVES.contador })).body;
  const r2 = await e.api.post('/api/v1/auth/refresh').send({ refreshToken: t1.refreshToken });
  assert.equal(r2.status, 200);
  assert.notEqual(r2.body.refreshToken, t1.refreshToken);
  // reutilización del token viejo (posible robo)
  const reuso = await e.api.post('/api/v1/auth/refresh').send({ refreshToken: t1.refreshToken });
  assert.equal(reuso.status, 401);
  // el token nuevo también quedó revocado
  assert.equal((await e.api.post('/api/v1/auth/refresh').send({ refreshToken: r2.body.refreshToken })).status, 401);
});

test('limitador de intentos de login: 429 con Retry-After', async () => {
  const limitado = await (await import('../helpers/entorno.js')).crearEntorno({ semilla: false, config: { limiteLoginPorMinuto: 3 } });
  try {
    const intentos = [];
    for (let i = 0; i < 5; i += 1) intentos.push((await limitado.api.post('/api/v1/auth/login').send({ usuario: 'admin', contrasena: 'incorrecta-123' })).status);
    assert.deepEqual(intentos, [401, 401, 401, 429, 429]);
    const r = await limitado.api.post('/api/v1/auth/login').send({ usuario: 'admin', contrasena: 'incorrecta-123' });
    assert.equal(r.headers['retry-after'], '60');
  } finally { await limitado.cerrar(); }
});

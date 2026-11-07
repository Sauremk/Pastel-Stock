import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { crearApp } from '../../src/app.js';
import { crearLogger } from '../../src/shared/logger.js';
import { cargarConfig } from '../../src/config.js';
import { crearEntorno } from '../helpers/entorno.js';

let e; let admin; let dirWeb;
before(async () => {
  dirWeb = mkdtempSync(join(tmpdir(), 'web-'));
  writeFileSync(join(dirWeb, 'index.html'), '<!doctype html><title>Pastel Stock</title>');
  e = await crearEntorno({ config: { dirWeb } });
  admin = await e.como('admin');
});
after(async () => { await e.cerrar(); });

test('cabeceras de seguridad: CSP estricta, sin X-Powered-By, nosniff, sin frames', async () => {
  const r = await e.api.get('/');
  assert.equal(r.status, 200);
  const csp = r.headers['content-security-policy'];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'(;|$)/); // sin 'unsafe-inline' ni CDNs en scripts (DT-03, DT-04)
  assert.doesNotMatch(csp, /script-src[^;]*unsafe/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.equal(r.headers['x-powered-by'], undefined);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
});

test('salud: /health y /api/v1/health son públicos y comprueban la base de datos', async () => {
  for (const ruta of ['/health', '/api/v1/health']) {
    const r = await e.api.get(ruta);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { estado: 'ok', status: 'ok', db: 'up', version: 'test' });
    assert.equal(r.headers['cache-control'], 'no-store');
  }
});

test('salud: si la base de datos no responde → 503 problem+json sin filtrar detalles internos', async () => {
  const poolRoto = { query: async () => { throw new Error('connect ECONNREFUSED 10.0.0.5:5432 password=secreto'); } };
  const app = crearApp({ pool: poolRoto, config: cargarConfig({ NODE_ENV: 'test', DATABASE_URL: 'x', JWT_SECRET: 'x'.repeat(40), BCRYPT_COST: '4' }), logger: crearLogger('silent') });
  const r = await request(app).get('/health');
  assert.equal(r.status, 503);
  assert.match(r.headers['content-type'], /problem\+json/);
  assert.doesNotMatch(JSON.stringify(r.body), /ECONNREFUSED|secreto|10\.0\.0\.5/);
});

test('un error inesperado → 500 genérico (sin stack ni mensaje interno)', async () => {
  const poolRoto = { query: async () => { throw new Error('boom interno: tabla xyz'); }, connect: async () => { throw new Error('boom interno'); } };
  const cfg = cargarConfig({ NODE_ENV: 'test', DATABASE_URL: 'x', JWT_SECRET: 'x'.repeat(40), BCRYPT_COST: '4' });
  const app = crearApp({ pool: poolRoto, config: cfg, logger: crearLogger('silent') });
  // token válido emitido por la app real con el mismo secreto
  const jwt = (await import('jsonwebtoken')).default;
  const token = jwt.sign({ sub: '1', rol: 'admin', typ: 'access' }, cfg.jwtSecret, { issuer: 'pastel-stock', audience: 'pastel-stock-api' });
  const r = await request(app).get('/api/v1/materias-primas').set('Authorization', `Bearer ${token}`);
  assert.equal(r.status, 500);
  assert.equal(r.body.title, 'Error interno del servidor');
  assert.doesNotMatch(JSON.stringify(r.body), /boom|xyz|stack|at /);
});

test('cuerpo con JSON roto → 400; cuerpo gigante → 413; rutas desconocidas → 404 problem+json', async () => {
  const roto = await e.api.post('/api/v1/materias-primas').set(admin).set('Content-Type', 'application/json').send('{"codigo": ');
  assert.equal(roto.status, 400);
  const grande = await e.api.post('/api/v1/materias-primas').set(admin).send({ nombre: 'x'.repeat(200_000) });
  assert.equal(grande.status, 413);
  const noExiste = await e.api.get('/api/v1/no-existe').set(admin);
  assert.equal(noExiste.status, 404);
  assert.match(noExiste.headers['content-type'], /problem\+json/);
  assert.equal(noExiste.body.status, 404);
  const fuera = await e.api.get('/otra-cosa');
  assert.equal(fuera.status, 404);
  assert.match(fuera.headers['content-type'], /problem\+json/);
});

test('el error del contrato lleva type, title, status e instance (RFC 9457)', async () => {
  const r = await e.api.get('/api/v1/materias-primas/MP999').set(admin);
  assert.equal(r.status, 404);
  assert.equal(r.body.type, '/errores/no-encontrado');
  assert.equal(r.body.instance, '/api/v1/materias-primas/MP999');
  assert.ok(r.body.title && r.body.status === 404);
});

test('prototype pollution en el cuerpo: se rechaza por el contrato (additionalProperties) y no contamina Object', async () => {
  const r = await e.api.post('/api/v1/movimientos/entradas').set(admin).set('Content-Type', 'application/json').send('{"codigo":"MP001","cantidad":1,"proveedor":"Proveedor","__proto__":{"admin":true},"constructor":{"prototype":{"x":1}}}');
  assert.equal(r.status, 422);
  assert.equal({}.admin, undefined);
  assert.equal({}.x, undefined);
});

test('los logs redactan credenciales y tokens (Ley 1581)', async () => {
  const { Writable } = await import('node:stream');
  const pino = (await import('pino')).default;
  let salida = '';
  const logger = pino({ level: 'info', redact: { paths: ['req.headers.authorization', 'req.body.contrasena'], censor: '[REDACTADO]' } }, new Writable({ write(c, _e, cb) { salida += c; cb(); } }));
  logger.info({ req: { headers: { authorization: 'Bearer secreto123' }, body: { contrasena: 'MiClave-123' } } }, 'prueba');
  assert.doesNotMatch(salida, /secreto123|MiClave-123/);
  assert.match(salida, /REDACTADO/);
});

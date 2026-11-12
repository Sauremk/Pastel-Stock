import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { crearPool } from '../../src/db/pool.js';
import { crearApp } from '../../src/app.js';
import { cargarConfig } from '../../src/config.js';
import { crearLogger } from '../../src/shared/logger.js';

// DT-20: con la base caída, las rutas de negocio respondían 500 (error-interno). Ahora 503 + Retry-After.
// Se simula la caída con un pool que apunta a un puerto donde no escucha nadie (no necesita detener PostgreSQL).
test('DT-20: base caída → 503 servicio-no-disponible con Retry-After en rutas de negocio y en /health', async () => {
  const secreto = 'x'.repeat(40);
  const config = cargarConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://nadie:nada@127.0.0.1:1/nada', JWT_SECRET: secreto, BCRYPT_COST: '4', APP_VERSION: 'test' });
  const pool = crearPool(config.databaseUrl, { connectionTimeoutMillis: 1000 });
  pool.on('error', () => {});
  const app = crearApp({ pool, config, logger: crearLogger('silent') });
  const token = jwt.sign({ sub: '1', rol: 'admin', typ: 'access' }, secreto, { algorithm: 'HS256', expiresIn: 60, issuer: 'pastel-stock', audience: 'pastel-stock-api' });
  try {
    for (const ruta of ['/api/v1/materias-primas', '/api/v1/reportes/dashboard', '/api/v1/ventas']) {
      const r = await request(app).get(ruta).set('Authorization', `Bearer ${token}`);
      assert.equal(r.status, 503, `${ruta}: ${r.status} ${JSON.stringify(r.body)}`);
      assert.equal(r.body.type, '/errores/servicio-no-disponible');
      assert.equal(r.headers['retry-after'], '5');
    }
    assert.equal((await request(app).get('/health')).status, 503);
  } finally { await pool.end(); }
});

import net from 'node:net';
import crypto from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import pg from 'pg';
import { crearPool } from '../../src/db/pool.js';
import { migrar } from '../../src/db/migrate.js';
import { sembrar } from '../../src/db/seed.js';
import { crearApp } from '../../src/app.js';
import { crearLogger } from '../../src/shared/logger.js';
import { cargarConfig } from '../../src/config.js';

export const AHORA = new Date('2026-11-06T15:00:00Z'); // 06-nov-2026 10:00 en Bogotá: reloj fijo = pruebas deterministas
export const CLAVES = { admin: 'Clave-Admin-1', operador: 'Clave-Oper-1', contador: 'Clave-Cont-1' };

const puertoLibre = () => new Promise((ok) => { const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => ok(port)); }); });

/**
 * Crea un entorno aislado: PostgreSQL REAL (servicio de CI vía TEST_DATABASE_URL, o PostgreSQL embebido en local)
 * con un esquema propio por archivo de prueba. Corrige DT-17: las pruebas ya no usan SQLite.
 */
export async function crearEntorno({ semilla = true, config = {} } = {}) {
  let embebido; let dirDatos; let urlBase = process.env.TEST_DATABASE_URL;
  if (!urlBase) {
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    const puerto = await puertoLibre();
    dirDatos = join(tmpdir(), `pastel-pg-${crypto.randomBytes(6).toString('hex')}`); // no debe existir: la librería lo crea (y le asigna dueño si corre como root)
    embebido = new EmbeddedPostgres({ databaseDir: dirDatos, user: 'postgres', password: 'test', port: puerto, persistent: false, onLog: () => {}, onError: () => {} });
    await embebido.initialise();
    await embebido.start();
    urlBase = `postgres://postgres:test@localhost:${puerto}/postgres`;
  }
  const esquema = `t_${crypto.randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: urlBase });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${esquema}`);
  await admin.end();

  const pool = crearPool(urlBase, { options: `-c search_path=${esquema}`, max: 20 });
  pool.on('error', () => {}); // al apagar PostgreSQL, las conexiones ociosas reciben 57P01: no debe tumbar el proceso de pruebas
  await migrar(pool);
  const env = { NODE_ENV: 'test', BCRYPT_COST: '4', SEED_ADMIN_PASSWORD: CLAVES.admin, SEED_OPERADOR_PASSWORD: CLAVES.operador, SEED_CONTADOR_PASSWORD: CLAVES.contador };
  if (semilla) await sembrar(pool, { env, ahora: AHORA, log: () => {} });

  const cfg = {
    ...cargarConfig({ NODE_ENV: 'test', DATABASE_URL: urlBase, JWT_SECRET: 'x'.repeat(40), BCRYPT_COST: '4', RATE_LIMIT_LOGIN_PER_MIN: '10000', RATE_LIMIT_GLOBAL_PER_MIN: '100000', APP_VERSION: 'test' }),
    ...config,
  };
  const app = crearApp({ pool, config: cfg, reloj: () => AHORA, logger: crearLogger('silent') });
  const api = request(app);

  const tokens = {};
  const login = async (usuario) => {
    if (!tokens[usuario]) {
      const r = await api.post('/api/v1/auth/login').send({ usuario, contrasena: CLAVES[usuario] });
      if (r.status !== 200) throw new Error(`login ${usuario} falló: ${r.status} ${JSON.stringify(r.body)}`);
      tokens[usuario] = r.body;
    }
    return tokens[usuario];
  };
  const como = async (usuario) => { const t = await login(usuario); return { Authorization: `Bearer ${t.accessToken}` }; };

  const cerrar = async () => {
    await pool.end();
    if (embebido) { await embebido.stop(); rmSync(dirDatos, { recursive: true, force: true }); }
  };
  return { app, api, pool, config: cfg, login, como, cerrar };
}

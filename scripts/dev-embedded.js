// Desarrollo SIN Docker: levanta un PostgreSQL embebido (paquete npm), migra, siembra datos demo y arranca el servidor.
//   npm run dev:embedded        → http://localhost:3000
// Los datos viven en .pgdata/ y las credenciales de prueba en .dev-credenciales.txt (ambos ignorados por Git).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const PUERTO_PG = Number(process.env.DEV_PG_PORT ?? 54329);
const DIR = process.env.DEV_PG_DIR ?? '.pgdata'; // ruta absoluta recomendada solo si corre como root (contenedores)
const CLAVE_PG = 'dev-local-solo';
const primera = !existsSync(DIR);

const servidorPg = new EmbeddedPostgres({ databaseDir: DIR, user: 'postgres', password: CLAVE_PG, port: PUERTO_PG, persistent: true });
if (primera) await servidorPg.initialise();
await servidorPg.start();

const admin = new pg.Client({ host: 'localhost', port: PUERTO_PG, user: 'postgres', password: CLAVE_PG, database: 'postgres' });
await admin.connect();
if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname = 'pastel_stock'")).rowCount) await admin.query('CREATE DATABASE pastel_stock');
await admin.end();

let creds = {};
if (existsSync('.dev-credenciales.txt')) creds = Object.fromEntries(readFileSync('.dev-credenciales.txt', 'utf8').split('\n').filter(Boolean).map((l) => l.split('=')));
else {
  creds = { SEED_ADMIN_PASSWORD: crypto.randomBytes(9).toString('base64url'), SEED_OPERADOR_PASSWORD: crypto.randomBytes(9).toString('base64url'), SEED_CONTADOR_PASSWORD: crypto.randomBytes(9).toString('base64url'), JWT_SECRET: crypto.randomBytes(32).toString('hex') };
  writeFileSync('.dev-credenciales.txt', Object.entries(creds).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  console.log('\nCredenciales de desarrollo guardadas en .dev-credenciales.txt (usuarios: admin, operador, contador)\n');
}
const env = { ...process.env, ...creds, NODE_ENV: 'development', DATABASE_URL: `postgres://postgres:${CLAVE_PG}@localhost:${PUERTO_PG}/pastel_stock` };

const correr = (args) => new Promise((ok, fallo) => spawn(process.execPath, args, { env, stdio: 'inherit' }).on('exit', (c) => (c === 0 ? ok() : fallo(new Error(`${args.join(' ')} terminó con ${c}`)))));
await correr(['src/db/seed.js']);
const app = spawn(process.execPath, ['--watch', 'src/server.js'], { env, stdio: 'inherit' });
const salir = async () => { app.kill(); await servidorPg.stop(); process.exit(0); };
process.on('SIGINT', salir); process.on('SIGTERM', salir);

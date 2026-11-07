import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { crearPool } from './pool.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const DIR = join(aqui, 'migrations');

/** Aplica, en orden y una sola vez, los .sql de migrations/. Usa un lock consultivo para que dos réplicas no migren a la vez. */
export async function migrar(pool, { log = () => {} } = {}) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727001)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (nombre TEXT PRIMARY KEY, aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now())');
    const hechas = new Set((await client.query('SELECT nombre FROM schema_migrations')).rows.map((r) => r.nombre));
    const archivos = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
    const aplicadas = [];
    for (const archivo of archivos) {
      if (hechas.has(archivo)) continue;
      await client.query('BEGIN');
      try {
        await client.query(readFileSync(join(DIR, archivo), 'utf8'));
        await client.query('INSERT INTO schema_migrations (nombre) VALUES ($1)', [archivo]);
        await client.query('COMMIT');
        aplicadas.push(archivo);
        log(`migración aplicada: ${archivo}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Falló la migración ${archivo}: ${err.message}`);
      }
    }
    return aplicadas;
  } finally {
    try { await client.query('SELECT pg_advisory_unlock(727001)'); } catch { /* conexión cerrada */ }
    client.release();
  }
}

// Ejecución directa: `npm run migrate`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!process.env.DATABASE_URL) { console.error('Defina DATABASE_URL'); process.exit(1); }
  const pool = crearPool(process.env.DATABASE_URL);
  migrar(pool, { log: console.log })
    .then((a) => { console.log(a.length ? `${a.length} migración(es) aplicada(s)` : 'Base de datos al día'); return pool.end(); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}

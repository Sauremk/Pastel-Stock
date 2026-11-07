import pg from 'pg';

// NUMERIC y BIGINT llegan como string desde pg; los contratos de la API usan números.
pg.types.setTypeParser(1700, (v) => Number.parseFloat(v)); // NUMERIC
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10)); // BIGINT (ids de movimiento)
pg.types.setTypeParser(1082, (v) => v); // DATE se mantiene como 'YYYY-MM-DD' (sin desfase de zona horaria)

export function crearPool(databaseUrl, opciones = {}) {
  return new pg.Pool({ connectionString: databaseUrl, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, ...opciones });
}

/**
 * Ejecuta `fn(client)` dentro de una transacción. Libera SIEMPRE la conexión (finally):
 * evita la fuga de conexiones del postmortem simulado de la Guía 14.
 */
export async function enTransaccion(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* la conexión ya estaba rota */ }
    throw err;
  } finally {
    client.release();
  }
}

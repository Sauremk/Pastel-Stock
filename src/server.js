import { cargarConfig, validarConfig } from './config.js';

async function main() {
  const config = validarConfig(cargarConfig());

  // Telemetría primero (instrumenta express/pg al importarse); luego el resto de la aplicación.
  const { iniciarTelemetria } = await import('./telemetry.js');
  const sdk = iniciarTelemetria();

  const { crearPool } = await import('./db/pool.js');
  const { migrar } = await import('./db/migrate.js');
  const { crearApp } = await import('./app.js');
  const { crearLogger } = await import('./shared/logger.js');

  const logger = crearLogger(config.logLevel);
  const pool = crearPool(config.databaseUrl);
  pool.on('error', (e) => logger.error({ err: e.message }, 'error en conexión inactiva del pool'));

  const { registrarMetricasPool } = await import('./shared/metricas.js');
  registrarMetricasPool(pool); // DT-15

  if (config.ejecutarMigraciones) await migrar(pool, { log: (m) => logger.info(m) });

  const app = crearApp({ pool, config, logger });
  const servidor = app.listen(config.puerto, () => logger.info({ puerto: config.puerto, version: config.version, otel: Boolean(sdk) }, 'Pastel Stock escuchando'));

  let cerrando = false;
  const apagar = async (senal) => {
    if (cerrando) return; cerrando = true;
    logger.info({ senal }, 'apagado ordenado');
    servidor.close(async () => { try { await pool.end(); await sdk?.shutdown(); } finally { process.exit(0); } });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => apagar('SIGTERM'));
  process.on('SIGINT', () => apagar('SIGINT'));
}

main().catch((e) => { console.error(e.message); process.exit(1); });

import { metrics } from '@opentelemetry/api';

// Métricas de negocio (ADR-13). Si el SDK de OpenTelemetry no está activo, estas llamadas no hacen nada.
const meter = metrics.getMeter('pastel-stock');
const entradas = meter.createCounter('pastel_entradas_total', { description: 'Entradas de materia prima registradas, por resultado' });
const producciones = meter.createCounter('pastel_producciones_total', { description: 'Producciones registradas, por resultado' });
const stockCritico = meter.createUpDownCounter('pastel_eventos_stock_critico_total', { description: 'Veces que una operación dejó una materia prima en estado crítico' });

export const contarEntrada = (resultado) => entradas.add(1, { resultado });
export const contarProduccion = (resultado) => producciones.add(1, { resultado });
export const contarStockCritico = () => stockCritico.add(1);
const ventas = meter.createCounter('pastel_ventas_total', { description: 'Ventas registradas, por resultado' });
export const contarVenta = (resultado) => ventas.add(1, { resultado });

/**
 * DT-15: métricas del pool de conexiones. Gauges observables que se leen en cada exportación (sin costo por petición):
 *   pastel_db_pool_total, pastel_db_pool_en_uso, pastel_db_pool_esperando, pastel_db_pool_max.
 * La alerta DbPoolSaturado (obs/alerts.yml) dispara si en_uso/max ≥ 80 % durante 2 min (acción 3 del postmortem simulado).
 */
export function registrarMetricasPool(pool, m = meter, max = pool.options?.max ?? 10) {
  const leer = () => ({
    total: pool.totalCount ?? 0,
    enUso: Math.max(0, (pool.totalCount ?? 0) - (pool.idleCount ?? 0)),
    esperando: pool.waitingCount ?? 0,
  });
  const gauges = {
    total: m.createObservableGauge('pastel_db_pool_total', { description: 'Conexiones abiertas en el pool' }),
    enUso: m.createObservableGauge('pastel_db_pool_en_uso', { description: 'Conexiones prestadas a una consulta o transacción' }),
    esperando: m.createObservableGauge('pastel_db_pool_esperando', { description: 'Peticiones esperando una conexión libre' }),
    max: m.createObservableGauge('pastel_db_pool_max', { description: 'Tamaño máximo del pool' }),
  };
  const observar = (r) => {
    const v = leer();
    r.observe(gauges.total, v.total);
    r.observe(gauges.enUso, v.enUso);
    r.observe(gauges.esperando, v.esperando);
    r.observe(gauges.max, max);
  };
  m.addBatchObservableCallback(observar, Object.values(gauges));
  return { leer, detener: () => m.removeBatchObservableCallback(observar, Object.values(gauges)) };
}

import { metrics } from '@opentelemetry/api';

// Métricas de negocio (ADR-13). Si el SDK de OpenTelemetry no está activo, estas llamadas no hacen nada.
const meter = metrics.getMeter('pastel-stock');
const entradas = meter.createCounter('pastel_entradas_total', { description: 'Entradas de materia prima registradas, por resultado' });
const producciones = meter.createCounter('pastel_producciones_total', { description: 'Producciones registradas, por resultado' });
const stockCritico = meter.createUpDownCounter('pastel_eventos_stock_critico_total', { description: 'Veces que una operación dejó una materia prima en estado crítico' });

export const contarEntrada = (resultado) => entradas.add(1, { resultado });
export const contarProduccion = (resultado) => producciones.add(1, { resultado });
export const contarStockCritico = () => stockCritico.add(1);

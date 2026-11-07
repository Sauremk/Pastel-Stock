// Observabilidad (ADR-13): se activa SOLO si OTEL_EXPORTER_OTLP_ENDPOINT está definido.
// Debe cargarse ANTES que express y pg para poder instrumentarlos (server.js lo hace con import dinámico).
import { NodeSDK } from '@opentelemetry/sdk-node';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

export function iniciarTelemetria(env = process.env) {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return null;
  const base = endpoint.replace(/\/$/, '');
  const sdk = new NodeSDK({
    resource: new Resource({ [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME ?? 'pastel-stock', [ATTR_SERVICE_VERSION]: env.APP_VERSION ?? 'dev' }),
    traceExporter: new OTLPTraceExporter({ url: `${base}/v1/traces` }),
    metricReader: new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter({ url: `${base}/v1/metrics` }), exportIntervalMillis: 15_000 }),
    instrumentations: [
      new HttpInstrumentation({ ignoreIncomingRequestHook: (req) => req.url === '/health' || req.url === '/api/v1/health' }),
      new ExpressInstrumentation(),
      new PgInstrumentation({ enhancedDatabaseReporting: false }), // no registra los valores de las consultas (datos personales)
    ],
  });
  sdk.start();
  return sdk;
}

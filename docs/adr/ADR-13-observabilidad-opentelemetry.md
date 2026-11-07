# ADR-13: Observabilidad con OpenTelemetry y retención de logs de 30 días con enmascaramiento de PII

| Campo | Valor |
|---|---|
| **Estado** | Aceptado |
| **Origen** | Guía de aprendizaje No. 13 (FPI-29) — Ingeniería de Software II, Universidad de Pamplona |
| **Autor** | Kevin Andres Rojas Marin |
| **Implementación en el repositorio** | `docker-compose.obs.yml`, `obs/` (Collector, Prometheus, Loki, Tempo, Grafana). |

## Contexto

El endpoint crítico ya tiene metas (p95 < 300 ms, errores < 1 %) pero no hay forma de saber en producción cómo las cumple ni, ante una falla, por qué ocurrió. El servidor de Dulce Hogar es de bajo costo (≈ 2 GB de RAM) y la Ley 1581 de 2012 prohíbe registrar datos personales sin autorización.

## Decisión

Instrumentar con OpenTelemetry (SDK Node) y exportar al OTel Collector, con Prometheus (métricas), Loki (logs) y Tempo (trazas) visualizados en Grafana. Logs JSON con `trace_id`. Muestreo de trazas `ParentBased(TraceIdRatio 0.2)`. Ningún PII en claro: lista negra de campos, enmascarado de 6–12 dígitos y seudónimo HMAC con clave en el entorno. Límites de memoria por servicio y alertas mínimas (p95, errores, API sin métricas).

## Consecuencias

**(+)** Diagnóstico por `trace_id` en minutos; dashboard y alertas vinculadas al SLO; sin dependencia de un proveedor (estándar CNCF); cumplimiento de Ley 1581 verificable con pruebas. **(−)** El stack suma ≈ 1,2 GB de límites de memoria: exige un host separado o ajustar límites; el muestreo al 20 % puede perder trazas de errores raros (mitigación futura: *tail sampling* en el Collector); el overhead real aún no se midió; `filelog` solo funciona sobre Docker local (en un PaaS se debe usar el reenvío de logs del proveedor).

## Política de rotación y retención de logs

Docker `json-file` con `max-size: 10m` y `max-file: 3` en el contenedor de la API (rotación local); Loki con retención de **30 días** (`retention_period: 720h`); trazas en Tempo 7 días; métricas en Prometheus 15 días (`--storage.tsdb.retention.time=15d`). Pasado el plazo se eliminan; no se archiva información personal.

## Impacto de costo (almacenamiento)

Sin licencias (todo código abierto). Medimos 240 bytes por línea de log; con el supuesto exigente de 1 000 entradas diarias, son ≈ 7,2 MB al mes (1 000 × 30 × 240 B) antes de compresión, es decir, insignificante frente al costo de CPU y RAM. El costo real es la memoria: ≈ 1 216 MB en límites.

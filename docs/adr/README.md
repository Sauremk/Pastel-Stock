# Registros de Decisión Arquitectónica (ADR)

Cada ADR sigue la plantilla de 5 campos (Título, Estado, Contexto, Decisión, Consecuencias) más los campos adicionales que pidió cada guía. Una decisión no se reescribe en silencio: si cambia, se crea un ADR nuevo que reemplaza al anterior.

| ADR | Decisión | Estado |
|---|---|---|
| [ADR-01](ADR-01-linea-base-y-priorizacion-de-deuda.md) | Congelar la línea base `v0.1.0-mvp` y pagar primero la deuda de pruebas y seguridad antes de refactorizar el diseño | Aceptado |
| [ADR-02](ADR-02-drivers-arquitectonicos.md) | Priorizar seguridad, integridad del inventario y mantenibilidad como drivers arquitectónicos; disponibilidad y rendimiento «suficientes» | Aceptado |
| [ADR-03](ADR-03-monolito-modular-con-api.md) | Adoptar un monolito modular (Node.js 22 + Express + PostgreSQL 16) con frontend estático que consume una API, en lugar de mantener la SPA con `localStorage` o dividir en microservicios | Aceptado |
| [ADR-04](ADR-04-monolito-modular-nucleo-hexagonal.md) | Monolito modular con núcleo hexagonal (puertos y adaptadores) | Aceptado |
| [ADR-05](ADR-05-bounded-contexts-sin-distribuir.md) | Cuatro Bounded Contexts dentro de un único despliegue; no distribuir | Aceptado |
| [ADR-06](ADR-06-api-openapi-jwt-rbac.md) | API REST `/api/v1` Design-First (OpenAPI 3.1) con autenticación JWT y RBAC en el servidor | Aceptado |
| [ADR-07](ADR-07-pruebas-de-integracion-bd-real.md) | Pruebas de integración con BD efímera real y servicios externos simulados solo en la frontera HTTP | Aceptado |
| [ADR-08](ADR-08-tdd-y-carga-k6.md) | TDD para la lógica de negocio y prueba de carga k6 con umbrales atados al volumen de Dulce Hogar sobre el endpoint crítico | Aceptado |
| [ADR-09](ADR-09-ci-quality-gate.md) | Pipeline de CI en GitHub Actions con Quality Gate bloqueante (SonarCloud) y artefacto inmutable por SHA | Aceptado |
| [ADR-10](ADR-10-docker-multietapa-compose.md) | Contenerizar Pastel Stock con Docker multietapa (Node 22 Alpine, usuario no root) y orquestar localmente con Docker Compose | Aceptado |
| [ADR-11](ADR-11-despliegue-continuo-y-rollback.md) | Despliegue continuo con promoción *staging → producción*, healthcheck posterior y rollback por imagen inmutable | Aceptado |
| [ADR-12](ADR-12-devsecops-en-el-pipeline.md) | Integrar seguridad en el pipeline (SAST, SCA, secretos, imagen) con escaneos bloqueantes y reportes privados | Aceptado |
| [ADR-13](ADR-13-observabilidad-opentelemetry.md) | Observabilidad con OpenTelemetry y retención de logs de 30 días con enmascaramiento de PII | Aceptado |
| [ADR-14](ADR-14-sli-slo-y-presupuesto-de-error.md) | SLI/SLO de disponibilidad (99,5 %) y latencia para el endpoint crítico, con política de presupuesto de error | Aceptado (pendiente de ratificación escrita por Dulce Hogar) |
| [ADR-15](ADR-15-deuda-residual-y-roadmap.md) | Priorización de la deuda residual y roadmap técnico de seis meses con disparadores | Aceptado |
| [ADR-16](ADR-16-idempotencia-y-precision-de-cantidades.md) | Idempotencia opcional en la producción y precisión de 6 decimales (incremento II–03) | Aceptado |

## Plantilla

```markdown
# ADR-NN: Título

- Estado: Propuesto | Aceptado | Rechazado | Reemplazado por ADR-XX

## Contexto
## Decisión
## Consecuencias (positivas y negativas)
```

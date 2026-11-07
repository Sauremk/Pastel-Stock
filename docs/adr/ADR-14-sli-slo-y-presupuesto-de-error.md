# ADR-14: SLI/SLO de disponibilidad (99,5 %) y latencia para el endpoint crítico, con política de presupuesto de error

| Campo | Valor |
|---|---|
| **Estado** | Aceptado (pendiente de ratificación escrita por Dulce Hogar) |
| **Origen** | Guía de aprendizaje No. 14 (FPI-30) — Ingeniería de Software II, Universidad de Pamplona |
| **Autor** | Kevin Andres Rojas Marin |
| **Implementación en el repositorio** | `obs/slo-rules.yml`, `obs/alerts.yml`, `docs/SLO.md`, `docs/runbooks/Runbook_base_de_datos.md`, `docs/postmortem-simulacion.md`. |

## Contexto

La telemetría de la FPI-29 permite medir, pero no existe un objetivo de confiabilidad. Se estima que Dulce Hogar registra entradas de materia prima pocas veces al día (por confirmar), tolera un respaldo manual en papel y no puede pagar infraestructura redundante; el equipo son 4 estudiantes sin guardia 24/7.

## Decisión

SLO de disponibilidad del 99,5 % mensual (3,6 h de presupuesto) y de latencia p95 < 300 ms en el 95 % de ventanas de 5 min. Si el presupuesto se agota, se congelan las funcionalidades. Se adopta el Runbook de BD, se practican postmortems sin culpables para todo incidente > 10 min y se amplía la retención de Prometheus a 35 días.

## Consecuencias

**(+)** Objetivo medible y negociado; regla clara para decidir entre estabilizar y entregar; sin sobreinversión (un 99,95 % exigiría redundancia y guardia nocturna). **(−)** Se aceptan hasta 3,6 h de caída al mes; sin guardia 24/7, un incidente nocturno se atiende en la mañana; la medición depende de que el stack de observabilidad esté sano; el SLO debe revisarse con datos reales a los 2 meses.

**Pendiente fuera del código.** La ratificación escrita del SLO por parte de Dulce Hogar requiere conversar con la MiPyme; el repositorio solo contiene las metas y su medición.

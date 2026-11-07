# ADR-15: Priorización de la deuda residual y roadmap técnico de seis meses con disparadores

| Campo | Valor |
|---|---|
| **Estado** | Aceptado |
| **Origen** | Guía de aprendizaje No. 15 (FPI-31) — Ingeniería de Software II, Universidad de Pamplona |
| **Autor** | Kevin Andres Rojas Marin |
| **Implementación en el repositorio** | `docs/ROADMAP.md`, `docs/DEUDA_TECNICA.md`. |

## Contexto

Tras 14 guías quedan 5 deudas originales abiertas (DT-05, DT-07, DT-08, DT-10, DT-11) y 4 nuevas (DT-14 a DT-17). El equipo tiene capacidad limitada (≈ 16 h/semana) y Dulce Hogar necesita funcionalidad de negocio. Pagar toda la deuda sería económicamente ineficiente (Pressman).

## Decisión

Priorizar por cuadrante de Fowler e impacto en el negocio, no por perfeccionismo: Ahora = dominio (DT-08, DT-10, DT-15); Siguiente = obligación adaptativa con fecha (DT-16); Después = mantenibilidad del frontend y fidelidad de las pruebas (DT-05, DT-07, DT-11, DT-14, DT-17). Cada hito tiene un disparador explícito. Se reserva el 20 % de cada sprint a deuda. Los cambios de comportamiento al refactorizar se declaran (como `cantidad > 0`). La deuda aceptada se registra con justificación y revisión trimestral.

## Consecuencias

**(+)** El esfuerzo va a lo que mueve el negocio; el roadmap es verificable por fechas y disparadores; la IA queda como apoyo y no como decisor. **(−)** Se convive 6 meses con el frontend sin pruebas ni módulos (riesgo de regresiones de UI); las estimaciones pueden fallar; DT-11 sigue creciendo si el 20 % no se respeta; el hito 1 retrasa la limpieza del frontend.

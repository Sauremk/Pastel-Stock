# ADR-01: Congelar la línea base `v0.1.0-mvp` y pagar primero la deuda de pruebas y seguridad antes de refactorizar el diseño

| Campo | Valor |
|---|---|
| **Estado** | Aceptado |
| **Origen** | Guía de aprendizaje No. 1 (FPI-17) — Ingeniería de Software II, Universidad de Pamplona |
| **Autor** | Kevin Andres Rojas Marin |
| **Implementación en el repositorio** | `CHANGELOG.md` (etiqueta `v0.1.0-mvp`), `docs/DEUDA_TECNICA.md`. |

## Contexto

Heredamos un MVP de un solo archivo (1.875 líneas) sin pruebas, con credenciales en texto plano, sesión forjable y 33 advisories en sus librerías (ver inventario). La ISO/IEC/IEEE 12207:2026 exige una línea base antes de cualquier mantenimiento. Se consideraron: (a) reescribir desde cero, (b) refactorizar de inmediato sin pruebas, (c) congelar línea base, escribir pruebas de caracterización y pagar la deuda por orden de riesgo.

## Decisión

Se etiqueta el código actual como `v0.1.0-mvp`; se escriben primero pruebas de caracterización de las reglas existentes (`calcularEstado`, bloqueo de borrado de insumos usados en recetas, KPI del tablero, exportes); el orden de pago es DT-01 a DT-04 (seguridad), luego DT-05 (pruebas), después DT-06 a DT-09 (diseño y dominio) y al final DT-10 a DT-13. Cada cambio futuro referencia el DT que paga y toda deuda nueva debe ser deliberada, prudente y registrada.

## Consecuencias

**(+)** Trazabilidad medible contra una versión fija; el riesgo de seguridad se cierra primero; se puede refactorizar con red de seguridad. **(−)** El primer sprint no entrega funcionalidades visibles para Dulce Hogar; las pruebas de caracterización pueden fijar comportamientos erróneos (p. ej., cantidades negativas), por lo que esos casos se marcan como «bug conocido» hasta corregirlos; se descarta la reescritura total (a).

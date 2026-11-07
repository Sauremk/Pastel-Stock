# ADR-02: Priorizar seguridad, integridad del inventario y mantenibilidad como drivers arquitectónicos; disponibilidad y rendimiento «suficientes»

| Campo | Valor |
|---|---|
| **Estado** | Aceptado |
| **Origen** | Guía de aprendizaje No. 2 (FPI-18) — Ingeniería de Software II, Universidad de Pamplona |
| **Autor** | Kevin Andres Rojas Marin |
| **Implementación en el repositorio** | `docs/ARQUITECTURA.md`, `docs/SLO.md`. |

## Contexto

Pastel Stock es el sistema de inventarios de una pastelería con 5 a 10 usuarios. La FPI-17 dejó 13 ítems de deuda (DT-01 a DT-13); varios son síntomas de atributos nunca definidos. Se evaluó priorizar el desempeño y la escalabilidad (lo «habitual» en arquitectura) frente al contexto real de la MiPyme (pocos usuarios, datos de inventario y precios, presupuesto limitado).

## Decisión

Los drivers en orden son: (1) seguridad con autenticación y autorización en servidor; (2) integridad y consistencia del inventario (stock nunca negativo, movimientos auditables); (3) mantenibilidad y testeabilidad; (4) disponibilidad y rendimiento «suficientes» (SLO 99,5 % mensual; p95 < 300 ms; error < 1 %). Cada uno tiene un escenario SEI de seis partes (tabla anterior).

## Consecuencias

**(+)** Las decisiones de las guías 3 a 15 se justifican en estos escenarios; el riesgo más grave se ataca primero. **(−)** Se acepta explícitamente una sola instancia (hasta 3,6 h de caída al mes), un login con tokens de vida corta que puede incomodar a los operadores y un primer sprint sin funcionalidad visible. Si el negocio crece (más usuarios o sucursales), el ADR se reemplaza con uno nuevo en lugar de editarse.

# ADR-08: TDD para la lógica de negocio y prueba de carga k6 con umbrales atados al volumen de Dulce Hogar sobre el endpoint crítico

| Campo | Valor |
|---|---|
| **Estado** | Aceptado |
| **Origen** | Guía de aprendizaje No. 8 (FPI-24) — Ingeniería de Software II, Universidad de Pamplona |
| **Autor** | Kevin Andres Rojas Marin |
| **Implementación en el repositorio** | `tests/unit/`, `k6/entradas.js`, `.github/workflows/perf-manual.yml`. |

## Contexto

El MVP no tenía pruebas (DT-05) y su tablero fallaba con `NaN%` e `Infinity%` (DT-10). El endpoint `POST /movimientos/entradas` es el único que escribe y protege la integridad del stock (DT-08). Dulce Hogar tiene unos 3 usuarios (supuesto a validar). Una IA propuso una prueba de 500 VUs apuntando a producción.

## Decisión

(1) Toda regla de negocio nueva se escribe con TDD; el código heredado se congela con pruebas de caracterización antes de refactorizar. (2) El endpoint crítico es `POST /api/v1/movimientos/entradas`. (3) Prueba k6 con **20 VUs** (rampa 30 s, sostenido 60 s, bajada 30 s), umbrales **p95 < 300 ms, p99 < 800 ms, error < 1 %**, ejecutada solo con `TARGET_ENV` en `local` o `staging`; el script aborta ante URLs de producción; credenciales por variables de entorno. (4) La suite de regresión corre en cada commit y PR; k6 se ejecuta bajo demanda (`workflow_dispatch`) contra staging, no en cada commit.

## Consecuencias

**Positivas:** defectos de borde detectados antes de escribir código; refactor seguro; criterio de rendimiento objetivo y reproducible; riesgo de autoDoS controlado por guardas. **Negativas:** las pruebas cuestan tiempo y líneas (7 pruebas para 12 líneas); los resultados locales son un piso optimista; hay que mantener el supuesto de volumen vigente; k6 en el pipeline exige un entorno de staging.

## Impacto técnico (ej. necesidad de caché o índices)

Hoy no se necesita caché en la escritura. Con PostgreSQL: la entrada debe ser una sola transacción con `UPDATE materias_primas SET stock = stock + $1 …` (atómico) o `SELECT … FOR UPDATE`, más `INSERT` en `movimientos`; índice en `movimientos(materia_prima_codigo, creado_en)` para el historial; pool de conexiones acotado (≈ 10); `bcrypt` con costo 12 solo en `login`, no en la ruta caliente (un solo login en `setup()`). Si el tablero (`/reportes/dashboard`) llegara a ser lento, se cachea con TTL corto.

# ADR-05: Cuatro Bounded Contexts dentro de un único despliegue; no distribuir

| Campo | Valor |
|---|---|
| **Estado** | Aceptado |
| **Origen** | Guía de aprendizaje No. 5 (FPI-21) — Ingeniería de Software II, Universidad de Pamplona |
| **Autor** | Kevin Andres Rojas Marin |
| **Implementación en el repositorio** | Carpetas `src/identity`, `src/inventory`, `src/catalog` y `src/reporting`; un solo despliegue (`Dockerfile`). |

## Contexto

El MVP mezcla todo en `index.html`. La FPI-20 definió un monolito modular con núcleo hexagonal. La carga estimada es de ≈ 2.000 peticiones/día con ~10 usuarios. Ventas de referencia de la MiPyme: USD 500/mes. El Ejercicio 3 estimó el costo de una arquitectura distribuida en USD 61–94/mes frente a USD 13–26/mes del monolito. Se detectan los contextos Identidad y Acceso, Inventario y Movimientos, Catálogo y Producción, y Reportes y Analítica.

## Decisión

Delimitar los cuatro contextos como módulos de `src/` con interfaces internas entre ellos (p. ej. `InventarioApi`) y **no distribuir ninguno**. Cada contexto accede solo a sus tablas mediante su repositorio. Mientras exista un único PostgreSQL se mantienen dos claves foráneas entre contextos (`receta_ingredientes.materia_prima_codigo → materias_primas` y `movimientos.usuario_id → usuarios`) como **puntos de corte documentados**: si un contexto se extrae, se sustituyen por referencia por identificador y validación por interfaz. Reportes es el primer candidato a extraer, bajo el disparador de la tabla anterior. Sin bus de eventos hasta que haya un consumidor real.

## Consecuencias

**(+)** Un solo despliegue y una sola base: transacciones ACID y menor costo (USD 13–26/mes); sin latencia de red ni sagas; límites claros que facilitan el contrato OpenAPI de la Guía 6. **(−)** Despliegue y escalado conjuntos (una falla de Reportes puede afectar a todo; se mitiga con límites de recursos y pruebas de carga en la Guía 8); riesgo de que el acoplamiento erosione los límites sin disciplina (se mitiga con revisión de dependencias entre contextos en CI); las FK entre contextos deberán romperse si se distribuye.

## Análisis de costo operativo local

Monolito modular en Render ≈ USD 26/mes (mínimo 13) = 5,2 % (2,6 %) de las ventas de referencia; alternativa distribuida ≈ USD 61–94 = 12–19 %. Conectividad de Dulce Hogar: pendiente de levantar con la MiPyme: aún no se ha visitado a Dulce Hogar para medir tipo de conexión, proveedor y caídas del último mes; la latencia de ida y vuelta real desde el local hacia la región de despliegue se medirá con `curl -w "%{time_total}"` (tarea del equipo). Todo el sistema depende de internet; el modo degradado (cola local) queda en el roadmap de la Guía 15.

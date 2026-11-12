# ADR-17: Contexto Ventas, costeo de recetas y kardex de producto terminado

| Campo | Valor |
|---|---|
| **Estado** | Aceptado (v1.1, aplicativo mejorado) |
| **Autor** | Kevin Andres Rojas Marin |
| **Relacionado** | ADR-04 (núcleo hexagonal), ADR-05 (contextos sin distribuir), ADR-16 (idempotencia y 6 decimales), DT-10, DT-15, DT-20, DT-22 |
| **Implementación** | `src/db/migrations/004_ventas_costeo_ajustes.sql`, `src/sales/`, `src/catalog/domain/costeo.js`, `src/inventory/domain/ajustes.js`, `src/reporting/`, `web/js/views/{ventas,alertas,rentabilidad,ajuste}.js` |

## Contexto

El roadmap dejaba en «Ahora» cuatro trabajos: ventas y costeo real (completar DT-10), alertas de caducidad, ajustes por conteo físico y métricas del pool. Al diseñarlos aparecieron tres decisiones de fondo:

1. **Dónde viven las ventas.** Descuentan producto terminado (tabla del contexto Catálogo) pero tienen reglas propias: precio pactado, productos vencidos, reintentos.
2. **Qué costo usar para el margen.** El costo de los insumos cambia; si el margen se recalcula con el costo de hoy, los reportes de meses anteriores cambian solos.
3. **El stock de producto terminado no tenía rastro (DT-22, hallada aquí).** Producir sumaba stock y editar un producto lo sobrescribía, sin movimiento. Con ventas y bajas, ese stock pasa a ser dinero que hay que poder auditar.

## Alternativas

| Decisión | Alternativa | Beneficio | Costo o riesgo |
|---|---|---|---|
| Ubicación | A. Ventas dentro de Catálogo | Menos archivos | Catálogo crece con reglas comerciales que no son suyas |
| | **B. Contexto Ventas nuevo que usa la interfaz pública de Catálogo dentro de la misma transacción (elegida)** | Reglas separadas; atomicidad conservada | Un acoplamiento explícito (`catalogo.reposEn(db)`) |
| | C. Servicio aparte | Despliegue independiente | Transacción distribuida para algo que hoy cabe en una; contradice ADR-05 |
| Costo | A. Recalcular el margen con el costo actual | Una sola fuente | El histórico cambia con cada compra |
| | **B. Congelar precio y costo en cada línea de venta; costo promedio ponderado por producto, recalculado al producir (elegida)** | Margen histórico estable; costo real de lo producido | Dos columnas más por línea |
| | C. PEPS por lotes | El más exacto | Exige lotes con fecha y caducidad propias: fuera de alcance (ver Consecuencias) |
| Rastro | **Kardex de producto (`movimientos_producto`) con PRODUCCION, VENTA, BAJA, AJUSTE y AJUSTE_NEGATIVO (elegida)** | Todo cambio de stock queda auditado | Producto con historial ya no se puede borrar (se deja en stock 0) |

## Decisión

- **Ventas** (`POST /ventas`, `GET /ventas`): una venta con varias líneas, todo o nada. Bloquea las filas de los productos en orden de SKU (sin interbloqueos), rechaza con 409 si algo no alcanza o está vencido, y acepta `Idempotency-Key` con la misma tabla y reglas de ADR-16 (la lógica se extrajo a `src/shared/idempotencia.js`).
- **Costeo:** `costearReceta()` convierte cada ingrediente a la unidad de inventario y lo multiplica por su costo; `GET /recetas/{id}/costeo` lo expone. Producir costea el lote, actualiza el costo promedio ponderado del producto y, si se indica, su caducidad.
- **Ajustes por conteo físico:** `POST /movimientos/ajustes` y `POST /productos/{sku}/ajustes` reciben lo **contado** (no la diferencia) y un motivo cerrado (`CONTEO_FISICO`, `MERMA`, `VENCIMIENTO`, `CORRECCION`). El kardex guarda cantidades positivas: el signo lo da el tipo. Una disminución por vencimiento queda como `BAJA`.
- **Reportes:** el tablero suma ventas, costo de ventas, margen bruto, ROI sobre costo, pérdidas (bajas y ajustes negativos a costo) y ventas de 7 días; `GET /reportes/alertas` y `GET /reportes/rentabilidad` alimentan las vistas nuevas.
- **Operación:** errores de conexión de `pg` → 503 con `Retry-After` (DT-20); gauges `pastel_db_pool_*` y alertas `DbPoolSaturado` / `DbPoolConEspera` (DT-15).

## Consecuencias

**Positivas**
- DT-10 queda pagada completa: el tablero vuelve a mostrar ventas, margen y ROI, ahora con datos reales.
- El stock de producto terminado es auditable (DT-22) y las pérdidas por vencimiento se pueden medir en pesos.
- El margen histórico no cambia aunque cambien precios o costos.

**Negativas y deuda que se acepta**
- **Un solo vencimiento por producto.** Producir con caducidad nueva reemplaza la fecha del producto completo (no hay lotes). Si en el piloto se mezclan lotes con fechas distintas, el siguiente paso es la tabla de lotes y PEPS (anotado en el roadmap, «Condicional»).
- **Costo promedio sin lotes.** Es correcto mientras los lotes se vendan en orden; con lotes, PEPS sería más exacto.
- **Las ventas no se anulan.** Un error se corrige con un ajuste de producto (`CORRECCION`). La anulación con reverso queda como mejora si Dulce Hogar la pide.
- **Un producto con ventas, producciones o bajas no se puede eliminar.** Se deja en stock 0. Cambia el comportamiento de v1.0 (antes se borraba con su receta).

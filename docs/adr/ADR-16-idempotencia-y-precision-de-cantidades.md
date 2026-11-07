# ADR-16: Idempotencia opcional en la producción y precisión de 6 decimales

| Campo | Valor |
|---|---|
| **Estado** | Aceptado (incremento de la guía II–03) |
| **Autor** | Kevin Andres Rojas Marin |
| **Relacionado** | ADR-04 (núcleo hexagonal), ADR-06 (contrato API), DT-18, DT-19 |
| **Implementación** | `src/db/migrations/002_*.sql`, `003_*.sql`, `src/catalog/application/producir.js`, `openapi/openapi.yaml`, `tests/integration/{idempotencia,migracion}.test.js` |

## Contexto

Al modelar el flujo «producir» (guía II–01) se hallaron dos problemas:

1. `convertir()` redondeaba a 3 decimales. Un pastel consume 4 unidades de huevo = 0,3333… docena, que se guardaba como 0,333. Producir 1.000 pasteles de a uno dejaba 4 huevos de desvío.
2. Repetir la misma petición (por ejemplo, porque se perdió la respuesta de red) **volvía a producir**. El contrato no definía una política de reintento.

## Alternativas

| Alternativa | Beneficio | Costo o riesgo |
|---|---|---|
| A. Dejar todo igual y documentarlo | Cero cambios | El desvío y las producciones dobles siguen ocurriendo |
| B. Escala de 6 decimales + `Idempotency-Key` opcional con tabla propia (elegida) | Corrige ambos con cambios pequeños y compatibles | Una tabla más; claves que hay que limpiar; el desvío baja pero no es cero |
| C. Guardar unidades de conteo como enteros en `unid` y convertir solo al mostrar | Elimina el desvío de conteo | Cambia el significado de datos existentes (docenas → unidades); migración más riesgosa; no resuelve los reintentos |
| D. Cola con procesador asíncrono | Patrón muy usado | Innecesario: no hay efecto externo; añade operación y reintentos |

## Decisión

Alternativa **B**.

- Migración `002`: amplía la escala (`NUMERIC(14,6)`) sin tocar valores ni `CHECK`.
- Migración `003` y `Idempotency-Key`: la clave se inserta **dentro de la misma transacción** que la producción. Si la producción se revierte (409, 422, error), la clave también, así que se puede reintentar. Si otra petición con la misma clave está en curso, el `INSERT … ON CONFLICT DO NOTHING` espera su resultado. La clave se asocia al usuario y a una huella (sha256) del cuerpo: la misma clave con otro cuerpo responde 422.
- La cabecera es **opcional**: sin ella el comportamiento no cambia (compatibilidad con el cliente de v1.0.0).

## Consecuencias

**(+)** Reintentos seguros; desvío por redondeo ≤ 5·10⁻⁷ por operación; compatibilidad hacia atrás; probado contra PostgreSQL real (incluida una prueba de dos peticiones simultáneas).
**(−)** La tabla `claves_idempotencia` crece: falta una tarea de limpieza (deuda DT-19). Solo se repiten respuestas exitosas. La idempotencia es opcional, así que un cliente que no envíe clave sigue expuesto. El desvío no es exactamente cero con docenas (1/3 no tiene representación finita).

## Cuándo revisarla

Si aparece un efecto externo (correo, facturación): evaluar un registro persistente de mensajes pendientes (outbox) en vez de enviar dentro de la petición. Si el desvío de conteo se vuelve relevante para el negocio: reconsiderar la alternativa C.

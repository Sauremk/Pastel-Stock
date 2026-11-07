# ADR-07: Pruebas de integración con BD efímera real y servicios externos simulados solo en la frontera HTTP

| Campo | Valor |
|---|---|
| **Estado** | Aceptado |
| **Origen** | Guía de aprendizaje No. 7 (FPI-23) — Ingeniería de Software II, Universidad de Pamplona |
| **Autor** | Kevin Andres Rojas Marin |
| **Implementación en el repositorio** | `tests/integration/`, `tests/contract/` (la suite se ejecuta contra PostgreSQL real; ver `docs/DEUDA_TECNICA.md`, DT-17). |

## Contexto

La API (ADR-06) acaba de nacer y el MVP no tenía pruebas (DT-05). Los fallos más probables están en las uniones: SQL, autenticación, concurrencia y el proveedor de alertas. Un asistente de IA generó pruebas que escribían en la BD de desarrollo y llamaban a una URL real. El equipo es de 4 personas y el pipeline debe correr en minutos.

## Decisión

(1) Las pruebas de integración usan la BD **real pero efímera**: SQLite `:memory:` hoy (por no haber Docker en el entorno de prueba) y PostgreSQL 16 en contenedor con Testcontainers/servicio de CI cuando exista el adaptador PostgreSQL. (2) Solo se simulan servicios **externos al sistema**, en la frontera HTTP con un servidor local; nunca entidades, casos de uso ni repositorios. (3) Una guarda (`assertEphemeral`) hace fallar la prueba si la BD no es efímera. (4) Los contratos de respuesta se validan contra `openapi.yaml` con `ajv`; Pact queda para cuando el frontend se separe en su propio ciclo de despliegue. (5) Prohibido salir a internet en pruebas.

## Consecuencias

**Positivas:** pruebas rápidas y deterministas; detectan fallos reales (S6, concurrencia, RBAC); sin riesgo para datos de desarrollo; el contrato OpenAPI se vuelve ejecutable. **Negativas:** SQLite y PostgreSQL difieren (tipos, bloqueos, `SELECT … FOR UPDATE`), así que la prueba de concurrencia debe repetirse en PostgreSQL antes de producción; se mantienen un servidor falso y datos de siembra; la dependencia externa nueva añade un adaptador a mantener.

## Estrategia de mocking e integración para APIs externas

Puerto `notificador.notificar()` con adaptador `webhookNotifier` (timeout 2 s). En pruebas: servidor HTTP local que registra cada llamada (método, cabecera, cuerpo). Escenarios: 200, 500 (resiliencia: la entrada se registra igual), sin llamada cuando el stock queda óptimo. Prueba de humo real contra el proveedor: fuera del pipeline, nocturna y no bloqueante.

**Actualización v1.0.** La excepción temporal de usar `node:sqlite` en memoria se retiró: la suite de integración y de contrato corre contra PostgreSQL real (deuda DT-17 pagada), tal como el ADR pedía para el adaptador definitivo.

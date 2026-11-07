# ADR-03: Adoptar un monolito modular (Node.js 22 + Express + PostgreSQL 16) con frontend estático que consume una API, en lugar de mantener la SPA con `localStorage` o dividir en microservicios

| Campo | Valor |
|---|---|
| **Estado** | Aceptado |
| **Origen** | Guía de aprendizaje No. 3 (FPI-19) — Ingeniería de Software II, Universidad de Pamplona |
| **Autor** | Kevin Andres Rojas Marin |
| **Implementación en el repositorio** | `docs/ARQUITECTURA.md`; `src/` (backend) y `web/` (frontend estático). |

## Contexto

Los drivers del ADR-02 son seguridad, integridad del inventario y mantenibilidad. La deuda DT-01, DT-02, DT-06 y DT-08 exige un servidor que imponga permisos y una base de datos con transacciones. El equipo es pequeño, ya domina JavaScript, Dulce Hogar tiene 5 a 10 usuarios y poco presupuesto, y el despliegue previsto es un PaaS con PostgreSQL gestionado (Render).

## Decisión

Se construye un único servicio Node.js 22 + Express organizado en módulos (`identity`, `inventory`, `catalog`, `reporting`) con PostgreSQL 16 como única base de datos, y el frontend actual pasa a `web/` consumiendo `/api/v1`. El estilo interno (núcleo hexagonal) se formaliza en el ADR-04.

## Consecuencias

**(+)** La seguridad se valida en el servidor; la integridad se garantiza con transacciones y restricciones; un solo despliegue, una sola base de datos y un solo pipeline; los módulos permiten extraer uno después. **(−)** Hay que operar un servidor y una base de datos (costo, respaldos); el frontend debe reescribirse parcialmente (738 líneas de JS) para consumir la API; el sistema pasa a depender de la conexión con el servidor (la SPA era autónoma una vez cargada), algo que Dulce Hogar no ha exigido; el escalado es vertical, lo cual basta para el contexto actual. Si más adelante un módulo necesita escalar de forma independiente, se registrará un ADR nuevo que reemplace a este.

## Alternativas consideradas y por qué se descartaron

**A) SPA + `localStorage`:** se descarta porque no puede cumplir seguridad ni integridad (autoridad en el cliente; sin transacciones ni datos compartidos). **C) Microservicios:** se descarta porque, para 5 a 10 usuarios y un equipo pequeño, multiplica pipelines, despliegues y bases de datos, y rompe la transacción única que exige la integridad del stock; no aporta ningún driver que el monolito no cubra.

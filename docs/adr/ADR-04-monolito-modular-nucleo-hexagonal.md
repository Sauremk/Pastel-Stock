# ADR-04: Monolito modular con núcleo hexagonal (puertos y adaptadores)

| Campo | Valor |
|---|---|
| **Estado** | Aceptado |
| **Origen** | Guía de aprendizaje No. 4 (FPI-20) — Ingeniería de Software II, Universidad de Pamplona |
| **Autor** | Kevin Andres Rojas Marin |
| **Implementación en el repositorio** | `src/{identity,inventory,catalog,reporting}/{domain,application,adapters}`; el dominio y los casos de uso no importan infraestructura. |

## Contexto

El MVP (`index.html`, 1.875 líneas) mezcla vista, reglas y estado global (DT-07). Los drivers de la FPI-18 priorizan seguridad, integridad del inventario y testeabilidad. El ADR-03 eligió un monolito modular Node.js + PostgreSQL. No hay ninguna prueba automatizada (DT-05) y el equipo es pequeño, por lo que se quiere evitar la sobre-ingeniería.

## Decisión

Estructurar cada módulo como `src/<contexto>/{domain,application,adapters}` con regla de dependencia hacia adentro. Los puertos se crean **solo** cuando hay infraestructura que aislar (base de datos, exportadores) o una regla de negocio que proteger. Los errores de infraestructura se traducen en el adaptador; el núcleo usa `DomainError`. Se migra primero `inventory` (entrada de materia prima) y después `catalog`, `identity` y `reporting`. Verificación automática: `tools/check-pureza.js` en CI (Guía 9).

## Consecuencias

**(+)** Reglas probadas en ~92 ms sin base de datos; cobertura de líneas 99 % en el módulo; defecto DT-08 corregido y cubierto por pruebas; posibilidad de cambiar el adaptador (PostgreSQL ↔ memoria) sin tocar el núcleo. **(−)** Más archivos y un poco más de ceremonia por módulo (de 1 función a 8 archivos incluyendo adaptadores y pruebas); los puertos en JavaScript no se verifican por el compilador, solo con `exigirPuerto` en tiempo de ejecución (mitigación posible: TypeScript, a evaluar); riesgo de sobre-abstraer si no se respeta la regla "solo donde haya infraestructura o regla".

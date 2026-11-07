# ADR-11: Despliegue continuo con promoción *staging → producción*, healthcheck posterior y rollback por imagen inmutable

| Campo | Valor |
|---|---|
| **Estado** | Aceptado |
| **Origen** | Guía de aprendizaje No. 11 (FPI-27) — Ingeniería de Software II, Universidad de Pamplona |
| **Autor** | Kevin Andres Rojas Marin |
| **Implementación en el repositorio** | `.github/workflows/cd.yml`, `scripts/healthcheck.sh`. |

## Contexto

Con la imagen del ADR-10, publicar a mano es lento y propenso a error. Dulce Hogar opera su inventario y sus costos con el sistema; un despliegue defectuoso no puede quedar sin detectar. Presupuesto: capa gratuita (Render + GHCR + GitHub Actions).

## Decisión

(1) CD con GitHub Actions disparado solo si el CI de `main` está en verde. (2) Imagen construida **una vez**, etiquetada `sha-<commit>` en GHCR. (3) *Staging* con Continuous Deployment; **producción con Continuous Delivery** (aprobación manual del *Environment*). (4) Healthcheck posterior en ambos entornos, comparando la versión desplegada. (5) Secretos solo en *GitHub Secrets*. (6) Rollback automático a `:stable`.

## Consecuencias

**Positivas:** Cada versión es trazable y reversible; un despliegue que no arranca se detecta en minutos y se revierte solo; ninguna credencial en el repositorio; el dueño del negocio decide cuándo salir a producción.

**Negativas:** La aprobación manual agrega latencia y depende de una persona disponible. El rollback en Render es un redespliegue (minutos), no una conmutación instantánea. Los límites del plan gratuito (suspensión por inactividad, arranque en frío) obligan a tolerancia de 5 min en el healthcheck. El rollback de código **no** revierte datos.

## Políticas de recuperación ante fallos (rollback)

**Disparo automático:** si el healthcheck de producción falla tras 30 intentos (5 min) o el paso de despliegue devuelve HTTP ≥ 400, el job `rollback` redespliega `:stable` y vuelve a verificar. **Disparo manual:** *Run workflow* con `rollback = true` (objetivo de recuperación ≤ 10 min). **Imagen `:stable`:** solo se mueve después de un healthcheck exitoso en producción; los tags `sha-*` son inmutables y se conservan al menos las últimas 10 versiones. **Base de datos:** migraciones compatibles hacia atrás (*expand/contract*), nunca destructivas en el mismo despliegue; copia de seguridad antes de migrar. **Tras un rollback:** el pipeline termina en rojo a propósito y se abre un postmortem sin culpables (guía 14). **Fallo en staging:** producción no se toca.

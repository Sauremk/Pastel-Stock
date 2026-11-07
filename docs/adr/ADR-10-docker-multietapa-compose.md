# ADR-10: Contenerizar Pastel Stock con Docker multietapa (Node 22 Alpine, usuario no root) y orquestar localmente con Docker Compose

| Campo | Valor |
|---|---|
| **Estado** | Aceptado |
| **Origen** | Guía de aprendizaje No. 10 (FPI-26) — Ingeniería de Software II, Universidad de Pamplona |
| **Autor** | Kevin Andres Rojas Marin |
| **Implementación en el repositorio** | `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.env.example`. |

## Contexto

El MVP heredado era un solo `index.html` sin entorno reproducible (DT-12). Tras el ADR-03/04 la solución es un monolito modular Node.js + PostgreSQL; el pipeline de CI (ADR-09) necesita un artefacto inmutable y el CD (siguiente guía) necesita desplegar el mismo artefacto en la nube. Un asistente de IA propuso una imagen con Node 20 (fuera de soporte), ejecución como root, capas mal ordenadas y contraseñas en claro.

## Decisión

(1) Dockerfile de 3 etapas (`prod-deps`, `builder` con lint, `runtime`) sobre `node:22-alpine`, `USER node`, `HEALTHCHECK` a `/health`. (2) `docker-compose.yml` con `api` + `postgres:16-alpine`, volumen con nombre `pgdata`, red `backend` interna y red `frontend`, `depends_on` por salud. (3) Secretos solo por variables de entorno (`.env` ignorado; `${VAR:?}` para fallar si faltan). (4) Dependencias de JavaScript puro (`pg`, `bcryptjs`) para evitar compilación nativa en Alpine.

## Consecuencias

**Positivas:** Entornos reproducibles dev/CI/prod; imagen pequeña y con menor superficie de ataque; datos persistentes; la BD no se expone; un secreto faltante impide el arranque en vez de usar uno débil.

**Negativas:** Alpine usa musl: si se añade una dependencia nativa habrá que compilarla en `builder` o cambiar a `node:22-slim`. Hay que mantener actualizadas las etiquetas de imagen (Dependabot para `docker`, guía 12). El volumen local no es una copia de seguridad: se necesitará una política de *backups* en producción. Node 22 sale de soporte en abril de 2027: migrar a Node 24 LTS antes.

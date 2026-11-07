# ADR-06: API REST `/api/v1` Design-First (OpenAPI 3.1) con autenticación JWT y RBAC en el servidor

| Campo | Valor |
|---|---|
| **Estado** | Aceptado |
| **Origen** | Guía de aprendizaje No. 6 (FPI-22) — Ingeniería de Software II, Universidad de Pamplona |
| **Autor** | Kevin Andres Rojas Marin |
| **Implementación en el repositorio** | `openapi/openapi.yaml` (contrato), `src/identity/` (JWT, bcrypt, RBAC), cabeceras en `docs/SEGURIDAD.md`. |

## Contexto

El MVP autentica y autoriza solo en el cliente: usuarios y contraseñas en texto plano en el JS (DT-01) y rol forjable en `localStorage` (DT-02). El ADR-05 define cuatro contextos en un solo despliegue. Se necesita un contrato que permita trabajar en paralelo (frontend, pruebas de la Guía 7) y que cierre DT-01/DT-02. Los datos personales se rigen por la Ley 1581 de 2012.

## Decisión

(1) Contrato OpenAPI 3.1 escrito **antes** del código; versión en la URL (`/api/v1`). (2) JWT firmado con **HS256** (un solo emisor y verificador: el monolito), fijando `algorithms`, `iss` y `aud`; *access token* de **15 min** y *refresh token* de **7 días con rotación** y detección de reutilización. (3) Contraseñas con **bcrypt (cost 12)**; el secreto JWT sale de la variable de entorno `JWT_SECRET` (≥ 32 caracteres) y el servidor no arranca sin él. (4) **RBAC en el servidor** con los roles admin/operador/contador, declarados por operación en `x-roles`. (5) `security` global y `security: []` solo en `login`, `refresh` y `health`. (6) Errores en `application/problem+json` (RFC 9457); respuestas sin datos sensibles; límite de 5 intentos de login por minuto por IP.

## Consecuencias

**(+)** Se cierran DT-01 y DT-02 en el diseño; contrato verificable por linter y por pruebas; el frontend puede mockear la API. **(−)** El *refresh token* guardado en el navegador es vulnerable a XSS: se mitiga cerrando DT-03 (escape de salida), con una política CSP y, a evaluar en la Guía 12, una cookie `httpOnly`. El *logout* no invalida un *access token* ya emitido hasta que venza (máximo 15 min). La detección de reutilización hoy está en memoria; debe pasar a una tabla `refresh_tokens` al tener persistencia. Si se extrae un contexto en el futuro, se migrará a RS256/EdDSA para no compartir el secreto.

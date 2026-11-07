# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y versionado semántico.

## [Sin publicar] — Incremento II–03

### Añadido
- Cabecera opcional `Idempotency-Key` en `POST /recetas/{id}/producir`: un reintento con la misma clave y el mismo cuerpo devuelve la respuesta original sin volver a producir (ADR-16, DT-19).

### Cambiado
- La escala de `stock`, `minimo`, `receta_ingredientes.cantidad` y `movimientos.cantidad` pasa de 3 a 6 decimales (migración 002, DT-18). Los valores ya guardados no cambian.

## [1.0.0] — 2026-11-07

### Añadido
- API REST `/api/v1` (OpenAPI 3.1) con PostgreSQL: materias primas, movimientos (kardex), productos, recetas, producción, dashboard y reportes.
- Autenticación JWT con refresh rotativo, bcrypt y RBAC (admin, operador, contador) en el servidor.
- Frontend modular en `web/` (módulos ES, sin `innerHTML`, CSP estricta).
- Pruebas unitarias, de integración (PostgreSQL) y de contrato; prueba de carga k6.
- Docker (imagen multietapa, usuario no root) y Docker Compose con red interna.
- CI/CD en GitHub Actions: lint, pruebas, SonarCloud, seguridad (Gitleaks, Semgrep, CodeQL, Trivy, npm audit, SBOM), despliegue a staging y producción con aprobación y rollback.
- Observabilidad con OpenTelemetry, Prometheus, Loki, Tempo y Grafana; SLO y alertas.
- Documentación: ADR 01–15, arquitectura, seguridad, runbooks, deuda técnica, roadmap.

### Cambiado
- Los exportes PDF/Excel pasan al servidor; se eliminan jsPDF y SheetJS del navegador.
- La sesión deja de guardarse en `localStorage` como identidad; la autorización es del servidor.

### Seguridad
- Se eliminan las credenciales embebidas en el HTML y la autenticación del lado del cliente (DT-01).

## [0.1.0-mvp]

- MVP de un solo `index.html`: inventario, recetas y reportes en el navegador con `localStorage`.

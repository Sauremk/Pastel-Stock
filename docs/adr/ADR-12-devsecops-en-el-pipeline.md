# ADR-12: Integrar seguridad en el pipeline (SAST, SCA, secretos, imagen) con escaneos bloqueantes y reportes privados

| Campo | Valor |
|---|---|
| **Estado** | Aceptado |
| **Origen** | Guía de aprendizaje No. 12 (FPI-28) — Ingeniería de Software II, Universidad de Pamplona |
| **Autor** | Kevin Andres Rojas Marin |
| **Implementación en el repositorio** | `.github/workflows/security.yml`, `.semgrep/pastel-stock.yml`, `.gitleaks.toml`, `.trivyignore`, `.github/dependabot.yml`. |

## Contexto

El diagnóstico del MVP (ADR-01) encontró credenciales en texto plano, autenticación en el cliente, XSS por `innerHTML` y librerías con CVE críticos y altos. Con el CD activo (ADR-11), un defecto de seguridad llega a producción en minutos. Dulce Hogar trata datos personales de empleados y proveedores (Ley 1581 de 2012) y no tiene personal de seguridad.

## Decisión

(1) `security.yml` con Gitleaks, Semgrep (reglas propias + OWASP), CodeQL, `npm audit --omit=dev --audit-level=high`, SBOM CycloneDX y Trivy (imagen y configuración). (2) El pipeline **falla** ante HIGH/CRITICAL; los cuatro jobs son *checks* obligatorios de la PR. (3) Reportes como **artefactos privados**, nunca en servicios públicos. (4) Excepciones solo con `.trivyignore`/`.gitleaks.toml` justificados, con responsable y vencimiento. (5) Dependabot semanal (npm, Docker, Actions) y escaneo programado cada lunes. (6) Sustituir `xlsx` y `jsPDF` por `exceljs` (con `overrides` de `uuid`) y `pdfkit`.

## Consecuencias

**Positivas:** Defectos detectados en la PR, no en producción; trazabilidad de cada excepción; SBOM para responder rápido ante un nuevo CVE; cumplimiento defendible ante la Ley 1581.

**Negativas:** Los PR pueden bloquearse por alertas nuevas (más fricción y tiempo de CI); CodeQL en repositorios privados puede requerir GitHub Advanced Security; las reglas propias de Semgrep son poco precisas y requieren mantenimiento; `ignore-unfixed` deja fuera vulnerabilidades sin parche (se vigilan con Dependabot); un escaneo no sustituye a una prueba de penetración.

## Riesgo territorial mitigado

Dulce Hogar es una MiPyme de la región con administración informal de TI, personal que rota y credenciales compartidas o reutilizadas; un incidente (acceso al inventario y costos o alteración de existencias) la afecta directamente y no tiene capacidad de respuesta. Igual que la aduana inspecciona a la entrada de la zona de pesaje y no al final de la autopista, el escaneo en la PR frena el riesgo antes de que llegue a producción.

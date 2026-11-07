# Seguridad de Pastel Stock

Resumen del modelo de seguridad de v1.0 y de cómo se controla en el pipeline (ADR-06 y ADR-12). Si encuentra una vulnerabilidad, repórtela de forma privada a Kevin Andres Rojas Marin (no abra un *issue* público con detalles de explotación).

## Modelo de amenazas (breve)

| Activo | Amenaza | Control en v1.0 |
|---|---|---|
| Cuentas y roles | Contraseñas débiles o filtradas; fuerza bruta | Hash **bcrypt** (costo 12); contraseñas solo por variables de entorno, jamás en el código; límite de **5 intentos de login por minuto** por IP; mensaje genérico y comparación de hash aun si el usuario no existe (no revela qué usuarios existen) |
| Sesiones | Robo o forja de tokens | **JWT firmado HS256** con algoritmo fijado (evita `alg: none`), `issuer` y `audience` verificados; access token de **15 min**; refresh token de **7 días, rotativo y de un solo uso**; reutilización de un refresh token revoca todas las sesiones del usuario |
| Autorización | Un operador accediendo a funciones de administrador | **RBAC en el servidor** (`autorizar(...roles)`); el frontend solo oculta controles. Roles: `admin` (todo), `operador` (ver, entradas, producir), `contador` (ver, reportes y exportes) |
| Integridad del inventario | Cantidades negativas o stock negativo; concurrencia | Validación contra el contrato OpenAPI (`cantidad > 0`), restricciones `CHECK` en PostgreSQL y transacciones con bloqueo de fila |
| Navegador | XSS, *clickjacking* | Frontend sin `innerHTML` con datos ni manejadores inline; **CSP estricta**; `frame-ancestors 'none'`; regla de ESLint que prohíbe `innerHTML` en `web/` |
| Entrada de datos | Inyección SQL | Consultas **parametrizadas** (`$1`); regla Semgrep `pastel.sql-string-concat` |
| Cadena de suministro | Dependencias con CVE; secretos en el historial | `package-lock.json`, `npm audit`, **Dependabot**, Trivy, SBOM CycloneDX, **Gitleaks** sobre todo el historial |
| Disponibilidad | Abuso de la API | *Rate limit* global (600 peticiones/min por defecto) y límite de cuerpo de 100 kB |
| Datos personales | Fuga en logs y telemetría | Logs sin cédula, teléfono, contraseña ni token; enmascarado de secuencias de 6 a 12 dígitos; el Collector elimina atributos prohibidos; `enhancedDatabaseReporting` desactivado |

## Cabeceras HTTP

`helmet` configura, entre otras:

| Cabecera | Valor |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` (+ `upgrade-insecure-requests` en producción) |
| `Strict-Transport-Security` | Activa en producción (TLS lo termina el proveedor) |
| `X-Content-Type-Options` | `nosniff` |
| `Cross-Origin-Opener-Policy` / `Referrer-Policy` | Valores seguros por defecto de `helmet` |
| `X-Powered-By` | Deshabilitada |

No hay CORS abierto: el frontend y la API comparten origen.

## Errores

Todos los errores siguen **RFC 9457** (`application/problem+json`) sin trazas de pila ni detalles internos. Una falla de base de datos se informa como 503 genérico; el detalle va al log (sin datos personales).

## Secretos

- Solo variables de entorno (`.env` local ignorado por Git; secretos del servicio en Render; *Secrets* de GitHub para el CI/CD). La API **no arranca** si falta `JWT_SECRET` o es corto (< 32 caracteres).
- `.env.example` contiene únicamente marcadores `CAMBIAR_*`.
- Si un secreto real estuvo alguna vez en el historial de Git, hay que **rotarlo**; borrar el commit no basta.
- El MVP original publicaba `admin/admin123` y otras contraseñas en el HTML (DT-01): **considere comprometidas esas credenciales** si alguna vez se usaron fuera de pruebas.

## Controles automáticos (CI)

| Control | Herramienta | Falla el pipeline si… |
|---|---|---|
| Secretos | Gitleaks (con regla propia de contraseñas en literal) | Hay un secreto en cualquier commit |
| SAST | Semgrep (reglas del proyecto + OWASP) y CodeQL | Hay un hallazgo de severidad ERROR |
| SCA | `npm audit --omit=dev --audit-level=high` y SBOM | Hay una vulnerabilidad HIGH o CRITICAL en producción |
| Imagen y configuración | Trivy | Hay una vulnerabilidad HIGH/CRITICAL corregible o una mala configuración grave |
| Calidad | SonarCloud (Quality Gate) | No hay vulnerabilidades nuevas, cobertura en código nuevo < 80 %, o duplicación excesiva |
| Contenedor | Docker | (Diseño) usuario no root, sistema de archivos de solo lectura, `cap_drop: ALL`, `no-new-privileges` |

Las excepciones solo se aceptan en `.trivyignore` o `.gitleaks.toml` con justificación, responsable y fecha de vencimiento.

## Datos personales (Ley 1581 de 2012)

Pastel Stock almacena datos de proveedores (nombre comercial) y de usuarios del sistema (nombre y usuario de acceso); **no almacena datos de clientes finales** (cédulas, teléfonos). Reglas del proyecto:

1. No registrar datos personales en logs, métricas ni trazas; los logs se retienen 30 días como máximo (ADR-13).
2. No enviar datos personales reales a herramientas de IA ni a servicios externos sin autorización del titular; las pruebas usan datos ficticios.
3. Si en el futuro se incorporan datos de clientes (por ejemplo, ventas con identificación), se requiere autorización del titular, política de tratamiento y revisión de este modelo de amenazas.
4. Los respaldos de la base se tratan como información sensible (acceso restringido y cifrado en tránsito).

## Qué falta (límites conocidos)

- No hay revocación inmediata de access tokens (vencen a los 15 min).
- No hay autenticación de dos factores ni política de bloqueo de cuenta tras fallos repetidos (solo límite de tasa por IP).
- Las auditorías de seguridad de este repositorio son automatizadas; no sustituyen una prueba de penetración antes de manejar datos reales de clientes.

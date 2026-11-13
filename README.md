# Pastel Stock — Dulce Hogar · Sistema de Inventarios Pro

Sistema de inventario, producción y ventas para una pastelería: materias primas, kardex de movimientos, productos con receta, producción que descuenta insumos, **ventas con margen real, costeo por receta, alertas de caducidad y ajustes por conteo físico** (v1.1), alertas de stock bajo y reportes (PDF/Excel). Evolución del MVP de un solo `index.html` a una aplicación con **API REST, base de datos PostgreSQL, autenticación en el servidor, pruebas, contenedores, CI/CD y observabilidad**.

- Repositorio: <https://github.com/Sauremk/Pastel-Stock>
- Autor: Kevin Andres Rojas Marin (desarrollador full-stack, líder, QA/DevOps)
- Asesor: Abel Fernando Becerra Carrillo — Ingeniería de Software II, Universidad de Pamplona

## App sin servidor (PWA)

La forma más rápida de usarlo: **ábrelo en el navegador, instálalo en el celular y úsalo sin internet.** Es la misma aplicación (misma interfaz y mismas reglas de negocio), pero la API corre dentro del navegador y los datos quedan en el dispositivo ([ADR-18](docs/adr/ADR-18-pwa-sin-servidor.md)).

- Enlace: <https://sauremk.github.io/Pastel-Stock/>
- Usuarios de prueba: `admin`, `operador` o `contador`, contraseña `dulcehogar` (cada uno puede cambiarla en «Datos y cuenta»).
- **Instalar:** en Android, Chrome → menú ⋮ → «Instalar aplicación» (o el botón «📲 Instalar la app»). En iPhone, Safari → Compartir → «Agregar a pantalla de inicio».
- **Tu propia tienda (v1.5):** en el inicio de sesión toca «＋ Crear una tienda nueva». Empieza vacía y tú quedas como administrador. Cada tienda guarda sus datos aparte y se elige en «Tienda» al entrar ([ADR-19](docs/adr/ADR-19-equipo-y-tiendas.md)).
- **Equipo (v1.5):** el administrador agrega personas en «Más → Equipo», les asigna un rol (operador, contador o administrador), las desactiva y les pone una contraseña nueva si la olvidan. En la app sin servidor el equipo comparte el mismo celular o computador.
- **Respaldo:** los datos viven solo en ese dispositivo. Descarga un respaldo desde «Datos y cuenta» con regularidad.
- Construir: `npm run build:pwa` (sale en `dist-pwa/`). Probar: `npx serve dist-pwa` o cualquier servidor estático.

## Requisitos

- Node.js 22+ y npm
- PostgreSQL 16 **o** Docker (con Compose v2) **o** nada más (modo embebido para desarrollo)

## Inicio rápido

### Opción A — Sin instalar PostgreSQL (desarrollo)

```bash
npm ci
npm run dev:embedded     # levanta un PostgreSQL embebido, migra, siembra y arranca la app
```

La consola imprime la URL y las credenciales de desarrollo (también quedan en `.dev-credenciales.txt`, ignorado por Git). Si lo ejecuta como `root` (por ejemplo, dentro de un contenedor), indique una carpeta inexistente: `DEV_PG_DIR=/tmp/pgdev npm run dev:embedded`.

### Opción B — Docker Compose

```bash
cp .env.example .env     # edite y reemplace todos los CAMBIAR_*
docker compose up -d --build
docker compose --profile seed run --rm seed    # datos iniciales (opcional)
curl http://localhost:3000/health
```

### Opción C — PostgreSQL propio

```bash
cp .env.example .env     # DATABASE_URL apuntando a su servidor
npm ci
npm run migrate
npm run seed             # opcional
npm start
```

Abra <http://localhost:3000>. Genere el secreto JWT con `openssl rand -base64 48`. **Nunca** suba `.env` al repositorio.

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `DATABASE_URL` | Sí | Cadena de conexión a PostgreSQL |
| `JWT_SECRET` | Sí | Secreto de firma (≥ 32 caracteres) |
| `NODE_ENV` | No | `development`, `test` o `production` |
| `PORT` | No | Puerto HTTP (3000 por defecto) |
| `APP_VERSION` | No | Versión informada en `/health` |
| `LOG_LEVEL` | No | Nivel de pino (`info` por defecto) |
| `RUN_MIGRATIONS` | No | Ejecuta migraciones al arrancar |
| `TRUST_PROXY` | No | Confía en el proxy (necesario tras Render/balanceadores) |
| `BCRYPT_COST` | No | Costo de bcrypt (12 por defecto) |
| `RATE_LIMIT_LOGIN_PER_MIN` | No | Intentos de login por minuto (5) |
| `RATE_LIMIT_GLOBAL_PER_MIN` | No | Peticiones por minuto por IP (600) |
| `ACCESS_TTL_SECONDS` / `REFRESH_TTL_SECONDS` | No | Vida de los tokens (900 / 604800) |
| `WEB_DIR` | No | Carpeta del frontend (`web`) |
| `TIENDA_NOMBRE` | No | Nombre de la tienda que muestra la app (`Dulce Hogar`) |

Los valores de ejemplo están en [`.env.example`](.env.example).

## Scripts

| Script | Qué hace |
|---|---|
| `npm start` / `npm run dev` | Arranca la API (y el frontend estático) |
| `npm run dev:embedded` | Desarrollo con PostgreSQL embebido |
| `npm run migrate` / `npm run seed` | Migraciones y datos iniciales |
| `npm run lint` | ESLint (incluye la prohibición de `innerHTML` en `web/`) |
| `npm test` | Todas las pruebas |
| `npm run test:unit` / `test:integration` / `test:contract` | Por nivel |
| `npm run test:cov` | Pruebas con cobertura |
| `npm run build:pwa` | Genera la app sin servidor en `dist-pwa/` (ver «App sin servidor») |
| `npm run test:e2e` | Flujos en navegador real con Playwright (antes: `npx playwright install chromium`) |
| `npm run openapi:lint` | Valida el contrato OpenAPI |

## Estructura

Ver [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md). En resumen: `web/` (frontend), `src/{identity,inventory,catalog,sales,reporting}` (monolito modular con núcleo hexagonal), `openapi/` (contrato), `tests/`, `k6/`, `obs/`, `docs/`, `.github/workflows/`.

## API

Contrato en [`openapi/openapi.yaml`](openapi/openapi.yaml) (OpenAPI 3.1, errores RFC 9457). Prefijo `/api/v1`; `/health` es público. Roles: `admin`, `operador`, `contador`. Las pruebas de contrato verifican que las respuestas reales cumplan el documento.

## Pruebas y calidad

Pruebas unitarias del dominio, de integración sobre PostgreSQL real y de contrato (las respuestas reales se validan contra el esquema OpenAPI). El CI exige lint, pruebas y el Quality Gate de SonarCloud (cobertura ≥ 80 % en código nuevo). La prueba de carga está en [`k6/entradas.js`](k6/entradas.js) y se lanza desde el workflow `perf-manual`.

## CI/CD

| Workflow | Cuándo | Qué hace |
|---|---|---|
| `ci.yml` | PR y push | Lint, pruebas con PostgreSQL, SonarCloud, build de la imagen |
| `security.yml` | PR, push y semanal | Gitleaks, Semgrep, CodeQL, `npm audit`, Trivy, SBOM |
| `cd.yml` | push a `main` | Publica la imagen en GHCR por SHA → staging → **aprobación manual** → producción; rollback si falla el healthcheck |
| `perf-manual.yml` | manual | Prueba de carga k6 contra staging |

**Configuración requerida en GitHub** (Settings):

- *Secrets*: `SONAR_TOKEN`, `RENDER_DEPLOY_HOOK_STAGING`, `RENDER_DEPLOY_HOOK_PRODUCTION`, `K6_USER`, `K6_PASS`
- *Variables*: `STAGING_URL`, `PRODUCTION_URL`
- *Environments*: `staging` y `production` (este con *Required reviewers* = la persona que aprueba el despliegue)
- SonarCloud: importar el repositorio y confirmar `sonar.organization` / `sonar.projectKey` en [`sonar-project.properties`](sonar-project.properties)
- Rama `main` protegida: PR obligatorio y checks de CI en verde

### Despliegue en Render (paso a paso)

1. Crear una base **PostgreSQL** en Render (una para staging y otra para producción) y copiar su *Internal Database URL*.
2. Crear un **Web Service** desde la imagen `ghcr.io/sauremk/pastel-stock` (o desde el repositorio con el `Dockerfile`), uno por entorno.
3. Variables: `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET`, `TRUST_PROXY=1`, `RUN_MIGRATIONS=true`.
4. *Health Check Path*: `/health`.
5. Copiar el *Deploy Hook* de cada servicio a los secretos de GitHub indicados arriba.

## Observabilidad

Opcional, con OpenTelemetry → Collector → Prometheus/Loki/Tempo → Grafana:

```bash
docker compose -f docker-compose.yml -f docker-compose.obs.yml up -d
# Grafana: http://localhost:3001  (tablero "Pastel Stock – RED + SLO")
```

SLO, alertas y fórmulas en [docs/SLO.md](docs/SLO.md); procedimientos en [docs/runbook.md](docs/runbook.md).

## Documentación

[Arquitectura](docs/ARQUITECTURA.md) · [Seguridad](docs/SEGURIDAD.md) · [ADR](docs/adr/README.md) · [Deuda técnica](docs/DEUDA_TECNICA.md) · [Roadmap](docs/ROADMAP.md) · [SLO](docs/SLO.md) · [Runbook](docs/runbook.md) · [Runbook de base de datos](docs/runbooks/Runbook_base_de_datos.md) · [Postmortem (simulación)](docs/postmortem-simulacion.md)

## Contribuir

Ramas cortas por cambio, *Pull Request* hacia `main`, CI en verde y revisión antes de fusionar. Mensajes de commit descriptivos.

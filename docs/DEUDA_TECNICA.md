# Inventario de deuda técnica

Línea base: MVP heredado `v0.1.0-mvp` (un solo `index.html` de 1 875 líneas; ADR-01). El inventario original (DT-01 a DT-13) salió de la auditoría de la Guía 1; DT-14 a DT-17 aparecieron durante el semestre (Guía 15). Los números de línea citados en «Ubicación original» son del `index.html` del MVP.

> **Cómo leer los estados.** «Pagada en v1.0» significa que el código de esta versión incluye la corrección. Cada fila indica **dónde** está, para verificarla con `npm run lint`, `npm run test:cov` y una revisión de código antes de cerrar el ítem. Ninguna deuda se resuelve en silencio: cada cambio referencia su DT en el commit o PR.

## Resumen

| Estado | Ítems | Cantidad |
|---|---|---|
| **Pagadas en v1.0** | DT-01 a DT-13, DT-17 | 14 |
| **Parcialmente pagada** | DT-15 (`/health` ya consulta la base; faltan métricas y alerta del pool) | 1 |
| **Pendientes** | DT-14, DT-16 | 2 |

## Detalle

| ID | Deuda | Ubicación original | Categoría | Estado | Cómo se pagó (dónde) |
|---|---|---|---|---|---|
| DT-01 | Credenciales y contraseñas en texto plano; se mostraban en pantalla | `usuarios` (l. 1137-1141); `login-hint` (l. 719-723) | Seguridad | **Pagada** | Usuarios en la tabla `usuarios` con hash bcrypt; contraseñas iniciales solo por variables de entorno (`SEED_*_PASSWORD`); el login ya no muestra credenciales. Vigilancia: Gitleaks (ADR-12) |
| DT-02 | Autenticación y autorización solo en el cliente; sesión forjable en `localStorage` | `iniciarSesion` (l. 1200-1218), `verificarSesion` (l. 1241-1250), `configurarUsuario` (l. 1233-1238) | Seguridad | **Pagada** | JWT (access 15 min + refresh rotativo), RBAC aplicado en el servidor (`src/identity/`), contrato en `openapi/openapi.yaml` (ADR-06). El frontend solo oculta controles; el servidor decide |
| DT-03 | XSS por `innerHTML` y JSON dentro de atributos `onclick` | l. 1354, 1440, 1613-1680, 1627, 1643 | Seguridad | **Pagada** | Frontend (`web/`) con DOM seguro y sin manejadores inline; CSP estricta `script-src 'self'` (helmet). SAST lo vigila: Semgrep + CodeQL (ADR-12) |
| DT-04 | Librerías por CDN sin versión fija ni SRI, con CVE (jsPDF CRITICAL/HIGH, SheetJS HIGH) | l. 7-10 | Seguridad / cadena de suministro | **Pagada** | Sin CDN: dependencias en `package-lock.json`; exportes PDF/Excel en el servidor con `pdfkit` y `exceljs`; Chart.js servido localmente. `npm audit`, Dependabot, Trivy y SBOM en CI |
| DT-05 | Cobertura de pruebas 0 % | Todo el proyecto | Pruebas | **Pagada** | Pruebas unitarias, de integración (PostgreSQL real) y de contrato en `tests/`; umbral de cobertura 70 % en CI (`npm run test:cov`) y Quality Gate. El flujo E2E del navegador queda en el [roadmap](ROADMAP.md) |
| DT-06 | Sin persistencia: los datos se perdían al recargar | `let materiasPrimas/productos/recetas` (l. 1146-1172) | Diseño | **Pagada** | PostgreSQL 16 con migraciones (`src/db/migrations/`), restricciones `CHECK` (stock ≥ 0) y volumen `pgdata` |
| DT-07 | Monolito de un archivo con estado global y handlers inline | Todo `index.html` | Diseño | **Pagada** | Monolito modular con núcleo hexagonal `src/{identity,inventory,catalog,reporting}` (ADR-04/05); frontend en módulos ES (`web/js/`) |
| DT-08 | Movimientos sin historial; entradas negativas posibles; sin salidas | `registrarEntrada` (l. 1539-1557) | Diseño / dominio | **Pagada** | Tabla `movimientos` (kardex) con `cantidad > 0`; entradas atómicas; salidas por producción de recetas |
| DT-09 | Enlace por nombre y unidades inconsistentes entre receta y materia prima | l. 1507, receta vs stock (docena/unid) | Diseño | **Pagada** | Recetas enlazan por `codigo` de materia prima; unidades normalizadas a g/ml/unid (docena = 12 unid) |
| DT-10 | Datos del tablero simulados y quemados | l. 794, 802-814, 1175-1190, 1754-1756 | Diseño | **Pagada (alcance acotado)** | `GET /reportes/dashboard` calcula KPI desde datos reales (valor de inventario, compras, productos por vencer, críticos). Sin ventas simuladas; **ventas y margen real** pasan al [roadmap](ROADMAP.md) (Ahora) |
| DT-11 | Código duplicado y funciones largas/complejas | `guardar*`, `eliminar*`, `filtrar*`, `crearGraficos`; `agregarIngrediente` V(G)=19 | Código | **Pagada** | Casos de uso y validadores compartidos; vistas del frontend separadas; ESLint con reglas de complejidad en CI. Mejora futura: repositorio genérico en el backend |
| DT-12 | Sin Docker, CI/CD ni observabilidad | — | Infraestructura | **Pagada** | `Dockerfile`, `docker-compose.yml`, `.github/workflows/{ci,cd,security}.yml`, `obs/` y `docker-compose.obs.yml` (ADR-09 a ADR-13) |
| DT-13 | `charset="UTF-4"` inválido y `parseInt` que trunca decimales | l. 4; l. 1384-1387 | Código | **Pagada** | `UTF-8`; cantidades `NUMERIC` en la base y números decimales en la API |
| DT-14 | Observabilidad parcial en PaaS: `filelog` solo lee logs de Docker local; el stack suma ≈ 1,2 GB de límites de memoria | `obs/otel-collector.yaml` | Infraestructura | **Pendiente** | Hito 3: reenviar logs del proveedor (Render) al Collector o a un servicio gestionado gratuito |
| DT-15 | `/health` superficial y sin métricas del pool de conexiones | `src/app.js`, `obs/` | Infraestructura | **Parcial** | `/health` ya ejecuta `SELECT 1` (responde 503 si la base falla). Falta exponer `db.pool.in_use` / `db.pool.waiting` y alertar al 80 % durante 2 min (acción 3 del postmortem simulado) |
| DT-16 | Node.js 22 cerca del fin de su soporte | `Dockerfile`, `package.json` (`engines`) | Entorno | **Pendiente** | Hito 2: migrar a Node.js 24 LTS antes de abril de 2027 (confirmar la fecha en nodejs.org) |
| DT-17 | Pruebas de integración sobre SQLite en memoria, no sobre PostgreSQL | ADR-07 (excepción temporal) | Pruebas | **Pagada** | La suite de integración y de contrato corre contra PostgreSQL real (servicio del CI y PostgreSQL embebido en local); las diferencias de `NUMERIC` y de concurrencia ya quedan cubiertas |

## Cuadrante de Fowler (clasificación original)

| Deuda | Cuadrante |
|---|---|
| DT-01, DT-03, DT-05, DT-13 | Inadvertida + Imprudente |
| DT-02, DT-08, DT-09 | Inadvertida + Prudente (el diseño original quedó obsoleto al crecer el negocio) |
| DT-04, DT-06, DT-10, DT-12 | Deliberada + Prudente (atajos de MVP asumidos; este inventario es su plan de pago) |
| DT-07, DT-11 | Inadvertida + Imprudente |

La regla de oro del proyecto: toda deuda que se asuma desde ahora debe ser **deliberada y prudente** — documentada aquí, justificada y con plan de pago explícito en el [roadmap](ROADMAP.md).

# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y versionado semántico.

## [1.4.0] — Más fácil para quien empieza (2026-11-12)

### Cambiado
- **Menú de 5 opciones** en palabras de todos los días: Inicio, Vender, Hornear, Inventario y Avisos. Las demás quedan en «Más» (Ganancias y «¿Cómo se usa?»).
- **Barra inferior en el celular**, como en las apps de mensajería: Inicio, Vender, Hornear, Inventario y Más.
- **Inventario en un solo lugar**, con tres pestañas: Ingredientes, Productos y Entradas.
- **Inicio:**
  - botones grandes de «¿Qué quieres hacer?»: Registrar una venta, Hornear, Llegaron ingredientes y Contar el inventario. Cada uno lleva directo a la acción (`#/ventas/nueva`, `#/recetas/hornear`, `#/movimientos/entrada`);
  - los gráficos y detalles quedan plegados en «Ver más detalles»;
  - guía de bienvenida la primera vez.
- **Lenguaje simple:**
  - se reemplazaron los términos técnicos: materias primas → ingredientes, kardex → historial, stock mínimo → «avisar bajo», margen → ganancia, ROI → rendimiento;
  - los estados se llaman Suficiente / Poco / Muy poco y Fresco / Vence pronto / Vencido;
  - el SKU ya no se muestra.
- **Botones con texto** («Contar», «Historial», «Editar») en lugar de íconos solos. «Eliminar» queda dentro de «Editar», para evitar borrados por error.
- **Códigos automáticos** al crear ingredientes y productos (MP006, PT005).
- **Hornear:** una tarjeta por producto con un solo botón grande y los ingredientes desplegables.
- **Vender:** preguntas en lugar de etiquetas («¿Qué vendiste?», «¿Cuántos?»). Quien vende solo ve el «Total a cobrar»; costos y ganancia, solo el administrador y el contador.
- **Accesibilidad:**
  - letra base de 16 px;
  - botones y campos de 46 a 48 px de alto;
  - en el celular, los mensajes aparecen arriba para no tapar los botones.

### Verificado
- axe-core: 0 violaciones WCAG 2 A/AA en 64 combinaciones (8 pantallas × 2 temas × 2 tamaños × 2 roles).
- 174 pruebas y 7 E2E; la nueva E2E cubre la guía y el atajo de venta.

## [1.3.0] — Tablero «obrador en vivo» (2026-11-12)

### Cambiado
- **Tablero rediseñado** con los mismos datos reales:
  - portada con aurora animada, chispas, saludo según la hora y reloj;
  - ventas de 30 días que cuentan al aparecer, con curva de 7 días que se dibuja;
  - chips de margen, ventas, ticket promedio y mejor día;
  - anillos de progreso para margen, ROI, salud del inventario y frescura;
  - tarjetas con brillo que sigue al puntero;
  - podio de más vendidos con medallas y barras animadas;
  - «Pulso de la pastelería» (ventas y movimientos recientes);
  - barras de insumos bajo mínimo y gráficos con degradados;
  - esqueleto de carga.
- Con «reducir movimiento» activado en el sistema, todo aparece sin animación.
- `GET /movimientos` incluye `nombre` y `unidad` de la materia prima.

### Corregido
- `h()` no aplicaba propiedades CSS personalizadas (`--x`) en el atributo `style`.

### Verificado
- axe-core: 0 violaciones WCAG 2 A/AA en el tablero (claro y oscuro, 1440 px y 390 px).
- 174 pruebas y 6 E2E en verde.

## [1.2.0] — App instalable sin servidor (2026-11-12)

### Añadido
- **PWA** (ADR-18): `npm run build:pwa` genera `dist-pwa/`, una versión que se abre con un enlace, se instala en el celular y funciona sin internet. Usa la misma interfaz y las mismas reglas de negocio; la API la responde el navegador (`pwa/servidor.js`) y los datos quedan en el dispositivo.
- «Datos y cuenta» (solo PWA): descargar y restaurar respaldo, cambiar contraseña y reiniciar los datos de demostración; botón «Instalar la app».
- Exportación PDF y Excel dentro del navegador, con el mismo formato que el servidor.
- Workflow `pages` para publicar en GitHub Pages; 6 pruebas `tests/pwa/` que verifican las mismas cifras que el servidor.
- Ícono de la app (cupcake) en SVG y PNG, incluido el maskable para Android.

### Cambiado
- Los datos demo (`src/db/datosDemo.js`) y las definiciones de reportes (`src/reporting/domain/definicionesReporte.js`) se separaron para compartirlos entre el servidor y la PWA.
- `index.html` usa rutas relativas (funciona servido desde una subcarpeta).

## [1.1.0] — Aplicativo mejorado (2026-11-12)

### Añadido
- **Ventas** (contexto nuevo, ADR-17): `POST /ventas` con varias líneas, precio pactado opcional, `Idempotency-Key`, bloqueo de stock y rechazo de productos vencidos; `GET /ventas` con filtro por fecha y resumen del período. Pantalla «Ventas» con carrito, total y margen estimado en vivo.
- **Costeo:** `GET /recetas/{id}/costeo` (costo estándar con conversión de unidades); producir costea el lote, recalcula el costo promedio ponderado y puede actualizar la caducidad. `GET /reportes/rentabilidad` y pantalla «Costos y márgenes» (admin y contador). Exportación de ventas a PDF y Excel.
- **Tablero:** ventas, margen bruto, ROI sobre costo y pérdidas de 30 días; gráficos de ventas y margen de 7 días y más vendidos.
- **Alertas:** `GET /reportes/alertas` (vencidos con stock, por vencer, valor en riesgo, insumos por reponer); pantalla «Alertas» con baja en un clic e insignia en el menú.
- **Ajustes por conteo físico** con motivo, para materias primas (`POST /movimientos/ajustes`) y productos (`POST /productos/{sku}/ajustes`); kardex de producto terminado (`GET /productos/{sku}/movimientos`, DT-22). Filtro por tipo en `GET /movimientos`.
- Métricas `pastel_db_pool_*` y alertas `DbPoolSaturado` / `DbPoolConEspera` (DT-15).
- Pruebas E2E con Playwright (`npm run test:e2e`, job `e2e` en CI): venta, validación de stock, baja de vencido, conteo en celular y permisos.

### Cambiado
- **Rediseño visual** completo: nueva paleta, tipografía, tarjetas KPI, menú agrupado; en celular, barra superior con menú deslizable y tablas convertidas en tarjetas. Sin violaciones WCAG 2 A/AA (axe-core) en las 8 vistas, ambos temas y ambos tamaños.
- Un producto con ventas, producciones o bajas ya no se puede eliminar (409); se deja en stock 0.
- Editar el stock de un producto deja un ajuste `CORRECCION` en su kardex.

### Corregido
- Con la base caída, las rutas de negocio respondían 500; ahora 503 con `Retry-After` (DT-20).
- En celular (390 px) el menú lateral desaparecía y no había forma de navegar.
- `npm run lint` fallaba en CI por los globales del script `scripts/verificar-reintento-ui.cjs` (PR #5).

### Migración
- `004_ventas_costeo_ajustes.sql` (aditiva): tablas `ventas`, `venta_items`, `movimientos_producto`; columnas `productos.costo_unitario` y `movimientos.motivo`; tipo `AJUSTE_NEGATIVO`. Costea los productos con receta y registra el saldo inicial de cada producto en su kardex.

## [Sin publicar] — Validación y piloto II–06

### Corregido
- La interfaz enviaba «producir» sin `Idempotency-Key`: si se perdía la respuesta y la persona reintentaba, se producía dos veces (comprobado en navegador: 1 intención → 2 producciones). Ahora genera una clave por intención (se renueva al cambiar el formulario y tras un éxito) y la conserva en el reintento tras renovar el token.

## [Sin publicar] — Despliegue y operación II–05

### Añadido
- `scripts/ensayo-despliegue.sh`: ensayo automatizado de entrega, verificación, incidente y recuperación en dos clústeres PostgreSQL 16 locales con datos ficticios.
- Runbook: sección «Entrega y reversión» y advertencia sobre la reversión de código tras la migración 002.
- Deuda DT-20 (500 en lugar de 503 con la base caída) y DT-21 (reversión con redondeo a 3 decimales).

## [Sin publicar] — Calidad II–04

### Añadido
- Pruebas de frontera y seguridad de «producir» (`tests/integration/fronteras.test.js`) y regresión de contraste (`tests/web/contraste.test.js`).

### Corregido
- Login: el marcador de posición de los campos tenía contraste 2,24:1 (WCAG 2.x AA exige 4,5:1); ahora usa el color secundario del tema (D-02).
- Prueba del tablero dependía del día real (fallaba al cambiar la fecha); ahora fija la fecha del movimiento (D-01).

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

# ADR-18: Versión instalable sin servidor (PWA) que reutiliza la interfaz y las reglas de negocio

| Campo | Valor |
|---|---|
| **Estado** | Aceptado (v1.2) |
| **Autor** | Kevin Andres Rojas Marin |
| **Relacionado** | ADR-03 (monolito con API), ADR-05, ADR-17 |
| **Implementación** | `pwa/`, `scripts/build-pwa.mjs`, `web/js/modo.js`, `.github/workflows/pages.yml`, `tests/pwa/` |

## Contexto

Para usar Pastel Stock hoy hace falta un servidor Node y una base PostgreSQL. Eso sirve para producción, pero es una barrera para mostrar el sistema, probarlo en el local de Dulce Hogar o usarlo en un celular sin conexión estable. Se pidió una versión que se abra con un enlace y se instale en el celular, igual que una app.

## Alternativas

| Alternativa | Beneficio | Costo o riesgo |
|---|---|---|
| A. Desplegar el servidor en un PaaS gratuito | Datos centralizados | Arranque en frío, base gratuita que caduca, requiere conexión |
| B. Reescribir la app solo para el navegador | Independiente | Dos códigos que divergen; las reglas de negocio se duplican |
| **C. PWA que reutiliza `web/` sin cambios y un servidor local en el navegador que importa las reglas de `src/*/domain` (elegida)** | Mismo código de interfaz y de dominio; funciona sin conexión; publicación gratuita en GitHub Pages | Los datos viven en un solo dispositivo |

## Decisión

- `web/js/modo.js` exporta `modoLocal = null` en la versión con servidor. El build de la PWA lo reemplaza por `pwa/modo-local.js`, que entrega a `crearAuth` y `crearApi` un `fetch` propio (`pwa/servidor.js`). La interfaz no sabe en qué modo corre.
- `pwa/servidor.js` responde las mismas rutas, códigos y problemas RFC 9457 que la API, con las reglas importadas del backend (unidades, estado de stock, ajustes, costeo, ventas, tablero, alertas). `tests/pwa/` comprueba que con los datos demo da **las mismas cifras** que el servidor Node.
- Cada operación trabaja sobre una copia del estado y solo se confirma si termina sin error: todo o nada, como una transacción.
- Persistencia en `localStorage`; respaldo y restauración en JSON; contraseñas con SHA-256 y sal por usuario.
- Service worker con precarga de todos los archivos (uso sin conexión). PDF y Excel se generan en el navegador con pdfkit y exceljs, las mismas librerías del servidor, y se guardan en caché al primer uso.
- Publicación con `.github/workflows/pages.yml` (o la rama `gh-pages`).

## Consecuencias

**Positivas**
- Un enlace basta para usarla; se instala en Android, iPhone y escritorio; funciona sin internet.
- No hay segunda copia de las reglas de negocio: un cambio en `src/*/domain` llega a ambas versiones.

**Negativas y límites que se aceptan**
- **Los datos están en un solo dispositivo.** No hay sincronización entre celulares; si se borran los datos del navegador se pierden. Mitigación: botón de respaldo y aviso en pantalla. Para varios equipos o personas, se usa la versión con servidor.
- **La seguridad es local.** Los roles y contraseñas evitan errores de uso, no protegen contra alguien con acceso al dispositivo: los datos se pueden leer desde las herramientas del navegador. No apto para datos que deban protegerse de quien tiene el celular.
- `localStorage` admite unos 5 MB: suficiente para años de una pastelería pequeña (≈ 1 KB por venta), pero no ilimitado. La app avisa si se llena.

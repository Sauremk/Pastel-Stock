// Generado por scripts/build-pwa.mjs — no editar a mano.
const VERSION = 'pastel-stock-1.2.0-f5a6bdbc1a';
const PRECACHE = ["./","css/styles.css","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","icons/icon.svg","index.html","js/api.js","js/auth.js","js/catalogos.js","js/dom.js","js/format.js","js/main.js","js/modo.js","js/ui.js","js/validacion.js","js/views/ajuste.js","js/views/alertas.js","js/views/dashboard.js","js/views/exportar.js","js/views/materias.js","js/views/movimientos.js","js/views/productos.js","js/views/recetas.js","js/views/rentabilidad.js","js/views/ventas.js","manifest.webmanifest","pwa/exportar.js","pwa/modo-local.js","pwa/semilla.js","pwa/servidor.js","src/catalog/domain/costeo.js","src/db/datosDemo.js","src/inventory/domain/ajustes.js","src/inventory/domain/stock.js","src/inventory/domain/unidades.js","src/reporting/domain/dashboard.js","src/reporting/domain/definicionesReporte.js","src/sales/domain/venta.js","src/shared/errors.js","vendor/chart.umd.js"];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith('pastel-stock-') && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Primero la caché (funciona sin conexión); lo que no está se pide a la red y se guarda (PDF y Excel al primer uso).
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((enCache) => enCache || fetch(req).then((resp) => {
    if (resp.ok && resp.type === 'basic') { const copia = resp.clone(); caches.open(VERSION).then((c) => c.put(req, copia)); }
    return resp;
  }).catch(() => (req.mode === 'navigate' ? caches.match('./') : Response.error()))));
});

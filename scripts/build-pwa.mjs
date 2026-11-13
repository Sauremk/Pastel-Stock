#!/usr/bin/env node
// Construye Pastel Stock como app web progresiva SIN servidor (carpeta dist-pwa/), lista para GitHub Pages.
// Reutiliza la interfaz de web/ sin cambios y las reglas de negocio de src/*/domain; la API la responde
// pwa/servidor.js dentro del navegador y los datos quedan en el dispositivo.
//   node scripts/build-pwa.mjs [carpeta-salida]
import { cp, mkdir, rm, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const salida = path.resolve(raiz, process.argv[2] ?? 'dist-pwa');
const de = (...p) => path.join(raiz, ...p);
const a = (...p) => path.join(salida, ...p);

const pkg = JSON.parse(await readFile(de('package.json'), 'utf8'));

await rm(salida, { recursive: true, force: true });
await mkdir(salida, { recursive: true });

// 1) Interfaz (idéntica a la del servidor) y modo local
await cp(de('web'), salida, { recursive: true });
await writeFile(a('js', 'modo.js'), "// Versión sin servidor: la API la responde el navegador (pwa/servidor.js).\nexport { modoLocal } from '../pwa/modo-local.js';\n");
await mkdir(a('pwa'), { recursive: true });
for (const f of ['servidor.js', 'semilla.js', 'exportar.js', 'modo-local.js']) await cp(de('pwa', f), a('pwa', f));
await cp(de('pwa', 'icons'), a('icons'), { recursive: true });

// 2) Reglas de negocio del backend (código puro, sin Node): las mismas que usa el servidor
const dominio = [
  'src/shared/errors.js',
  'src/inventory/domain/unidades.js', 'src/inventory/domain/stock.js', 'src/inventory/domain/ajustes.js',
  'src/catalog/domain/costeo.js', 'src/sales/domain/venta.js',
  'src/reporting/domain/dashboard.js', 'src/reporting/domain/definicionesReporte.js',
  'src/db/datosDemo.js',
];
for (const f of dominio) {
  const texto = await readFile(de(f), 'utf8');
  if (/from 'node:|require\(/.test(texto)) throw new Error(`${f} usa módulos de Node: no puede ir al navegador`);
  await mkdir(path.dirname(a(f)), { recursive: true });
  await writeFile(a(f), texto);
}

// 3) Librerías de terceros (sin CDN): gráficos siempre; PDF y Excel se cargan al exportar
await mkdir(a('vendor'), { recursive: true });
await cp(de('node_modules/chart.js/dist/chart.umd.js'), a('vendor', 'chart.umd.js'));
await cp(de('node_modules/exceljs/dist/exceljs.min.js'), a('vendor', 'exceljs.min.js'));
await cp(de('node_modules/pdfkit/js/pdfkit.standalone.js'), a('vendor', 'pdfkit.standalone.js'));

// 4) index.html: manifiesto, íconos, color de tema y CSP (GitHub Pages no permite cabeceras propias)
let html = await readFile(a('index.html'), 'utf8');
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";
html = html
  .replace(/<link rel="icon"[^>]*>/, [
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    '<meta name="theme-color" content="#24170F">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
    '<meta name="apple-mobile-web-app-title" content="Pastel Stock">',
    '<link rel="manifest" href="manifest.webmanifest">',
    '<link rel="icon" href="icons/icon-192.png" type="image/png">',
    '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">',
  ].join('\n    '));
if (!html.includes('manifest.webmanifest')) throw new Error('No se pudo preparar index.html (cambió la etiqueta del ícono)');
await writeFile(a('index.html'), html);

// 5) Manifiesto de la app instalable
await writeFile(a('manifest.webmanifest'), JSON.stringify({
  name: 'Pastel Stock — Dulce Hogar',
  short_name: 'Pastel Stock',
  description: 'Inventario, recetas, producción y ventas para tu pastelería. Funciona sin internet.',
  lang: 'es-CO',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'any',
  background_color: '#24170F',
  theme_color: '#24170F',
  categories: ['business', 'productivity', 'food'],
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
  shortcuts: [
    { name: 'Registrar venta', url: './#/ventas', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
    { name: 'Alertas', url: './#/alertas', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
  ],
}, null, 2));

// 6) Service worker: guarda todos los archivos para usar la app sin conexión. La versión cambia con el contenido.
async function listar(dir) {
  const fuera = [];
  for (const n of await readdir(dir)) {
    const p = path.join(dir, n);
    if ((await stat(p)).isDirectory()) fuera.push(...await listar(p)); else fuera.push(p);
  }
  return fuera;
}
const archivos = (await listar(salida)).map((p) => path.relative(salida, p).split(path.sep).join('/')).sort();
const huella = createHash('sha256');
for (const f of archivos) huella.update(f).update(await readFile(a(f)));
const version = `${pkg.version}-${huella.digest('hex').slice(0, 10)}`;
const pesados = new Set(['vendor/exceljs.min.js', 'vendor/pdfkit.standalone.js']); // se guardan al primer uso
const precache = ['./', ...archivos.filter((f) => !pesados.has(f))];
await writeFile(a('sw.js'), `// Generado por scripts/build-pwa.mjs — no editar a mano.
const VERSION = 'pastel-stock-${version}';
const PRECACHE = ${JSON.stringify(precache, null, 0)};

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
`);
await writeFile(a('.nojekyll'), '');

const tam = (await Promise.all(archivos.map(async (f) => (await stat(a(f))).size))).reduce((x, y) => x + y, 0);
console.log(`PWA lista en ${path.relative(raiz, salida)}/ · ${archivos.length} archivos · ${(tam / 1024 / 1024).toFixed(1)} MB · versión ${version}`); // eslint-disable-line no-console

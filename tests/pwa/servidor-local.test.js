// App sin servidor (PWA): el servidor local responde la API con las mismas reglas y cifras que el servidor Node.
// Reloj fijo 06-nov-2026 (Bogotá), mismos datos demo → mismos números que tests/integration/costeo-ajustes.test.js.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { crearServidorLocal } from '../../pwa/servidor.js';
import { CLAVE_DEMO } from '../../pwa/semilla.js';

const AHORA = new Date('2026-11-06T15:00:00Z');
let srv; let almacen;
const memoria = () => { let t = null; return { leer: () => t, guardar: (x) => { t = x; } }; };

async function llamar(metodo, ruta, { cuerpo, token, cabeceras = {} } = {}) {
  const r = await srv.fetch(`/api/v1${ruta}`, {
    method: metodo,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cuerpo ? { 'Content-Type': 'application/json' } : {}), ...cabeceras },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = r.status === 204 ? '' : await r.text();
  let json = null; try { json = JSON.parse(texto); } catch { /* binario */ }
  return { status: r.status, body: json, headers: r.headers };
}
const entrar = async (usuario) => (await llamar('POST', '/auth/login', { cuerpo: { usuario, contrasena: CLAVE_DEMO } })).body.accessToken;

beforeEach(() => { almacen = memoria(); srv = crearServidorLocal({ almacen, reloj: () => AHORA }); });

test('login con la clave demo; credenciales malas → 401; sin token → 401; rol sin permiso → 403', async () => {
  const ok = await llamar('POST', '/auth/login', { cuerpo: { usuario: 'admin', contrasena: CLAVE_DEMO } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.nombre, 'Ana García');
  assert.equal((await llamar('POST', '/auth/login', { cuerpo: { usuario: 'admin', contrasena: 'x' } })).status, 401);
  assert.equal((await llamar('GET', '/productos')).status, 401);
  const op = await entrar('operador');
  assert.equal((await llamar('GET', '/reportes/rentabilidad', { token: op })).status, 403);
  // El refresh rota y sobrevive a "recargar la página" (nuevo servidor sobre el mismo almacén)
  srv = crearServidorLocal({ almacen, reloj: () => AHORA });
  const r = await llamar('POST', '/auth/refresh', { cuerpo: { refreshToken: ok.body.refreshToken } });
  assert.equal(r.status, 200);
  assert.equal((await llamar('POST', '/auth/refresh', { cuerpo: { refreshToken: ok.body.refreshToken } })).status, 401, 'un refresh usado no se reutiliza');
});

test('tablero: mismas cifras que el servidor Node con los datos demo', async () => {
  const d = (await llamar('GET', '/reportes/dashboard', { token: await entrar('contador') })).body;
  assert.deepEqual([d.ventasUltimos30Dias, d.costoVentasUltimos30Dias, d.margenBrutoUltimos30Dias, d.margenPorcentaje30Dias, d.roi30Dias], [452500, 148650, 303850, 67.15, 204.41]);
  assert.deepEqual(d.ventasUltimos7Dias.map((x) => x.total), [34000, 82000, 40000, 58000, 161000, 77500, 0]);
  assert.deepEqual(d.topProductosVendidos.map((p) => p.sku), ['PT001', 'PT004', 'PT002', 'PT003']);
  assert.equal(d.totalIngredientesCriticos, 2);
});

test('producir y vender: costeo, costo promedio, idempotencia y todo-o-nada', async () => {
  const op = await entrar('operador');
  assert.equal((await llamar('GET', '/recetas/1/costeo', { token: op })).body.costoUnitario, 9350);
  const prod = await llamar('POST', '/recetas/1/producir', { token: op, cuerpo: { unidades: 2, caducidad: '2026-11-10' }, cabeceras: { 'Idempotency-Key': 'lote-0001-abc' } });
  assert.equal(prod.status, 201);
  assert.deepEqual([prod.body.stockProducto, prod.body.costoLote, prod.body.caducidadProducto], [10, 18700, '2026-11-10']);
  const otra = await llamar('POST', '/recetas/1/producir', { token: op, cuerpo: { unidades: 2, caducidad: '2026-11-10' }, cabeceras: { 'Idempotency-Key': 'lote-0001-abc' } });
  assert.equal(otra.headers.get('Idempotency-Replayed'), 'true');
  assert.equal((await llamar('GET', '/productos/PT001', { token: op })).body.stock, 10, 'el reintento no produjo dos veces');

  const v = await llamar('POST', '/ventas', { token: op, cuerpo: { items: [{ sku: 'PT001', cantidad: 2 }, { sku: 'PT003', cantidad: 10, precioUnitario: 700 }] } });
  assert.equal(v.status, 201);
  assert.deepEqual([v.body.total, v.body.costoTotal, v.body.margen], [77000, 21800, 55200]);
  const falla = await llamar('POST', '/ventas', { token: op, cuerpo: { items: [{ sku: 'PT003', cantidad: 1 }, { sku: 'PT004', cantidad: 50 }] } });
  assert.equal(falla.status, 409);
  assert.deepEqual(falla.body.faltantes, [{ sku: 'PT004', solicitado: 50, disponible: 4 }]);
  assert.equal((await llamar('GET', '/productos/PT003', { token: op })).body.stock, 50, 'la línea que sí alcanzaba no se descontó');
  // Los datos persisten: un "nuevo arranque" sobre el mismo almacén ve la venta
  srv = crearServidorLocal({ almacen, reloj: () => AHORA });
  const lista = await llamar('GET', '/ventas?limite=1', { token: await entrar('contador') });
  assert.equal(lista.body.datos[0].total, 77000);
});

test('alertas, baja por vencimiento y ajuste de materia prima', async () => {
  const admin = await entrar('admin');
  await llamar('POST', '/productos', { token: admin, cuerpo: { sku: 'PT080', nombre: 'Croissant', categoria: 'Panes', stock: 2, precio: 3000, caducidad: '2026-11-01', costoUnitario: 1000 } });
  const a = (await llamar('GET', '/reportes/alertas', { token: admin })).body;
  assert.deepEqual(a.porVencer.map((p) => [p.sku, p.diasRestantes]), [['PT002', 1], ['PT004', 1], ['PT001', 2]]);
  assert.deepEqual(a.vencidos.map((p) => [p.sku, p.diasRestantes]), [['PT080', -5]]);
  assert.equal(a.valorEnRiesgoACosto, 149800);
  const baja = await llamar('POST', '/productos/PT080/ajustes', { token: admin, cuerpo: { stockContado: 0, motivo: 'VENCIMIENTO' } });
  assert.equal(baja.body.valorDiferencia, -2000);
  const k = (await llamar('GET', '/productos/PT080/movimientos', { token: admin })).body.datos[0];
  assert.deepEqual([k.tipo, k.cantidad], ['BAJA', 2]);
  assert.equal((await llamar('DELETE', '/productos/PT080', { token: admin })).status, 409);

  const aj = await llamar('POST', '/movimientos/ajustes', { token: admin, cuerpo: { codigo: 'MP002', stockContado: 7500, motivo: 'MERMA' } });
  assert.deepEqual([aj.status, aj.body.diferencia, aj.body.valorDiferencia], [201, -500, -1500]);
  assert.equal((await llamar('GET', '/reportes/dashboard', { token: admin })).body.perdidasUltimos30Dias, 3500);
});

test('validaciones: cuerpo con campos extra, unidad incompatible y parámetros inválidos → 422', async () => {
  const admin = await entrar('admin');
  assert.equal((await llamar('POST', '/ventas', { token: admin, cuerpo: { items: [{ sku: 'PT001', cantidad: 1 }], extra: 1 } })).status, 422);
  const rec = await llamar('POST', '/recetas', { token: admin, cuerpo: { productoSku: 'PT002', ingredientes: [{ codigoMateriaPrima: 'MP003', cantidad: 10, unidad: 'g' }] } });
  assert.equal(rec.status, 422);
  assert.match(rec.body.title, /Unidad incompatible/);
  assert.equal((await llamar('GET', '/materias-primas/XX1', { token: admin })).status, 422);
  assert.equal((await llamar('GET', '/reportes/alertas?dias=99', { token: admin })).status, 422);
  assert.equal((await llamar('GET', '/no-existe', { token: admin })).status, 404);
});

test('respaldo: exportar e importar restaura los datos; cambiar contraseña', async () => {
  const admin = await entrar('admin');
  const resp = await srv.fetch('/api/v1/local/respaldo', { headers: { Authorization: `Bearer ${admin}` } });
  assert.match(resp.headers.get('Content-Disposition'), /pastel-stock-respaldo-2026-11-06\.json/);
  const respaldo = JSON.parse(await resp.text());
  await llamar('POST', '/ventas', { token: admin, cuerpo: { items: [{ sku: 'PT003', cantidad: 5 }] } });
  assert.equal((await llamar('GET', '/productos/PT003', { token: admin })).body.stock, 55);
  assert.equal((await llamar('POST', '/local/respaldo', { token: admin, cuerpo: respaldo })).status, 204);
  const otra = await entrar('admin');
  assert.equal((await llamar('GET', '/productos/PT003', { token: otra })).body.stock, 60);
  assert.equal((await llamar('POST', '/local/respaldo', { token: otra, cuerpo: { app: 'otra' } })).status, 422);

  assert.equal((await llamar('POST', '/local/contrasena', { token: otra, cuerpo: { actual: CLAVE_DEMO, nueva: 'NuevaClave-2026' } })).status, 204);
  assert.equal((await llamar('POST', '/auth/login', { cuerpo: { usuario: 'admin', contrasena: CLAVE_DEMO } })).status, 401);
  assert.equal((await llamar('POST', '/auth/login', { cuerpo: { usuario: 'admin', contrasena: 'NuevaClave-2026' } })).status, 200);
});

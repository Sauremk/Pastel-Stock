// Prueba de extremo a extremo (DT-21 / roadmap v1.1): navegador Chromium real contra la API real y PostgreSQL real.
// No corre en `npm test` (necesita el navegador). Ejecutar: `npx playwright install chromium` y `npm run test:e2e`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { crearEntorno, AHORA, CLAVES } from '../helpers/entorno.js';

let e; let servidor; let navegador; let base;
before(async () => {
  e = await crearEntorno();
  servidor = await new Promise((ok) => { const s = e.app.listen(0, () => ok(s)); });
  base = `http://127.0.0.1:${servidor.address().port}`;
  navegador = await chromium.launch();
});
after(async () => { await navegador?.close(); servidor?.close(); await e?.cerrar(); });

async function abrir(usuario, { ancho = 1366 } = {}) {
  const pagina = await navegador.newPage({ viewport: { width: ancho, height: 900 } });
  const errores = [];
  pagina.on('pageerror', (err) => errores.push(err.message));
  pagina.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errores.push(m.text()); });
  await pagina.clock.setFixedTime(AHORA); // el navegador comparte el "hoy" fijo del servidor de pruebas (06-nov-2026)
  await pagina.goto(base);
  await pagina.fill('#login-user', usuario);
  await pagina.fill('#login-pass', CLAVES[usuario]);
  await pagina.click('#login-submit');
  await pagina.getByRole('heading', { level: 1, name: /^Buen(os|as) (días|tardes|noches)/ }).waitFor();
  return { pagina, errores };
}
// Consultas de verificación por HTTP real contra el mismo servidor que usa el navegador.
async function api(metodo, ruta, cuerpo) {
  const { accessToken } = await e.login('admin');
  const r = await fetch(`${base}/api/v1${ruta}`, { method: metodo, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  return r.json();
}
const stock = async (sku) => (await api('GET', `/productos/${sku}`)).stock;

test('operador: registra una venta de dos productos desde la interfaz y el tablero la refleja', async () => {
  const { pagina, errores } = await abrir('operador');
  await pagina.getByRole('button', { name: 'Ventas' }).click();
  await pagina.getByRole('button', { name: /Registrar venta/ }).click();
  const dialogo = pagina.getByRole('dialog', { name: 'Registrar venta' });
  await dialogo.getByLabel('Producto', { exact: true }).first().selectOption('PT001');
  await dialogo.getByLabel('Cantidad', { exact: true }).first().fill('2');
  await dialogo.getByRole('button', { name: /Agregar otro producto/ }).click();
  await dialogo.getByLabel('Producto', { exact: true }).nth(1).selectOption('PT003');
  await dialogo.getByLabel('Cantidad', { exact: true }).nth(1).fill('10');
  await dialogo.getByLabel('Precio unit.').nth(1).fill('700');
  assert.match(await dialogo.locator('.resumen-venta .total').innerText(), /77\.000/);
  await dialogo.getByRole('button', { name: 'Registrar venta' }).click();
  await pagina.getByText(/Venta #\d+ registrada/).waitFor();
  assert.equal(await stock('PT001'), 6);
  assert.equal(await stock('PT003'), 50);
  // El historial muestra la venta nueva arriba. La base fecha la venta con SU reloj (hoy real) y el navegador vive el
  // 06-nov fijo: se quita el filtro "Hasta" para no depender de esa diferencia.
  await pagina.getByLabel('Hasta').fill('');
  await pagina.getByLabel('Hasta').dispatchEvent('change');
  await pagina.locator('tbody tr').first().getByText('2× Pastel de Chocolate, 10× Galletas de Mantequilla').waitFor();
  // El kardex del producto registra la venta (el tablero filtra por el "hoy" fijo del servidor, ver arriba)
  await pagina.getByRole('button', { name: 'Productos' }).click();
  await pagina.getByRole('button', { name: 'Kardex de Pastel de Chocolate' }).click();
  await pagina.getByRole('dialog', { name: /Kardex/ }).getByText('−2').first().waitFor();
  assert.deepEqual(errores, []);
  await pagina.close();
});

test('operador: la venta no permite más unidades que el stock (validación antes de enviar)', async () => {
  const { pagina } = await abrir('operador');
  await pagina.goto(`${base}/#/ventas`);
  await pagina.getByRole('button', { name: /Registrar venta/ }).click();
  const dialogo = pagina.getByRole('dialog', { name: 'Registrar venta' });
  await dialogo.getByLabel('Producto', { exact: true }).first().selectOption('PT004');
  await dialogo.getByLabel('Cantidad', { exact: true }).first().fill('99');
  await dialogo.getByRole('button', { name: 'Registrar venta' }).click();
  await dialogo.getByText('Solo hay 4.').waitFor();
  assert.equal(await stock('PT004'), 4);
  await pagina.close();
});

test('alertas: dar de baja un producto vencido lo saca de alertas y suma pérdidas', async () => {
  await api('POST', '/productos', { sku: 'PT090', nombre: 'Mantecada', categoria: 'Panes', stock: 6, precio: 2000, caducidad: '2026-11-04', costoUnitario: 700 });
  const { pagina, errores } = await abrir('operador');
  await pagina.getByRole('button', { name: /^Alertas/ }).click();
  const item = pagina.locator('.alerta-item', { hasText: 'Mantecada' });
  await item.getByText('Venció hace 2 días').waitFor();
  await item.getByRole('button', { name: 'Dar de baja' }).click();
  const dialogo = pagina.getByRole('dialog', { name: 'Ajustar stock del producto' });
  assert.equal(await dialogo.getByLabel(/Stock contado/).inputValue(), '0');
  assert.equal(await dialogo.getByLabel('Motivo').inputValue(), 'VENCIMIENTO');
  await dialogo.getByRole('button', { name: 'Aplicar ajuste' }).click();
  await pagina.getByText(/Ajuste aplicado \(−?-6 unidades/).waitFor();
  await pagina.getByText('No hay productos vencidos con stock.').waitFor();
  assert.equal(await stock('PT090'), 0);
  assert.deepEqual(errores, []);
  await pagina.close();
});

test('materias primas: ajuste por conteo físico desde la tabla (en celular)', async () => {
  const { pagina, errores } = await abrir('operador', { ancho: 390 });
  await pagina.getByRole('button', { name: 'Abrir menú' }).click();
  await pagina.getByRole('button', { name: 'Materias primas' }).click();
  await pagina.getByRole('button', { name: 'Ajustar stock de Azúcar por conteo' }).click();
  const dialogo = pagina.getByRole('dialog', { name: 'Ajustar stock por conteo' });
  await dialogo.getByLabel(/Stock contado/).fill('7800');
  await dialogo.getByText('Diferencia: -200 g (se descuenta).').waitFor();
  await dialogo.getByLabel('Motivo').selectOption('MERMA');
  await dialogo.getByRole('button', { name: 'Aplicar ajuste' }).click();
  await pagina.getByText(/Ajuste aplicado/).waitFor();
  const mp = await api('GET', '/materias-primas/MP002');
  assert.equal(mp.stock, 7800);
  assert.deepEqual(errores, []);
  await pagina.close();
});

test('contador: ve Costos y márgenes pero no puede registrar ventas', async () => {
  const { pagina, errores } = await abrir('contador');
  await pagina.getByRole('button', { name: 'Costos y márgenes' }).click();
  await pagina.getByRole('cell', { name: /Pastel de Chocolate/ }).waitFor();
  await pagina.getByRole('button', { name: 'Ventas' }).click();
  await pagina.getByRole('heading', { name: 'Ventas' }).waitFor();
  assert.equal(await pagina.getByRole('button', { name: /Registrar venta/ }).count(), 0);
  assert.deepEqual(errores, []);
  await pagina.close();
});

test('operador: no ve Costos y márgenes en el menú ni entra por URL', async () => {
  const { pagina } = await abrir('operador');
  assert.equal(await pagina.getByRole('button', { name: 'Costos y márgenes' }).isVisible(), false);
  await pagina.goto(`${base}/#/rentabilidad`);
  await pagina.getByRole('heading', { level: 1, name: /^Buen(os|as) (días|tardes|noches)/ }).waitFor();
  await pagina.close();
});

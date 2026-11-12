import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearEntorno } from '../helpers/entorno.js';

// Ventas y costeo (v1.1, paga DT-10). Reloj fijo: 06-nov-2026 en Bogotá. Precios y costos de la siembra:
// PT001 35.000 / 9.350 · PT002 1.500 / 600 · PT003 800 / 310 · PT004 28.000 / 11.500 (PT002 y PT004 vencen mañana).
let e; let admin; let operador; let contador;
before(async () => { e = await crearEntorno(); admin = await e.como('admin'); operador = await e.como('operador'); contador = await e.como('contador'); });
after(async () => { await e.cerrar(); });

const stock = async (sku) => (await e.api.get(`/api/v1/productos/${sku}`).set(admin)).body.stock;

test('vender: descuenta stock, congela precio y costo y calcula el margen', async () => {
  const r = await e.api.post('/api/v1/ventas').set(operador).send({ items: [{ sku: 'PT001', cantidad: 2 }, { sku: 'PT003', cantidad: 10, precioUnitario: 700 }], nota: 'Mostrador' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.headers.location, /^\/api\/v1\/ventas\/\d+$/);
  // 2 × 35.000 + 10 × 700 (precio pactado) = 77.000; costo 2 × 9.350 + 10 × 310 = 21.800
  assert.equal(r.body.total, 77000);
  assert.equal(r.body.costoTotal, 21800);
  assert.equal(r.body.margen, 55200);
  assert.deepEqual(r.body.items.map((i) => [i.sku, i.precioUnitario, i.subtotal]), [['PT001', 35000, 70000], ['PT003', 700, 7000]]);
  assert.deepEqual(r.body.stockRestante, [{ sku: 'PT001', stock: 6 }, { sku: 'PT003', stock: 50 }]);
  assert.equal(await stock('PT001'), 6);

  // El kardex del producto registra la venta con su id
  const k = await e.api.get('/api/v1/productos/PT001/movimientos').set(contador);
  assert.equal(k.status, 200);
  assert.deepEqual([k.body.datos[0].tipo, k.body.datos[0].cantidad, k.body.datos[0].ventaId], ['VENTA', 2, r.body.id]);
  assert.equal(k.body.datos[0].registradoPor, 'Carlos L.');

  // Cambiar luego el precio de lista NO cambia el margen de la venta ya registrada
  await e.api.put('/api/v1/productos/PT001').set(admin).send({ nombre: 'Pastel de Chocolate', categoria: 'Pasteles', stock: 6, precio: 99000, caducidad: '2026-11-08' });
  const lista = await e.api.get('/api/v1/ventas?limite=1').set(contador);
  assert.equal(lista.body.datos[0].id, r.body.id);
  assert.equal(lista.body.datos[0].total, 77000);
  assert.equal(lista.body.datos[0].margen, 55200);
});

test('vender: 409 sin cambios si un producto no alcanza; 409 si está vencido', async () => {
  const antes = await stock('PT003');
  const r = await e.api.post('/api/v1/ventas').set(operador).send({ items: [{ sku: 'PT003', cantidad: 1 }, { sku: 'PT004', cantidad: 50 }] });
  assert.equal(r.status, 409);
  assert.deepEqual(r.body.faltantes, [{ sku: 'PT004', solicitado: 50, disponible: 4 }]);
  assert.equal(await stock('PT003'), antes, 'la línea que sí alcanzaba no se descontó (todo o nada)');

  await e.api.post('/api/v1/productos').set(admin).send({ sku: 'PT050', nombre: 'Milhoja', categoria: 'Postres', stock: 5, precio: 5000, caducidad: '2026-11-05', costoUnitario: 2000 });
  const v = await e.api.post('/api/v1/ventas').set(operador).send({ items: [{ sku: 'PT050', cantidad: 1 }] });
  assert.equal(v.status, 409);
  assert.match(v.body.title, /vencido/);
  assert.deepEqual(v.body.vencidos, [{ sku: 'PT050', caducidad: '2026-11-05' }]);
});

test('vender: validación de contrato, productos repetidos, inexistentes y RBAC', async () => {
  const post = (h, cuerpo) => e.api.post('/api/v1/ventas').set(h).send(cuerpo);
  for (const mal of [{}, { items: [] }, { items: [{ sku: 'PT001', cantidad: 0 }] }, { items: [{ sku: 'PT001', cantidad: 1.5 }] }, { items: [{ sku: 'X1', cantidad: 1 }] },
    { items: [{ sku: 'PT001', cantidad: 1, precioUnitario: -1 }] }, { items: [{ sku: 'PT001', cantidad: 1 }], extra: true }]) {
    assert.equal((await post(admin, mal)).status, 422, JSON.stringify(mal));
  }
  const rep = await post(admin, { items: [{ sku: 'PT003', cantidad: 1 }, { sku: 'PT003', cantidad: 2 }] });
  assert.equal(rep.status, 422);
  assert.match(rep.body.title, /repetidos/);
  const inex = await post(admin, { items: [{ sku: 'PT999', cantidad: 1 }] });
  assert.equal(inex.status, 422);
  assert.match(inex.body.detail, /PT999/);
  assert.equal((await post(contador, { items: [{ sku: 'PT003', cantidad: 1 }] })).status, 403);
  assert.equal((await e.api.get('/api/v1/ventas')).status, 401);
});

test('vender con Idempotency-Key: el reintento devuelve la misma venta sin descontar dos veces', async () => {
  const antes = await stock('PT003');
  const cuerpo = { items: [{ sku: 'PT003', cantidad: 3 }] };
  const a = await e.api.post('/api/v1/ventas').set(operador).set('Idempotency-Key', 'venta-mostrador-001').send(cuerpo);
  const b = await e.api.post('/api/v1/ventas').set(operador).set('Idempotency-Key', 'venta-mostrador-001').send(cuerpo);
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.equal(a.headers['idempotency-replayed'], 'false');
  assert.equal(b.headers['idempotency-replayed'], 'true');
  assert.equal(b.body.id, a.body.id);
  assert.equal(await stock('PT003'), antes - 3);
  const otra = await e.api.post('/api/v1/ventas').set(operador).set('Idempotency-Key', 'venta-mostrador-001').send({ items: [{ sku: 'PT003', cantidad: 4 }] });
  assert.equal(otra.status, 422);
  assert.equal((await e.api.post('/api/v1/ventas').set(operador).set('Idempotency-Key', 'corta').send(cuerpo)).status, 422);
});

test('ventas concurrentes del último stock: solo una gana y el stock nunca queda negativo', async () => {
  await e.api.post('/api/v1/productos').set(admin).send({ sku: 'PT060', nombre: 'Torta única', categoria: 'Pasteles', stock: 1, precio: 50000, caducidad: '2026-11-20', costoUnitario: 20000 });
  const intentos = await Promise.all(Array.from({ length: 5 }, () => e.api.post('/api/v1/ventas').set(operador).send({ items: [{ sku: 'PT060', cantidad: 1 }] })));
  assert.deepEqual(intentos.map((r) => r.status).sort(), [201, 409, 409, 409, 409]);
  assert.equal(await stock('PT060'), 0);
});

test('listar ventas: filtro por fecha local y resumen del período', async () => {
  const r = await e.api.get('/api/v1/ventas?desde=2026-11-04&hasta=2026-11-05').set(contador);
  assert.equal(r.status, 200);
  // Siembra: 04-nov 161.000 (costo 51.050) y 05-nov 77.500 (costo 26.100)
  assert.equal(r.body.paginacion.total, 2);
  assert.deepEqual(r.body.resumen, { total: 238500, costo: 77150, margen: 161350 });
  assert.equal(r.body.datos[0].items.length, 3);
  assert.equal((await e.api.get('/api/v1/ventas?desde=04-11-2026').set(contador)).status, 422);
});

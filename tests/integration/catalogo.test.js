import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearEntorno } from '../helpers/entorno.js';

let e; let admin; let operador; let contador;
before(async () => { e = await crearEntorno(); admin = await e.como('admin'); operador = await e.como('operador'); contador = await e.como('contador'); });
after(async () => { await e.cerrar(); });

const producto = (extra = {}) => ({ sku: 'PT005', nombre: 'Pastel Red Velvet', categoria: 'Pasteles', stock: 3, precio: 38000, caducidad: '2026-11-20', ...extra });

test('productos: listado y filtro por categoría', async () => {
  const todos = await e.api.get('/api/v1/productos').set(contador);
  assert.equal(todos.body.paginacion.total, 4);
  assert.deepEqual(todos.body.datos.map((p) => p.sku), ['PT001', 'PT002', 'PT003', 'PT004']);
  assert.equal(todos.body.datos[0].caducidad, '2026-11-08'); // DATE sin desfase de zona horaria
  const tartas = await e.api.get('/api/v1/productos?categoria=Tartas').set(contador);
  assert.deepEqual(tartas.body.datos.map((p) => p.sku), ['PT004']);
  assert.equal((await e.api.get('/api/v1/productos?categoria=Zapatos').set(contador)).status, 422);
});

test('productos: crear, duplicado, validación, actualizar, eliminar', async () => {
  const c = await e.api.post('/api/v1/productos').set(admin).send(producto());
  assert.equal(c.status, 201);
  assert.equal(c.headers.location, '/api/v1/productos/PT005');
  assert.equal((await e.api.post('/api/v1/productos').set(admin).send(producto())).status, 409);
  for (const mal of [producto({ sku: 'P5' }), producto({ stock: -1 }), producto({ stock: 1.5 }), producto({ precio: -5 }), producto({ caducidad: '2026-13-45' }), producto({ categoria: 'Otros' })]) {
    assert.equal((await e.api.post('/api/v1/productos').set(admin).send(mal)).status, 422, JSON.stringify(mal));
  }
  const u = await e.api.put('/api/v1/productos/PT005').set(admin).send({ nombre: 'Red Velvet Grande', categoria: 'Pasteles', stock: 5, precio: 42000, caducidad: '2026-11-25' });
  assert.equal(u.status, 200); assert.equal(u.body.precio, 42000);
  assert.equal((await e.api.put('/api/v1/productos/PT404').set(admin).send({ nombre: 'Nada', categoria: 'Panes', stock: 1, precio: 1, caducidad: '2026-11-25' })).status, 404);
  assert.equal((await e.api.delete('/api/v1/productos/PT005').set(admin)).status, 204);
  assert.equal((await e.api.get('/api/v1/productos/PT005').set(admin)).status, 404);
  assert.equal((await e.api.post('/api/v1/productos').set(operador).send(producto({ sku: 'PT006' }))).status, 403);
  assert.equal((await e.api.delete('/api/v1/productos/PT001').set(contador)).status, 403);
});

test('recetas: la receta demo enlaza por CÓDIGO de materia prima y trae el nombre (DT-09)', async () => {
  const r = await e.api.get('/api/v1/recetas/1').set(contador);
  assert.equal(r.status, 200);
  assert.equal(r.body.productoSku, 'PT001');
  assert.equal(r.body.productoNombre, 'Pastel de Chocolate');
  assert.deepEqual(r.body.ingredientes.map((i) => [i.codigoMateriaPrima, i.nombre, i.cantidad, i.unidad]), [
    ['MP001', 'Harina de Trigo', 500, 'g'], ['MP002', 'Azúcar', 300, 'g'], ['MP003', 'Huevos', 4, 'unid'], ['MP004', 'Mantequilla', 200, 'g'], ['MP005', 'Cacao en Polvo', 100, 'g'],
  ]);
  assert.equal((await e.api.get('/api/v1/recetas').set(contador)).body.paginacion.total, 1);
});

test('recetas: crear con unidades convertibles; rechazar unidad incompatible, ingrediente inexistente o repetido', async () => {
  await e.api.post('/api/v1/productos').set(admin).send(producto({ sku: 'PT007', nombre: 'Galletas de Avena', categoria: 'Galletas' }));
  const mal = [
    { productoSku: 'PT007', ingredientes: [{ codigoMateriaPrima: 'MP003', cantidad: 100, unidad: 'g' }] }, // huevos en gramos
    { productoSku: 'PT007', ingredientes: [{ codigoMateriaPrima: 'MP777', cantidad: 1, unidad: 'g' }] },
    { productoSku: 'PT007', ingredientes: [{ codigoMateriaPrima: 'MP001', cantidad: 1, unidad: 'g' }, { codigoMateriaPrima: 'MP001', cantidad: 2, unidad: 'g' }] },
    { productoSku: 'PT007', ingredientes: [] },
    { productoSku: 'PT007', ingredientes: [{ codigoMateriaPrima: 'MP001', cantidad: 0, unidad: 'g' }] },
    { productoSku: 'PT999', ingredientes: [{ codigoMateriaPrima: 'MP001', cantidad: 1, unidad: 'g' }] },
  ];
  for (const cuerpo of mal) assert.equal((await e.api.post('/api/v1/recetas').set(admin).send(cuerpo)).status, 422, JSON.stringify(cuerpo));
  const ok = await e.api.post('/api/v1/recetas').set(admin).send({ productoSku: 'PT007', ingredientes: [{ codigoMateriaPrima: 'MP001', cantidad: 0.25, unidad: 'kg' }, { codigoMateriaPrima: 'MP003', cantidad: 2, unidad: 'unid' }] });
  assert.equal(ok.status, 201);
  assert.match(ok.headers.location, /\/api\/v1\/recetas\/\d+/);
  assert.equal(ok.body.ingredientes.length, 2);
  // un producto solo tiene una receta
  assert.equal((await e.api.post('/api/v1/recetas').set(admin).send({ productoSku: 'PT007', ingredientes: [{ codigoMateriaPrima: 'MP001', cantidad: 1, unidad: 'g' }] })).status, 409);
});

test('recetas: reemplazar ingredientes, eliminar, y la materia prima queda libre para borrarse', async () => {
  const lista = (await e.api.get('/api/v1/recetas?limite=100').set(admin)).body.datos;
  const id = lista.find((r) => r.productoSku === 'PT007').id;
  const put = await e.api.put(`/api/v1/recetas/${id}`).set(admin).send({ ingredientes: [{ codigoMateriaPrima: 'MP002', cantidad: 100, unidad: 'g' }] });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.ingredientes.map((i) => i.codigoMateriaPrima), ['MP002']);
  assert.equal((await e.api.put('/api/v1/recetas/9999').set(admin).send({ ingredientes: [{ codigoMateriaPrima: 'MP002', cantidad: 1, unidad: 'g' }] })).status, 404);
  assert.equal((await e.api.put(`/api/v1/recetas/${id}`).set(operador).send({ ingredientes: [{ codigoMateriaPrima: 'MP002', cantidad: 1, unidad: 'g' }] })).status, 403);
  assert.equal((await e.api.delete(`/api/v1/recetas/${id}`).set(admin)).status, 204);
  assert.equal((await e.api.get(`/api/v1/recetas/${id}`).set(admin)).status, 404);
});

test('eliminar un producto elimina su receta en cascada', async () => {
  assert.equal((await e.api.delete('/api/v1/productos/PT001').set(admin)).status, 204);
  assert.equal((await e.api.get('/api/v1/recetas/1').set(admin)).status, 404);
});

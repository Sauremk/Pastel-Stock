import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crearEntorno } from '../helpers/entorno.js';

let e;
before(async () => { e = await crearEntorno({ semilla: false }); });
after(async () => { await e.cerrar(); });

const sql = (n) => readFileSync(new URL(`../../src/db/migrations/${n}`, import.meta.url), 'utf8');

test('DT-18: la migración 002 conserva los valores guardados con 3 decimales y admite 6', async () => {
  const c = await e.pool.connect();
  try {
    await c.query('CREATE SCHEMA mig_prueba'); await c.query('SET search_path = mig_prueba');
    await c.query(sql('001_init.sql'));
    await c.query("INSERT INTO materias_primas (codigo,nombre,categoria,stock,unidad,minimo,costo) VALUES ('MP001','Huevos','Lácteos/Huevos',2.667,'docena',5.5,12000)");
    await c.query("INSERT INTO movimientos (materia_prima_codigo,tipo,cantidad) VALUES ('MP001','SALIDA',0.333)");
    const antes = (await c.query('SELECT stock, minimo FROM materias_primas')).rows[0];
    await c.query(sql('002_precision_6_decimales.sql'));
    const despues = (await c.query('SELECT stock, minimo FROM materias_primas')).rows[0];
    assert.deepEqual({ stock: Number(despues.stock), minimo: Number(despues.minimo) }, { stock: 2.667, minimo: 5.5 });
    assert.equal(Number(antes.stock), Number(despues.stock));
    assert.equal(Number((await c.query('SELECT cantidad FROM movimientos')).rows[0].cantidad), 0.333);
    await c.query("UPDATE materias_primas SET stock = 2.666667"); // ahora cabe
    assert.equal(Number((await c.query('SELECT stock FROM materias_primas')).rows[0].stock), 2.666667);
    await assert.rejects(() => c.query('UPDATE materias_primas SET stock = -0.000001'), /check/i); // el CHECK se conserva
    for (const [tabla, col] of [['materias_primas', 'stock'], ['materias_primas', 'minimo'], ['receta_ingredientes', 'cantidad'], ['movimientos', 'cantidad']]) {
      const f = (await c.query("SELECT numeric_scale FROM information_schema.columns WHERE table_schema='mig_prueba' AND table_name=$1 AND column_name=$2", [tabla, col])).rows[0];
      assert.equal(f.numeric_scale, 6, `${tabla}.${col}`);
    }
  } finally { await c.query('DROP SCHEMA mig_prueba CASCADE'); c.release(); }
});

test('DT-18: 1.000 producciones de 1 pastel consumen lo mismo que una de 1.000 (sin desvío visible)', async () => {
  // aritmética pura del dominio: ya no se pierde un huevo cada ~250 pasteles
  const { convertir } = await import('../../src/inventory/domain/unidades.js');
  const deAUno = Array.from({ length: 1000 }, () => convertir(4, 'unid', 'docena')).reduce((s, x) => s + x, 0);
  const deUnaVez = convertir(4000, 'unid', 'docena');
  assert.ok(Math.abs(deAUno - deUnaVez) < 0.001, `desvío ${deAUno - deUnaVez} docena`); // antes de DT-18: 0,333 docena = 4 huevos
});

test('v1.1: la migración 004 conserva el stock, costea los productos con receta y deja su saldo inicial en el kardex', async () => {
  const c = await e.pool.connect();
  try {
    await c.query('CREATE SCHEMA mig_004'); await c.query('SET search_path = mig_004');
    for (const f of ['001_init.sql', '002_precision_6_decimales.sql', '003_idempotencia.sql']) await c.query(sql(f));
    await c.query("INSERT INTO materias_primas (codigo,nombre,categoria,stock,unidad,minimo,costo) VALUES ('MP001','Harina','Harinas',1000,'g',1,2.5),('MP003','Huevos','Lácteos/Huevos',3,'docena',1,12000)");
    await c.query("INSERT INTO movimientos (materia_prima_codigo,tipo,cantidad,nota) VALUES ('MP001','AJUSTE',1000,'Stock inicial')");
    await c.query("INSERT INTO productos (sku,nombre,categoria,stock,precio,caducidad) VALUES ('PT001','Pastel','Pasteles',8,35000,'2026-11-20'),('PT002','Pan','Panes',0,1500,'2026-11-20')");
    const rid = (await c.query("INSERT INTO recetas (producto_sku) VALUES ('PT001') RETURNING id")).rows[0].id;
    await c.query("INSERT INTO receta_ingredientes (receta_id, materia_prima_codigo, cantidad, unidad) VALUES ($1,'MP001',0.5,'kg'),($1,'MP003',4,'unid')", [rid]);
    await c.query(sql('004_ventas_costeo_ajustes.sql'));
    const p = (await c.query('SELECT sku, stock, costo_unitario FROM productos ORDER BY sku')).rows.map((r) => [r.sku, r.stock, Number(r.costo_unitario)]);
    assert.deepEqual(p, [['PT001', 8, 5250], ['PT002', 0, 0]]); // 500 g × 2,5 + 4/12 docena × 12.000
    const k = (await c.query('SELECT producto_sku, tipo, cantidad, motivo FROM movimientos_producto')).rows;
    assert.deepEqual(k, [{ producto_sku: 'PT001', tipo: 'AJUSTE', cantidad: 8, motivo: 'STOCK_INICIAL' }]);
    assert.equal((await c.query("SELECT motivo FROM movimientos WHERE tipo = 'AJUSTE'")).rows[0].motivo, 'STOCK_INICIAL');
    await c.query("INSERT INTO movimientos (materia_prima_codigo,tipo,cantidad,motivo) VALUES ('MP001','AJUSTE_NEGATIVO',10,'MERMA')");
    await assert.rejects(() => c.query("INSERT INTO movimientos (materia_prima_codigo,tipo,cantidad) VALUES ('MP001','OTRO',1)"), /check/i);
  } finally { await c.query('DROP SCHEMA mig_004 CASCADE'); c.release(); }
});

import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { crearPool, enTransaccion } from './pool.js';
import { migrar } from './migrate.js';
import { crearUsuariosRepo } from '../identity/adapters/pg/usuariosRepo.js';
import { fechaLocal, sumarDias } from '../reporting/domain/dashboard.js';

import { USUARIOS, MATERIAS, PRODUCTOS, VENTAS, RECETA_DEMO } from './datosDemo.js';

async function sembrarUsuarios(pool, env, log) {
  const produccion = env.NODE_ENV === 'production';
  const generadas = {};
  const costo = Number.parseInt(env.BCRYPT_COST ?? '12', 10);
  const repo = crearUsuariosRepo(pool);
  for (const u of USUARIOS) {
    let clave = env[u.variable];
    if (!clave) {
      if (produccion) throw new Error(`Defina ${u.variable} para sembrar usuarios en producción.`);
      clave = crypto.randomBytes(9).toString('base64url'); // 12 caracteres; solo desarrollo
      generadas[u.usuario] = clave;
    }
    if (clave.length < 8) throw new Error(`${u.variable} debe tener al menos 8 caracteres.`);
    const creado = await repo.crearSiNoExiste({ usuario: u.usuario, nombre: u.nombre, rol: u.rol, passwordHash: await bcrypt.hash(clave, costo) });
    if (creado) log(`usuario ${u.usuario}: creado`);
    else { delete generadas[u.usuario]; log(`usuario ${u.usuario}: ya existía (no se modificó su contraseña)`); }
  }
  return generadas;
}

async function sembrarDemo(pool, ahora, log) {
  const hoy = fechaLocal(ahora);
  await enTransaccion(pool, async (db) => {
    const admin = (await db.query("SELECT id FROM usuarios WHERE usuario = 'admin'")).rows[0]?.id ?? null;
    const operador = (await db.query("SELECT id FROM usuarios WHERE usuario = 'operador'")).rows[0]?.id ?? admin;
    const hace = (dias) => `${sumarDias(hoy, -dias)}T10:00:00-05:00`;
    for (const m of MATERIAS) {
      const final = m.inicial + m.entradas.reduce((a, [, c]) => a + c, 0);
      await db.query('INSERT INTO materias_primas (codigo, nombre, categoria, stock, unidad, minimo, costo) VALUES ($1,$2,$3,$4,$5,$6,$7)', [m.codigo, m.nombre, m.categoria, final, m.unidad, m.minimo, m.costo]);
      await db.query("INSERT INTO movimientos (materia_prima_codigo, tipo, cantidad, costo_unitario, usuario_id, nota, creado_en, motivo) VALUES ($1,'AJUSTE',$2,$3,$4,'Stock inicial',$5,'STOCK_INICIAL')", [m.codigo, m.inicial, m.costo, admin, hace(8)]);
      for (const [dias, cantidad, proveedor] of m.entradas) {
        await db.query("INSERT INTO movimientos (materia_prima_codigo, tipo, cantidad, costo_unitario, proveedor, usuario_id, creado_en) VALUES ($1,'ENTRADA',$2,$3,$4,$5,$6)", [m.codigo, cantidad, m.costo, proveedor, operador, hace(dias)]);
      }
    }
    const vendido = (sku) => VENTAS.reduce((a, [, items]) => a + items.filter(([s]) => s === sku).reduce((b, [, c]) => b + c, 0), 0);
    for (const p of PRODUCTOS) {
      await db.query('INSERT INTO productos (sku, nombre, categoria, stock, precio, caducidad, costo_unitario) VALUES ($1,$2,$3,$4,$5,$6,$7)', [p.sku, p.nombre, p.categoria, p.stock, p.precio, sumarDias(hoy, p.dias), p.costo]);
      await db.query("INSERT INTO movimientos_producto (producto_sku, tipo, cantidad, costo_unitario, motivo, usuario_id, nota, creado_en) VALUES ($1,'AJUSTE',$2,$3,'STOCK_INICIAL',$4,'Stock inicial',$5)",
        [p.sku, p.stock + vendido(p.sku), p.costo, admin, hace(8)]);
    }
    const porSku = new Map(PRODUCTOS.map((p) => [p.sku, p]));
    for (const [dias, items] of VENTAS) {
      const total = items.reduce((a, [s, c]) => a + c * porSku.get(s).precio, 0);
      const costo = items.reduce((a, [s, c]) => a + c * porSku.get(s).costo, 0);
      const cuando = `${sumarDias(hoy, -dias)}T15:30:00-05:00`;
      const venta = (await db.query('INSERT INTO ventas (usuario_id, total, costo_total, creado_en) VALUES ($1,$2,$3,$4) RETURNING id', [operador, total, costo, cuando])).rows[0].id;
      for (const [sku, cantidad] of items) {
        const p = porSku.get(sku);
        await db.query('INSERT INTO venta_items (venta_id, producto_sku, cantidad, precio_unitario, costo_unitario) VALUES ($1,$2,$3,$4,$5)', [venta, sku, cantidad, p.precio, p.costo]);
        await db.query("INSERT INTO movimientos_producto (producto_sku, tipo, cantidad, costo_unitario, venta_id, usuario_id, nota, creado_en) VALUES ($1,'VENTA',$2,$3,$4,$5,$6,$7)",
          [sku, cantidad, p.costo, venta, operador, `Venta #${venta}`, cuando]);
      }
    }
    const rec = (await db.query("INSERT INTO recetas (producto_sku) VALUES ('PT001') RETURNING id")).rows[0].id;
    for (const [codigo, cantidad, unidad] of RECETA_DEMO.ingredientes) {
      await db.query('INSERT INTO receta_ingredientes (receta_id, materia_prima_codigo, cantidad, unidad) VALUES ($1,$2,$3,$4)', [rec, codigo, cantidad, unidad]);
    }
  });
  log(`datos demo: 5 materias primas, 4 productos, 1 receta, ${VENTAS.length} ventas y movimientos de los últimos días`);
}

export async function sembrar(pool, { env = process.env, ahora = new Date(), log = console.log } = {}) {
  const generadas = await sembrarUsuarios(pool, env, log);
  if (env.SEED_DEMO === 'false') return { generadas, demo: false };
  const hayDatos = (await pool.query('SELECT count(*)::int AS n FROM materias_primas')).rows[0].n > 0;
  if (hayDatos) { log('datos demo: omitidos (ya hay materias primas)'); return { generadas, demo: false }; }
  await sembrarDemo(pool, ahora, log);
  return { generadas, demo: true };
}

// Ejecución directa: `npm run seed`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!process.env.DATABASE_URL) { console.error('Defina DATABASE_URL'); process.exit(1); }
  const pool = crearPool(process.env.DATABASE_URL);
  try {
    await migrar(pool, { log: console.log });
    const { generadas } = await sembrar(pool);
    if (Object.keys(generadas).length) {
      console.log('\nContraseñas generadas (se muestran UNA sola vez; guárdelas en su gestor de contraseñas):');
      for (const [u, c] of Object.entries(generadas)) console.log(`  ${u}: ${c}`);
    }
  } catch (e) { console.error(e.message); process.exitCode = 1; } finally { await pool.end(); }
}

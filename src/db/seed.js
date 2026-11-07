import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { crearPool, enTransaccion } from './pool.js';
import { migrar } from './migrate.js';
import { crearUsuariosRepo } from '../identity/adapters/pg/usuariosRepo.js';
import { fechaLocal, sumarDias } from '../reporting/domain/dashboard.js';

const USUARIOS = [
  { usuario: 'admin', nombre: 'Ana García', rol: 'admin', variable: 'SEED_ADMIN_PASSWORD' },
  { usuario: 'operador', nombre: 'Carlos López', rol: 'operador', variable: 'SEED_OPERADOR_PASSWORD' },
  { usuario: 'contador', nombre: 'María Rodríguez', rol: 'contador', variable: 'SEED_CONTADOR_PASSWORD' },
];

// costo = COP por unidad de medida de la materia prima (Harina: $2,5 por gramo = $2.500 por kg).
const MATERIAS = [
  { codigo: 'MP001', nombre: 'Harina de Trigo', categoria: 'Harinas', unidad: 'g', minimo: 10000, costo: 2.5, inicial: 20000, entradas: [[5, 5000, 'Molinos del Valle']] },
  { codigo: 'MP002', nombre: 'Azúcar', categoria: 'Endulzantes', unidad: 'g', minimo: 5000, costo: 3, inicial: 5000, entradas: [[3, 3000, 'Distribuidora La Esperanza']] },
  { codigo: 'MP003', nombre: 'Huevos', categoria: 'Lácteos/Huevos', unidad: 'docena', minimo: 5, costo: 12000, inicial: 2, entradas: [[1, 1, 'Granja Avícola El Prado']] },
  { codigo: 'MP004', nombre: 'Mantequilla', categoria: 'Lácteos', unidad: 'g', minimo: 3000, costo: 8.5, inicial: 1000, entradas: [[2, 1000, 'Lácteos del Norte']] },
  { codigo: 'MP005', nombre: 'Cacao en Polvo', categoria: 'Saborizantes', unidad: 'g', minimo: 2000, costo: 15, inicial: 15000, entradas: [] },
];
const PRODUCTOS = [
  { sku: 'PT001', nombre: 'Pastel de Chocolate', categoria: 'Pasteles', stock: 8, precio: 35000, dias: 2 },
  { sku: 'PT002', nombre: 'Pan Dulce Surtido', categoria: 'Panes', stock: 45, precio: 1500, dias: 1 },
  { sku: 'PT003', nombre: 'Galletas de Mantequilla', categoria: 'Galletas', stock: 60, precio: 800, dias: 9 },
  { sku: 'PT004', nombre: 'Tarta de Fresa', categoria: 'Tartas', stock: 4, precio: 28000, dias: 1 },
];

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
      await db.query("INSERT INTO movimientos (materia_prima_codigo, tipo, cantidad, costo_unitario, usuario_id, nota, creado_en) VALUES ($1,'AJUSTE',$2,$3,$4,'Stock inicial',$5)", [m.codigo, m.inicial, m.costo, admin, hace(8)]);
      for (const [dias, cantidad, proveedor] of m.entradas) {
        await db.query("INSERT INTO movimientos (materia_prima_codigo, tipo, cantidad, costo_unitario, proveedor, usuario_id, creado_en) VALUES ($1,'ENTRADA',$2,$3,$4,$5,$6)", [m.codigo, cantidad, m.costo, proveedor, operador, hace(dias)]);
      }
    }
    for (const p of PRODUCTOS) {
      await db.query('INSERT INTO productos (sku, nombre, categoria, stock, precio, caducidad) VALUES ($1,$2,$3,$4,$5,$6)', [p.sku, p.nombre, p.categoria, p.stock, p.precio, sumarDias(hoy, p.dias)]);
    }
    const rec = (await db.query("INSERT INTO recetas (producto_sku) VALUES ('PT001') RETURNING id")).rows[0].id;
    for (const [codigo, cantidad, unidad] of [['MP001', 500, 'g'], ['MP002', 300, 'g'], ['MP003', 4, 'unid'], ['MP004', 200, 'g'], ['MP005', 100, 'g']]) {
      await db.query('INSERT INTO receta_ingredientes (receta_id, materia_prima_codigo, cantidad, unidad) VALUES ($1,$2,$3,$4)', [rec, codigo, cantidad, unidad]);
    }
  });
  log('datos demo: 5 materias primas, 4 productos, 1 receta y movimientos de los últimos días');
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

// Datos iniciales de la app sin servidor: los MISMOS de la demo del servidor (src/db/datosDemo.js), fechados respecto a hoy.
import { USUARIOS, MATERIAS, PRODUCTOS, VENTAS, RECETA_DEMO } from '../src/db/datosDemo.js';
import { fechaLocal, sumarDias } from '../src/reporting/domain/dashboard.js';

export const VERSION_DATOS = 1;
/** Contraseña inicial de los tres usuarios de la demo (se muestra en el login; cada usuario puede cambiarla). */
export const CLAVE_DEMO = 'dulcehogar';

export async function sembrarDemo({ ahora = new Date(), hashClave }) {
  const hoy = fechaLocal(ahora, 'America/Bogota');
  const hace = (dias, hora = '10:00') => new Date(`${sumarDias(hoy, -dias)}T${hora}:00-05:00`).toISOString();
  const d = {
    version: VERSION_DATOS,
    secuencias: { movimiento: 0, movimientoProducto: 0, venta: 0, receta: 0 },
    usuarios: [], materias: [], productos: [], recetas: [], movimientos: [], movimientosProducto: [], ventas: [], claves: {}, sesiones: {},
  };
  const sig = (s) => ++d.secuencias[s];
  let id = 0;
  for (const u of USUARIOS) {
    const sal = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    d.usuarios.push({ id: ++id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, sal, hash: await hashClave(CLAVE_DEMO, sal) });
  }
  const admin = 1; const operador = 2;

  for (const m of MATERIAS) {
    const stock = m.inicial + m.entradas.reduce((a, [, c]) => a + c, 0);
    d.materias.push({ codigo: m.codigo, nombre: m.nombre, categoria: m.categoria, unidad: m.unidad, minimo: m.minimo, costo: m.costo, stock });
    d.movimientos.push({ id: sig('movimiento'), codigo: m.codigo, tipo: 'AJUSTE', cantidad: m.inicial, costoUnitario: m.costo, proveedor: null, usuarioId: admin, nota: 'Stock inicial', motivo: 'STOCK_INICIAL', creadoEn: hace(8) });
    for (const [dias, cantidad, proveedor] of m.entradas) {
      d.movimientos.push({ id: sig('movimiento'), codigo: m.codigo, tipo: 'ENTRADA', cantidad, costoUnitario: m.costo, proveedor, usuarioId: operador, nota: null, motivo: null, creadoEn: hace(dias) });
    }
  }

  const vendido = (sku) => VENTAS.reduce((a, [, items]) => a + items.filter(([s]) => s === sku).reduce((b, [, c]) => b + c, 0), 0);
  for (const p of PRODUCTOS) {
    d.productos.push({ sku: p.sku, nombre: p.nombre, categoria: p.categoria, stock: p.stock, precio: p.precio, caducidad: sumarDias(hoy, p.dias), costoUnitario: p.costo });
    d.movimientosProducto.push({ id: sig('movimientoProducto'), sku: p.sku, tipo: 'AJUSTE', cantidad: p.stock + vendido(p.sku), costoUnitario: p.costo, motivo: 'STOCK_INICIAL', ventaId: null, usuarioId: admin, nota: 'Stock inicial', creadoEn: hace(8) });
  }
  const porSku = new Map(PRODUCTOS.map((p) => [p.sku, p]));
  for (const [dias, items] of VENTAS) {
    const ventaId = sig('venta');
    const creadoEn = hace(dias, '15:30');
    d.ventas.push({
      id: ventaId, usuarioId: operador, nota: null, creadoEn,
      total: items.reduce((a, [s, c]) => a + c * porSku.get(s).precio, 0),
      costoTotal: items.reduce((a, [s, c]) => a + c * porSku.get(s).costo, 0),
      items: items.map(([sku, cantidad]) => ({ sku, cantidad, precioUnitario: porSku.get(sku).precio, costoUnitario: porSku.get(sku).costo })),
    });
    for (const [sku, cantidad] of items) {
      d.movimientosProducto.push({ id: sig('movimientoProducto'), sku, tipo: 'VENTA', cantidad, costoUnitario: porSku.get(sku).costo, motivo: null, ventaId, usuarioId: operador, nota: `Venta #${ventaId}`, creadoEn });
    }
  }
  d.recetas.push({ id: sig('receta'), productoSku: RECETA_DEMO.sku, ingredientes: RECETA_DEMO.ingredientes.map(([codigoMateriaPrima, cantidad, unidad]) => ({ codigoMateriaPrima, cantidad, unidad })) });
  return d;
}

/**
 * Datos de una tienda NUEVA creada desde la app (v1.5, ADR-19): vacía, con su nombre y su primer administrador.
 * No trae ingredientes, productos ni ventas de ejemplo.
 */
export async function crearDatosTienda({ nombreTienda, admin, ahora = new Date(), hashClave }) {
  const sal = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  return {
    version: VERSION_DATOS,
    tienda: { nombre: nombreTienda, creadaEn: ahora.toISOString() },
    secuencias: { movimiento: 0, movimientoProducto: 0, venta: 0, receta: 0 },
    usuarios: [{ id: 1, usuario: admin.usuario, nombre: admin.nombre, rol: 'admin', activo: true, creadoEn: ahora.toISOString(), sal, hash: await hashClave(admin.contrasena, sal) }],
    materias: [], productos: [], recetas: [], movimientos: [], movimientosProducto: [], ventas: [], claves: {}, sesiones: {},
  };
}

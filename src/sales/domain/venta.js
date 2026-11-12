import { conflicto, validacion } from '../../shared/errors.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Una venta no puede repetir un producto en dos líneas (se suman en una sola). */
export function validarLineas(items) {
  const skus = items.map((i) => i.sku);
  if (new Set(skus).size !== skus.length) throw validacion('Productos repetidos en la venta', 'Cada producto solo puede aparecer una vez; sume las cantidades en una línea.');
}

/**
 * Arma las líneas de la venta con precio y costo congelados. Si la línea no trae precio se usa el de lista.
 * `productos` es un Map sku → producto (ya bloqueado). Devuelve líneas, total, costo y margen.
 */
export function liquidarVenta(items, productos) {
  const lineas = items.map((i) => {
    const p = productos.get(i.sku);
    const precioUnitario = i.precioUnitario ?? p.precio;
    return {
      sku: p.sku, nombre: p.nombre, cantidad: i.cantidad, precioUnitario, costoUnitario: p.costoUnitario,
      subtotal: r2(i.cantidad * precioUnitario), costo: r2(i.cantidad * p.costoUnitario),
    };
  });
  const total = r2(lineas.reduce((a, l) => a + l.subtotal, 0));
  const costoTotal = r2(lineas.reduce((a, l) => a + l.costo, 0));
  return { lineas, total, costoTotal, margen: r2(total - costoTotal) };
}

/** Productos que no se pueden vender: no alcanza el stock o ya vencieron (fecha local de hoy). */
export function bloqueosDeVenta(items, productos, hoy) {
  const faltantes = []; const vencidos = [];
  for (const i of items) {
    const p = productos.get(i.sku);
    if (p.stock < i.cantidad) faltantes.push({ sku: p.sku, solicitado: i.cantidad, disponible: p.stock });
    if (p.caducidad < hoy) vencidos.push({ sku: p.sku, caducidad: p.caducidad });
  }
  return { faltantes, vencidos };
}

/** Lanza el error de negocio adecuado si la venta no se puede registrar (inexistente → 422; vencido o sin stock → 409). */
export function comprobarVendible(items, productos, hoy) {
  const inexistentes = items.filter((i) => !productos.has(i.sku)).map((i) => i.sku);
  if (inexistentes.length) throw validacion('Producto inexistente en la venta', `No existe: ${inexistentes.join(', ')}.`);
  const { faltantes, vencidos } = bloqueosDeVenta(items, productos, hoy);
  const nombre = (sku) => productos.get(sku).nombre;
  if (vencidos.length) {
    throw conflicto('No se puede vender un producto vencido', `${vencidos.map((v) => `${nombre(v.sku)} venció el ${v.caducidad}`).join('; ')}. Dele de baja desde Alertas.`, { vencidos });
  }
  if (faltantes.length) {
    throw conflicto('Stock insuficiente para la venta', faltantes.map((f) => `${nombre(f.sku)}: pide ${f.solicitado} y hay ${f.disponible}`).join('; '), { faltantes });
  }
}

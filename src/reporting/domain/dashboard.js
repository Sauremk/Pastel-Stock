import { estadoStock } from '../../inventory/domain/stock.js';

export const DIAS_POR_VENCER = 3;
const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Suma días a una fecha 'AAAA-MM-DD' sin depender de la zona horaria del servidor. */
export function sumarDias(fecha, dias) {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Fecha 'AAAA-MM-DD' de un instante en una zona horaria (por defecto la de Colombia). */
export function fechaLocal(instante, zona = 'America/Bogota') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instante);
}

/** Arma la respuesta del tablero a partir de datos reales (sustituye los datos simulados del MVP, DT-10). */
const porcentaje = (parte, base) => (base > 0 ? Math.round((parte / base) * 10000) / 100 : null);

export function armarDashboard({
  materias, valorProductos, compras30, compras7, stockPorCategoria, topProductos, productosPorVencer, productosVencidos,
  ventas30 = { total: 0, costo: 0, n: 0 }, ventas7 = [], topVendidos = [], perdidas30 = 0,
}) {
  const margen30 = redondear(ventas30.total - ventas30.costo);
  const criticos = materias
    .map((m) => ({ ...m, estado: estadoStock(m.stock, m.minimo) }))
    .filter((m) => m.estado !== 'OPTIMO')
    .map(({ codigo, nombre, unidad, stock, minimo, estado }) => ({ codigo, nombre, unidad, stock, minimo, estado }));
  return {
    valorInventarioInsumos: redondear(materias.reduce((a, m) => a + m.stock * m.costo, 0)),
    comprasUltimos30Dias: redondear(compras30),
    valorProductosTerminados: redondear(valorProductos),
    totalIngredientesCriticos: criticos.length,
    productosPorVencer,
    productosVencidos,
    ingredientesCriticos: criticos,
    comprasUltimos7Dias: compras7.map((d) => ({ fecha: d.fecha, total: redondear(d.total) })),
    stockPorCategoria: stockPorCategoria.map((c) => ({ categoria: c.categoria, valor: redondear(c.valor) })),
    topProductosPorValor: topProductos.map((p) => ({ sku: p.sku, nombre: p.nombre, valor: redondear(p.valor) })),
    // v1.1 — ventas y costeo reales (DT-10 pagada): ya no hay cifras simuladas.
    ventasUltimos30Dias: redondear(ventas30.total),
    numeroVentasUltimos30Dias: ventas30.n,
    costoVentasUltimos30Dias: redondear(ventas30.costo),
    margenBrutoUltimos30Dias: margen30,
    margenPorcentaje30Dias: porcentaje(margen30, ventas30.total),
    roi30Dias: porcentaje(margen30, ventas30.costo),
    perdidasUltimos30Dias: redondear(perdidas30),
    ventasUltimos7Dias: ventas7.map((d) => ({ fecha: d.fecha, total: redondear(d.total), margen: redondear(d.margen) })),
    topProductosVendidos: topVendidos.map((p) => ({ sku: p.sku, nombre: p.nombre, unidades: p.unidades, total: redondear(p.total) })),
  };
}

/** Alertas de caducidad: separa vencidos de por vencer y valoriza lo que está en riesgo (a costo y a precio). */
export function armarAlertasCaducidad(filas) {
  const item = (f) => ({
    sku: f.sku, nombre: f.nombre, categoria: f.categoria, stock: f.stock, caducidad: f.caducidad,
    diasRestantes: f.dias, valorACosto: redondear(f.stock * f.costoUnitario), valorAPrecio: redondear(f.stock * f.precio),
  });
  const vencidos = filas.filter((f) => f.dias < 0).map(item);
  const porVencer = filas.filter((f) => f.dias >= 0).map(item);
  return {
    vencidos, porVencer,
    valorEnRiesgoACosto: redondear([...vencidos, ...porVencer].reduce((a, p) => a + p.valorACosto, 0)),
  };
}

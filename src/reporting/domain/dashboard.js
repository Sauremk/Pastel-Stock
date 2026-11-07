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
export function armarDashboard({ materias, valorProductos, compras30, compras7, stockPorCategoria, topProductos, productosPorVencer, productosVencidos }) {
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
  };
}

import { convertir } from '../../inventory/domain/unidades.js';

const redondear2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Costo estándar de UNA unidad de producto a partir de su receta y del costo actual de cada insumo.
 * `materias` es un Map código → { costo, unidad, nombre }. El costo de la materia prima es COP por unidad de
 * medida de la materia prima (Harina: $2,5 por gramo), así que cada cantidad se convierte primero a esa unidad.
 */
export function costearReceta(ingredientes, materias) {
  const detalle = ingredientes.map((i) => {
    const mp = materias.get(i.codigoMateriaPrima);
    if (!mp) throw new Error(`Materia prima ${i.codigoMateriaPrima} sin datos de costo`);
    const enUnidadMp = convertir(i.cantidad, i.unidad, mp.unidad);
    return {
      codigoMateriaPrima: i.codigoMateriaPrima,
      nombre: mp.nombre,
      cantidad: i.cantidad,
      unidad: i.unidad,
      cantidadEnUnidadInventario: enUnidadMp,
      unidadInventario: mp.unidad,
      costoUnitarioInsumo: mp.costo,
      costo: redondear2(enUnidadMp * mp.costo),
    };
  });
  // El total se suma sin redondear cada línea para no acumular error de centavos.
  const total = detalle.reduce((a, d) => a + d.cantidadEnUnidadInventario * d.costoUnitarioInsumo, 0);
  return { costoUnitario: redondear2(total), detalle };
}

/** Margen de un precio frente a un costo. margenPorcentaje es sobre el precio (margen bruto), null si el precio es 0. */
export function margen(precio, costo) {
  const m = redondear2(precio - costo);
  return { margenUnitario: m, margenPorcentaje: precio > 0 ? Math.round((m / precio) * 10000) / 100 : null };
}

/**
 * Costo promedio ponderado tras producir: el lote nuevo se mezcla con lo que ya había en stock.
 * Si no había stock (o su costo era 0 porque nunca se costeó), el promedio es el costo del lote.
 */
export function costoPromedio({ stockAnterior, costoAnterior, unidades, costoLote }) {
  const base = stockAnterior > 0 && costoAnterior > 0 ? stockAnterior : 0;
  const total = base * costoAnterior + costoLote;
  return redondear2(total / (base + unidades));
}

export { redondear2 };

// Ajustes por conteo físico (inventario y producto terminado). El kardex guarda cantidades > 0: el signo lo da el tipo.
export const MOTIVOS_AJUSTE = ['CONTEO_FISICO', 'MERMA', 'VENCIMIENTO', 'CORRECCION'];

/**
 * Traduce "el sistema dice X y contamos Y" en un movimiento: AJUSTE (suma) o AJUSTE_NEGATIVO (resta).
 * Devuelve null si no hay diferencia. Redondea a 6 decimales, la escala de la base (DT-18).
 */
export function tipoDeAjuste(stockSistema, stockContado) {
  const diferencia = Math.round((stockContado - stockSistema) * 1e6) / 1e6;
  if (diferencia === 0) return null;
  return diferencia > 0 ? { tipo: 'AJUSTE', cantidad: diferencia } : { tipo: 'AJUSTE_NEGATIVO', cantidad: -diferencia };
}

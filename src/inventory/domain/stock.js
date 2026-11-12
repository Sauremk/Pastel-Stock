/** Estado del stock de una materia prima. Reglas del MVP (calcularEstado, línea 1589) sin números mágicos. */
export const FACTOR_CRITICO = 0.5;

export function estadoStock(stock, minimo) {
  if (stock <= minimo * FACTOR_CRITICO) return 'CRITICO';
  if (stock <= minimo) return 'BAJO';
  return 'OPTIMO';
}

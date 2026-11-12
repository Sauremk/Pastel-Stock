import { validacion } from '../../shared/errors.js';

// Dimensión y factor respecto a la unidad base de la dimensión (g, ml, unid).
const UNIDADES = {
  g: { dim: 'masa', f: 1 },
  kg: { dim: 'masa', f: 1000 },
  ml: { dim: 'volumen', f: 1 },
  L: { dim: 'volumen', f: 1000 },
  unid: { dim: 'conteo', f: 1 },
  docena: { dim: 'conteo', f: 12 },
};

export const UNIDADES_VALIDAS = Object.keys(UNIDADES);

export const sonCompatibles = (a, b) => UNIDADES[a]?.dim !== undefined && UNIDADES[a].dim === UNIDADES[b]?.dim;

/**
 * Convierte una cantidad entre unidades de la misma dimensión (4 unid → 0,333333 docena).
 * Lanza 422 si las dimensiones no coinciden (no se puede restar gramos de una "docena"): corrige DT-09.
 */
export function convertir(cantidad, desde, hacia) {
  if (!sonCompatibles(desde, hacia)) {
    throw validacion('Unidades incompatibles', `No se puede convertir de "${desde}" a "${hacia}" (dimensiones distintas).`);
  }
  const valor = (cantidad * UNIDADES[desde].f) / UNIDADES[hacia].f;
  return Math.round(valor * 1e6) / 1e6; // la base guarda 6 decimales (DT-18; antes 3)
}

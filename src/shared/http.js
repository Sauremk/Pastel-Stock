import { validacion } from './errors.js';

/** Envuelve un handler async para que sus errores lleguen al middleware de errores (Express 4 no los captura). */
export const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Parseo seguro de ?pagina=&limite= (valores por defecto y topes del contrato). */
export function paginacion(query) {
  const pagina = query.pagina === undefined ? 1 : Number(query.pagina);
  const limite = query.limite === undefined ? 20 : Number(query.limite);
  if (!Number.isInteger(pagina) || pagina < 1) throw validacion('Parámetro "pagina" inválido', 'Debe ser un entero ≥ 1.');
  if (!Number.isInteger(limite) || limite < 1 || limite > 100) throw validacion('Parámetro "limite" inválido', 'Debe ser un entero entre 1 y 100.');
  return { pagina, limite, offset: (pagina - 1) * limite };
}

export const pagina = (datos, { pagina: p, limite }, total) => ({ datos, paginacion: { pagina: p, limite, total } });

/** Valida un parámetro de ruta contra una expresión regular del contrato. */
export function parametro(valor, regex, nombre) {
  if (typeof valor !== 'string' || !regex.test(valor)) throw validacion(`Parámetro "${nombre}" inválido`, `No cumple el patrón ${regex}.`);
  return valor;
}
export const RE_MP = /^MP[0-9]{3,}$/;
export const RE_PT = /^PT[0-9]{3,}$/;

export function enumerado(valor, permitidos, nombre) {
  if (valor === undefined || valor === '') return undefined;
  if (!permitidos.includes(valor)) throw validacion(`Parámetro "${nombre}" inválido`, `Valores permitidos: ${permitidos.join(', ')}.`);
  return valor;
}

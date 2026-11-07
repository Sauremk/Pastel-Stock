import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import { validacion } from './errors.js';

const aqui = dirname(fileURLToPath(import.meta.url));
export const RUTA_OPENAPI = join(aqui, '..', '..', 'openapi', 'openapi.yaml');

/** Carga el contrato OpenAPI: es la ÚNICA fuente de verdad de los esquemas de entrada (contract-first, ADR-06). */
export function cargarContrato(ruta = RUTA_OPENAPI) {
  return parse(readFileSync(ruta, 'utf8'));
}

const BASE = 'https://pastel-stock.local/openapi.json';

/** Reescribe los $ref locales ('#/components/...') para que apunten al documento OpenAPI registrado en Ajv. */
export function anclarRefs(nodo) {
  if (Array.isArray(nodo)) return nodo.map(anclarRefs);
  if (nodo && typeof nodo === 'object') {
    return Object.fromEntries(Object.entries(nodo).map(([k, v]) => [k, k === '$ref' && typeof v === 'string' && v.startsWith('#/') ? BASE + v : anclarRefs(v)]));
  }
  return nodo;
}

export function crearValidadores(contrato = cargarContrato()) {
  const ajv = new Ajv2020({ strict: false, allErrors: true, coerceTypes: false });
  addFormats(ajv);
  ajv.addFormat('password', true);
  // Todo el documento se registra UNA vez: así los $ref internos ('#/components/schemas/X') se resuelven solos.
  ajv.addSchema({ ...contrato, $id: BASE });
  const cache = new Map();
  const obtener = (nombre) => {
    if (!cache.has(nombre)) {
      const v = ajv.getSchema(`${BASE}#/components/schemas/${nombre}`);
      if (!v) throw new Error(`Esquema OpenAPI inexistente: ${nombre}`);
      cache.set(nombre, v);
    }
    return cache.get(nombre);
  };

  const resumir = (errores) =>
    errores.map((e) => `${e.instancePath || '(cuerpo)'} ${e.message}`.trim()).slice(0, 8).join('; ');

  /** Middleware: valida req.body contra un esquema del contrato; si falla, responde 422. */
  const cuerpo = (nombreEsquema) => (req, _res, next) => {
    const validar = obtener(nombreEsquema);
    if (req.body === undefined || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return next(validacion('El cuerpo de la solicitud debe ser un objeto JSON'));
    }
    if (!validar(req.body)) return next(validacion('Los datos no cumplen el contrato de la API', resumir(validar.errors), { errores: validar.errors.map((e) => ({ campo: e.instancePath, mensaje: e.message })) }));
    return next();
  };
  return { cuerpo, obtener, ajv };
}

import crypto from 'node:crypto';
import { validacion } from './errors.js';

/** Huella sha256 de una solicitud (operación + cuerpo): una misma clave con otro cuerpo se rechaza. */
export const huella = (...partes) => crypto.createHash('sha256').update(JSON.stringify(partes)).digest('hex');

/**
 * Reclama la clave DENTRO de la transacción del llamador (ADR-16): si la operación se revierte, la clave también.
 * Si otra petición con la misma clave está en curso, el INSERT espera a que confirme o revierta.
 * Devuelve `null` si la clave es nueva, o la respuesta guardada si ya se procesó con el mismo cuerpo.
 */
export async function reclamarClave(db, { usuarioId, clave, huella: h }) {
  const nueva = await db.query(
    'INSERT INTO claves_idempotencia (usuario_id, clave, huella) VALUES ($1, $2, $3) ON CONFLICT (usuario_id, clave) DO NOTHING RETURNING 1',
    [usuarioId, clave, h]);
  if (nueva.rowCount) return null;
  const previa = (await db.query('SELECT huella, respuesta FROM claves_idempotencia WHERE usuario_id = $1 AND clave = $2', [usuarioId, clave])).rows[0];
  if (previa.huella !== h) throw validacion('Clave de idempotencia reutilizada', 'La misma Idempotency-Key se usó antes con una solicitud distinta.');
  return previa.respuesta;
}

export async function guardarRespuesta(db, { usuarioId, clave, estado = 201, cuerpo }) {
  await db.query('UPDATE claves_idempotencia SET estado = $3, respuesta = $4 WHERE usuario_id = $1 AND clave = $2', [usuarioId, clave, estado, JSON.stringify(cuerpo)]);
}

export const RE_CLAVE = /^[A-Za-z0-9_-]{8,64}$/;

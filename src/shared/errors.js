/** Error de aplicación que se traduce a application/problem+json (RFC 9457). */
export class AppError extends Error {
  constructor(status, slug, title, detail, extra = {}) {
    super(title);
    this.name = 'AppError';
    this.status = status;
    this.slug = slug;
    this.title = title;
    this.detail = detail;
    this.extra = extra;
  }
}

export const noAutenticado = (title = 'Token ausente, inválido o vencido') =>
  new AppError(401, 'no-autenticado', title);
export const prohibido = (title = 'El rol no tiene permiso para esta operación') =>
  new AppError(403, 'prohibido', title);
export const noEncontrado = (recurso, id) =>
  new AppError(404, 'no-encontrado', `${recurso} no encontrado`, id ? `No existe ${recurso.toLowerCase()} con identificador ${id}.` : undefined);
export const conflicto = (title, detail, extra) => new AppError(409, 'conflicto', title, detail, extra);
export const validacion = (title, detail, extra) => new AppError(422, 'validacion', title, detail, extra);
export const solicitudInvalida = (title, detail) => new AppError(400, 'solicitud-invalida', title, detail);

/** Traduce errores de PostgreSQL (SQLSTATE) a errores de aplicación con sentido para el cliente. */
export function traducirErrorPg(err) {
  if (!err || typeof err.code !== 'string') return err;
  switch (err.code) {
    case '23505': return conflicto('Ya existe un registro con ese identificador', err.detail);
    case '23503': return conflicto('El registro está en uso por otros datos', 'Tiene recetas o movimientos asociados y no puede eliminarse ni referenciarse.');
    case '23514': return validacion('Los datos violan una regla de integridad', err.constraint ? `Regla incumplida: ${err.constraint}` : undefined);
    case '22P02':
    case '22003':
    case '22007': return validacion('Valor con formato o rango inválido');
    default: return err;
  }
}

/**
 * DT-20: errores que indican que la BASE no está disponible (no un fallo del código). Se responden 503 con
 * Retry-After para que el cliente reintente y el diagnóstico no se confunda con un 500.
 * SQLSTATE 08xxx (conexión), 57P01/02/03 (servidor apagándose o arrancando), 53300 (demasiadas conexiones),
 * errores de red de Node y los mensajes propios de node-postgres al agotar el tiempo o perder la conexión.
 */
const CODIGOS_RED = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'EPIPE']);
export function esBaseNoDisponible(err) {
  if (!err) return false;
  const code = typeof err.code === 'string' ? err.code : '';
  if (CODIGOS_RED.has(code) || /^08/.test(code) || ['57P01', '57P02', '57P03', '53300'].includes(code)) return true;
  if (err.errors?.some?.(esBaseNoDisponible)) return true; // AggregateError (IPv4 + IPv6 rechazados)
  return /timeout exceeded when trying to connect|Connection terminated|connection.*(closed|terminated)/i.test(err.message ?? '');
}

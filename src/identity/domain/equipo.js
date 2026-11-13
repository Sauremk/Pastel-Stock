// Reglas del equipo (v1.5): quién puede entrar a la tienda y con qué rol. Funciones puras, sin infraestructura:
// las usan el servidor Node y la app sin servidor (pwa/servidor.js), así ambas versiones se comportan igual.
import { conflicto, validacion } from '../../shared/errors.js';
import { ROLES } from './roles.js';

/** Nombre de usuario: 3 a 40 caracteres, minúsculas, números, punto, guion o guion bajo; empieza con letra o número. */
export const RE_USUARIO = /^[a-z0-9][a-z0-9._-]{2,39}$/;
export const CLAVE_MIN = 8;
export const CLAVE_MAX = 72; // bcrypt solo usa los primeros 72 bytes

export const normalizarUsuario = (u) => String(u ?? '').trim().toLowerCase();

export function validarNuevoUsuario({ usuario, nombre, rol, contrasena }) {
  const u = normalizarUsuario(usuario);
  if (!RE_USUARIO.test(u)) throw validacion('Usuario inválido', 'Use de 3 a 40 letras minúsculas, números, punto, guion o guion bajo, sin espacios.');
  validarNombre(nombre);
  if (!ROLES.includes(rol)) throw validacion('Rol inválido', `Use ${ROLES.join(', ')}.`);
  validarClave(contrasena);
  return { usuario: u, nombre: nombre.trim(), rol };
}

export function validarNombre(nombre) {
  if (typeof nombre !== 'string' || nombre.trim().length < 2 || nombre.trim().length > 80) throw validacion('Nombre inválido', 'Entre 2 y 80 caracteres.');
}

export function validarClave(contrasena) {
  if (typeof contrasena !== 'string' || contrasena.length < CLAVE_MIN || contrasena.length > CLAVE_MAX) {
    throw validacion('Contraseña inválida', `Use entre ${CLAVE_MIN} y ${CLAVE_MAX} caracteres.`);
  }
}

/**
 * Comprueba un cambio de nombre, rol o estado sobre un usuario.
 * - Nadie puede quitarse a sí mismo el rol de administrador ni desactivarse (se quedaría por fuera).
 * - Siempre debe quedar al menos un administrador activo.
 * @param actorId id de quien hace el cambio
 * @param objetivo usuario actual { id, rol, activo }
 * @param cambios { nombre?, rol?, activo? }
 * @param adminsActivos número de administradores activos ANTES del cambio
 */
function validarCambios(cambios) {
  if (cambios.nombre !== undefined) validarNombre(cambios.nombre);
  if (cambios.rol !== undefined && !ROLES.includes(cambios.rol)) throw validacion('Rol inválido', `Use ${ROLES.join(', ')}.`);
  if (cambios.activo !== undefined && typeof cambios.activo !== 'boolean') throw validacion('Estado inválido', '"activo" debe ser verdadero o falso.');
}

export function comprobarCambio({ actorId, objetivo, cambios, adminsActivos }) {
  validarCambios(cambios);
  const despues = { ...objetivo, ...cambios };
  const quedaAdmin = despues.rol === 'admin' && despues.activo;
  const eraAdminActivo = objetivo.rol === 'admin' && objetivo.activo;
  if (objetivo.id === actorId && eraAdminActivo && !quedaAdmin) {
    throw conflicto('No puedes quitarte tu propio acceso de administrador', 'Pídele a otro administrador que haga el cambio.');
  }
  if (eraAdminActivo && !quedaAdmin && adminsActivos <= 1) {
    throw conflicto('La tienda se quedaría sin administrador', 'Nombra antes a otra persona como administradora.');
  }
}

/** Vista pública de un usuario (nunca expone el hash ni la sal). */
export const vistaUsuario = (u) => ({ id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, activo: u.activo !== false, creadoEn: u.creadoEn ?? null });

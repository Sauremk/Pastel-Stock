import { enTransaccion } from '../../db/pool.js';
import { conflicto, noEncontrado } from '../../shared/errors.js';
import { validarNuevoUsuario, validarClave, comprobarCambio, vistaUsuario } from '../domain/equipo.js';
import { crearUsuariosRepo, crearRefreshRepo } from '../adapters/pg/usuariosRepo.js';

/**
 * Casos de uso del equipo (v1.5, ADR-19): el administrador agrega personas, cambia su rol, las desactiva y les
 * pone una contraseña nueva. Las reglas viven en domain/equipo.js (compartidas con la app sin servidor).
 * Al desactivar a alguien o cambiarle la contraseña se revocan sus refresh tokens: su sesión termina cuando
 * venza el access token en curso (máximo 15 minutos, ADR-06).
 */
export function crearEquipoService({ pool, authService }) {
  const repos = (db) => ({ usuarios: crearUsuariosRepo(db), refresh: crearRefreshRepo(db) });

  return {
    async listar() {
      return { datos: (await crearUsuariosRepo(pool).listar()).map(vistaUsuario) };
    },

    async crear(cuerpo) {
      const datos = validarNuevoUsuario(cuerpo);
      const passwordHash = await authService.hashear(cuerpo.contrasena);
      try {
        return vistaUsuario(await crearUsuariosRepo(pool).crear({ ...datos, passwordHash }));
      } catch (e) {
        if (e.code === '23505') throw conflicto('Ese nombre de usuario ya existe', `Elige otro distinto de "${datos.usuario}".`);
        throw e;
      }
    },

    async actualizar(actorId, id, cambios) {
      return enTransaccion(pool, async (client) => {
        const { usuarios, refresh } = repos(client);
        const adminsActivos = await usuarios.contarAdminsActivos();
        const objetivo = await usuarios.porIdParaActualizar(id);
        if (!objetivo) throw noEncontrado('Usuario', id);
        comprobarCambio({ actorId, objetivo, cambios, adminsActivos });
        const nuevo = await usuarios.actualizar(id, { nombre: cambios.nombre?.trim(), rol: cambios.rol, activo: cambios.activo });
        if (cambios.activo === false || (cambios.rol !== undefined && cambios.rol !== objetivo.rol)) await refresh.revocarTodos(id);
        return vistaUsuario(nuevo);
      });
    },

    async restablecerClave(id, contrasena) {
      validarClave(contrasena);
      const passwordHash = await authService.hashear(contrasena);
      await enTransaccion(pool, async (client) => {
        const { usuarios, refresh } = repos(client);
        if (!(await usuarios.cambiarClave(id, passwordHash))) throw noEncontrado('Usuario', id);
        await refresh.revocarTodos(id);
      });
    },
  };
}

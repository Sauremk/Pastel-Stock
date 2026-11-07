// Sesión: access token SOLO en memoria; refresh token en sessionStorage (se borra al cerrar la pestaña).
// Compromiso documentado: un XSS podría leer sessionStorage; se mitiga con CSP estricta y sin innerHTML con datos.
import { ApiError, parseProblema } from './format.js';
import { PERMISOS } from './catalogos.js';

const CLAVE_REFRESH = 'ps.refresh';

function almacenamientoSeguro(storage) {
  return {
    leer() { try { return storage?.getItem(CLAVE_REFRESH) ?? null; } catch { return null; } },
    guardar(v) { try { storage?.setItem(CLAVE_REFRESH, v); } catch { /* modo privado: la sesión dura la pestaña en memoria */ } },
    borrar() { try { storage?.removeItem(CLAVE_REFRESH); } catch { /* nada */ } },
  };
}

export function crearAuth({ fetchImpl = (...a) => globalThis.fetch(...a), storage = globalThis.sessionStorage, baseUrl = '/api/v1' } = {}) {
  const almacen = almacenamientoSeguro(storage);
  const estado = { accessToken: null, usuario: null };
  let renovando = null; // una sola renovación a la vez (el servidor rota el refresh token)

  async function post(ruta, cuerpo) {
    let resp;
    try {
      resp = await fetchImpl(`${baseUrl}${ruta}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, application/problem+json' },
        body: JSON.stringify(cuerpo),
      });
    } catch {
      throw new ApiError(parseProblema(0, null));
    }
    let datos = null;
    try { datos = await resp.json(); } catch { /* sin cuerpo JSON */ }
    if (!resp.ok) {
      const p = parseProblema(resp.status, datos);
      const reintentar = resp.headers?.get?.('Retry-After');
      if (resp.status === 429 && reintentar) p.mensaje += ` Reintenta en ${reintentar} s.`;
      throw new ApiError(p);
    }
    return datos;
  }

  function aplicar(par) {
    estado.accessToken = par.accessToken;
    estado.usuario = { nombre: par.nombre ?? par.rol, rol: par.rol };
    almacen.guardar(par.refreshToken);
  }

  function limpiar() {
    estado.accessToken = null;
    estado.usuario = null;
    almacen.borrar();
  }

  return {
    token: () => estado.accessToken,
    usuario: () => estado.usuario,
    tieneRefresh: () => almacen.leer() !== null,
    estaAutenticado: () => estado.accessToken !== null,

    async iniciarSesion(usuario, contrasena) {
      const par = await post('/auth/login', { usuario, contrasena });
      aplicar(par);
      return estado.usuario;
    },

    /** Renueva el par de tokens con el refresh vigente. Lanza si no se puede. */
    renovar() {
      if (!renovando) {
        renovando = (async () => {
          const refresh = almacen.leer();
          if (!refresh) throw new ApiError(parseProblema(401, null));
          const par = await post('/auth/refresh', { refreshToken: refresh });
          aplicar(par);
          return estado.usuario;
        })().finally(() => { renovando = null; });
      }
      return renovando;
    },

    /** Al abrir la página: si hay refresh token, intenta reabrir la sesión. */
    async restaurar() {
      if (!almacen.leer()) return false;
      try { await this.renovar(); return true; } catch (e) {
        // Solo se descarta el refresh si el servidor lo rechazó; un corte de red no cierra la sesión.
        if (e instanceof ApiError && e.status !== 0 && e.status < 500) limpiar();
        return false;
      }
    },

    cerrarSesion: limpiar,

    /** ¿El rol actual tiene este permiso de interfaz? (cosmético; el servidor decide) */
    puede(permiso) {
      const rol = estado.usuario?.rol;
      return Boolean(rol && (PERMISOS[permiso] ?? []).includes(rol));
    },
  };
}

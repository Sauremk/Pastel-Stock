// Cliente HTTP del API /api/v1 con JWT: un reintento automático tras renovar el token ante un 401.
import { ApiError, parseProblema, construirConsulta, nombreDeArchivo } from './format.js';

export function crearApi({ auth, fetchImpl = (...a) => globalThis.fetch(...a), baseUrl = '/api/v1', alSesionExpirada = () => {} } = {}) {
  async function ejecutar(metodo, ruta, { consulta, cuerpo, archivo = false, cabeceras = {} } = {}, puedeReintentar = true) {
    const headers = { Accept: archivo ? '*/*' : 'application/json, application/problem+json' };
    const token = auth.token();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (cuerpo !== undefined) headers['Content-Type'] = 'application/json';
    Object.assign(headers, cabeceras);

    let resp;
    try {
      resp = await fetchImpl(`${baseUrl}${ruta}${construirConsulta(consulta)}`, {
        method: metodo,
        headers,
        body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
      });
    } catch {
      throw new ApiError(parseProblema(0, null));
    }

    if (resp.status === 401) {
      if (puedeReintentar && auth.tieneRefresh()) {
        try { await auth.renovar(); } catch (e) {
          if (e instanceof ApiError && e.status === 0) throw e; // sin red: no cerrar sesión
          auth.cerrarSesion(); alSesionExpirada();
          throw new ApiError(parseProblema(401, null));
        }
        return ejecutar(metodo, ruta, { consulta, cuerpo, archivo, cabeceras }, false);
      }
      auth.cerrarSesion(); alSesionExpirada();
    }

    if (!resp.ok) {
      let datos = null;
      try { datos = await resp.json(); } catch { /* cuerpo vacío o no JSON */ }
      throw new ApiError(parseProblema(resp.status, datos));
    }
    if (resp.status === 204) return null;
    if (archivo) {
      return { blob: await resp.blob(), nombre: nombreDeArchivo(resp.headers.get('content-disposition'), null) };
    }
    return resp.json();
  }

  return {
    get: (ruta, consulta) => ejecutar('GET', ruta, { consulta }),
    post: (ruta, cuerpo, opciones = {}) => ejecutar('POST', ruta, { cuerpo, cabeceras: opciones.cabeceras }),
    put: (ruta, cuerpo) => ejecutar('PUT', ruta, { cuerpo }),
    patch: (ruta, cuerpo) => ejecutar('PATCH', ruta, { cuerpo }),
    del: (ruta) => ejecutar('DELETE', ruta),
    descargar: (ruta, consulta) => ejecutar('GET', ruta, { consulta, archivo: true }),
  };
}

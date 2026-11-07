import { noAutenticado, prohibido } from '../../../shared/errors.js';

/** 401 si no hay un access token válido. */
export const autenticar = (authService) => (req, res, next) => {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  if (!m) { res.set('WWW-Authenticate', 'Bearer'); return next(noAutenticado('Token ausente')); }
  try {
    req.usuario = authService.verificarAccess(m[1]);
    return next();
  } catch (e) {
    res.set('WWW-Authenticate', 'Bearer');
    return next(e);
  }
};

/** 403 si el rol autenticado no está permitido: RBAC aplicado en el SERVIDOR (corrige DT-02). */
export const autorizar = (...roles) => (req, _res, next) =>
  roles.includes(req.usuario?.rol) ? next() : next(prohibido());

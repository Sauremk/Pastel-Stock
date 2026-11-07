import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncH } from '../../../shared/http.js';

export function crearAuthRouter({ authService, validar, limitePorMinuto }) {
  const r = Router();
  const limitar = rateLimit({
    windowMs: 60_000,
    limit: limitePorMinuto,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      res.set('Retry-After', '60');
      res.status(429).type('application/problem+json').json({ type: '/errores/demasiados-intentos', title: 'Demasiados intentos, espere un minuto', status: 429, instance: req.originalUrl });
    },
  });

  r.post('/auth/login', limitar, validar.cuerpo('Credenciales'), asyncH(async (req, res) => {
    res.json(await authService.login(req.body));
  }));

  r.post('/auth/refresh', limitar, validar.cuerpo('RefreshSolicitud'), asyncH(async (req, res) => {
    res.json(await authService.renovar(req.body.refreshToken));
  }));
  return r;
}

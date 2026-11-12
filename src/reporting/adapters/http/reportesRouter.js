import { Router } from 'express';
import { asyncH } from '../../../shared/http.js';
import { autorizar } from '../../../identity/adapters/http/middleware.js';
import { TIPOS_CONTENIDO } from '../exporters/exportadores.js';

export function crearReportesRouter({ casos, usuariosRepo }) {
  const r = Router();
  r.get('/reportes/dashboard', autorizar('admin', 'operador', 'contador'), asyncH(async (_req, res) => {
    res.set('Cache-Control', 'no-store').json(await casos.dashboard());
  }));
  r.get('/reportes/alertas', autorizar('admin', 'operador', 'contador'), asyncH(async (req, res) => {
    const dias = req.query.dias === undefined ? undefined : Number(req.query.dias);
    res.set('Cache-Control', 'no-store').json(await casos.alertas(dias));
  }));
  r.get('/reportes/rentabilidad', autorizar('admin', 'contador'), asyncH(async (_req, res) => {
    res.set('Cache-Control', 'no-store').json(await casos.rentabilidad());
  }));
  r.get('/reportes/export', autorizar('admin', 'contador'), asyncH(async (req, res) => {
    const u = await usuariosRepo.porId(req.usuario.id);
    const { buffer, nombreArchivo } = await casos.exportar(String(req.query.tipo ?? ''), String(req.query.formato ?? ''), { id: req.usuario.id, nombre: u?.nombre });
    res.set({ 'Content-Type': TIPOS_CONTENIDO[nombreArchivo.split('.').pop()], 'Content-Disposition': `attachment; filename="${nombreArchivo}"`, 'Cache-Control': 'no-store' }).send(buffer);
  }));
  return r;
}

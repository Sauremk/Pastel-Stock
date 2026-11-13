import { Router } from 'express';
import { asyncH, parametro } from '../../../shared/http.js';
import { autorizar } from './middleware.js';

const RE_ID = /^[1-9][0-9]{0,8}$/;
const id = (req) => Number(parametro(req.params.id, RE_ID, 'id'));

/** Equipo (v1.5): solo el administrador gestiona quién entra a la tienda. */
export function crearEquipoRouter({ equipo, validar }) {
  const r = Router();
  const soloAdmin = autorizar('admin');
  r.get('/usuarios', soloAdmin, asyncH(async (_req, res) => {
    res.set('Cache-Control', 'no-store').json(await equipo.listar());
  }));
  r.post('/usuarios', soloAdmin, validar.cuerpo('UsuarioCrear'), asyncH(async (req, res) => {
    res.status(201).json(await equipo.crear(req.body));
  }));
  r.patch('/usuarios/:id', soloAdmin, validar.cuerpo('UsuarioActualizar'), asyncH(async (req, res) => {
    res.json(await equipo.actualizar(req.usuario.id, id(req), req.body));
  }));
  r.post('/usuarios/:id/contrasena', soloAdmin, validar.cuerpo('ClaveNueva'), asyncH(async (req, res) => {
    await equipo.restablecerClave(id(req), req.body.contrasena);
    res.status(204).end();
  }));
  return r;
}

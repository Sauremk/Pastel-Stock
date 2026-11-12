import { Router } from 'express';
import { asyncH, paginacion, pagina, parametro, enumerado, RE_MP } from '../../../shared/http.js';
import { validacion } from '../../../shared/errors.js';
import { autorizar } from '../../../identity/adapters/http/middleware.js';
import { CATEGORIAS_MATERIA, ESTADOS_STOCK } from '../../domain/catalogos.js';

const TODOS = ['admin', 'operador', 'contador'];
const TIPOS_MOVIMIENTO = ['ENTRADA', 'SALIDA', 'AJUSTE', 'AJUSTE_NEGATIVO'];

export function crearInventarioRouter({ casos, validar }) {
  const r = Router();

  r.get('/materias-primas', autorizar(...TODOS), asyncH(async (req, res) => {
    const pag = paginacion(req.query);
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    if (q && q.length > 60) throw validacion('Parámetro "q" inválido', 'Máximo 60 caracteres.');
    const filtros = {
      q: q || undefined,
      categoria: enumerado(req.query.categoria, CATEGORIAS_MATERIA, 'categoria'),
      estado: enumerado(req.query.estado, ESTADOS_STOCK, 'estado'),
      limite: pag.limite,
      offset: pag.offset,
    };
    const { filas, total } = await casos.listarMaterias(filtros);
    res.json(pagina(filas, pag, total));
  }));

  r.post('/materias-primas', autorizar('admin'), validar.cuerpo('MateriaPrimaCrear'), asyncH(async (req, res) => {
    const creada = await casos.crearMateria(req.body, req.usuario.id);
    res.status(201).location(`/api/v1/materias-primas/${creada.codigo}`).json(creada);
  }));

  r.get('/materias-primas/:codigo', autorizar(...TODOS), asyncH(async (req, res) => {
    res.json(await casos.obtenerMateria(parametro(req.params.codigo, RE_MP, 'codigo')));
  }));

  r.put('/materias-primas/:codigo', autorizar('admin'), validar.cuerpo('MateriaPrimaActualizar'), asyncH(async (req, res) => {
    res.json(await casos.actualizarMateria(parametro(req.params.codigo, RE_MP, 'codigo'), req.body));
  }));

  r.delete('/materias-primas/:codigo', autorizar('admin'), asyncH(async (req, res) => {
    await casos.eliminarMateria(parametro(req.params.codigo, RE_MP, 'codigo'));
    res.status(204).end();
  }));

  r.post('/movimientos/entradas', autorizar('admin', 'operador'), validar.cuerpo('EntradaCrear'), asyncH(async (req, res) => {
    res.status(201).json(await casos.registrarEntrada(req.body, req.usuario.id));
  }));

  r.post('/movimientos/ajustes', autorizar('admin', 'operador'), validar.cuerpo('AjusteSolicitud'), asyncH(async (req, res) => {
    res.status(201).json(await casos.registrarAjuste(req.body, req.usuario.id));
  }));

  r.get('/movimientos', autorizar(...TODOS), asyncH(async (req, res) => {
    const pag = paginacion(req.query);
    const fecha = /^\d{4}-\d{2}-\d{2}$/;
    const { codigo, desde, hasta } = req.query;
    if (codigo !== undefined) parametro(codigo, RE_MP, 'codigo');
    const tipo = enumerado(req.query.tipo, TIPOS_MOVIMIENTO, 'tipo');
    for (const [n, v] of [['desde', desde], ['hasta', hasta]]) if (v !== undefined && !fecha.test(String(v))) throw validacion(`Parámetro "${n}" inválido`, 'Use el formato AAAA-MM-DD.');
    const { datos, total } = await casos.listarMovimientos({ codigo, tipo, desde, hasta, limite: pag.limite, offset: pag.offset });
    res.json(pagina(datos, pag, total));
  }));

  return r;
}

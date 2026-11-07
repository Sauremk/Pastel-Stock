import { Router } from 'express';
import { asyncH, paginacion, pagina, parametro, enumerado, RE_PT } from '../../../shared/http.js';
import { validacion } from '../../../shared/errors.js';
import { autorizar } from '../../../identity/adapters/http/middleware.js';

const TODOS = ['admin', 'operador', 'contador'];
const RE_CLAVE = /^[A-Za-z0-9_-]{8,64}$/;
const CATEGORIAS_PRODUCTO = ['Pasteles', 'Panes', 'Galletas', 'Tartas', 'Postres'];
const idRuta = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw validacion('Parámetro "id" inválido', 'Debe ser un entero ≥ 1.');
  return n;
};

export function crearCatalogoRouter({ casos, validar }) {
  const r = Router();

  // ---- Productos
  r.get('/productos', autorizar(...TODOS), asyncH(async (req, res) => {
    const pag = paginacion(req.query);
    const { filas, total } = await casos.listarProductos({ categoria: enumerado(req.query.categoria, CATEGORIAS_PRODUCTO, 'categoria'), limite: pag.limite, offset: pag.offset });
    res.json(pagina(filas, pag, total));
  }));
  r.post('/productos', autorizar('admin'), validar.cuerpo('ProductoCrear'), asyncH(async (req, res) => {
    const p = await casos.crearProducto(req.body);
    res.status(201).location(`/api/v1/productos/${p.sku}`).json(p);
  }));
  r.get('/productos/:sku', autorizar(...TODOS), asyncH(async (req, res) => res.json(await casos.obtenerProducto(parametro(req.params.sku, RE_PT, 'sku')))));
  r.put('/productos/:sku', autorizar('admin'), validar.cuerpo('ProductoActualizar'), asyncH(async (req, res) => res.json(await casos.actualizarProducto(parametro(req.params.sku, RE_PT, 'sku'), req.body))));
  r.delete('/productos/:sku', autorizar('admin'), asyncH(async (req, res) => { await casos.eliminarProducto(parametro(req.params.sku, RE_PT, 'sku')); res.status(204).end(); }));

  // ---- Recetas
  r.get('/recetas', autorizar(...TODOS), asyncH(async (req, res) => {
    const pag = paginacion(req.query);
    const { filas, total } = await casos.listarRecetas({ limite: pag.limite, offset: pag.offset });
    res.json(pagina(filas, pag, total));
  }));
  r.post('/recetas', autorizar('admin'), validar.cuerpo('RecetaCrear'), asyncH(async (req, res) => {
    const rec = await casos.crearReceta(req.body);
    res.status(201).location(`/api/v1/recetas/${rec.id}`).json(rec);
  }));
  r.get('/recetas/:id', autorizar(...TODOS), asyncH(async (req, res) => res.json(await casos.obtenerReceta(idRuta(req.params.id)))));
  r.put('/recetas/:id', autorizar('admin'), validar.cuerpo('RecetaActualizar'), asyncH(async (req, res) => res.json(await casos.reemplazarReceta(idRuta(req.params.id), req.body))));
  r.delete('/recetas/:id', autorizar('admin'), asyncH(async (req, res) => { await casos.eliminarReceta(idRuta(req.params.id)); res.status(204).end(); }));
  r.post('/recetas/:id/producir', autorizar('admin', 'operador'), validar.cuerpo('ProducirSolicitud'), asyncH(async (req, res) => {
    const clave = req.get('Idempotency-Key');
    if (clave !== undefined && !RE_CLAVE.test(clave)) throw validacion('Cabecera "Idempotency-Key" inválida', 'Debe tener entre 8 y 64 caracteres: letras, números, guion o guion bajo.');
    const { repetida, cuerpo } = await casos.producir(idRuta(req.params.id), req.body, req.usuario.id, clave);
    if (clave) res.set('Idempotency-Replayed', String(repetida));
    res.status(201).json(cuerpo);
  }));
  return r;
}

import { Router } from 'express';
import { asyncH, paginacion } from '../../../shared/http.js';
import { validacion } from '../../../shared/errors.js';
import { RE_CLAVE } from '../../../shared/idempotencia.js';
import { autorizar } from '../../../identity/adapters/http/middleware.js';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function crearVentasRouter({ casos, validar }) {
  const r = Router();

  r.post('/ventas', autorizar('admin', 'operador'), validar.cuerpo('VentaCrear'), asyncH(async (req, res) => {
    const clave = req.get('Idempotency-Key');
    if (clave !== undefined && !RE_CLAVE.test(clave)) throw validacion('Cabecera "Idempotency-Key" inválida', 'Debe tener entre 8 y 64 caracteres: letras, números, guion o guion bajo.');
    const { repetida, cuerpo } = await casos.registrarVenta(req.body, req.usuario.id, clave);
    if (clave) res.set('Idempotency-Replayed', String(repetida));
    res.status(201).location(`/api/v1/ventas/${cuerpo.id}`).json(cuerpo);
  }));

  r.get('/ventas', autorizar('admin', 'operador', 'contador'), asyncH(async (req, res) => {
    const pag = paginacion(req.query);
    const { desde, hasta } = req.query;
    for (const [n, v] of [['desde', desde], ['hasta', hasta]]) if (v !== undefined && !FECHA.test(String(v))) throw validacion(`Parámetro "${n}" inválido`, 'Use el formato AAAA-MM-DD.');
    const { datos, total, resumen } = await casos.listarVentas({ desde, hasta, limite: pag.limite, offset: pag.offset });
    res.json({ datos, paginacion: { pagina: pag.pagina, limite: pag.limite, total }, resumen });
  }));

  return r;
}

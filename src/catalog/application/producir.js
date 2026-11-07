import crypto from 'node:crypto';
import { enTransaccion } from '../../db/pool.js';
import { conflicto, noEncontrado, validacion } from '../../shared/errors.js';
import { contarProduccion, contarStockCritico } from '../../shared/metricas.js';
import { convertir } from '../../inventory/domain/unidades.js';

/**
 * Registra una producción: consume ingredientes (SALIDA) y suma stock al producto terminado en UNA transacción.
 * Si algún ingrediente no alcanza, no se modifica nada (409). El stock nunca queda negativo.
 */
export async function producir({ pool, inventario, repos }, id, { unidades, nota }, usuarioId, clave) {
  try {
    const huella = crypto.createHash('sha256').update(JSON.stringify([id, unidades, nota ?? null])).digest('hex');
    const resultado = await enTransaccion(pool, async (db) => {
      if (clave) {
        // La clave se inserta dentro de la MISMA transacción: si la producción se revierte, la clave también.
        // Si otra petición con la misma clave está en curso, este INSERT espera a que confirme o revierta.
        const nueva = await db.query(
          'INSERT INTO claves_idempotencia (usuario_id, clave, huella) VALUES ($1, $2, $3) ON CONFLICT (usuario_id, clave) DO NOTHING RETURNING 1',
          [usuarioId, clave, huella]);
        if (!nueva.rowCount) {
          const previa = (await db.query('SELECT huella, respuesta FROM claves_idempotencia WHERE usuario_id = $1 AND clave = $2', [usuarioId, clave])).rows[0];
          if (previa.huella !== huella) throw validacion('Clave de idempotencia reutilizada', 'La misma Idempotency-Key se usó antes con una solicitud distinta.');
          return { repetida: true, cuerpo: previa.respuesta };
        }
      }
      const { recetas, productos } = repos(db);
      const inv = inventario.reposEn(db);
      const receta = await recetas.obtener(id);
      if (!receta) throw noEncontrado('Receta', String(id));
      const bloqueadas = new Map((await inv.materias.obtenerVariasBloqueadas(receta.ingredientes.map((i) => i.codigoMateriaPrima))).map((m) => [m.codigo, m]));

      const consumos = receta.ingredientes.map((i) => {
        const mp = bloqueadas.get(i.codigoMateriaPrima);
        return { mp, necesario: convertir(i.cantidad * unidades, i.unidad, mp.unidad) };
      });
      const faltantes = consumos.filter(({ mp, necesario }) => mp.stock < necesario);
      if (faltantes.length) {
        throw conflicto('Stock insuficiente para producir', faltantes.map(({ mp, necesario }) => `${mp.nombre}: se necesitan ${necesario} ${mp.unidad} y hay ${mp.stock}`).join('; '),
          { faltantes: faltantes.map(({ mp, necesario }) => ({ codigoMateriaPrima: mp.codigo, necesario, disponible: mp.stock, unidad: mp.unidad })) });
      }

      const detalle = [];
      for (const { mp, necesario } of consumos) {
        const despues = await inv.materias.ajustarStock(mp.codigo, -necesario);
        await inv.movimientos.insertar({ codigo: mp.codigo, tipo: 'SALIDA', cantidad: necesario, costoUnitario: mp.costo, usuarioId, nota: nota ?? `Producción de ${unidades} × ${receta.productoNombre}` });
        if (despues.estado === 'CRITICO') contarStockCritico();
        detalle.push({ codigoMateriaPrima: mp.codigo, cantidadConsumida: necesario, stockRestante: despues.stock, estado: despues.estado });
      }
      const prod = await productos.sumarStock(receta.productoSku, unidades);
      const cuerpo = { productoSku: receta.productoSku, stockProducto: prod.stock, consumos: detalle };
      if (clave) await db.query('UPDATE claves_idempotencia SET estado = 201, respuesta = $3 WHERE usuario_id = $1 AND clave = $2', [usuarioId, clave, JSON.stringify(cuerpo)]);
      return { repetida: false, cuerpo };
    });
    if (!resultado.repetida) contarProduccion('ok');
    return resultado;
  } catch (e) {
    contarProduccion(e.status ? `http_${e.status}` : 'error');
    throw e;
  }
}

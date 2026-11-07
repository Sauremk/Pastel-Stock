import { enTransaccion } from '../../db/pool.js';
import { conflicto, noEncontrado } from '../../shared/errors.js';
import { contarProduccion, contarStockCritico } from '../../shared/metricas.js';
import { convertir } from '../../inventory/domain/unidades.js';

/**
 * Registra una producción: consume ingredientes (SALIDA) y suma stock al producto terminado en UNA transacción.
 * Si algún ingrediente no alcanza, no se modifica nada (409). El stock nunca queda negativo.
 */
export async function producir({ pool, inventario, repos }, id, { unidades, nota }, usuarioId) {
  try {
    const resultado = await enTransaccion(pool, async (db) => {
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
      return { productoSku: receta.productoSku, stockProducto: prod.stock, consumos: detalle };
    });
    contarProduccion('ok');
    return resultado;
  } catch (e) {
    contarProduccion(e.status ? `http_${e.status}` : 'error');
    throw e;
  }
}

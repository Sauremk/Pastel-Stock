import { enTransaccion } from '../../db/pool.js';
import { conflicto, noEncontrado } from '../../shared/errors.js';
import { contarProduccion, contarStockCritico } from '../../shared/metricas.js';
import { huella, reclamarClave, guardarRespuesta } from '../../shared/idempotencia.js';
import { convertir } from '../../inventory/domain/unidades.js';
import { costoPromedio, redondear2 } from '../domain/costeo.js';

/**
 * Registra una producción: consume ingredientes (SALIDA) y suma stock al producto terminado en UNA transacción.
 * Si algún ingrediente no alcanza, no se modifica nada (409). El stock nunca queda negativo.
 * v1.1: costea el lote con el costo de cada insumo, recalcula el costo promedio ponderado del producto,
 * deja el movimiento PRODUCCION en el kardex del producto y, si se indica, actualiza su fecha de caducidad.
 */
export async function producir({ pool, inventario, repos }, id, { unidades, nota, caducidad }, usuarioId, clave) {
  try {
    // La huella conserva la forma de v1.0 cuando no hay caducidad: las claves ya guardadas siguen siendo válidas.
    const h = caducidad ? huella(id, unidades, nota ?? null, caducidad) : huella(id, unidades, nota ?? null);
    const resultado = await enTransaccion(pool, async (db) => {
      if (clave) {
        const previa = await reclamarClave(db, { usuarioId, clave, huella: h });
        if (previa) return { repetida: true, cuerpo: previa };
      }
      const { recetas, productos, kardex } = repos(db);
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
      let costoLote = 0;
      for (const { mp, necesario } of consumos) {
        const despues = await inv.materias.ajustarStock(mp.codigo, -necesario);
        await inv.movimientos.insertar({ codigo: mp.codigo, tipo: 'SALIDA', cantidad: necesario, costoUnitario: mp.costo, usuarioId, nota: nota ?? `Producción de ${unidades} × ${receta.productoNombre}` });
        if (despues.estado === 'CRITICO') contarStockCritico();
        costoLote += necesario * mp.costo;
        detalle.push({ codigoMateriaPrima: mp.codigo, cantidadConsumida: necesario, stockRestante: despues.stock, estado: despues.estado });
      }
      costoLote = redondear2(costoLote);

      const antes = await productos.obtener(receta.productoSku, { bloquear: true });
      const nuevoCosto = costoPromedio({ stockAnterior: antes.stock, costoAnterior: antes.costoUnitario, unidades, costoLote });
      await productos.fijarCostoYCaducidad(receta.productoSku, { costoUnitario: nuevoCosto, caducidad });
      const prod = await productos.sumarStock(receta.productoSku, unidades);
      const costoUnitarioLote = redondear2(costoLote / unidades);
      await kardex.insertar({ sku: receta.productoSku, tipo: 'PRODUCCION', cantidad: unidades, costoUnitario: costoUnitarioLote, usuarioId, nota: nota ?? `Producción de ${unidades} unidades` });

      const cuerpo = {
        productoSku: receta.productoSku, stockProducto: prod.stock, consumos: detalle,
        costoLote, costoUnitarioLote, costoPromedioProducto: nuevoCosto, caducidadProducto: prod.caducidad,
      };
      if (clave) await guardarRespuesta(db, { usuarioId, clave, cuerpo });
      return { repetida: false, cuerpo };
    });
    if (!resultado.repetida) contarProduccion('ok');
    return resultado;
  } catch (e) {
    contarProduccion(e.status ? `http_${e.status}` : 'error');
    throw e;
  }
}

import { enTransaccion } from '../../db/pool.js';
import { huella, reclamarClave, guardarRespuesta } from '../../shared/idempotencia.js';
import { contarVenta } from '../../shared/metricas.js';
import { abreviarNombre } from '../../inventory/adapters/pg/movimientosRepo.js';
import { fechaLocal } from '../../reporting/domain/dashboard.js';
import { validarLineas, liquidarVenta, comprobarVendible } from '../domain/venta.js';
import { crearVentasRepo } from '../adapters/pg/ventasRepo.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Contexto Ventas (v1.1). Descuenta producto terminado y congela precio y costo en cada línea.
 * `catalogo.reposEn(db)` es la interfaz pública de Catálogo: Ventas participa en SU transacción sin tocar sus tablas.
 */
export function crearCasosVentas({ pool, catalogo, reloj = () => new Date(), zona = 'America/Bogota' }) {
  return {
    async registrarVenta({ items, nota }, usuarioId, clave) {
      validarLineas(items);
      try {
        const resultado = await enTransaccion(pool, async (db) => {
          if (clave) {
            const previa = await reclamarClave(db, { usuarioId, clave, huella: huella('venta', items, nota ?? null) });
            if (previa) return { repetida: true, cuerpo: previa };
          }
          const { productos, kardex } = catalogo.reposEn(db);
          const bloqueados = new Map((await productos.obtenerVariosBloqueados(items.map((i) => i.sku))).map((p) => [p.sku, p]));
          comprobarVendible(items, bloqueados, fechaLocal(reloj(), zona));

          const liquidacion = liquidarVenta(items, bloqueados);
          const venta = await crearVentasRepo(db).insertar({ usuarioId, total: liquidacion.total, costoTotal: liquidacion.costoTotal, nota, lineas: liquidacion.lineas });
          const stockRestante = [];
          for (const l of liquidacion.lineas) {
            const despues = await productos.sumarStock(l.sku, -l.cantidad);
            await kardex.insertar({ sku: l.sku, tipo: 'VENTA', cantidad: l.cantidad, costoUnitario: l.costoUnitario, ventaId: venta.id, usuarioId, nota: `Venta #${venta.id}` });
            stockRestante.push({ sku: l.sku, stock: despues.stock });
          }
          const cuerpo = {
            id: venta.id, creadoEn: venta.creadoEn instanceof Date ? venta.creadoEn.toISOString() : venta.creadoEn,
            total: liquidacion.total, costoTotal: liquidacion.costoTotal, margen: liquidacion.margen,
            items: liquidacion.lineas.map(({ sku, nombre, cantidad, precioUnitario, costoUnitario, subtotal }) => ({ sku, nombre, cantidad, precioUnitario, costoUnitario, subtotal })),
            stockRestante,
            ...(nota ? { nota } : {}),
          };
          if (clave) await guardarRespuesta(db, { usuarioId, clave, cuerpo });
          return { repetida: false, cuerpo };
        });
        if (!resultado.repetida) contarVenta('ok');
        return resultado;
      } catch (e) {
        contarVenta(e.status ? `http_${e.status}` : 'error');
        throw e;
      }
    },

    async listarVentas(filtros) {
      const { filas, total, resumen } = await crearVentasRepo(pool).listar({ ...filtros, zona });
      const datos = filas.map(({ registradoPorNombre, nota, creadoEn, total: t, costoTotal, items, ...f }) => ({
        ...f, total: t, costoTotal, margen: r2(t - costoTotal),
        items: items.map((i) => ({ ...i, subtotal: r2(i.cantidad * i.precioUnitario) })),
        ...(nota ? { nota } : {}),
        ...(registradoPorNombre ? { registradoPor: abreviarNombre(registradoPorNombre) } : {}),
        creadoEn: creadoEn instanceof Date ? creadoEn.toISOString() : creadoEn,
      }));
      return { datos, total, resumen: { total: r2(resumen.total), costo: r2(resumen.costo), margen: r2(resumen.total - resumen.costo) } };
    },
  };
}

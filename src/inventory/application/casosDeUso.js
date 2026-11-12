import { conflicto, noEncontrado, validacion } from '../../shared/errors.js';
import { contarEntrada, contarStockCritico } from '../../shared/metricas.js';
import { abreviarNombre } from '../adapters/pg/movimientosRepo.js';
import { tipoDeAjuste } from '../domain/ajustes.js';

/** Casos de uso del contexto Inventario. Dependen del puerto `uow`, no de Express ni de pg. */
export function crearCasosInventario({ uow }) {
  return {
    async listarMaterias(filtros) {
      return uow.leer().materias.listar(filtros);
    },

    async obtenerMateria(codigo) {
      const m = await uow.leer().materias.obtener(codigo);
      if (!m) throw noEncontrado('Materia prima', codigo);
      return m;
    },

    /** Crea la materia prima; si trae stock inicial lo registra como movimiento AJUSTE (el kardex siempre cuadra con el stock). */
    async crearMateria(datos, usuarioId) {
      return uow.transaccion(async ({ materias, movimientos }) => {
        if (await materias.obtener(datos.codigo)) throw conflicto('Ya existe una materia prima con ese código', `Código ${datos.codigo}.`);
        const creada = await materias.crear(datos);
        if (datos.stock > 0) {
          await movimientos.insertar({ codigo: datos.codigo, tipo: 'AJUSTE', cantidad: datos.stock, costoUnitario: datos.costo, usuarioId, nota: 'Stock inicial', motivo: 'STOCK_INICIAL' });
        }
        return creada;
      });
    },

    async actualizarMateria(codigo, datos) {
      return uow.transaccion(async ({ materias, movimientos }) => {
        const actual = await materias.obtener(codigo, { bloquear: true });
        if (!actual) throw noEncontrado('Materia prima', codigo);
        if (datos.unidad !== actual.unidad) {
          const enUso = await materias.contarRecetasQueLaUsan(codigo);
          const historial = await movimientos.contarTodos(codigo);
          if (enUso > 0 || historial > 0) {
            throw validacion('No se puede cambiar la unidad', 'La materia prima tiene recetas o historial de movimientos en la unidad actual.');
          }
        }
        return materias.actualizar(codigo, datos);
      });
    },

    async eliminarMateria(codigo) {
      return uow.transaccion(async ({ materias, movimientos }) => {
        const m = await materias.obtener(codigo, { bloquear: true });
        if (!m) throw noEncontrado('Materia prima', codigo);
        if ((await materias.contarRecetasQueLaUsan(codigo)) > 0) {
          throw conflicto('No se puede eliminar: está en uso en una receta', `La materia prima ${codigo} forma parte de al menos una receta.`);
        }
        if ((await movimientos.contarNoIniciales(codigo)) > 0) {
          throw conflicto('No se puede eliminar: tiene historial de movimientos', 'El kardex es un registro de auditoría. Déjela en stock 0 en lugar de eliminarla.');
        }
        await movimientos.eliminarAjustes(codigo); // solo el "stock inicial" de una materia sin uso real
        await materias.eliminar(codigo);
      });
    },

    /** Endpoint crítico (ADR-08): suma stock de forma atómica y deja el movimiento. DT-08: la cantidad ya viene validada > 0. */
    async registrarEntrada({ codigo, cantidad, proveedor, nota }, usuarioId) {
      try {
        const resultado = await uow.transaccion(async ({ materias, movimientos }) => {
          const m = await materias.ajustarStock(codigo, cantidad); // UPDATE atómico: bloquea la fila hasta el COMMIT
          if (!m) throw noEncontrado('Materia prima', codigo);
          const movimientoId = await movimientos.insertar({ codigo, tipo: 'ENTRADA', cantidad, costoUnitario: m.costo, proveedor, usuarioId, nota });
          return { codigo, stock: m.stock, estado: m.estado, movimientoId };
        });
        contarEntrada('ok');
        return resultado;
      } catch (e) {
        contarEntrada(e.status ? `http_${e.status}` : 'error');
        throw e;
      }
    },

    /**
     * Conteo físico de una materia prima: el stock pasa a ser lo contado y la diferencia queda en el kardex
     * (AJUSTE si sobra, AJUSTE_NEGATIVO si falta) con su motivo. Bloquea la fila: no compite con producciones.
     */
    async registrarAjuste({ codigo, stockContado, motivo, nota }, usuarioId) {
      return uow.transaccion(async ({ materias, movimientos }) => {
        const m = await materias.obtener(codigo, { bloquear: true });
        if (!m) throw noEncontrado('Materia prima', codigo);
        const ajuste = tipoDeAjuste(m.stock, stockContado);
        if (!ajuste) return { codigo, stockAnterior: m.stock, stockNuevo: m.stock, diferencia: 0, valorDiferencia: 0, estado: m.estado, movimientoId: null };
        const despues = await materias.ajustarStock(codigo, ajuste.tipo === 'AJUSTE' ? ajuste.cantidad : -ajuste.cantidad);
        const movimientoId = await movimientos.insertar({ codigo, ...ajuste, costoUnitario: m.costo, usuarioId, nota, motivo });
        const diferencia = Math.round((despues.stock - m.stock) * 1e6) / 1e6;
        return { codigo, stockAnterior: m.stock, stockNuevo: despues.stock, diferencia, valorDiferencia: Math.round(diferencia * m.costo * 100) / 100, estado: despues.estado, movimientoId };
      });
    },

    async listarMovimientos(filtros) {
      const { filas, total } = await uow.leer().movimientos.listar(filtros);
      const datos = filas.map(({ registradoPorNombre, proveedor, nota, motivo, ...f }) => ({
        ...f,
        ...(proveedor ? { proveedor } : {}),
        ...(nota ? { nota } : {}),
        ...(motivo ? { motivo } : {}),
        ...(registradoPorNombre ? { registradoPor: abreviarNombre(registradoPorNombre) } : {}),
        creadoEn: f.creadoEn instanceof Date ? f.creadoEn.toISOString() : f.creadoEn,
      }));
      return { datos, total };
    },

    /** Usado por Catálogo (producir): descuenta ingredientes dentro de la transacción del llamador. */
    contarCritico: contarStockCritico,
  };
}

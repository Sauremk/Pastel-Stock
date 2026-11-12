import { enTransaccion } from '../../db/pool.js';
import { conflicto, noEncontrado, validacion } from '../../shared/errors.js';
import { producir } from './producir.js';
import { sonCompatibles } from '../../inventory/domain/unidades.js';
import { costearReceta, margen } from '../domain/costeo.js';
import { tipoDeAjuste } from '../../inventory/domain/ajustes.js';
import { abreviarNombre } from '../../inventory/adapters/pg/movimientosRepo.js';
import { crearProductosRepo, crearRecetasRepo, crearMovimientosProductoRepo } from '../adapters/pg/catalogoRepos.js';

/**
 * Casos de uso del contexto Catálogo y Producción.
 * `inventario` es la INTERFAZ PÚBLICA del contexto Inventario (ADR-05): Catálogo no toca sus tablas directamente.
 */
export function crearCasosCatalogo({ pool, inventario }) {
  const repos = (db) => ({ productos: crearProductosRepo(db), recetas: crearRecetasRepo(db), kardex: crearMovimientosProductoRepo(db) });
  const leer = () => repos(pool);

  /** Verifica que cada ingrediente exista y tenga una unidad de la misma dimensión que la materia prima (DT-09). */
  async function validarIngredientes(items) {
    const codigos = items.map((i) => i.codigoMateriaPrima);
    if (new Set(codigos).size !== codigos.length) throw validacion('Ingredientes repetidos', 'Cada materia prima solo puede aparecer una vez en la receta.');
    const existentes = new Map((await inventario.leer().materias.obtenerVariasBloqueadasLectura(codigos)).map((m) => [m.codigo, m]));
    for (const i of items) {
      const mp = existentes.get(i.codigoMateriaPrima);
      if (!mp) throw validacion('Materia prima inexistente en la receta', `No existe la materia prima ${i.codigoMateriaPrima}.`);
      if (!sonCompatibles(i.unidad, mp.unidad)) throw validacion('Unidad incompatible en un ingrediente', `${mp.nombre} se controla en "${mp.unidad}" y la receta usa "${i.unidad}".`);
    }
  }

  return {
    // ---- Productos
    listarProductos: (f) => leer().productos.listar(f),
    async obtenerProducto(sku) {
      const p = await leer().productos.obtener(sku);
      if (!p) throw noEncontrado('Producto', sku);
      return p;
    },
    /** Crea el producto; si trae stock inicial lo deja en el kardex de producto (AJUSTE, STOCK_INICIAL). */
    async crearProducto(datos, usuarioId = null) {
      return enTransaccion(pool, async (db) => {
        const { productos, kardex } = repos(db);
        if (await productos.obtener(datos.sku)) throw conflicto('Ya existe un producto con ese SKU', `SKU ${datos.sku}.`);
        const creado = await productos.crear(datos);
        if (creado.stock > 0) await kardex.insertar({ sku: creado.sku, tipo: 'AJUSTE', cantidad: creado.stock, costoUnitario: creado.costoUnitario, motivo: 'STOCK_INICIAL', usuarioId, nota: 'Stock inicial' });
        return creado;
      });
    },
    /** Si el stock cambia por edición directa, la diferencia queda en el kardex como corrección (antes no dejaba rastro, DT-22). */
    async actualizarProducto(sku, datos, usuarioId = null) {
      return enTransaccion(pool, async (db) => {
        const { productos, kardex } = repos(db);
        const actual = await productos.obtener(sku, { bloquear: true });
        if (!actual) throw noEncontrado('Producto', sku);
        const p = await productos.actualizar(sku, datos);
        const ajuste = tipoDeAjuste(actual.stock, p.stock);
        if (ajuste) await kardex.insertar({ sku, ...ajuste, costoUnitario: p.costoUnitario, motivo: 'CORRECCION', usuarioId, nota: 'Edición directa del stock' });
        return p;
      });
    },
    async eliminarProducto(sku) {
      return enTransaccion(pool, async (db) => {
        const { productos } = repos(db);
        if (!(await productos.obtener(sku, { bloquear: true }))) throw noEncontrado('Producto', sku);
        if (await productos.tieneHistorial(sku)) throw conflicto('No se puede eliminar: el producto tiene ventas, producciones o bajas', 'El kardex es un registro de auditoría. Déjelo en stock 0 en lugar de eliminarlo.');
        await productos.eliminar(sku);
      });
    },

    /** Conteo físico de producto terminado: fija el stock contado y deja la diferencia en el kardex con su motivo. */
    async ajustarProducto(sku, { stockContado, motivo, nota }, usuarioId) {
      return enTransaccion(pool, async (db) => {
        const { productos, kardex } = repos(db);
        const actual = await productos.obtener(sku, { bloquear: true });
        if (!actual) throw noEncontrado('Producto', sku);
        const ajuste = tipoDeAjuste(actual.stock, stockContado);
        if (!ajuste) return { sku, stockAnterior: actual.stock, stockNuevo: actual.stock, diferencia: 0, movimientoId: null };
        const despues = await productos.sumarStock(sku, ajuste.tipo === 'AJUSTE' ? ajuste.cantidad : -ajuste.cantidad);
        const tipo = ajuste.tipo === 'AJUSTE_NEGATIVO' && motivo === 'VENCIMIENTO' ? 'BAJA' : ajuste.tipo;
        const movimientoId = await kardex.insertar({ sku, tipo, cantidad: ajuste.cantidad, costoUnitario: actual.costoUnitario, motivo, usuarioId, nota });
        return {
          sku, stockAnterior: actual.stock, stockNuevo: despues.stock, diferencia: despues.stock - actual.stock, movimientoId,
          valorDiferencia: Math.round((despues.stock - actual.stock) * actual.costoUnitario * 100) / 100,
        };
      });
    },

    async kardexProducto(sku, { limite, offset }) {
      if (!(await leer().productos.obtener(sku))) throw noEncontrado('Producto', sku);
      const { filas, total } = await leer().kardex.listar({ sku, limite, offset });
      const datos = filas.map(({ registradoPorNombre, motivo, ventaId, nota, creadoEn, ...f }) => ({
        ...f,
        ...(motivo ? { motivo } : {}),
        ...(ventaId ? { ventaId } : {}),
        ...(nota ? { nota } : {}),
        ...(registradoPorNombre ? { registradoPor: abreviarNombre(registradoPorNombre) } : {}),
        creadoEn: creadoEn instanceof Date ? creadoEn.toISOString() : creadoEn,
      }));
      return { datos, total };
    },

    /** Costo estándar de una unidad del producto con los costos actuales de los insumos, y su margen frente al precio. */
    async costeoReceta(id) {
      const r = await leer().recetas.obtener(id);
      if (!r) throw noEncontrado('Receta', String(id));
      const producto = await leer().productos.obtener(r.productoSku);
      const materias = new Map((await inventario.leer().materias.obtenerVariasBloqueadasLectura(r.ingredientes.map((i) => i.codigoMateriaPrima))).map((m) => [m.codigo, m]));
      const { costoUnitario, detalle } = costearReceta(r.ingredientes, materias);
      return { recetaId: r.id, productoSku: r.productoSku, productoNombre: r.productoNombre, precioVenta: producto.precio, costoUnitario, ...margen(producto.precio, costoUnitario), ingredientes: detalle };
    },

    // ---- Recetas
    listarRecetas: (f) => leer().recetas.listar(f),
    async obtenerReceta(id) {
      const r = await leer().recetas.obtener(id);
      if (!r) throw noEncontrado('Receta', String(id));
      return r;
    },
    async crearReceta({ productoSku, ingredientes }) {
      if (!(await leer().productos.obtener(productoSku))) throw validacion('Producto inexistente', `No existe el producto ${productoSku}.`);
      await validarIngredientes(ingredientes);
      const id = await enTransaccion(pool, async (db) => {
        const { recetas } = repos(db);
        let nueva;
        try { nueva = await recetas.crear(productoSku); } catch (e) { if (e.code === '23505') throw conflicto('Ese producto ya tiene receta', `Use PUT /recetas/{id} para modificar la de ${productoSku}.`); throw e; }
        await recetas.reemplazarIngredientes(nueva, ingredientes);
        return nueva;
      });
      return leer().recetas.obtener(id);
    },
    async reemplazarReceta(id, { ingredientes }) {
      if (!(await leer().recetas.obtener(id))) throw noEncontrado('Receta', String(id));
      await validarIngredientes(ingredientes);
      await enTransaccion(pool, (db) => repos(db).recetas.reemplazarIngredientes(id, ingredientes));
      return leer().recetas.obtener(id);
    },
    async eliminarReceta(id) {
      if (!(await leer().recetas.eliminar(id))) throw noEncontrado('Receta', String(id));
    },

    /** Interfaz pública para que otros contextos (Ventas) participen en su transacción sin tocar sus tablas. */
    reposEn: (db) => { const { productos, kardex } = repos(db); return { productos, kardex }; },

    producir: (id, datos, usuarioId, clave) => producir({ pool, inventario, repos }, id, datos, usuarioId, clave),
  };
}

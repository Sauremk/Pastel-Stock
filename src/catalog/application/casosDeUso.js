import { enTransaccion } from '../../db/pool.js';
import { conflicto, noEncontrado, validacion } from '../../shared/errors.js';
import { producir } from './producir.js';
import { sonCompatibles } from '../../inventory/domain/unidades.js';
import { crearProductosRepo, crearRecetasRepo } from '../adapters/pg/catalogoRepos.js';

/**
 * Casos de uso del contexto Catálogo y Producción.
 * `inventario` es la INTERFAZ PÚBLICA del contexto Inventario (ADR-05): Catálogo no toca sus tablas directamente.
 */
export function crearCasosCatalogo({ pool, inventario }) {
  const repos = (db) => ({ productos: crearProductosRepo(db), recetas: crearRecetasRepo(db) });
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
    async crearProducto(datos) {
      if (await leer().productos.obtener(datos.sku)) throw conflicto('Ya existe un producto con ese SKU', `SKU ${datos.sku}.`);
      return leer().productos.crear(datos);
    },
    async actualizarProducto(sku, datos) {
      const p = await leer().productos.actualizar(sku, datos);
      if (!p) throw noEncontrado('Producto', sku);
      return p;
    },
    async eliminarProducto(sku) {
      if (!(await leer().productos.eliminar(sku))) throw noEncontrado('Producto', sku);
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

    producir: (id, datos, usuarioId) => producir({ pool, inventario, repos }, id, datos, usuarioId),
  };
}

const COLS_P = 'sku, nombre, categoria, stock, precio, caducidad, costo_unitario AS "costoUnitario"';

export function crearProductosRepo(db) {
  return {
    async listar({ categoria, limite, offset }) {
      const p = []; let cond = '';
      if (categoria) { p.push(categoria); cond = 'WHERE categoria = $1'; }
      const total = (await db.query(`SELECT count(*)::int AS n FROM productos ${cond}`, p)).rows[0].n;
      const { rows } = await db.query(`SELECT ${COLS_P} FROM productos ${cond} ORDER BY sku LIMIT ${Number(limite)} OFFSET ${Number(offset)}`, p);
      return { filas: rows, total };
    },
    async obtener(sku, { bloquear = false } = {}) {
      const { rows } = await db.query(`SELECT ${COLS_P} FROM productos WHERE sku = $1 ${bloquear ? 'FOR UPDATE' : ''}`, [sku]);
      return rows[0] ?? null;
    },
    async crear(p) {
      const { rows } = await db.query(`INSERT INTO productos (sku, nombre, categoria, stock, precio, caducidad, costo_unitario) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${COLS_P}`,
        [p.sku, p.nombre, p.categoria, p.stock, p.precio, p.caducidad, p.costoUnitario ?? 0]);
      return rows[0];
    },
    /** Actualiza datos maestros y stock. Si no llega costoUnitario se conserva el actual. */
    async actualizar(sku, p) {
      const { rows } = await db.query(`UPDATE productos SET nombre=$2, categoria=$3, stock=$4, precio=$5, caducidad=$6, costo_unitario=COALESCE($7, costo_unitario) WHERE sku=$1 RETURNING ${COLS_P}`,
        [sku, p.nombre, p.categoria, p.stock, p.precio, p.caducidad, p.costoUnitario ?? null]);
      return rows[0] ?? null;
    },
    /** Suma (o resta, con delta negativo) de forma atómica; el CHECK (stock >= 0) impide dejarlo negativo. */
    async sumarStock(sku, unidades) {
      const { rows } = await db.query(`UPDATE productos SET stock = stock + $2 WHERE sku = $1 RETURNING ${COLS_P}`, [sku, unidades]);
      return rows[0] ?? null;
    },
    async fijarCostoYCaducidad(sku, { costoUnitario, caducidad }) {
      const { rows } = await db.query(`UPDATE productos SET costo_unitario = $2, caducidad = COALESCE($3, caducidad) WHERE sku = $1 RETURNING ${COLS_P}`, [sku, costoUnitario, caducidad ?? null]);
      return rows[0] ?? null;
    },
    /** Bloquea varias filas en orden de SKU (evita interbloqueos entre ventas concurrentes). */
    async obtenerVariosBloqueados(skus) {
      const { rows } = await db.query(`SELECT ${COLS_P} FROM productos WHERE sku = ANY($1) ORDER BY sku FOR UPDATE`, [skus]);
      return rows;
    },
    /** Ventas, producciones o bajas: historial que el kardex debe conservar (los ajustes por sí solos no cuentan). */
    async tieneHistorial(sku) {
      const { rows } = await db.query(
        `SELECT EXISTS (SELECT 1 FROM venta_items WHERE producto_sku = $1)
             OR EXISTS (SELECT 1 FROM movimientos_producto WHERE producto_sku = $1 AND tipo IN ('PRODUCCION', 'VENTA', 'BAJA')) AS hay`, [sku]);
      return rows[0].hay;
    },
    /** Borra el producto y sus ajustes (solo se llama si no tiene ventas, producciones ni bajas). */
    async eliminar(sku) {
      await db.query("DELETE FROM movimientos_producto WHERE producto_sku = $1 AND tipo IN ('AJUSTE', 'AJUSTE_NEGATIVO')", [sku]);
      return (await db.query('DELETE FROM productos WHERE sku = $1', [sku])).rowCount === 1;
    },
  };
}

/** Kardex de producto terminado (DT-22): cada cambio de stock deja un movimiento. */
export function crearMovimientosProductoRepo(db) {
  return {
    async insertar({ sku, tipo, cantidad, costoUnitario = 0, motivo = null, ventaId = null, usuarioId = null, nota = null, creadoEn = null }) {
      const { rows } = await db.query(
        `INSERT INTO movimientos_producto (producto_sku, tipo, cantidad, costo_unitario, motivo, venta_id, usuario_id, nota, creado_en)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9, now())) RETURNING id`,
        [sku, tipo, cantidad, costoUnitario, motivo, ventaId, usuarioId, nota, creadoEn]);
      return rows[0].id;
    },
    async listar({ sku, limite, offset }) {
      const total = (await db.query('SELECT count(*)::int AS n FROM movimientos_producto WHERE producto_sku = $1', [sku])).rows[0].n;
      const { rows } = await db.query(
        `SELECT m.id, m.producto_sku AS sku, m.tipo, m.cantidad, m.costo_unitario AS "costoUnitario", m.motivo, m.venta_id AS "ventaId",
                m.nota, m.creado_en AS "creadoEn", u.nombre AS "registradoPorNombre"
           FROM movimientos_producto m LEFT JOIN usuarios u ON u.id = m.usuario_id
          WHERE m.producto_sku = $1 ORDER BY m.creado_en DESC, m.id DESC LIMIT ${Number(limite)} OFFSET ${Number(offset)}`, [sku]);
      return { filas: rows, total };
    },
  };
}

export function crearRecetasRepo(db) {
  const ingredientes = async (ids) => {
    if (!ids.length) return new Map();
    const { rows } = await db.query(
      `SELECT ri.receta_id AS "recetaId", ri.materia_prima_codigo AS "codigoMateriaPrima", mp.nombre, ri.cantidad, ri.unidad
         FROM receta_ingredientes ri JOIN materias_primas mp ON mp.codigo = ri.materia_prima_codigo
        WHERE ri.receta_id = ANY($1) ORDER BY ri.receta_id, ri.materia_prima_codigo`, [ids]);
    const m = new Map();
    for (const { recetaId, ...ing } of rows) m.set(recetaId, [...(m.get(recetaId) ?? []), ing]);
    return m;
  };
  const armar = async (filas) => {
    const ing = await ingredientes(filas.map((f) => f.id));
    return filas.map((f) => ({ ...f, ingredientes: ing.get(f.id) ?? [] }));
  };
  const BASE = 'SELECT r.id, r.producto_sku AS "productoSku", p.nombre AS "productoNombre" FROM recetas r JOIN productos p ON p.sku = r.producto_sku';
  return {
    async listar({ limite, offset }) {
      const total = (await db.query('SELECT count(*)::int AS n FROM recetas')).rows[0].n;
      const { rows } = await db.query(`${BASE} ORDER BY r.id LIMIT ${Number(limite)} OFFSET ${Number(offset)}`);
      return { filas: await armar(rows), total };
    },
    async obtener(id) {
      const { rows } = await db.query(`${BASE} WHERE r.id = $1`, [id]);
      return rows.length ? (await armar(rows))[0] : null;
    },
    async crear(productoSku) {
      const { rows } = await db.query('INSERT INTO recetas (producto_sku) VALUES ($1) RETURNING id', [productoSku]);
      return rows[0].id;
    },
    async reemplazarIngredientes(recetaId, items) {
      await db.query('DELETE FROM receta_ingredientes WHERE receta_id = $1', [recetaId]);
      for (const i of items) {
        await db.query('INSERT INTO receta_ingredientes (receta_id, materia_prima_codigo, cantidad, unidad) VALUES ($1,$2,$3,$4)',
          [recetaId, i.codigoMateriaPrima, i.cantidad, i.unidad]);
      }
    },
    async eliminar(id) {
      return (await db.query('DELETE FROM recetas WHERE id = $1', [id])).rowCount === 1;
    },
  };
}

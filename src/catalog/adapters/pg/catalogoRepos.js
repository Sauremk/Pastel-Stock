const COLS_P = 'sku, nombre, categoria, stock, precio, caducidad';

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
      const { rows } = await db.query(`INSERT INTO productos (sku, nombre, categoria, stock, precio, caducidad) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${COLS_P}`,
        [p.sku, p.nombre, p.categoria, p.stock, p.precio, p.caducidad]);
      return rows[0];
    },
    async actualizar(sku, p) {
      const { rows } = await db.query(`UPDATE productos SET nombre=$2, categoria=$3, stock=$4, precio=$5, caducidad=$6 WHERE sku=$1 RETURNING ${COLS_P}`,
        [sku, p.nombre, p.categoria, p.stock, p.precio, p.caducidad]);
      return rows[0] ?? null;
    },
    async sumarStock(sku, unidades) {
      const { rows } = await db.query(`UPDATE productos SET stock = stock + $2 WHERE sku = $1 RETURNING ${COLS_P}`, [sku, unidades]);
      return rows[0] ?? null;
    },
    async eliminar(sku) {
      return (await db.query('DELETE FROM productos WHERE sku = $1', [sku])).rowCount === 1;
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

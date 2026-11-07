export function crearMovimientosRepo(db) {
  return {
    async insertar({ codigo, tipo, cantidad, costoUnitario, proveedor = null, usuarioId = null, nota = null, creadoEn = null }) {
      const { rows } = await db.query(
        `INSERT INTO movimientos (materia_prima_codigo, tipo, cantidad, costo_unitario, proveedor, usuario_id, nota, creado_en)
         VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8, now())) RETURNING id`,
        [codigo, tipo, cantidad, costoUnitario, proveedor, usuarioId, nota, creadoEn],
      );
      return rows[0].id;
    },
    async listar({ codigo, desde, hasta, limite, offset }) {
      const where = []; const p = [];
      if (codigo) { p.push(codigo); where.push(`m.materia_prima_codigo = $${p.length}`); }
      if (desde) { p.push(desde); where.push(`m.creado_en >= $${p.length}::date`); }
      if (hasta) { p.push(hasta); where.push(`m.creado_en < ($${p.length}::date + 1)`); }
      const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = (await db.query(`SELECT count(*)::int AS n FROM movimientos m ${cond}`, p)).rows[0].n;
      const { rows } = await db.query(
        `SELECT m.id, m.materia_prima_codigo AS codigo, m.tipo, m.cantidad, m.proveedor, m.nota, m.creado_en AS "creadoEn",
                u.nombre AS "registradoPorNombre"
           FROM movimientos m LEFT JOIN usuarios u ON u.id = m.usuario_id
           ${cond} ORDER BY m.creado_en DESC, m.id DESC LIMIT ${Number(limite)} OFFSET ${Number(offset)}`,
        p,
      );
      return { filas: rows, total };
    },
    async contarNoIniciales(codigo) {
      return (await db.query("SELECT count(*)::int AS n FROM movimientos WHERE materia_prima_codigo = $1 AND tipo <> 'AJUSTE'", [codigo])).rows[0].n;
    },
    async contarTodos(codigo) {
      return (await db.query('SELECT count(*)::int AS n FROM movimientos WHERE materia_prima_codigo = $1', [codigo])).rows[0].n;
    },
    async eliminarAjustes(codigo) {
      await db.query("DELETE FROM movimientos WHERE materia_prima_codigo = $1 AND tipo = 'AJUSTE'", [codigo]);
    },
  };
}

/** "Carlos López" → "Carlos L.": la vista pública del kardex no expone el usuario de acceso ni su id. */
export function abreviarNombre(nombre) {
  if (!nombre) return undefined;
  const [primero, ...resto] = nombre.trim().split(/\s+/);
  return resto.length ? `${primero} ${resto[0][0].toUpperCase()}.` : primero;
}

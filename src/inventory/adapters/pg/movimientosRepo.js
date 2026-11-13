export function crearMovimientosRepo(db) {
  return {
    async insertar({ codigo, tipo, cantidad, costoUnitario, proveedor = null, usuarioId = null, nota = null, creadoEn = null, motivo = null }) {
      const { rows } = await db.query(
        `INSERT INTO movimientos (materia_prima_codigo, tipo, cantidad, costo_unitario, proveedor, usuario_id, nota, creado_en, motivo)
         VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8, now()), $9) RETURNING id`,
        [codigo, tipo, cantidad, costoUnitario, proveedor, usuarioId, nota, creadoEn, motivo],
      );
      return rows[0].id;
    },
    async listar({ codigo, tipo, desde, hasta, limite, offset }) {
      const where = []; const p = [];
      if (codigo) { p.push(codigo); where.push(`m.materia_prima_codigo = $${p.length}`); }
      if (tipo) { p.push(tipo); where.push(`m.tipo = $${p.length}`); }
      if (desde) { p.push(desde); where.push(`m.creado_en >= $${p.length}::date`); }
      if (hasta) { p.push(hasta); where.push(`m.creado_en < ($${p.length}::date + 1)`); }
      const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = (await db.query(`SELECT count(*)::int AS n FROM movimientos m ${cond}`, p)).rows[0].n;
      const { rows } = await db.query(
        `SELECT m.id, m.materia_prima_codigo AS codigo, mp.nombre, mp.unidad, m.tipo, m.cantidad, m.proveedor, m.nota, m.motivo, m.creado_en AS "creadoEn",
                u.nombre AS "registradoPorNombre"
           FROM movimientos m LEFT JOIN usuarios u ON u.id = m.usuario_id JOIN materias_primas mp ON mp.codigo = m.materia_prima_codigo
           ${cond} ORDER BY m.creado_en DESC, m.id DESC LIMIT ${Number(limite)} OFFSET ${Number(offset)}`,
        p,
      );
      return { filas: rows, total };
    },
    /** Movimientos que no son el saldo inicial (los ajustes por conteo físico también son historial). */
    async contarNoIniciales(codigo) {
      return (await db.query(
        "SELECT count(*)::int AS n FROM movimientos WHERE materia_prima_codigo = $1 AND NOT (tipo = 'AJUSTE' AND motivo IS NOT DISTINCT FROM 'STOCK_INICIAL')",
        [codigo])).rows[0].n;
    },
    async contarTodos(codigo) {
      return (await db.query('SELECT count(*)::int AS n FROM movimientos WHERE materia_prima_codigo = $1', [codigo])).rows[0].n;
    },
    async eliminarAjustes(codigo) {
      await db.query("DELETE FROM movimientos WHERE materia_prima_codigo = $1 AND tipo = 'AJUSTE' AND motivo = 'STOCK_INICIAL'", [codigo]);
    },
  };
}

/** "Carlos López" → "Carlos L.": la vista pública del kardex no expone el usuario de acceso ni su id. */
export function abreviarNombre(nombre) {
  if (!nombre) return undefined;
  const [primero, ...resto] = nombre.trim().split(/\s+/);
  return resto.length ? `${primero} ${resto[0][0].toUpperCase()}.` : primero;
}

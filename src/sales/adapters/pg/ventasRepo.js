export function crearVentasRepo(db) {
  return {
    async insertar({ usuarioId, total, costoTotal, nota, lineas }) {
      const { rows } = await db.query('INSERT INTO ventas (usuario_id, total, costo_total, nota) VALUES ($1,$2,$3,$4) RETURNING id, creado_en AS "creadoEn"',
        [usuarioId, total, costoTotal, nota ?? null]);
      const venta = rows[0];
      for (const l of lineas) {
        await db.query('INSERT INTO venta_items (venta_id, producto_sku, cantidad, precio_unitario, costo_unitario) VALUES ($1,$2,$3,$4,$5)',
          [venta.id, l.sku, l.cantidad, l.precioUnitario, l.costoUnitario]);
      }
      return venta;
    },
    async listar({ desde, hasta, limite, offset, zona }) {
      const where = []; const p = [];
      if (desde) { p.push(desde); where.push(`(v.creado_en AT TIME ZONE '${zona}')::date >= $${p.length}::date`); }
      if (hasta) { p.push(hasta); where.push(`(v.creado_en AT TIME ZONE '${zona}')::date <= $${p.length}::date`); }
      const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const resumen = (await db.query(`SELECT count(*)::int AS n, COALESCE(SUM(total),0) AS total, COALESCE(SUM(costo_total),0) AS costo FROM ventas v ${cond}`, p)).rows[0];
      const { rows } = await db.query(
        `SELECT v.id, v.total, v.costo_total AS "costoTotal", v.nota, v.creado_en AS "creadoEn", u.nombre AS "registradoPorNombre"
           FROM ventas v LEFT JOIN usuarios u ON u.id = v.usuario_id ${cond}
          ORDER BY v.creado_en DESC, v.id DESC LIMIT ${Number(limite)} OFFSET ${Number(offset)}`, p);
      const ids = rows.map((r) => r.id);
      const items = ids.length ? (await db.query(
        `SELECT vi.venta_id AS "ventaId", vi.producto_sku AS sku, p.nombre, vi.cantidad, vi.precio_unitario AS "precioUnitario", vi.costo_unitario AS "costoUnitario"
           FROM venta_items vi JOIN productos p ON p.sku = vi.producto_sku WHERE vi.venta_id = ANY($1) ORDER BY vi.venta_id, vi.producto_sku`, [ids])).rows : [];
      const porVenta = new Map();
      for (const { ventaId, ...it } of items) porVenta.set(ventaId, [...(porVenta.get(ventaId) ?? []), it]);
      return { filas: rows.map((r) => ({ ...r, items: porVenta.get(r.id) ?? [] })), total: resumen.n, resumen: { total: resumen.total, costo: resumen.costo } };
    },
  };
}

export function crearReportesRepo(db, zona = 'America/Bogota') {
  return {
    async materias() {
      return (await db.query('SELECT codigo, nombre, categoria, stock, unidad, minimo, costo FROM materias_primas ORDER BY codigo')).rows;
    },
    async productos() {
      return (await db.query('SELECT sku, nombre, categoria, stock, precio, caducidad FROM productos ORDER BY sku')).rows;
    },
    async recetasPlanas() {
      return (await db.query(
        `SELECT p.nombre AS producto, mp.nombre AS ingrediente, ri.cantidad, ri.unidad
           FROM recetas r JOIN productos p ON p.sku = r.producto_sku
           JOIN receta_ingredientes ri ON ri.receta_id = r.id
           JOIN materias_primas mp ON mp.codigo = ri.materia_prima_codigo
          ORDER BY p.nombre, mp.nombre`)).rows;
    },
    async datosDashboard(hoy, desde30, desde7, hasta3) {
      const q = (sql, p = []) => db.query(sql, p).then((r) => r.rows);
      const [materias, [{ valor: valorProductos }], [{ total: compras30 }], compras7, stockPorCategoria, topProductos, [{ porVencer, vencidos }]] = await Promise.all([
        q('SELECT codigo, nombre, categoria, stock, unidad, minimo, costo FROM materias_primas ORDER BY codigo'),
        q('SELECT COALESCE(SUM(stock * precio), 0) AS valor FROM productos'),
        q(`SELECT COALESCE(SUM(cantidad * costo_unitario), 0) AS total FROM movimientos
            WHERE tipo = 'ENTRADA' AND (creado_en AT TIME ZONE '${zona}')::date BETWEEN $1::date AND $2::date`, [desde30, hoy]),
        q(`SELECT to_char(d, 'YYYY-MM-DD') AS fecha, COALESCE(SUM(m.cantidad * m.costo_unitario), 0) AS total
             FROM generate_series($1::date, $2::date, interval '1 day') d
             LEFT JOIN movimientos m ON m.tipo = 'ENTRADA' AND (m.creado_en AT TIME ZONE '${zona}')::date = d::date
            GROUP BY d ORDER BY d`, [desde7, hoy]),
        q('SELECT categoria, SUM(stock * costo) AS valor FROM materias_primas GROUP BY categoria ORDER BY valor DESC'),
        q('SELECT sku, nombre, stock * precio AS valor FROM productos ORDER BY valor DESC, sku LIMIT 5'),
        q(`SELECT count(*) FILTER (WHERE caducidad >= $1::date AND caducidad <= $2::date)::int AS "porVencer",
                  count(*) FILTER (WHERE caducidad < $1::date)::int AS vencidos FROM productos`, [hoy, hasta3]),
      ]);
      return { materias, valorProductos, compras30, compras7, stockPorCategoria, topProductos, productosPorVencer: porVencer, productosVencidos: vencidos };
    },
  };
}

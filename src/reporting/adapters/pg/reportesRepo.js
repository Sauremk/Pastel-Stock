export function crearReportesRepo(db, zona = 'America/Bogota') {
  return {
    async materias() {
      return (await db.query('SELECT codigo, nombre, categoria, stock, unidad, minimo, costo FROM materias_primas ORDER BY codigo')).rows;
    },
    async productos() {
      return (await db.query('SELECT sku, nombre, categoria, stock, precio, caducidad FROM productos ORDER BY sku')).rows;
    },
    async ventasPlanas(desde, hasta) {
      return (await db.query(
        `SELECT to_char(v.creado_en AT TIME ZONE '${zona}', 'YYYY-MM-DD HH24:MI') AS fecha, v.id AS venta, p.nombre AS producto, vi.cantidad,
                vi.precio_unitario AS precio, vi.cantidad * vi.precio_unitario AS subtotal, vi.cantidad * vi.costo_unitario AS costo,
                vi.cantidad * (vi.precio_unitario - vi.costo_unitario) AS margen
           FROM ventas v JOIN venta_items vi ON vi.venta_id = v.id JOIN productos p ON p.sku = vi.producto_sku
          WHERE (v.creado_en AT TIME ZONE '${zona}')::date BETWEEN $1::date AND $2::date
          ORDER BY v.creado_en DESC, v.id DESC, p.nombre`, [desde, hasta])).rows;
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
      const enZona = (col) => `(${col} AT TIME ZONE '${zona}')::date`;
      const [[ventas30], ventas7, topVendidos, [perdidas]] = await Promise.all([
        q(`SELECT COALESCE(SUM(total),0) AS total, COALESCE(SUM(costo_total),0) AS costo, count(*)::int AS n FROM ventas WHERE ${enZona('creado_en')} BETWEEN $1::date AND $2::date`, [desde30, hoy]),
        q(`SELECT to_char(d, 'YYYY-MM-DD') AS fecha, COALESCE(SUM(v.total), 0) AS total, COALESCE(SUM(v.total - v.costo_total), 0) AS margen
             FROM generate_series($1::date, $2::date, interval '1 day') d
             LEFT JOIN ventas v ON ${enZona('v.creado_en')} = d::date
            GROUP BY d ORDER BY d`, [desde7, hoy]),
        q(`SELECT vi.producto_sku AS sku, p.nombre, SUM(vi.cantidad)::int AS unidades, SUM(vi.cantidad * vi.precio_unitario) AS total
             FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id JOIN productos p ON p.sku = vi.producto_sku
            WHERE ${enZona('v.creado_en')} BETWEEN $1::date AND $2::date
            GROUP BY vi.producto_sku, p.nombre ORDER BY total DESC, sku LIMIT 5`, [desde30, hoy]),
        q(`SELECT
             (SELECT COALESCE(SUM(cantidad * costo_unitario),0) FROM movimientos_producto
               WHERE tipo IN ('BAJA','AJUSTE_NEGATIVO') AND ${enZona('creado_en')} BETWEEN $1::date AND $2::date)
           + (SELECT COALESCE(SUM(cantidad * costo_unitario),0) FROM movimientos
               WHERE tipo = 'AJUSTE_NEGATIVO' AND ${enZona('creado_en')} BETWEEN $1::date AND $2::date) AS valor`, [desde30, hoy]),
      ]);
      return {
        materias, valorProductos, compras30, compras7, stockPorCategoria, topProductos, productosPorVencer: porVencer, productosVencidos: vencidos,
        ventas30, ventas7, topVendidos, perdidas30: perdidas.valor,
      };
    },
    /** Productos con stock que vencen dentro de la ventana o ya vencieron, y su valor a costo y a precio. */
    async alertasCaducidad(hoy, hasta) {
      return (await db.query(
        `SELECT sku, nombre, categoria, stock, caducidad, precio, costo_unitario AS "costoUnitario", (caducidad - $1::date)::int AS dias
           FROM productos WHERE stock > 0 AND caducidad <= $2::date ORDER BY caducidad, sku`, [hoy, hasta])).rows;
    },
    async datosRentabilidad(desde30, hoy) {
      const q = (sql, p = []) => db.query(sql, p).then((r) => r.rows);
      const [productos, ingredientes, materias, vendidos] = await Promise.all([
        q('SELECT p.sku, p.nombre, p.categoria, p.precio, p.costo_unitario AS "costoUnitario", r.id AS "recetaId" FROM productos p LEFT JOIN recetas r ON r.producto_sku = p.sku ORDER BY p.sku'),
        q('SELECT receta_id AS "recetaId", materia_prima_codigo AS "codigoMateriaPrima", cantidad, unidad FROM receta_ingredientes'),
        q('SELECT codigo, nombre, unidad, costo FROM materias_primas'),
        q(`SELECT vi.producto_sku AS sku, SUM(vi.cantidad)::int AS unidades, SUM(vi.cantidad * vi.precio_unitario) AS ventas,
                  SUM(vi.cantidad * (vi.precio_unitario - vi.costo_unitario)) AS margen
             FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id
            WHERE (v.creado_en AT TIME ZONE '${zona}')::date BETWEEN $1::date AND $2::date GROUP BY vi.producto_sku`, [desde30, hoy]),
      ]);
      return { productos, ingredientes, materias, vendidos };
    },
  };
}

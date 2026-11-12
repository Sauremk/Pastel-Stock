-- Incremento v1.1: ventas, costeo real, kardex de producto terminado y ajustes por conteo físico.
-- Paga DT-10 (el tablero vuelve a mostrar ventas, margen y ROI, ahora calculados) y DT-22 (el stock de
-- producto terminado cambiaba sin dejar rastro). Migración aditiva: no altera ningún valor ya guardado.

-- 1) Kardex de materias primas: los ajustes ahora pueden restar (conteo físico menor que el sistema, merma).
--    AJUSTE suma (como antes); AJUSTE_NEGATIVO resta. El motivo es obligatorio para los ajustes nuevos.
ALTER TABLE movimientos DROP CONSTRAINT IF EXISTS movimientos_tipo_check;
ALTER TABLE movimientos ADD CONSTRAINT movimientos_tipo_check CHECK (tipo IN ('ENTRADA', 'SALIDA', 'AJUSTE', 'AJUSTE_NEGATIVO'));
ALTER TABLE movimientos ADD COLUMN motivo TEXT CHECK (motivo IN ('STOCK_INICIAL', 'CONTEO_FISICO', 'MERMA', 'VENCIMIENTO', 'CORRECCION'));

-- 2) Costo promedio ponderado del producto terminado (se recalcula en cada producción).
ALTER TABLE productos ADD COLUMN costo_unitario NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (costo_unitario >= 0);

-- 3) Ventas (cabecera + líneas). Precio y costo se congelan en la línea: el margen histórico no cambia si
--    luego cambian el precio de lista o el costo de los insumos.
CREATE TABLE ventas (
  id          BIGSERIAL PRIMARY KEY,
  usuario_id  INTEGER       REFERENCES usuarios(id) ON DELETE SET NULL,
  total       NUMERIC(14,2) NOT NULL CHECK (total >= 0),
  costo_total NUMERIC(14,2) NOT NULL CHECK (costo_total >= 0),
  nota        VARCHAR(200),
  creado_en   TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX ventas_fecha_idx ON ventas (creado_en DESC);

CREATE TABLE venta_items (
  venta_id        BIGINT        NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  producto_sku    VARCHAR(12)   NOT NULL REFERENCES productos(sku) ON DELETE RESTRICT,
  cantidad        INTEGER       NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(14,2) NOT NULL CHECK (precio_unitario >= 0),
  costo_unitario  NUMERIC(14,2) NOT NULL CHECK (costo_unitario >= 0),
  PRIMARY KEY (venta_id, producto_sku)
);
CREATE INDEX venta_items_sku_idx ON venta_items (producto_sku);

-- 4) Kardex de producto terminado: todo cambio de stock de un producto deja un movimiento.
--    PRODUCCION y AJUSTE suman; VENTA, BAJA y AJUSTE_NEGATIVO restan.
CREATE TABLE movimientos_producto (
  id             BIGSERIAL PRIMARY KEY,
  producto_sku   VARCHAR(12)   NOT NULL REFERENCES productos(sku) ON DELETE RESTRICT,
  tipo           TEXT          NOT NULL CHECK (tipo IN ('PRODUCCION', 'VENTA', 'BAJA', 'AJUSTE', 'AJUSTE_NEGATIVO')),
  cantidad       INTEGER       NOT NULL CHECK (cantidad > 0),
  costo_unitario NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (costo_unitario >= 0),
  motivo         TEXT          CHECK (motivo IN ('STOCK_INICIAL', 'CONTEO_FISICO', 'MERMA', 'VENCIMIENTO', 'CORRECCION')),
  venta_id       BIGINT        REFERENCES ventas(id) ON DELETE RESTRICT,
  usuario_id     INTEGER       REFERENCES usuarios(id) ON DELETE SET NULL,
  nota           VARCHAR(200),
  creado_en      TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX movimientos_producto_sku_fecha_idx ON movimientos_producto (producto_sku, creado_en DESC);
CREATE INDEX movimientos_producto_fecha_idx ON movimientos_producto (creado_en DESC);

-- 5) Costo inicial de los productos que ya tienen receta (costo estándar con los costos actuales de los insumos).
UPDATE productos p SET costo_unitario = c.costo
  FROM (
    SELECT r.producto_sku,
           ROUND(SUM(ri.cantidad
                     * (CASE ri.unidad WHEN 'kg' THEN 1000 WHEN 'L' THEN 1000 WHEN 'docena' THEN 12 ELSE 1 END)::numeric
                     / (CASE mp.unidad WHEN 'kg' THEN 1000 WHEN 'L' THEN 1000 WHEN 'docena' THEN 12 ELSE 1 END)::numeric
                     * mp.costo), 2) AS costo
      FROM recetas r
      JOIN receta_ingredientes ri ON ri.receta_id = r.id
      JOIN materias_primas mp ON mp.codigo = ri.materia_prima_codigo
     GROUP BY r.producto_sku
  ) c
 WHERE c.producto_sku = p.sku;

-- 6) Los productos con stock al momento de migrar dejan su saldo inicial en el kardex (así el kardex cuadra).
INSERT INTO movimientos_producto (producto_sku, tipo, cantidad, costo_unitario, motivo, nota)
SELECT sku, 'AJUSTE', stock, costo_unitario, 'STOCK_INICIAL', 'Saldo al migrar a v1.1' FROM productos WHERE stock > 0;

-- Los "Stock inicial" antiguos de materias primas quedan marcados con su motivo.
UPDATE movimientos SET motivo = 'STOCK_INICIAL' WHERE tipo = 'AJUSTE' AND nota = 'Stock inicial' AND motivo IS NULL;

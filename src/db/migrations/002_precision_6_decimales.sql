-- DT-18: el redondeo a 3 decimales acumulaba desvíos al producir en tandas pequeñas
-- (4 unid = 0,333 docena en vez de 0,333333). Se amplía la escala a 6 decimales.
-- Migración compatible: ampliar la escala no altera ningún valor ya guardado y los CHECK se conservan.
-- Orden de transición: 1) esta migración, 2) el código nuevo (convertir() redondea a 6 decimales).
-- Si se revierte solo el código, los valores de 6 decimales siguen siendo válidos para la versión anterior
-- (la versión 1.0.0 los lee, aunque al escribir redondea a 3).
ALTER TABLE materias_primas     ALTER COLUMN stock    TYPE NUMERIC(14,6);
ALTER TABLE materias_primas     ALTER COLUMN minimo   TYPE NUMERIC(14,6);
ALTER TABLE receta_ingredientes ALTER COLUMN cantidad TYPE NUMERIC(14,6);
ALTER TABLE movimientos         ALTER COLUMN cantidad TYPE NUMERIC(14,6);

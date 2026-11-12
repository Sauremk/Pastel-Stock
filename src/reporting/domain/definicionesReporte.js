// Definiciones de los reportes exportables: compartidas por el servidor (pdfkit/exceljs) y la app sin servidor (PWA).
export const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

/** Neutraliza "inyección de fórmulas" en Excel: un texto que empieza con = + - @ se guardaría como fórmula. */
export const seguroExcel = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

export const DEFINICIONES = {
  materias: {
    titulo: 'Materias primas',
    columnas: [['Código', 'codigo'], ['Nombre', 'nombre'], ['Categoría', 'categoria'], ['Stock', 'stock'], ['Unidad', 'unidad'], ['Mínimo', 'minimo'], ['Costo (COP)', 'costo', 'cop']],
  },
  productos: {
    titulo: 'Productos terminados',
    columnas: [['SKU', 'sku'], ['Nombre', 'nombre'], ['Categoría', 'categoria'], ['Stock', 'stock'], ['Precio (COP)', 'precio', 'cop'], ['Caducidad', 'caducidad']],
  },
  ventas: {
    titulo: 'Ventas (últimos 30 días)',
    columnas: [['Fecha', 'fecha'], ['Venta', 'venta'], ['Producto', 'producto'], ['Cant.', 'cantidad'], ['Precio', 'precio', 'cop'], ['Subtotal', 'subtotal', 'cop'], ['Costo', 'costo', 'cop'], ['Margen', 'margen', 'cop']],
  },
  recetas: {
    titulo: 'Recetas (fichas técnicas)',
    columnas: [['Producto', 'producto'], ['Ingrediente', 'ingrediente'], ['Cantidad', 'cantidad'], ['Unidad', 'unidad']],
  },
};


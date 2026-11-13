// Datos de demostración: los usa la siembra del servidor (seed.js) y la app sin servidor (pwa/semilla.js).

export const USUARIOS = [
  { usuario: 'admin', nombre: 'Ana García', rol: 'admin', variable: 'SEED_ADMIN_PASSWORD' },
  { usuario: 'operador', nombre: 'Carlos López', rol: 'operador', variable: 'SEED_OPERADOR_PASSWORD' },
  { usuario: 'contador', nombre: 'María Rodríguez', rol: 'contador', variable: 'SEED_CONTADOR_PASSWORD' },
];

// costo = COP por unidad de medida de la materia prima (Harina: $2,5 por gramo = $2.500 por kg).
export const MATERIAS = [
  { codigo: 'MP001', nombre: 'Harina de Trigo', categoria: 'Harinas', unidad: 'g', minimo: 10000, costo: 2.5, inicial: 20000, entradas: [[5, 5000, 'Molinos del Valle']] },
  { codigo: 'MP002', nombre: 'Azúcar', categoria: 'Endulzantes', unidad: 'g', minimo: 5000, costo: 3, inicial: 5000, entradas: [[3, 3000, 'Distribuidora La Esperanza']] },
  { codigo: 'MP003', nombre: 'Huevos', categoria: 'Lácteos/Huevos', unidad: 'docena', minimo: 5, costo: 12000, inicial: 2, entradas: [[1, 1, 'Granja Avícola El Prado']] },
  { codigo: 'MP004', nombre: 'Mantequilla', categoria: 'Lácteos', unidad: 'g', minimo: 3000, costo: 8.5, inicial: 1000, entradas: [[2, 1000, 'Lácteos del Norte']] },
  { codigo: 'MP005', nombre: 'Cacao en Polvo', categoria: 'Saborizantes', unidad: 'g', minimo: 2000, costo: 15, inicial: 15000, entradas: [] },
];
// costo = COP por unidad (PT001 se recalcula con su receta; los demás son costos de referencia de la demo).
export const PRODUCTOS = [
  { sku: 'PT001', nombre: 'Pastel de Chocolate', categoria: 'Pasteles', stock: 8, precio: 35000, dias: 2, costo: 9350 },
  { sku: 'PT002', nombre: 'Pan Dulce Surtido', categoria: 'Panes', stock: 45, precio: 1500, dias: 1, costo: 600 },
  { sku: 'PT003', nombre: 'Galletas de Mantequilla', categoria: 'Galletas', stock: 60, precio: 800, dias: 9, costo: 310 },
  { sku: 'PT004', nombre: 'Tarta de Fresa', categoria: 'Tartas', stock: 4, precio: 28000, dias: 1, costo: 11500 },
];
// Ventas de la demo: [días atrás, [[sku, cantidad], ...]]. El stock de PRODUCTOS ya es el saldo DESPUÉS de estas ventas.
export const VENTAS = [
  [6, [['PT002', 12], ['PT003', 20]]],
  [5, [['PT001', 2], ['PT002', 8]]],
  [4, [['PT004', 1], ['PT003', 15]]],
  [3, [['PT001', 1], ['PT002', 10], ['PT003', 10]]],
  [2, [['PT001', 3], ['PT004', 2]]],
  [1, [['PT002', 15], ['PT003', 25], ['PT001', 1]]],
];

export const RECETA_DEMO = { sku: 'PT001', ingredientes: [['MP001', 500, 'g'], ['MP002', 300, 'g'], ['MP003', 4, 'unid'], ['MP004', 200, 'g'], ['MP005', 100, 'g']] };

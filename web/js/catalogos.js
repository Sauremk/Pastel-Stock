// Catálogos cerrados del contrato OpenAPI (components.schemas). Si cambian allí, cambian aquí.
export const CATEGORIAS_MP = ['Harinas', 'Endulzantes', 'Lácteos', 'Lácteos/Huevos', 'Saborizantes', 'Frutas'];
export const CATEGORIAS_PT = ['Pasteles', 'Panes', 'Galletas', 'Tartas', 'Postres'];

export const UNIDADES = [
  { valor: 'g', texto: 'Gramos (g)' },
  { valor: 'kg', texto: 'Kilogramos (kg)' },
  { valor: 'ml', texto: 'Mililitros (ml)' },
  { valor: 'L', texto: 'Litros (L)' },
  { valor: 'unid', texto: 'Unidades' },
  { valor: 'docena', texto: 'Docenas' },
];

export const ETIQUETAS_ROL = { admin: 'Administrador', operador: 'Operador', contador: 'Contador' };

/** Permisos de interfaz (cosméticos: el servidor decide con RBAC en cada petición). */
export const PERMISOS = {
  catalogo: ['admin'],
  movimientos: ['admin', 'operador'],
  producir: ['admin', 'operador'],
  reportes: ['admin', 'contador'],
};

export const PATRON_CODIGO_MP = /^MP[0-9]{3,}$/;
export const PATRON_SKU = /^PT[0-9]{3,}$/;

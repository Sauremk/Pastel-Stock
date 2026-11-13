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

/** Qué puede hacer cada rol, en palabras de todos los días (pantalla Equipo, v1.5). */
export const ROLES_EQUIPO = [
  { valor: 'operador', texto: 'Operador: vende, hornea y anota lo que llega' },
  { valor: 'contador', texto: 'Contador: ve ventas, ganancias y reportes' },
  { valor: 'admin', texto: 'Administrador: puede hacer todo, también manejar el equipo' },
];

/** Permisos de interfaz (cosméticos: el servidor decide con RBAC en cada petición). */
export const PERMISOS = {
  catalogo: ['admin'],
  movimientos: ['admin', 'operador'],
  producir: ['admin', 'operador'],
  reportes: ['admin', 'contador'],
  ventas: ['admin', 'operador'],
  ajustes: ['admin', 'operador'],
  rentabilidad: ['admin', 'contador'],
  equipo: ['admin'],
};

/** Motivos de un ajuste por conteo físico (el contrato no admite STOCK_INICIAL desde la interfaz). */
export const MOTIVOS_AJUSTE = [
  { valor: 'CONTEO_FISICO', texto: 'Conteo físico' },
  { valor: 'MERMA', texto: 'Merma (daño, pérdida)' },
  { valor: 'VENCIMIENTO', texto: 'Vencimiento' },
  { valor: 'CORRECCION', texto: 'Corrección de un error' },
];
export const TEXTO_MOTIVO = { STOCK_INICIAL: 'Stock inicial', CONTEO_FISICO: 'Conteo físico', MERMA: 'Merma', VENCIMIENTO: 'Vencimiento', CORRECCION: 'Corrección' };

export const PATRON_CODIGO_MP = /^MP[0-9]{3,}$/;
export const PATRON_SKU = /^PT[0-9]{3,}$/;

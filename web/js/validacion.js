// Validación de formularios (espejo de las reglas del contrato OpenAPI). Funciones puras.
import { CATEGORIAS_MP, CATEGORIAS_PT, UNIDADES, PATRON_CODIGO_MP, PATRON_SKU } from './catalogos.js';

const UNIDADES_VALIDAS = new Set(UNIDADES.map((u) => u.valor));

/** Convierte texto de un input a número; acepta coma decimal. NaN si no es número. */
export function numeroDe(valor) {
  if (valor === '' || valor === null || valor === undefined) return NaN;
  const n = Number(String(valor).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

const texto = (v) => String(v ?? '').trim();

function validarTexto(errores, campo, valor, etiqueta, min, max) {
  const t = texto(valor);
  if (t.length < min) errores[campo] = `${etiqueta} debe tener al menos ${min} caracteres.`;
  else if (t.length > max) errores[campo] = `${etiqueta} admite máximo ${max} caracteres.`;
  return t;
}

function validarNoNegativo(errores, campo, valor, etiqueta) {
  const n = numeroDe(valor);
  if (Number.isNaN(n)) errores[campo] = `${etiqueta} debe ser un número.`;
  else if (n < 0) errores[campo] = `${etiqueta} no puede ser negativo.`;
  return n;
}

export function validarMateria(d, { modo = 'crear' } = {}) {
  const errores = {};
  const datos = {};
  if (modo === 'crear') {
    datos.codigo = texto(d.codigo).toUpperCase();
    if (!PATRON_CODIGO_MP.test(datos.codigo)) errores.codigo = 'El código debe ser MP seguido de 3 o más dígitos (ej. MP006).';
  }
  datos.nombre = validarTexto(errores, 'nombre', d.nombre, 'El nombre', 2, 80);
  datos.categoria = d.categoria;
  if (!CATEGORIAS_MP.includes(d.categoria)) errores.categoria = 'Selecciona una categoría.';
  datos.unidad = d.unidad;
  if (!UNIDADES_VALIDAS.has(d.unidad)) errores.unidad = 'Selecciona una unidad.';
  if (modo === 'crear') datos.stock = validarNoNegativo(errores, 'stock', d.stock, 'El stock inicial');
  datos.minimo = validarNoNegativo(errores, 'minimo', d.minimo, 'El stock mínimo');
  datos.costo = validarNoNegativo(errores, 'costo', d.costo, 'El costo unitario');
  return { errores, datos, valido: Object.keys(errores).length === 0 };
}

export function validarProducto(d, { modo = 'crear' } = {}) {
  const errores = {};
  const datos = {};
  if (modo === 'crear') {
    datos.sku = texto(d.sku).toUpperCase();
    if (!PATRON_SKU.test(datos.sku)) errores.sku = 'El SKU debe ser PT seguido de 3 o más dígitos (ej. PT005).';
  }
  datos.nombre = validarTexto(errores, 'nombre', d.nombre, 'El nombre', 2, 80);
  datos.categoria = d.categoria;
  if (!CATEGORIAS_PT.includes(d.categoria)) errores.categoria = 'Selecciona una categoría.';
  datos.stock = validarNoNegativo(errores, 'stock', d.stock, 'El stock');
  if (!errores.stock && !Number.isInteger(datos.stock)) errores.stock = 'El stock de productos debe ser un número entero.';
  datos.precio = validarNoNegativo(errores, 'precio', d.precio, 'El precio');
  datos.caducidad = texto(d.caducidad);
  const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datos.caducidad);
  const fechaReal = f && new Date(Date.UTC(+f[1], +f[2] - 1, +f[3])).getUTCDate() === +f[3];
  if (!fechaReal) errores.caducidad = 'Indica una fecha de caducidad válida.';
  return { errores, datos, valido: Object.keys(errores).length === 0 };
}

export function validarEntrada(d) {
  const errores = {};
  const datos = {};
  datos.codigo = texto(d.codigo);
  if (!PATRON_CODIGO_MP.test(datos.codigo)) errores.codigo = 'Selecciona una materia prima.';
  datos.cantidad = numeroDe(d.cantidad);
  if (Number.isNaN(datos.cantidad)) errores.cantidad = 'La cantidad debe ser un número.';
  else if (datos.cantidad <= 0) errores.cantidad = 'La cantidad debe ser mayor que cero.'; // corrige DT-08
  datos.proveedor = validarTexto(errores, 'proveedor', d.proveedor, 'El proveedor', 2, 80);
  const nota = texto(d.nota);
  if (nota.length > 200) errores.nota = 'La nota admite máximo 200 caracteres.';
  else if (nota) datos.nota = nota;
  return { errores, datos, valido: Object.keys(errores).length === 0 };
}

/** `d.ingredientes`: [{ codigoMateriaPrima, cantidad, unidad }]. Errores por fila en `errores.filas[i]`. */
export function validarReceta(d, { modo = 'crear' } = {}) {
  const errores = {};
  const datos = {};
  if (modo === 'crear') {
    datos.productoSku = texto(d.productoSku);
    if (!PATRON_SKU.test(datos.productoSku)) errores.productoSku = 'Selecciona el producto terminado.';
  }
  const filas = Array.isArray(d.ingredientes) ? d.ingredientes : [];
  if (filas.length === 0) errores.ingredientes = 'Agrega al menos un ingrediente.';
  const vistos = new Set();
  const erroresFilas = [];
  datos.ingredientes = filas.map((f, i) => {
    const e = {};
    const codigo = texto(f.codigoMateriaPrima);
    if (!PATRON_CODIGO_MP.test(codigo)) e.codigoMateriaPrima = 'Selecciona la materia prima.';
    else if (vistos.has(codigo)) e.codigoMateriaPrima = 'Este ingrediente ya está en la receta.';
    vistos.add(codigo);
    const cantidad = numeroDe(f.cantidad);
    if (Number.isNaN(cantidad) || cantidad <= 0) e.cantidad = 'Debe ser mayor que cero.';
    if (!UNIDADES_VALIDAS.has(f.unidad)) e.unidad = 'Selecciona la unidad.';
    erroresFilas[i] = e;
    return { codigoMateriaPrima: codigo, cantidad, unidad: f.unidad };
  });
  if (erroresFilas.some((e) => Object.keys(e).length)) errores.filas = erroresFilas;
  return { errores, datos, valido: Object.keys(errores).length === 0 };
}

export function validarProduccion(d) {
  const errores = {};
  const datos = {};
  datos.unidades = numeroDe(d.unidades);
  if (!Number.isInteger(datos.unidades) || datos.unidades < 1 || datos.unidades > 1000) {
    errores.unidades = 'Indica un número entero de unidades entre 1 y 1.000.';
  }
  const nota = texto(d.nota);
  if (nota.length > 200) errores.nota = 'La nota admite máximo 200 caracteres.';
  else if (nota) datos.nota = nota;
  return { errores, datos, valido: Object.keys(errores).length === 0 };
}

export function validarCredenciales(d) {
  const errores = {};
  const usuario = texto(d.usuario);
  if (usuario.length < 3) errores.usuario = 'Ingresa tu usuario.';
  const contrasena = String(d.contrasena ?? '');
  if (contrasena.length < 8) errores.contrasena = 'La contraseña tiene al menos 8 caracteres.';
  return { errores, datos: { usuario, contrasena }, valido: Object.keys(errores).length === 0 };
}

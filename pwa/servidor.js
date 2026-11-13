// Pastel Stock sin servidor (PWA): implementa la API /api/v1 DENTRO del navegador.
// La interfaz no cambia: este módulo se le pasa como `fetchImpl` y responde las mismas rutas, códigos y
// problemas RFC 9457 que el servidor Node. Las reglas de negocio son las MISMAS (se importan del backend):
// conversión de unidades, estado de stock, costeo, ventas, tablero y alertas.
// Los datos viven en el dispositivo (un almacén clave-valor; localStorage en el navegador).
import { AppError, noAutenticado, prohibido, noEncontrado, conflicto, validacion } from '../src/shared/errors.js';
import { convertir, sonCompatibles, UNIDADES_VALIDAS } from '../src/inventory/domain/unidades.js';
import { estadoStock } from '../src/inventory/domain/stock.js';
import { tipoDeAjuste } from '../src/inventory/domain/ajustes.js';
import { costearReceta, margen, costoPromedio, redondear2 } from '../src/catalog/domain/costeo.js';
import { validarLineas, liquidarVenta, comprobarVendible } from '../src/sales/domain/venta.js';
import { armarDashboard, armarAlertasCaducidad, fechaLocal, sumarDias, DIAS_POR_VENCER } from '../src/reporting/domain/dashboard.js';
import { sembrarDemo, VERSION_DATOS } from './semilla.js';

export const CLAVE_DATOS = 'pastel-stock.datos';
const ZONA = 'America/Bogota';
const TODOS = ['admin', 'operador', 'contador'];
const RE_MP = /^MP\d{3,}$/;
const RE_PT = /^PT\d{3,}$/;
const RE_CLAVE = /^[A-Za-z0-9_-]{8,64}$/;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const CATEGORIAS_MATERIA = ['Harinas', 'Endulzantes', 'Lácteos', 'Lácteos/Huevos', 'Saborizantes', 'Frutas', 'Otros'];
const CATEGORIAS_PRODUCTO = ['Pasteles', 'Panes', 'Galletas', 'Tartas', 'Postres', 'Otros'];
const MOTIVOS_SOLICITUD = ['CONTEO_FISICO', 'MERMA', 'VENCIMIENTO', 'CORRECCION'];
const r2 = redondear2;
const r6 = (n) => Math.round(n * 1e6) / 1e6;

// ------------------------------------------------------------------ utilidades de validación
const exigir = (cond, title, detail) => { if (!cond) throw validacion(title, detail); };
const esTexto = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;
const esNumero = (v, min = 0, max = 1e8) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const esEntero = (v, min = 0, max = 1e6) => Number.isInteger(v) && v >= min && v <= max;
const notaOpcional = (n) => { if (n === undefined || n === null || n === '') return null; exigir(esTexto(n, 0, 200), 'Nota inválida', 'Máximo 200 caracteres.'); return n.trim() || null; };
function soloCampos(cuerpo, permitidos, requeridos = []) {
  exigir(cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo), 'Cuerpo inválido', 'Se esperaba un objeto JSON.');
  const extra = Object.keys(cuerpo).filter((k) => !permitidos.includes(k));
  exigir(extra.length === 0, 'Campos no permitidos', `No se esperaban: ${extra.join(', ')}.`);
  const faltan = requeridos.filter((k) => cuerpo[k] === undefined || cuerpo[k] === null);
  exigir(faltan.length === 0, 'Faltan campos obligatorios', `Falta: ${faltan.join(', ')}.`);
}
function paginacion(q) {
  const pagina = q.get('pagina') === null ? 1 : Number(q.get('pagina'));
  const limite = q.get('limite') === null ? 20 : Number(q.get('limite'));
  exigir(Number.isInteger(pagina) && pagina >= 1, 'Parámetro "pagina" inválido', 'Debe ser un entero ≥ 1.');
  exigir(Number.isInteger(limite) && limite >= 1 && limite <= 100, 'Parámetro "limite" inválido', 'Debe ser un entero entre 1 y 100.');
  return { pagina, limite, offset: (pagina - 1) * limite };
}
const paginar = (lista, pag) => ({ datos: lista.slice(pag.offset, pag.offset + pag.limite), paginacion: { pagina: pag.pagina, limite: pag.limite, total: lista.length } });
const abreviar = (nombre) => { const [a, b] = String(nombre ?? '').trim().split(/\s+/); return b ? `${a} ${b[0]}.` : a; };
const aleatorio = (n = 24) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');

export async function hashClave(clave, sal) {
  const datos = new TextEncoder().encode(`${sal}:${clave}`);
  const h = await crypto.subtle.digest('SHA-256', datos);
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param almacen { leer(): string|null, guardar(texto) } — localStorage en el navegador; un objeto en memoria en pruebas.
 * @param reloj () => Date
 */
export function crearServidorLocal({ almacen, reloj = () => new Date() } = {}) {
  let datos = null;
  const sesiones = new Map(); // accessToken → usuarioId (solo en memoria: se pierde al recargar)

  async function cargar() {
    if (datos) return datos;
    const texto = almacen.leer();
    if (texto) {
      try { datos = JSON.parse(texto); } catch { datos = null; }
    }
    if (!datos || datos.version !== VERSION_DATOS) {
      datos = await sembrarDemo({ ahora: reloj(), hashClave });
      guardar();
    }
    return datos;
  }
  function guardar() { almacen.guardar(JSON.stringify(datos)); }

  /** "Transacción": trabaja sobre una copia y solo la confirma si el manejador termina sin error. */
  async function transaccion(fn) {
    const copia = structuredClone(datos);
    try {
      const r = await fn(datos);
      guardar();
      return r;
    } catch (e) { datos = copia; throw e; }
  }

  // ---------------------------------------------------------------- lecturas derivadas
  const hoy = () => fechaLocal(reloj(), ZONA);
  const fechaDe = (iso) => fechaLocal(new Date(iso), ZONA);
  const conEstado = (m) => ({ ...m, estado: estadoStock(m.stock, m.minimo) });
  const materia = (codigo) => datos.materias.find((m) => m.codigo === codigo);
  const producto = (sku) => datos.productos.find((p) => p.sku === sku);
  const usuario = (id) => datos.usuarios.find((u) => u.id === id);
  const sig = (serie) => { datos.secuencias[serie] = (datos.secuencias[serie] ?? 0) + 1; return datos.secuencias[serie]; };
  const recetaVista = (r) => ({
    id: r.id, productoSku: r.productoSku, productoNombre: producto(r.productoSku)?.nombre,
    ingredientes: [...r.ingredientes].sort((a, b) => a.codigoMateriaPrima.localeCompare(b.codigoMateriaPrima))
      .map((i) => ({ ...i, nombre: materia(i.codigoMateriaPrima)?.nombre })),
  });
  const ahoraISO = () => reloj().toISOString();
  function movimiento(m) {
    datos.movimientos.push({ id: sig('movimiento'), creadoEn: ahoraISO(), proveedor: null, nota: null, motivo: null, ...m });
    return datos.secuencias.movimiento;
  }
  function movimientoProducto(m) {
    datos.movimientosProducto.push({ id: sig('movimientoProducto'), creadoEn: ahoraISO(), costoUnitario: 0, motivo: null, ventaId: null, nota: null, ...m });
    return datos.secuencias.movimientoProducto;
  }
  function ajustarStockMateria(m, delta) {
    const nuevo = r6(m.stock + delta);
    if (nuevo < 0) throw conflicto('Stock insuficiente', `${m.nombre} quedaría con stock negativo.`);
    m.stock = nuevo;
    return conEstado(m);
  }
  function reclamarClave(usuarioId, clave, huella) {
    const k = `${usuarioId}:${clave}`;
    const previa = datos.claves[k];
    if (!previa) return null;
    if (previa.huella !== huella) throw validacion('Clave de idempotencia reutilizada', 'La misma Idempotency-Key se usó antes con una solicitud distinta.');
    return previa.respuesta;
  }
  const leerClave = (req) => {
    const clave = req.cabeceras['idempotency-key'];
    if (clave !== undefined && !RE_CLAVE.test(clave)) throw validacion('Cabecera "Idempotency-Key" inválida', 'Debe tener entre 8 y 64 caracteres: letras, números, guion o guion bajo.');
    return clave;
  };

  // ---------------------------------------------------------------- rutas
  const rutas = [];
  const ruta = (metodo, patron, roles, manejador) => {
    const nombres = [];
    const re = new RegExp(`^${patron.replace(/:(\w+)/g, (_, n) => { nombres.push(n); return '([^/]+)'; })}$`);
    rutas.push({ metodo, re, nombres, roles, manejador });
  };

  // ---- Identidad
  ruta('POST', '/auth/login', null, async ({ cuerpo }) => {
    exigir(cuerpo && esTexto(cuerpo.usuario, 1, 60) && typeof cuerpo.contrasena === 'string', 'Credenciales incompletas', 'Indique usuario y contraseña.');
    const u = datos.usuarios.find((x) => x.usuario === cuerpo.usuario.trim().toLowerCase());
    if (!u || (await hashClave(cuerpo.contrasena, u.sal)) !== u.hash) throw noAutenticado('Usuario o contraseña incorrectos');
    return { status: 200, cuerpo: emitir(u) };
  });
  ruta('POST', '/auth/refresh', null, async ({ cuerpo }) => {
    const id = datos.sesiones?.[cuerpo?.refreshToken];
    const u = id && usuario(id);
    if (!u) throw noAutenticado('Refresh token inválido o vencido');
    await transaccion(async (d) => { delete d.sesiones[cuerpo.refreshToken]; });
    return { status: 200, cuerpo: emitir(u) };
  });
  function emitir(u) {
    const accessToken = aleatorio(); const refreshToken = aleatorio();
    sesiones.set(accessToken, u.id);
    datos.sesiones = { ...(datos.sesiones ?? {}), [refreshToken]: u.id };
    // Se conservan como mucho 20 sesiones abiertas por dispositivo
    const claves = Object.keys(datos.sesiones);
    if (claves.length > 20) for (const k of claves.slice(0, claves.length - 20)) delete datos.sesiones[k];
    guardar();
    return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn: 900, rol: u.rol, nombre: u.nombre };
  }

  // ---- Materias primas
  ruta('GET', '/materias-primas', TODOS, ({ q }) => {
    const pag = paginacion(q);
    const texto = (q.get('q') ?? '').toLowerCase();
    const categoria = q.get('categoria'); const estado = q.get('estado');
    const lista = datos.materias.map(conEstado)
      .filter((m) => !texto || m.codigo.toLowerCase().includes(texto) || m.nombre.toLowerCase().includes(texto))
      .filter((m) => !categoria || m.categoria === categoria)
      .filter((m) => !estado || m.estado === estado)
      .sort((a, b) => a.codigo.localeCompare(b.codigo));
    return { cuerpo: paginar(lista, pag) };
  });
  ruta('GET', '/materias-primas/:codigo', TODOS, ({ p }) => {
    const m = materia(p.codigo); if (!m) throw noEncontrado('Materia prima', p.codigo);
    return { cuerpo: conEstado(m) };
  });
  const validarMateria = (c, crear) => {
    soloCampos(c, crear ? ['codigo', 'nombre', 'categoria', 'unidad', 'minimo', 'costo', 'stock'] : ['nombre', 'categoria', 'unidad', 'minimo', 'costo'],
      crear ? ['codigo', 'nombre', 'categoria', 'unidad', 'minimo', 'costo'] : ['nombre', 'categoria', 'unidad', 'minimo', 'costo']);
    if (crear) exigir(RE_MP.test(c.codigo), 'Código inválido', 'Use el formato MP001.');
    exigir(esTexto(c.nombre, 2, 80), 'Nombre inválido', 'Entre 2 y 80 caracteres.');
    exigir(CATEGORIAS_MATERIA.includes(c.categoria), 'Categoría inválida', CATEGORIAS_MATERIA.join(', '));
    exigir(UNIDADES_VALIDAS.includes(c.unidad), 'Unidad inválida', UNIDADES_VALIDAS.join(', '));
    exigir(esNumero(c.minimo) && esNumero(c.costo), 'Mínimo o costo inválido', 'Deben ser números ≥ 0.');
    if (crear && c.stock !== undefined) exigir(esNumero(c.stock), 'Stock inválido', 'Debe ser un número ≥ 0.');
  };
  ruta('POST', '/materias-primas', ['admin'], ({ cuerpo, usuarioId }) => transaccion(async (d) => {
    validarMateria(cuerpo, true);
    if (materia(cuerpo.codigo)) throw conflicto('Ya existe una materia prima con ese código', `Código ${cuerpo.codigo}.`);
    const m = { codigo: cuerpo.codigo, nombre: cuerpo.nombre.trim(), categoria: cuerpo.categoria, unidad: cuerpo.unidad, minimo: cuerpo.minimo, costo: cuerpo.costo, stock: r6(cuerpo.stock ?? 0) };
    d.materias.push(m);
    if (m.stock > 0) movimiento({ codigo: m.codigo, tipo: 'AJUSTE', cantidad: m.stock, costoUnitario: m.costo, usuarioId, nota: 'Stock inicial', motivo: 'STOCK_INICIAL' });
    return { status: 201, cuerpo: conEstado(m) };
  }));
  ruta('PUT', '/materias-primas/:codigo', ['admin'], ({ p, cuerpo }) => transaccion(async () => {
    const m = materia(p.codigo); if (!m) throw noEncontrado('Materia prima', p.codigo);
    validarMateria(cuerpo, false);
    if (cuerpo.unidad !== m.unidad) {
      const enUso = datos.recetas.some((r) => r.ingredientes.some((i) => i.codigoMateriaPrima === m.codigo));
      const historial = datos.movimientos.some((x) => x.codigo === m.codigo);
      if (enUso || historial) throw validacion('No se puede cambiar la unidad', 'La materia prima tiene recetas o historial de movimientos en la unidad actual.');
    }
    Object.assign(m, { nombre: cuerpo.nombre.trim(), categoria: cuerpo.categoria, unidad: cuerpo.unidad, minimo: cuerpo.minimo, costo: cuerpo.costo });
    return { cuerpo: conEstado(m) };
  }));
  ruta('DELETE', '/materias-primas/:codigo', ['admin'], ({ p }) => transaccion(async (d) => {
    const m = materia(p.codigo); if (!m) throw noEncontrado('Materia prima', p.codigo);
    if (d.recetas.some((r) => r.ingredientes.some((i) => i.codigoMateriaPrima === m.codigo))) {
      throw conflicto('No se puede eliminar: está en uso en una receta', `La materia prima ${m.codigo} forma parte de al menos una receta.`);
    }
    if (d.movimientos.some((x) => x.codigo === m.codigo && !(x.tipo === 'AJUSTE' && x.motivo === 'STOCK_INICIAL'))) {
      throw conflicto('No se puede eliminar: tiene historial de movimientos', 'El kardex es un registro de auditoría. Déjela en stock 0 en lugar de eliminarla.');
    }
    d.movimientos = d.movimientos.filter((x) => x.codigo !== m.codigo);
    d.materias = d.materias.filter((x) => x !== m);
    return { status: 204 };
  }));

  // ---- Movimientos
  ruta('POST', '/movimientos/entradas', ['admin', 'operador'], ({ cuerpo, usuarioId }) => transaccion(async () => {
    soloCampos(cuerpo, ['codigo', 'cantidad', 'proveedor', 'nota'], ['codigo', 'cantidad']);
    exigir(typeof cuerpo.cantidad === 'number' && cuerpo.cantidad > 0 && cuerpo.cantidad <= 1e8, 'Cantidad inválida', 'Debe ser mayor que cero.');
    if (cuerpo.proveedor !== undefined) exigir(esTexto(cuerpo.proveedor, 0, 120), 'Proveedor inválido', 'Máximo 120 caracteres.');
    const m = materia(cuerpo.codigo); if (!m) throw noEncontrado('Materia prima', cuerpo.codigo);
    const despues = ajustarStockMateria(m, cuerpo.cantidad);
    const movimientoId = movimiento({ codigo: m.codigo, tipo: 'ENTRADA', cantidad: r6(cuerpo.cantidad), costoUnitario: m.costo, proveedor: cuerpo.proveedor?.trim() || null, usuarioId, nota: notaOpcional(cuerpo.nota) });
    return { status: 201, cuerpo: { codigo: m.codigo, stock: despues.stock, estado: despues.estado, movimientoId } };
  }));
  ruta('POST', '/movimientos/ajustes', ['admin', 'operador'], ({ cuerpo, usuarioId }) => transaccion(async () => {
    soloCampos(cuerpo, ['codigo', 'stockContado', 'motivo', 'nota'], ['codigo', 'stockContado', 'motivo']);
    exigir(esNumero(cuerpo.stockContado), 'Stock contado inválido', 'Debe ser un número ≥ 0.');
    exigir(MOTIVOS_SOLICITUD.includes(cuerpo.motivo), 'Motivo inválido', MOTIVOS_SOLICITUD.join(', '));
    const m = materia(cuerpo.codigo); if (!m) throw noEncontrado('Materia prima', cuerpo.codigo);
    const antes = m.stock;
    const ajuste = tipoDeAjuste(antes, cuerpo.stockContado);
    if (!ajuste) return { status: 201, cuerpo: { codigo: m.codigo, stockAnterior: antes, stockNuevo: antes, diferencia: 0, valorDiferencia: 0, estado: conEstado(m).estado, movimientoId: null } };
    const despues = ajustarStockMateria(m, ajuste.tipo === 'AJUSTE' ? ajuste.cantidad : -ajuste.cantidad);
    const movimientoId = movimiento({ codigo: m.codigo, ...ajuste, costoUnitario: m.costo, usuarioId, nota: notaOpcional(cuerpo.nota), motivo: cuerpo.motivo });
    const diferencia = r6(despues.stock - antes);
    return { status: 201, cuerpo: { codigo: m.codigo, stockAnterior: antes, stockNuevo: despues.stock, diferencia, valorDiferencia: r2(diferencia * m.costo), estado: despues.estado, movimientoId } };
  }));
  ruta('GET', '/movimientos', TODOS, ({ q }) => {
    const pag = paginacion(q);
    const codigo = q.get('codigo'); const tipo = q.get('tipo'); const desde = q.get('desde'); const hasta = q.get('hasta');
    for (const [n, v] of [['desde', desde], ['hasta', hasta]]) if (v) exigir(RE_FECHA.test(v), `Parámetro "${n}" inválido`, 'Use el formato AAAA-MM-DD.');
    const lista = datos.movimientos
      .filter((m) => (!codigo || m.codigo === codigo) && (!tipo || m.tipo === tipo))
      .filter((m) => (!desde || fechaDe(m.creadoEn) >= desde) && (!hasta || fechaDe(m.creadoEn) <= hasta))
      .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn) || b.id - a.id)
      .map((m) => ({
        id: m.id, codigo: m.codigo, nombre: materia(m.codigo)?.nombre, unidad: materia(m.codigo)?.unidad, tipo: m.tipo, cantidad: m.cantidad, creadoEn: m.creadoEn,
        ...(m.proveedor ? { proveedor: m.proveedor } : {}), ...(m.nota ? { nota: m.nota } : {}), ...(m.motivo ? { motivo: m.motivo } : {}),
        ...(usuario(m.usuarioId) ? { registradoPor: abreviar(usuario(m.usuarioId).nombre) } : {}),
      }));
    return { cuerpo: paginar(lista, pag) };
  });

  // ---- Productos
  const validarProducto = (c, crear) => {
    const campos = ['nombre', 'categoria', 'stock', 'precio', 'caducidad', 'costoUnitario'];
    soloCampos(c, crear ? ['sku', ...campos] : campos, ['nombre', 'categoria', 'stock', 'precio', 'caducidad', ...(crear ? ['sku'] : [])]);
    if (crear) exigir(RE_PT.test(c.sku), 'SKU inválido', 'Use el formato PT001.');
    exigir(esTexto(c.nombre, 2, 80), 'Nombre inválido', 'Entre 2 y 80 caracteres.');
    exigir(CATEGORIAS_PRODUCTO.includes(c.categoria), 'Categoría inválida', CATEGORIAS_PRODUCTO.join(', '));
    exigir(esEntero(c.stock), 'Stock inválido', 'Debe ser un entero ≥ 0.');
    exigir(esNumero(c.precio), 'Precio inválido', 'Debe ser un número ≥ 0.');
    exigir(typeof c.caducidad === 'string' && RE_FECHA.test(c.caducidad), 'Caducidad inválida', 'Use el formato AAAA-MM-DD.');
    if (c.costoUnitario !== undefined) exigir(esNumero(c.costoUnitario), 'Costo inválido', 'Debe ser un número ≥ 0.');
  };
  ruta('GET', '/productos', TODOS, ({ q }) => {
    const pag = paginacion(q); const categoria = q.get('categoria');
    const lista = datos.productos.filter((p) => !categoria || p.categoria === categoria).sort((a, b) => a.sku.localeCompare(b.sku)).map((p) => ({ ...p }));
    return { cuerpo: paginar(lista, pag) };
  });
  ruta('GET', '/productos/:sku', TODOS, ({ p }) => {
    const x = producto(p.sku); if (!x) throw noEncontrado('Producto', p.sku);
    return { cuerpo: { ...x } };
  });
  ruta('POST', '/productos', ['admin'], ({ cuerpo, usuarioId }) => transaccion(async (d) => {
    validarProducto(cuerpo, true);
    if (producto(cuerpo.sku)) throw conflicto('Ya existe un producto con ese SKU', `SKU ${cuerpo.sku}.`);
    const x = { sku: cuerpo.sku, nombre: cuerpo.nombre.trim(), categoria: cuerpo.categoria, stock: cuerpo.stock, precio: cuerpo.precio, caducidad: cuerpo.caducidad, costoUnitario: r2(cuerpo.costoUnitario ?? 0) };
    d.productos.push(x);
    if (x.stock > 0) movimientoProducto({ sku: x.sku, tipo: 'AJUSTE', cantidad: x.stock, costoUnitario: x.costoUnitario, motivo: 'STOCK_INICIAL', usuarioId, nota: 'Stock inicial' });
    return { status: 201, cuerpo: { ...x } };
  }));
  ruta('PUT', '/productos/:sku', ['admin'], ({ p, cuerpo, usuarioId }) => transaccion(async () => {
    const x = producto(p.sku); if (!x) throw noEncontrado('Producto', p.sku);
    validarProducto(cuerpo, false);
    const antes = x.stock;
    Object.assign(x, { nombre: cuerpo.nombre.trim(), categoria: cuerpo.categoria, stock: cuerpo.stock, precio: cuerpo.precio, caducidad: cuerpo.caducidad, ...(cuerpo.costoUnitario !== undefined ? { costoUnitario: r2(cuerpo.costoUnitario) } : {}) });
    const ajuste = tipoDeAjuste(antes, x.stock);
    if (ajuste) movimientoProducto({ sku: x.sku, ...ajuste, costoUnitario: x.costoUnitario, motivo: 'CORRECCION', usuarioId, nota: 'Edición directa del stock' });
    return { cuerpo: { ...x } };
  }));
  ruta('DELETE', '/productos/:sku', ['admin'], ({ p }) => transaccion(async (d) => {
    const x = producto(p.sku); if (!x) throw noEncontrado('Producto', p.sku);
    const historial = d.ventas.some((v) => v.items.some((i) => i.sku === x.sku))
      || d.movimientosProducto.some((m) => m.sku === x.sku && ['PRODUCCION', 'VENTA', 'BAJA'].includes(m.tipo));
    if (historial) throw conflicto('No se puede eliminar: el producto tiene ventas, producciones o bajas', 'El kardex es un registro de auditoría. Déjelo en stock 0 en lugar de eliminarlo.');
    d.movimientosProducto = d.movimientosProducto.filter((m) => m.sku !== x.sku);
    d.recetas = d.recetas.filter((r) => r.productoSku !== x.sku);
    d.productos = d.productos.filter((y) => y !== x);
    return { status: 204 };
  }));
  ruta('POST', '/productos/:sku/ajustes', ['admin', 'operador'], ({ p, cuerpo, usuarioId }) => transaccion(async () => {
    soloCampos(cuerpo, ['stockContado', 'motivo', 'nota'], ['stockContado', 'motivo']);
    exigir(esEntero(cuerpo.stockContado), 'Stock contado inválido', 'Debe ser un entero ≥ 0.');
    exigir(MOTIVOS_SOLICITUD.includes(cuerpo.motivo), 'Motivo inválido', MOTIVOS_SOLICITUD.join(', '));
    const x = producto(p.sku); if (!x) throw noEncontrado('Producto', p.sku);
    const antes = x.stock;
    const ajuste = tipoDeAjuste(antes, cuerpo.stockContado);
    if (!ajuste) return { status: 201, cuerpo: { sku: x.sku, stockAnterior: antes, stockNuevo: antes, diferencia: 0, movimientoId: null } };
    x.stock = cuerpo.stockContado;
    const tipo = ajuste.tipo === 'AJUSTE_NEGATIVO' && cuerpo.motivo === 'VENCIMIENTO' ? 'BAJA' : ajuste.tipo;
    const movimientoId = movimientoProducto({ sku: x.sku, tipo, cantidad: ajuste.cantidad, costoUnitario: x.costoUnitario, motivo: cuerpo.motivo, usuarioId, nota: notaOpcional(cuerpo.nota) });
    return { status: 201, cuerpo: { sku: x.sku, stockAnterior: antes, stockNuevo: x.stock, diferencia: x.stock - antes, valorDiferencia: r2((x.stock - antes) * x.costoUnitario), movimientoId } };
  }));
  ruta('GET', '/productos/:sku/movimientos', TODOS, ({ p, q }) => {
    const pag = paginacion(q);
    if (!producto(p.sku)) throw noEncontrado('Producto', p.sku);
    const lista = datos.movimientosProducto.filter((m) => m.sku === p.sku)
      .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn) || b.id - a.id)
      .map((m) => ({
        id: m.id, sku: m.sku, tipo: m.tipo, cantidad: m.cantidad, costoUnitario: m.costoUnitario, creadoEn: m.creadoEn,
        ...(m.motivo ? { motivo: m.motivo } : {}), ...(m.ventaId ? { ventaId: m.ventaId } : {}), ...(m.nota ? { nota: m.nota } : {}),
        ...(usuario(m.usuarioId) ? { registradoPor: abreviar(usuario(m.usuarioId).nombre) } : {}),
      }));
    return { cuerpo: paginar(lista, pag) };
  });

  // ---- Recetas
  function validarIngredientes(lista) {
    exigir(Array.isArray(lista) && lista.length >= 1 && lista.length <= 50, 'Ingredientes inválidos', 'Entre 1 y 50 ingredientes.');
    for (const i of lista) {
      soloCampos(i, ['codigoMateriaPrima', 'cantidad', 'unidad'], ['codigoMateriaPrima', 'cantidad', 'unidad']);
      exigir(typeof i.cantidad === 'number' && i.cantidad > 0 && i.cantidad <= 1e6, 'Cantidad inválida en un ingrediente', 'Debe ser mayor que cero.');
      exigir(UNIDADES_VALIDAS.includes(i.unidad), 'Unidad inválida en un ingrediente', UNIDADES_VALIDAS.join(', '));
    }
    const codigos = lista.map((i) => i.codigoMateriaPrima);
    if (new Set(codigos).size !== codigos.length) throw validacion('Ingredientes repetidos', 'Cada materia prima solo puede aparecer una vez en la receta.');
    for (const i of lista) {
      const mp = materia(i.codigoMateriaPrima);
      if (!mp) throw validacion('Materia prima inexistente en la receta', `No existe la materia prima ${i.codigoMateriaPrima}.`);
      if (!sonCompatibles(i.unidad, mp.unidad)) throw validacion('Unidad incompatible en un ingrediente', `${mp.nombre} se controla en "${mp.unidad}" y la receta usa "${i.unidad}".`);
    }
    return lista.map(({ codigoMateriaPrima, cantidad, unidad }) => ({ codigoMateriaPrima, cantidad, unidad }));
  }
  const receta = (id) => datos.recetas.find((r) => r.id === Number(id));
  ruta('GET', '/recetas', TODOS, ({ q }) => {
    const pag = paginacion(q);
    return { cuerpo: paginar([...datos.recetas].sort((a, b) => a.id - b.id).map(recetaVista), pag) };
  });
  ruta('GET', '/recetas/:id', TODOS, ({ p }) => {
    const r = receta(p.id); if (!r) throw noEncontrado('Receta', p.id);
    return { cuerpo: recetaVista(r) };
  });
  ruta('POST', '/recetas', ['admin'], ({ cuerpo }) => transaccion(async (d) => {
    soloCampos(cuerpo, ['productoSku', 'ingredientes'], ['productoSku', 'ingredientes']);
    if (!producto(cuerpo.productoSku)) throw validacion('Producto inexistente', `No existe el producto ${cuerpo.productoSku}.`);
    const ingredientes = validarIngredientes(cuerpo.ingredientes);
    if (d.recetas.some((r) => r.productoSku === cuerpo.productoSku)) throw conflicto('Ese producto ya tiene receta', `Use PUT /recetas/{id} para modificar la de ${cuerpo.productoSku}.`);
    const r = { id: sig('receta'), productoSku: cuerpo.productoSku, ingredientes };
    d.recetas.push(r);
    return { status: 201, cuerpo: recetaVista(r) };
  }));
  ruta('PUT', '/recetas/:id', ['admin'], ({ p, cuerpo }) => transaccion(async () => {
    const r = receta(p.id); if (!r) throw noEncontrado('Receta', p.id);
    soloCampos(cuerpo, ['ingredientes', 'productoSku'], ['ingredientes']);
    r.ingredientes = validarIngredientes(cuerpo.ingredientes);
    return { cuerpo: recetaVista(r) };
  }));
  ruta('DELETE', '/recetas/:id', ['admin'], ({ p }) => transaccion(async (d) => {
    if (!receta(p.id)) throw noEncontrado('Receta', p.id);
    d.recetas = d.recetas.filter((r) => r.id !== Number(p.id));
    return { status: 204 };
  }));
  ruta('GET', '/recetas/:id/costeo', TODOS, ({ p }) => {
    const r = receta(p.id); if (!r) throw noEncontrado('Receta', p.id);
    const x = producto(r.productoSku);
    const { costoUnitario, detalle } = costearReceta(r.ingredientes, new Map(datos.materias.map((m) => [m.codigo, m])));
    return { cuerpo: { recetaId: r.id, productoSku: x.sku, productoNombre: x.nombre, precioVenta: x.precio, costoUnitario, ...margen(x.precio, costoUnitario), ingredientes: detalle } };
  });
  ruta('POST', '/recetas/:id/producir', ['admin', 'operador'], ({ p, cuerpo, usuarioId, req }) => transaccion(async (d) => {
    const clave = leerClave(req);
    soloCampos(cuerpo, ['unidades', 'nota', 'caducidad'], ['unidades']);
    exigir(esEntero(cuerpo.unidades, 1, 10000), 'Unidades inválidas', 'Entero entre 1 y 10.000.');
    if (cuerpo.caducidad !== undefined) exigir(RE_FECHA.test(cuerpo.caducidad), 'Caducidad inválida', 'Use el formato AAAA-MM-DD.');
    const nota = notaOpcional(cuerpo.nota);
    const huella = JSON.stringify([Number(p.id), cuerpo.unidades, nota, cuerpo.caducidad ?? null]);
    if (clave) { const previa = reclamarClave(usuarioId, clave, huella); if (previa) return { status: 201, cuerpo: previa, cabeceras: { 'Idempotency-Replayed': 'true' } }; }
    const r = receta(p.id); if (!r) throw noEncontrado('Receta', p.id);
    const unidades = cuerpo.unidades;
    const consumos = r.ingredientes.map((i) => { const mp = materia(i.codigoMateriaPrima); return { mp, necesario: convertir(i.cantidad * unidades, i.unidad, mp.unidad) }; });
    const faltantes = consumos.filter(({ mp, necesario }) => mp.stock < necesario);
    if (faltantes.length) {
      throw conflicto('Stock insuficiente para producir', faltantes.map(({ mp, necesario }) => `${mp.nombre}: se necesitan ${necesario} ${mp.unidad} y hay ${mp.stock}`).join('; '),
        { faltantes: faltantes.map(({ mp, necesario }) => ({ codigoMateriaPrima: mp.codigo, necesario, disponible: mp.stock, unidad: mp.unidad })) });
    }
    const x = producto(r.productoSku);
    let costoLote = 0; const detalle = [];
    for (const { mp, necesario } of consumos) {
      const despues = ajustarStockMateria(mp, -necesario);
      movimiento({ codigo: mp.codigo, tipo: 'SALIDA', cantidad: necesario, costoUnitario: mp.costo, usuarioId, nota: nota ?? `Producción de ${unidades} × ${x.nombre}` });
      costoLote += necesario * mp.costo;
      detalle.push({ codigoMateriaPrima: mp.codigo, cantidadConsumida: necesario, stockRestante: despues.stock, estado: despues.estado });
    }
    costoLote = r2(costoLote);
    x.costoUnitario = costoPromedio({ stockAnterior: x.stock, costoAnterior: x.costoUnitario, unidades, costoLote });
    if (cuerpo.caducidad) x.caducidad = cuerpo.caducidad;
    x.stock += unidades;
    const costoUnitarioLote = r2(costoLote / unidades);
    movimientoProducto({ sku: x.sku, tipo: 'PRODUCCION', cantidad: unidades, costoUnitario: costoUnitarioLote, usuarioId, nota: nota ?? `Producción de ${unidades} unidades` });
    const respuesta = { productoSku: x.sku, stockProducto: x.stock, consumos: detalle, costoLote, costoUnitarioLote, costoPromedioProducto: x.costoUnitario, caducidadProducto: x.caducidad };
    if (clave) d.claves[`${usuarioId}:${clave}`] = { huella, respuesta };
    return { status: 201, cuerpo: respuesta, cabeceras: clave ? { 'Idempotency-Replayed': 'false' } : {} };
  }));

  // ---- Ventas
  ruta('POST', '/ventas', ['admin', 'operador'], ({ cuerpo, usuarioId, req }) => transaccion(async (d) => {
    const clave = leerClave(req);
    soloCampos(cuerpo, ['items', 'nota'], ['items']);
    exigir(Array.isArray(cuerpo.items) && cuerpo.items.length >= 1 && cuerpo.items.length <= 50, 'Productos inválidos', 'Entre 1 y 50 líneas.');
    for (const i of cuerpo.items) {
      soloCampos(i, ['sku', 'cantidad', 'precioUnitario'], ['sku', 'cantidad']);
      exigir(RE_PT.test(i.sku), 'SKU inválido', 'Use el formato PT001.');
      exigir(esEntero(i.cantidad, 1, 10000), 'Cantidad inválida', 'Entero entre 1 y 10.000.');
      if (i.precioUnitario !== undefined) exigir(esNumero(i.precioUnitario), 'Precio inválido', 'Debe ser un número ≥ 0.');
    }
    const nota = notaOpcional(cuerpo.nota);
    validarLineas(cuerpo.items);
    const huella = JSON.stringify(['venta', cuerpo.items, nota]);
    if (clave) { const previa = reclamarClave(usuarioId, clave, huella); if (previa) return { status: 201, cuerpo: previa, cabeceras: { 'Idempotency-Replayed': 'true' } }; }
    const mapa = new Map(cuerpo.items.filter((i) => producto(i.sku)).map((i) => [i.sku, producto(i.sku)]));
    comprobarVendible(cuerpo.items, mapa, hoy());
    const liq = liquidarVenta(cuerpo.items, mapa);
    const venta = { id: sig('venta'), usuarioId, total: liq.total, costoTotal: liq.costoTotal, nota, creadoEn: ahoraISO(),
      items: liq.lineas.map(({ sku, cantidad, precioUnitario, costoUnitario }) => ({ sku, cantidad, precioUnitario, costoUnitario })) };
    d.ventas.push(venta);
    const stockRestante = [];
    for (const l of liq.lineas) {
      const x = producto(l.sku); x.stock -= l.cantidad;
      movimientoProducto({ sku: l.sku, tipo: 'VENTA', cantidad: l.cantidad, costoUnitario: l.costoUnitario, ventaId: venta.id, usuarioId, nota: `Venta #${venta.id}` });
      stockRestante.push({ sku: l.sku, stock: x.stock });
    }
    const respuesta = {
      id: venta.id, creadoEn: venta.creadoEn, total: liq.total, costoTotal: liq.costoTotal, margen: liq.margen,
      items: liq.lineas.map(({ sku, nombre, cantidad, precioUnitario, costoUnitario, subtotal }) => ({ sku, nombre, cantidad, precioUnitario, costoUnitario, subtotal })),
      stockRestante, ...(nota ? { nota } : {}),
    };
    if (clave) d.claves[`${usuarioId}:${clave}`] = { huella, respuesta };
    return { status: 201, cuerpo: respuesta, cabeceras: clave ? { 'Idempotency-Replayed': 'false' } : {} };
  }));
  ruta('GET', '/ventas', TODOS, ({ q }) => {
    const pag = paginacion(q);
    const desde = q.get('desde'); const hasta = q.get('hasta');
    for (const [n, v] of [['desde', desde], ['hasta', hasta]]) if (v) exigir(RE_FECHA.test(v), `Parámetro "${n}" inválido`, 'Use el formato AAAA-MM-DD.');
    const filtradas = datos.ventas.filter((v) => (!desde || fechaDe(v.creadoEn) >= desde) && (!hasta || fechaDe(v.creadoEn) <= hasta))
      .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn) || b.id - a.id);
    const total = filtradas.reduce((a, v) => a + v.total, 0); const costo = filtradas.reduce((a, v) => a + v.costoTotal, 0);
    const vista = filtradas.map((v) => ({
      id: v.id, creadoEn: v.creadoEn, total: v.total, costoTotal: v.costoTotal, margen: r2(v.total - v.costoTotal),
      items: v.items.map((i) => ({ ...i, nombre: producto(i.sku)?.nombre ?? i.sku, subtotal: r2(i.cantidad * i.precioUnitario) })),
      ...(v.nota ? { nota: v.nota } : {}), ...(usuario(v.usuarioId) ? { registradoPor: abreviar(usuario(v.usuarioId).nombre) } : {}),
    }));
    return { cuerpo: { ...paginar(vista, pag), resumen: { total: r2(total), costo: r2(costo), margen: r2(total - costo) } } };
  });

  // ---- Reportes
  const enRango = (iso, desde, hasta) => { const f = fechaDe(iso); return f >= desde && f <= hasta; };
  ruta('GET', '/reportes/dashboard', TODOS, () => {
    const h = hoy(); const desde30 = sumarDias(h, -29); const desde7 = sumarDias(h, -6); const hasta3 = sumarDias(h, DIAS_POR_VENCER);
    const dias7 = Array.from({ length: 7 }, (_, i) => sumarDias(desde7, i));
    const entradas = datos.movimientos.filter((m) => m.tipo === 'ENTRADA');
    const porCategoria = new Map();
    for (const m of datos.materias) porCategoria.set(m.categoria, (porCategoria.get(m.categoria) ?? 0) + m.stock * m.costo);
    const ventas30 = datos.ventas.filter((v) => enRango(v.creadoEn, desde30, h));
    const vendidos = new Map();
    for (const v of ventas30) for (const i of v.items) {
      const x = vendidos.get(i.sku) ?? { sku: i.sku, nombre: producto(i.sku)?.nombre ?? i.sku, unidades: 0, total: 0 };
      x.unidades += i.cantidad; x.total += i.cantidad * i.precioUnitario; vendidos.set(i.sku, x);
    }
    const perdidas = datos.movimientosProducto.filter((m) => ['BAJA', 'AJUSTE_NEGATIVO'].includes(m.tipo) && enRango(m.creadoEn, desde30, h)).reduce((a, m) => a + m.cantidad * m.costoUnitario, 0)
      + datos.movimientos.filter((m) => m.tipo === 'AJUSTE_NEGATIVO' && enRango(m.creadoEn, desde30, h)).reduce((a, m) => a + m.cantidad * m.costoUnitario, 0);
    return {
      cabeceras: { 'Cache-Control': 'no-store' },
      cuerpo: armarDashboard({
        materias: datos.materias,
        valorProductos: datos.productos.reduce((a, p) => a + p.stock * p.precio, 0),
        compras30: entradas.filter((m) => enRango(m.creadoEn, desde30, h)).reduce((a, m) => a + m.cantidad * m.costoUnitario, 0),
        compras7: dias7.map((fecha) => ({ fecha, total: entradas.filter((m) => fechaDe(m.creadoEn) === fecha).reduce((a, m) => a + m.cantidad * m.costoUnitario, 0) })),
        stockPorCategoria: [...porCategoria].map(([categoria, valor]) => ({ categoria, valor })).sort((a, b) => b.valor - a.valor),
        topProductos: datos.productos.map((p) => ({ sku: p.sku, nombre: p.nombre, valor: p.stock * p.precio })).sort((a, b) => b.valor - a.valor || a.sku.localeCompare(b.sku)).slice(0, 5),
        productosPorVencer: datos.productos.filter((p) => p.caducidad >= h && p.caducidad <= hasta3).length,
        productosVencidos: datos.productos.filter((p) => p.caducidad < h).length,
        ventas30: { total: ventas30.reduce((a, v) => a + v.total, 0), costo: ventas30.reduce((a, v) => a + v.costoTotal, 0), n: ventas30.length },
        ventas7: dias7.map((fecha) => {
          const del = datos.ventas.filter((v) => fechaDe(v.creadoEn) === fecha);
          return { fecha, total: del.reduce((a, v) => a + v.total, 0), margen: del.reduce((a, v) => a + v.total - v.costoTotal, 0) };
        }),
        topVendidos: [...vendidos.values()].sort((a, b) => b.total - a.total || a.sku.localeCompare(b.sku)).slice(0, 5),
        perdidas30: perdidas,
      }),
    };
  });
  ruta('GET', '/reportes/alertas', TODOS, ({ q }) => {
    const dias = q.get('dias') === null ? DIAS_POR_VENCER : Number(q.get('dias'));
    exigir(Number.isInteger(dias) && dias >= 0 && dias <= 30, 'Parámetro "dias" inválido', 'Debe ser un entero entre 0 y 30.');
    const h = hoy(); const limite = sumarDias(h, dias);
    const diasEntre = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
    const filas = datos.productos.filter((p) => p.stock > 0 && p.caducidad <= limite)
      .sort((a, b) => a.caducidad.localeCompare(b.caducidad) || a.sku.localeCompare(b.sku))
      .map((p) => ({ ...p, dias: diasEntre(p.caducidad, h) }));
    const ingredientesCriticos = datos.materias.map(conEstado).filter((m) => m.estado !== 'OPTIMO').sort((a, b) => a.codigo.localeCompare(b.codigo))
      .map(({ codigo, nombre, unidad, stock, minimo, estado }) => ({ codigo, nombre, unidad, stock, minimo, estado }));
    const cad = armarAlertasCaducidad(filas);
    return { cabeceras: { 'Cache-Control': 'no-store' }, cuerpo: { fecha: h, diasAviso: dias, ...cad, ingredientesCriticos, total: cad.vencidos.length + cad.porVencer.length + ingredientesCriticos.length } };
  });
  ruta('GET', '/reportes/rentabilidad', ['admin', 'contador'], () => {
    const h = hoy(); const desde30 = sumarDias(h, -29);
    const mapaMp = new Map(datos.materias.map((m) => [m.codigo, m]));
    const vendidos = new Map();
    for (const v of datos.ventas.filter((x) => enRango(x.creadoEn, desde30, h))) for (const i of v.items) {
      const x = vendidos.get(i.sku) ?? { unidades: 0, ventas: 0, margen: 0 };
      x.unidades += i.cantidad; x.ventas += i.cantidad * i.precioUnitario; x.margen += i.cantidad * (i.precioUnitario - i.costoUnitario);
      vendidos.set(i.sku, x);
    }
    const lista = [...datos.productos].sort((a, b) => a.sku.localeCompare(b.sku)).map((p) => {
      const rec = datos.recetas.find((r) => r.productoSku === p.sku);
      const costoReceta = rec ? costearReceta(rec.ingredientes, mapaMp).costoUnitario : null;
      const v = vendidos.get(p.sku);
      return { sku: p.sku, nombre: p.nombre, categoria: p.categoria, precio: p.precio, costoReceta, costoPromedio: p.costoUnitario, ...margen(p.precio, costoReceta ?? p.costoUnitario),
        unidadesVendidas30Dias: v?.unidades ?? 0, ventas30Dias: r2(v?.ventas ?? 0), margen30Dias: r2(v?.margen ?? 0) };
    });
    return { cabeceras: { 'Cache-Control': 'no-store' }, cuerpo: { fecha: h, datos: lista } };
  });
  ruta('GET', '/reportes/export', ['admin', 'contador'], async ({ q, usuarioId }) => {
    const tipo = q.get('tipo'); const formato = q.get('formato');
    if (!['materias', 'productos', 'recetas', 'ventas'].includes(tipo)) throw new AppError(400, 'solicitud-invalida', 'Tipo de reporte inválido', 'Use materias, productos, recetas o ventas.');
    if (!['pdf', 'xlsx'].includes(formato)) throw new AppError(400, 'solicitud-invalida', 'Formato inválido', 'Use pdf o xlsx.');
    const h = hoy();
    const filas = tipo === 'materias' ? [...datos.materias].sort((a, b) => a.codigo.localeCompare(b.codigo))
      : tipo === 'productos' ? [...datos.productos].sort((a, b) => a.sku.localeCompare(b.sku))
        : tipo === 'recetas' ? datos.recetas.flatMap((r) => r.ingredientes.map((i) => ({ producto: producto(r.productoSku)?.nombre, ingrediente: materia(i.codigoMateriaPrima)?.nombre, cantidad: i.cantidad, unidad: i.unidad })))
          .sort((a, b) => a.producto.localeCompare(b.producto) || a.ingrediente.localeCompare(b.ingrediente))
          : datos.ventas.filter((v) => enRango(v.creadoEn, sumarDias(h, -29), h)).sort((a, b) => b.creadoEn.localeCompare(a.creadoEn) || b.id - a.id)
            .flatMap((v) => v.items.map((i) => ({
              fecha: new Intl.DateTimeFormat('sv-SE', { timeZone: ZONA, dateStyle: 'short', timeStyle: 'short' }).format(new Date(v.creadoEn)),
              venta: v.id, producto: producto(i.sku)?.nombre ?? i.sku, cantidad: i.cantidad, precio: i.precioUnitario,
              subtotal: i.cantidad * i.precioUnitario, costo: i.cantidad * i.costoUnitario, margen: i.cantidad * (i.precioUnitario - i.costoUnitario),
            })));
    const { generarArchivo } = await import('./exportar.js');
    const blob = await generarArchivo(tipo, formato, filas, { usuarioNombre: usuario(usuarioId)?.nombre ?? '', fecha: h });
    return { blob, cabeceras: { 'Content-Disposition': `attachment; filename="reporte-${tipo}-${h}.${formato}"` } };
  });

  // ---- Respaldo (solo app sin servidor): exportar e importar todos los datos del dispositivo
  ruta('GET', '/local/respaldo', ['admin'], () => {
    const resto = { ...datos }; delete resto.sesiones; // las sesiones abiertas no viajan en el respaldo
    return { blob: new Blob([JSON.stringify({ app: 'pastel-stock', exportado: ahoraISO(), datos: resto }, null, 2)], { type: 'application/json' }),
      cabeceras: { 'Content-Disposition': `attachment; filename="pastel-stock-respaldo-${hoy()}.json"` } };
  });
  ruta('POST', '/local/respaldo', ['admin'], ({ cuerpo }) => transaccion(async (d) => {
    const nuevo = cuerpo?.datos;
    exigir(cuerpo?.app === 'pastel-stock' && nuevo && nuevo.version === VERSION_DATOS, 'Respaldo inválido', 'El archivo no es un respaldo de esta versión de Pastel Stock.');
    for (const k of ['usuarios', 'materias', 'productos', 'recetas', 'movimientos', 'movimientosProducto', 'ventas']) exigir(Array.isArray(nuevo[k]), 'Respaldo incompleto', `Falta "${k}".`);
    for (const k of Object.keys(d)) delete d[k];
    Object.assign(d, structuredClone(nuevo), { sesiones: {}, claves: nuevo.claves ?? {} });
    sesiones.clear();
    return { status: 204 };
  }));
  ruta('POST', '/local/reiniciar', ['admin'], async () => {
    datos = await sembrarDemo({ ahora: reloj(), hashClave });
    sesiones.clear();
    guardar();
    return { status: 204 };
  });
  ruta('POST', '/local/contrasena', TODOS, async ({ cuerpo, usuarioId }) => {
    soloCampos(cuerpo, ['actual', 'nueva'], ['actual', 'nueva']);
    exigir(typeof cuerpo.nueva === 'string' && cuerpo.nueva.length >= 8 && cuerpo.nueva.length <= 128, 'Contraseña muy corta', 'Use al menos 8 caracteres.');
    const u = usuario(usuarioId);
    if ((await hashClave(cuerpo.actual, u.sal)) !== u.hash) throw validacion('La contraseña actual no es correcta');
    const sal = aleatorio(16); const hash = await hashClave(cuerpo.nueva, sal);
    await transaccion(async () => { u.sal = sal; u.hash = hash; });
    return { status: 204 };
  });

  // ---------------------------------------------------------------- despacho
  async function atender(metodo, ruta_, q, cuerpo, cabeceras) {
    await cargar();
    const destino = rutas.find((r) => r.metodo === metodo && r.re.test(ruta_));
    if (!destino) {
      const existe = rutas.some((r) => r.re.test(ruta_));
      throw new AppError(existe ? 405 : 404, existe ? 'metodo-no-permitido' : 'no-encontrado', existe ? 'Método no permitido' : 'Ruta no encontrada');
    }
    const p = Object.fromEntries(destino.nombres.map((n, i) => [n, decodeURIComponent(destino.re.exec(ruta_)[i + 1])]));
    let usuarioId = null;
    if (destino.roles) {
      const token = /^Bearer (.+)$/.exec(cabeceras.authorization ?? '')?.[1];
      usuarioId = token ? sesiones.get(token) : undefined;
      const u = usuarioId && usuario(usuarioId);
      if (!u) throw noAutenticado();
      if (!destino.roles.includes(u.rol)) throw prohibido();
    }
    if (p.codigo !== undefined && !RE_MP.test(p.codigo)) throw validacion('Parámetro "codigo" inválido', 'Use el formato MP001.');
    if (p.sku !== undefined && !RE_PT.test(p.sku)) throw validacion('Parámetro "sku" inválido', 'Use el formato PT001.');
    if (p.id !== undefined && !/^[1-9]\d{0,8}$/.test(p.id)) throw validacion('Identificador inválido', 'Debe ser un entero positivo.');
    return destino.manejador({ p, q, cuerpo, usuarioId, req: { cabeceras } });
  }

  /** Implementación de `fetch` para el cliente de la API: misma forma de petición y respuesta que el servidor real. */
  async function fetchLocal(url, init = {}) {
    const u = new URL(url, 'http://local');
    const ruta_ = u.pathname.replace(/^\/api\/v1/, '');
    const cabeceras = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const metodo = (init.method ?? 'GET').toUpperCase();
    try {
      let cuerpo;
      if (init.body !== undefined && init.body !== null) {
        try { cuerpo = JSON.parse(init.body); } catch { throw new AppError(400, 'json-invalido', 'El cuerpo no es JSON válido'); }
      }
      const r = await atender(metodo, ruta_, u.searchParams, cuerpo, cabeceras);
      const status = r.status ?? 200;
      if (r.blob) return new Response(r.blob, { status, headers: { 'Content-Type': r.blob.type, ...r.cabeceras } });
      if (status === 204) return new Response(null, { status });
      return new Response(JSON.stringify(r.cuerpo), { status, headers: { 'Content-Type': 'application/json', ...r.cabeceras } });
    } catch (e) {
      const err = e instanceof AppError ? e : new AppError(500, 'error-interno', 'Error interno', e?.message);
      if (!(e instanceof AppError)) console.error('[servidor local]', e); // eslint-disable-line no-console
      const problema = { type: `/errores/${err.slug}`, title: err.title, status: err.status, ...(err.detail ? { detail: err.detail } : {}), instance: ruta_, ...err.extra };
      return new Response(JSON.stringify(problema), { status: err.status, headers: { 'Content-Type': 'application/problem+json' } });
    }
  }

  return { fetch: fetchLocal, cargar, datos: () => datos };
}

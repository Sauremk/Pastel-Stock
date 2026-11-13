// Componentes de interfaz reutilizables: toasts, modales accesibles, confirmación, formularios, tablas, paginador.
import { h, reemplazarHijos } from './dom.js';
import { mensajeDeError } from './format.js';

export { h, reemplazarHijos };

// ---------------------------------------------------------------- Toasts
const ICONOS_TOAST = { success: '✅', error: '❌', warning: '⚠️' };

export function toast(mensaje, tipo = 'success') {
  const contenedor = document.getElementById('toast-container');
  if (!contenedor) return;
  const el = h('div', { class: ['toast', tipo !== 'success' ? tipo : ''], role: tipo === 'error' ? 'alert' : 'status' },
    h('span', { 'aria-hidden': 'true' }, ICONOS_TOAST[tipo] ?? ICONOS_TOAST.success),
    h('span', {}, mensaje));
  contenedor.appendChild(el);
  const duracion = tipo === 'error' ? 6000 : 3500;
  setTimeout(() => {
    el.style.animation = 'slideInRight 0.3s ease reverse';
    setTimeout(() => el.remove(), 300);
  }, duracion);
}

export const toastError = (error) => toast(mensajeDeError(error), 'error');

// ---------------------------------------------------------------- Modales
const pila = [];
let contadorModal = 0;
const SELECTOR_ENFOCABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function actualizarFondoInerte() {
  const app = document.getElementById('app-container');
  const login = document.getElementById('login-screen');
  const hay = pila.length > 0;
  for (const nodo of [app, login]) {
    if (!nodo) continue;
    if (hay) nodo.setAttribute('inert', ''); else nodo.removeAttribute('inert');
  }
  document.body.classList.toggle('modal-abierto', hay);
}

/**
 * Abre un diálogo modal accesible (role=dialog, foco atrapado, Escape y clic fuera cierran, devuelve el foco).
 * @returns {{ cerrar: (resultado?: any) => void, el: HTMLElement }}
 */
export function abrirModal({ titulo, contenido, ancho = 600, alCerrar } = {}) {
  const previo = document.activeElement;
  const idTitulo = `modal-titulo-${++contadorModal}`;
  let cerrado = false;

  const btnCerrar = h('button', { type: 'button', class: 'close', 'aria-label': 'Cerrar', onClick: () => cerrar() }, '×');
  const caja = h('div', {
    class: 'modal-content', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': idTitulo, tabindex: '-1',
    style: { maxWidth: `${ancho}px` },
  },
  h('div', { class: 'modal-header' }, h('h2', { id: idTitulo }, titulo), btnCerrar),
  contenido);

  const fondo = h('div', { class: 'modal active', onMousedown: (e) => { if (e.target === fondo) cerrar(); } }, caja);

  // El teclado se escucha en `document`: si el botón enfocado se deshabilita (guardando…) el foco pasa a <body>
  // y un listener solo en el modal dejaría de recibir Escape.
  function alTeclear(e) {
    if (pila[pila.length - 1] !== entrada) return;
    if (e.key === 'Escape') { e.stopPropagation(); cerrar(); return; }
    if (e.key !== 'Tab') return;
    const enfocables = [...caja.querySelectorAll(SELECTOR_ENFOCABLE)].filter((n) => n.offsetParent !== null || n === btnCerrar);
    if (enfocables.length === 0) { e.preventDefault(); caja.focus(); return; }
    const primero = enfocables[0];
    const ultimo = enfocables[enfocables.length - 1];
    const dentro = caja.contains(document.activeElement);
    if (!dentro) { e.preventDefault(); (e.shiftKey ? ultimo : primero).focus(); }
    else if (e.shiftKey && (document.activeElement === primero || document.activeElement === caja)) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  }
  document.addEventListener('keydown', alTeclear);

  function cerrar(resultado) {
    if (cerrado) return;
    cerrado = true;
    document.removeEventListener('keydown', alTeclear);
    const i = pila.indexOf(entrada);
    if (i >= 0) pila.splice(i, 1);
    fondo.remove();
    actualizarFondoInerte();
    if (previo && typeof previo.focus === 'function' && document.contains(previo)) previo.focus();
    alCerrar?.(resultado);
  }

  const entrada = { cerrar };
  pila.push(entrada);
  document.getElementById('modal-root').appendChild(fondo);
  actualizarFondoInerte();

  const inicial = caja.querySelector('[autofocus], input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])')
    ?? [...caja.querySelectorAll('button:not(.close)')].pop() ?? caja;
  inicial.focus();

  return { cerrar, el: caja };
}

/** Diálogo de confirmación. Resuelve true solo si se pulsa el botón de aceptar. */
export function confirmar({ titulo = 'Confirmar', mensaje, textoAceptar = 'Eliminar', peligro = true }) {
  return new Promise((resolver) => {
    let decidido = false;
    const decidir = (valor) => { if (!decidido) { decidido = true; resolver(valor); } };
    const aceptar = h('button', { type: 'button', class: ['btn', peligro ? 'btn-danger' : ''], onClick: () => { decidir(true); modal.cerrar(); } }, textoAceptar);
    const cancelar = h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => modal.cerrar() }, 'Cancelar');
    const modal = abrirModal({
      titulo,
      ancho: 420,
      contenido: h('div', {}, h('p', { class: 'ayuda mensaje-confirmacion' }, mensaje), h('div', { class: 'form-acciones' }, cancelar, aceptar)),
      alCerrar: () => decidir(false),
    });
    cancelar.focus();
  });
}

// ---------------------------------------------------------------- Estados de carga / vacío / error
export function cargando(texto = 'Cargando…') {
  return h('div', { class: 'estado-carga', role: 'status' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('span', {}, texto));
}

export function vacio(texto, icono = '🧁') {
  return h('div', { class: 'vacio' }, h('span', { class: 'icono-vacio', 'aria-hidden': 'true' }, icono), h('p', {}, texto));
}

export function bannerError(error, alReintentar) {
  return h('div', { class: 'banner-error', role: 'alert' },
    h('span', {}, mensajeDeError(error)),
    alReintentar ? h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onClick: alReintentar }, 'Reintentar') : null);
}

// ---------------------------------------------------------------- Formularios
let contadorCampo = 0;

/**
 * Grupo etiqueta + control + ayuda + error. Devuelve { grupo, control, error(texto) }.
 * El control debe crearse con el mismo id (usa `idCampo()` para generarlo).
 */
export function idCampo(prefijo = 'campo') { return `${prefijo}-${++contadorCampo}`; }

export function campo({ id, etiqueta, requerido = false, ayuda, control }) {
  const idError = `${id}-error`;
  const idAyuda = `${id}-ayuda`;
  const msg = h('p', { class: 'error-campo', id: idError, role: 'alert' });
  control.setAttribute('id', id);
  control.setAttribute('aria-describedby', [ayuda ? idAyuda : null, idError].filter(Boolean).join(' '));
  const grupo = h('div', { class: 'form-group' },
    h('label', { for: id }, etiqueta, requerido ? h('span', { class: 'requerido', 'aria-hidden': 'true' }, ' *') : null),
    control,
    ayuda ? h('p', { class: 'ayuda', id: idAyuda }, ayuda) : null,
    msg);
  const limpiar = () => { if (msg.textContent) { msg.textContent = ''; control.removeAttribute('aria-invalid'); } };
  control.addEventListener('input', limpiar);
  control.addEventListener('change', limpiar);
  return {
    grupo,
    control,
    error(texto) {
      msg.textContent = texto ?? '';
      if (texto) control.setAttribute('aria-invalid', 'true'); else control.removeAttribute('aria-invalid');
    },
  };
}

export function opciones(lista, { placeholder } = {}) {
  const items = lista.map((o) => (typeof o === 'string' ? { valor: o, texto: o } : o));
  return [
    placeholder !== undefined ? h('option', { value: '' }, placeholder) : null,
    ...items.map((o) => h('option', { value: o.valor }, o.texto)),
  ];
}

export function selectControl(lista, { valor = '', placeholder, ...props } = {}) {
  return h('select', { ...props, value: valor }, ...opciones(lista, { placeholder }));
}

/** Marca errores de un objeto { campo: mensaje } sobre un mapa { campo: campoHelper }. */
export function mostrarErrores(campos, errores) {
  for (const [nombre, c] of Object.entries(campos)) c.error(errores?.[nombre] ?? '');
  const primero = Object.keys(campos).find((n) => errores?.[n]);
  if (primero) campos[primero].control.focus();
}

/** Bloque de error general de un formulario (errores del servidor: 409/422). */
export function crearAvisoFormulario() {
  const el = h('div', { class: 'banner-error', role: 'alert', hidden: true });
  return {
    el,
    mostrar(texto) { el.textContent = texto; el.hidden = false; },
    ocultar() { el.textContent = ''; el.hidden = true; },
  };
}

/** Deshabilita un botón mientras corre una promesa. */
export async function conBotonOcupado(boton, promesaFn, textoOcupado = 'Guardando…') {
  const original = boton.textContent;
  boton.disabled = true;
  boton.textContent = textoOcupado;
  try { return await promesaFn(); } finally {
    boton.disabled = false;
    boton.textContent = original;
    // Al deshabilitarse, el botón pierde el foco: se devuelve para no perder el contexto del teclado.
    if (boton.isConnected && document.activeElement === document.body) boton.focus();
  }
}

// ---------------------------------------------------------------- Tablas y paginación
/** columnas: [{ titulo, num?: boolean }]; filas: [{ celdas: [Node|string], clase?: string }] */
export function tabla({ columnas, filas, descripcion, pie }) {
  return h('div', { class: 'table-container' },
    h('table', {},
      descripcion ? h('caption', { class: 'sr-only' }, descripcion) : null,
      h('thead', {}, h('tr', {}, ...columnas.map((c) => h('th', { scope: 'col', class: c.num ? 'num' : null }, c.titulo)))),
      h('tbody', {}, ...filas.map((f) => h('tr', { class: f.clase },
        // data-label: en móvil cada fila se pinta como tarjeta y la celda muestra el nombre de su columna.
        ...f.celdas.map((celda, i) => h('td', { class: columnas[i]?.num ? 'num' : null, 'data-label': columnas[i]?.titulo ?? '' }, celda))))),
      pie ? h('tfoot', {}, h('tr', {}, ...pie.map((c, i) => h('td', { class: columnas[i]?.num ? 'num' : null, 'data-label': columnas[i]?.titulo ?? '' }, c)))) : null));
}

export function insignia(texto, clase) {
  return h('span', { class: ['estado', clase] }, texto);
}

export function paginador({ pagina, limite, total, alCambiar }) {
  const paginas = Math.max(1, Math.ceil(total / limite));
  const desde = total === 0 ? 0 : (pagina - 1) * limite + 1;
  const hasta = Math.min(total, pagina * limite);
  return h('nav', { class: 'paginador', 'aria-label': 'Paginación' },
    h('span', { 'aria-live': 'polite' }, `${desde}–${hasta} de ${total} · Página ${pagina} de ${paginas}`),
    h('div', { class: 'botones' },
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', disabled: pagina <= 1, onClick: () => alCambiar(pagina - 1) }, '← Anterior'),
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', disabled: pagina >= paginas, onClick: () => alCambiar(pagina + 1) }, 'Siguiente →')));
}

/** Evita llamadas repetidas mientras el usuario escribe. */
export function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---------------------------------------------------------------- Descargas
export function descargarArchivo(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const enlace = h('a', { href: url, download: nombre });
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function encabezadoVista(titulo, ...extra) {
  const subtitulo = typeof extra[0] === 'string' ? extra.shift() : null;
  return h('div', { class: 'header' },
    h('div', {}, h('h1', { tabindex: '-1' }, titulo), subtitulo ? h('p', { class: 'subtitulo' }, subtitulo) : null),
    ...extra);
}

/** Pestañas de la sección Inventario (Ingredientes · Productos · Entradas): tres pantallas, un solo lugar en el menú. */
export function pestanasInventario(actual) {
  const pestanas = [['materias', '🧂', 'Ingredientes'], ['productos', '🎂', 'Productos'], ['movimientos', '📦', 'Entradas']];
  return h('nav', { class: 'pestanas', 'aria-label': 'Secciones del inventario' },
    ...pestanas.map(([vista, icono, texto]) => h('a', { class: 'pestana', href: `#/${vista}`, 'aria-current': vista === actual ? 'page' : null },
      h('span', { 'aria-hidden': 'true' }, icono), texto)));
}

/** Siguiente código libre con un prefijo (MP006, PT005): la persona no tiene que inventarlo. */
export function siguienteCodigo(prefijo, existentes) {
  const max = existentes.map((c) => Number(String(c).replace(prefijo, ''))).filter(Number.isFinite).reduce((a, b) => Math.max(a, b), 0);
  return `${prefijo}${String(max + 1).padStart(3, '0')}`;
}

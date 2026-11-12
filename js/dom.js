// Construcción segura de DOM (corrige DT-03: nunca se usa innerHTML con datos).
// `h` crea nodos con createElement/textContent; los textos siempre son texto, jamás HTML.

const PROPIEDADES_BLOQUEADAS = new Set(['innerhtml', 'outerhtml', 'srcdoc', 'insertadjacenthtml']);
const ATRIBUTOS_BOOLEANOS = new Set([
  'disabled', 'hidden', 'required', 'readonly', 'multiple', 'open', 'autofocus', 'novalidate', 'inert',
]);
const ATRIBUTOS_URL = new Set(['href', 'src', 'action', 'formaction', 'xlink:href']);

/** Escapa texto para contextos HTML (solo para textos fuera del DOM, p. ej. mensajes de log). */
export function escapeHtml(valor) {
  return String(valor ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Indica si una URL es ejecutable (javascript:, vbscript:) aunque lleve espacios o caracteres de control. */
export function urlPeligrosa(valor) {
  // eslint-disable-next-line no-control-regex
  const limpia = String(valor).replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase();
  return limpia.startsWith('javascript:') || limpia.startsWith('vbscript:') || limpia.startsWith('data:text/html');
}

const esNodo = (x) => x !== null && typeof x === 'object' && 'nodeType' in x;

/** Fábrica de `h` para un `document` dado (permite probarla en Node con un documento falso). */
export function crearH(doc) {
  function agregar(padre, hijo) {
    if (hijo === null || hijo === undefined || hijo === false || hijo === true) return;
    if (Array.isArray(hijo)) { hijo.forEach((x) => agregar(padre, x)); return; }
    if (esNodo(hijo)) { padre.appendChild(hijo); return; }
    padre.appendChild(doc.createTextNode(String(hijo)));
  }

  return function h(etiqueta, props, ...hijos) {
    if (props !== null && props !== undefined && (typeof props !== 'object' || Array.isArray(props) || esNodo(props))) {
      hijos.unshift(props);
      props = null;
    }
    const el = doc.createElement(etiqueta);
    let valorDiferido; // `value` se asigna al final: los <option> ya deben existir
    let tieneValor = false;

    for (const [clave, valor] of Object.entries(props ?? {})) {
      const k = clave.toLowerCase();
      if (PROPIEDADES_BLOQUEADAS.has(k)) throw new Error(`h(): la propiedad ${clave} está prohibida (riesgo XSS)`);
      if (valor === null || valor === undefined) continue;

      if (k === 'class' || k === 'classname') {
        const texto = Array.isArray(valor) ? valor.filter(Boolean).join(' ') : String(valor);
        if (texto) el.setAttribute('class', texto);
      } else if (k === 'dataset') {
        for (const [d, v] of Object.entries(valor)) {
          if (v === null || v === undefined || v === false) continue;
          el.setAttribute(`data-${d.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`, String(v));
        }
      } else if (k === 'style') {
        if (typeof valor === 'object') Object.assign(el.style, valor);
        else el.setAttribute('style', String(valor));
      } else if (k.startsWith('on')) {
        if (typeof valor !== 'function') throw new Error(`h(): ${clave} debe ser una función, no texto (riesgo XSS)`);
        el.addEventListener(k.slice(2), valor);
      } else if (k === 'value') {
        valorDiferido = valor; tieneValor = true;
      } else if (k === 'checked' || k === 'selected') {
        el[k] = Boolean(valor);
      } else if (ATRIBUTOS_BOOLEANOS.has(k)) {
        if (valor) el.setAttribute(clave, '');
      } else if (ATRIBUTOS_URL.has(k) && urlPeligrosa(valor)) {
        throw new Error(`h(): URL no permitida en ${clave}`);
      } else if (valor === false) {
        continue;
      } else if (valor === true) {
        el.setAttribute(clave, '');
      } else {
        el.setAttribute(clave, String(valor));
      }
    }

    hijos.forEach((hijo) => agregar(el, hijo));
    if (tieneValor) el.value = String(valorDiferido);
    return el;
  };
}

/** `h` ligado al `document` del navegador (se resuelve al llamar, no al importar). */
export function h(...args) {
  return crearH(globalThis.document)(...args);
}

/** Vacía un nodo y agrega nuevos hijos (sin innerHTML). */
export function reemplazarHijos(el, ...hijos) {
  const nodos = hijos.flat(Infinity)
    .filter((x) => x !== null && x !== undefined && x !== false && x !== true)
    .map((x) => (esNodo(x) ? x : globalThis.document.createTextNode(String(x))));
  el.replaceChildren(...nodos);
  return el;
}

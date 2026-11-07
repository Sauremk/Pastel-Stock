import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearH, escapeHtml, urlPeligrosa } from '../../web/js/dom.js';

// Documento falso mínimo: lo justo para comprobar que `h` usa nodos de texto y atributos, nunca HTML.
class Nodo {
  constructor(tipo, nombre) { this.nodeType = tipo; this.nombre = nombre; this.hijos = []; this.attrs = {}; this.oyentes = {}; this.style = {}; }
  appendChild(n) { this.hijos.push(n); return n; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(ev, fn) { this.oyentes[ev] = fn; }
  get textoPlano() { return this.nodeType === 3 ? this.texto : this.hijos.map((h) => h.textoPlano).join(''); }
}
const doc = {
  createElement: (t) => new Nodo(1, t),
  createTextNode: (t) => { const n = new Nodo(3, '#text'); n.texto = t; return n; },
};
const h = crearH(doc);

test('h: el contenido siempre es texto, nunca HTML (DT-03)', () => {
  const peligro = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const el = h('td', {}, peligro);
  assert.equal(el.hijos.length, 1);
  assert.equal(el.hijos[0].nodeType, 3);
  assert.equal(el.textoPlano, peligro);
  assert.equal(el.hijos.some((n) => n.nombre === 'img' || n.nombre === 'script'), false);
});

test('h: props opcionales y anidación', () => {
  const el = h('div', h('span', {}, 'a'), 'b', 7, null, undefined, false, true, [h('i', {}, 'c'), ['d']]);
  assert.equal(el.textoPlano, 'ab7cd');
  assert.equal(el.hijos.length, 5);
});

test('h: class (texto o lista), data-*, booleanos y atributos', () => {
  const el = h('button', { class: ['btn', false, 'btn-sm', null], dataset: { vistaActual: 'x', ocultar: false }, disabled: true, hidden: false, 'aria-label': 'Cerrar', type: 'button' }, 'ok');
  assert.equal(el.attrs.class, 'btn btn-sm');
  assert.equal(el.attrs['data-vista-actual'], 'x');
  assert.equal('data-ocultar' in el.attrs, false);
  assert.equal('disabled' in el.attrs, true);
  assert.equal('hidden' in el.attrs, false);
  assert.equal(el.attrs['aria-label'], 'Cerrar');
});

test('h: manejadores solo como funciones', () => {
  let n = 0;
  const el = h('button', { onClick: () => { n += 1; } });
  el.oyentes.click();
  assert.equal(n, 1);
  assert.throws(() => h('button', { onclick: 'alert(1)' }), /función/);
  assert.throws(() => h('img', { onerror: 'alert(1)' }), /función/);
});

test('h: propiedades de HTML crudo prohibidas', () => {
  for (const p of ['innerHTML', 'outerHTML', 'srcdoc', 'insertAdjacentHTML']) {
    assert.throws(() => h('div', { [p]: '<b>x</b>' }), /prohibida/);
  }
});

test('h: URLs javascript: bloqueadas, incluso ofuscadas', () => {
  assert.throws(() => h('a', { href: 'javascript:alert(1)' }), /URL no permitida/);
  assert.throws(() => h('a', { href: ' JaVa\tScRiPt:alert(1)' }), /URL no permitida/);
  assert.throws(() => h('iframe', { src: 'data:text/html,<script>1</script>' }), /URL no permitida/);
  assert.doesNotThrow(() => h('a', { href: 'https://ejemplo.co/x?a=1' }));
  assert.doesNotThrow(() => h('a', { href: 'blob:https://ejemplo.co/uuid', download: 'a.pdf' }));
  assert.equal(urlPeligrosa('javascript:1'), true);
  assert.equal(urlPeligrosa('/api/v1/x'), false);
});

test('h: value se asigna después de crear los hijos (select con option)', () => {
  const el = h('select', { value: 'g' }, h('option', { value: 'g' }, 'Gramos'));
  assert.equal(el.value, 'g');
  assert.equal(el.hijos.length, 1);
});

test('escapeHtml', () => {
  assert.equal(escapeHtml(`<a href="x" onclick='y'>&</a>`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(42), '42');
});

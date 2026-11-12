// Guía corta para quien usa la app por primera vez. Se muestra sola la primera vez (en el Inicio)
// y siempre desde «¿Cómo se usa?» en el menú.
import { h, abrirModal } from '../ui.js';

export const PASOS = [
  ['🛒', 'Cuando vendas', 'Toca «Vender» y luego «Registrar venta». Elige el producto y la cantidad. El sistema descuenta lo vendido.'],
  ['🧁', 'Cuando hornees', 'Toca «Hornear» y elige qué hiciste. Los ingredientes se descuentan solos según la receta.'],
  ['📦', 'Cuando lleguen ingredientes', 'Toca «Inventario», pestaña «Entradas», y anota lo que llegó.'],
  ['🔔', 'Cada mañana', 'Mira «Avisos»: ahí sale lo que está por vencer y los ingredientes que se están acabando.'],
];

export function listaPasos() {
  return h('ol', { class: 'guia-pasos' }, ...PASOS.map(([icono, titulo, texto], i) => h('li', { class: 'guia-paso', style: { '--i': String(i) } },
    h('span', { class: 'guia-icono', 'aria-hidden': 'true' }, icono),
    h('div', {}, h('strong', {}, titulo), h('p', {}, texto)))));
}

export function mostrarAyuda() {
  const listo = h('button', { type: 'button', class: 'btn btn-block', onClick: () => modal.cerrar() }, '¡Entendido!');
  const modal = abrirModal({
    titulo: '¿Cómo se usa Pastel Stock?',
    contenido: h('div', {}, h('p', { class: 'guia-intro' }, 'Solo necesitas cuatro cosas:'), listaPasos(),
      h('p', { class: 'ayuda', style: { margin: '12px 0' } }, 'Si te equivocas, no pasa nada: en «Inventario» puedes contar y corregir la cantidad de cualquier cosa.'), listo),
    ancho: 560,
  });
}

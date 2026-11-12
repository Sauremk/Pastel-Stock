// Alertas (v1.1): productos vencidos o por vencer con su valor en riesgo, e insumos bajo el mínimo.
import { h, reemplazarHijos, cargando, vacio, bannerError, insignia, encabezadoVista, selectControl } from '../ui.js';
import { formatoCOP, formatoFecha, formatoNumero, infoEstado } from '../format.js';
import { abrirAjuste } from './ajuste.js';

const textoDias = (d) => (d < 0 ? `Venció hace ${-d} día${d === -1 ? '' : 's'}` : d === 0 ? 'Vence hoy' : `Vence en ${d} día${d === 1 ? '' : 's'}`);

export function crearVista(ctx) {
  const { api, auth } = ctx;
  const puedeAjustar = auth.puede('ajustes');
  let dias = 3;
  let marcaCarga = 0;
  const cuerpo = h('div', {});
  const selDias = selectControl([{ valor: '1', texto: '1 día' }, { valor: '3', texto: '3 días' }, { valor: '7', texto: '7 días' }, { valor: '14', texto: '14 días' }],
    { valor: '3', class: 'filter-select', 'aria-label': 'Ventana de aviso de caducidad' });
  selDias.value = '3';
  selDias.addEventListener('change', () => { dias = Number(selDias.value); cargar(); });

  const el = h('section', { class: 'vista activa', 'aria-labelledby': 'titulo-alertas' },
    encabezadoVista('Alertas', 'Lo que necesita atención hoy: vencimientos e insumos por reponer.', h('label', { class: 'control-cabecera' }, 'Avisar con', selDias, 'de anticipación')),
    cuerpo);
  el.querySelector('h1').id = 'titulo-alertas';

  const darDeBaja = (p, todo) => abrirAjuste({
    api, tipo: 'producto', item: p, motivo: 'VENCIMIENTO', stockContado: todo ? 0 : undefined,
    alTerminar: () => { ctx.refrescarAlertas?.(); cargar(); },
  });

  function itemProducto(p, vencido) {
    return h('div', { class: ['alerta-item', vencido ? 'vencido' : null] },
      h('div', { class: 'titulo' }, p.nombre, h('span', { class: 'sub solo-lectura' }, ` ${p.sku} · ${p.categoria}`)),
      insignia(textoDias(p.diasRestantes), vencido ? 'vencido' : 'por-vencer'),
      h('span', { class: 'dato' }, `${formatoNumero(p.stock)} und · caduca ${formatoFecha(p.caducidad)}`),
      h('span', { class: 'dato' }, `En riesgo: ${formatoCOP(p.valorACosto)} a costo · ${formatoCOP(p.valorAPrecio)} a precio`),
      puedeAjustar
        ? h('button', { type: 'button', class: ['btn', 'btn-sm', vencido ? 'btn-danger' : 'btn-secondary'], onClick: () => darDeBaja(p, vencido) }, vencido ? 'Dar de baja' : 'Registrar baja')
        : null);
  }

  function pintar(a) {
    const seccion = (titulo, nodos, mensajeVacio) => h('div', { class: 'panel' },
      h('div', { class: 'panel-header' }, h('h2', {}, titulo)),
      nodos.length ? h('div', { class: 'grupo-alertas' }, ...nodos) : vacio(mensajeVacio, '✅'));
    reemplazarHijos(cuerpo,
      h('div', { class: 'kpis' },
        h('div', { class: ['kpi', a.vencidos.length ? 'alerta' : null] }, h('h3', {}, 'Vencidos con stock'), h('div', { class: 'valor' }, String(a.vencidos.length)), h('div', { class: 'nota' }, 'No se pueden vender')),
        h('div', { class: ['kpi', a.porVencer.length ? 'aviso' : null] }, h('h3', {}, `Por vencer (≤ ${a.diasAviso} días)`), h('div', { class: 'valor' }, String(a.porVencer.length)), h('div', { class: 'nota' }, 'Priorízalos en mostrador')),
        h('div', { class: 'kpi' }, h('h3', {}, 'Valor en riesgo'), h('div', { class: 'valor' }, formatoCOP(a.valorEnRiesgoACosto)), h('div', { class: 'nota' }, 'A costo de producción')),
        h('div', { class: ['kpi', a.ingredientesCriticos.length ? 'aviso' : null] }, h('h3', {}, 'Insumos por reponer'), h('div', { class: 'valor' }, String(a.ingredientesCriticos.length)), h('div', { class: 'nota' }, 'Bajo o en estado crítico'))),
      seccion('⛔ Vencidos', a.vencidos.map((p) => itemProducto(p, true)), 'No hay productos vencidos con stock.'),
      seccion('⏳ Por vencer', a.porVencer.map((p) => itemProducto(p, false)), `Nada vence en los próximos ${a.diasAviso} días.`),
      seccion('🧂 Insumos por reponer', a.ingredientesCriticos.map((m) => {
        const e = infoEstado(m.estado);
        return h('div', { class: ['alerta-item', m.estado === 'CRITICO' ? 'critico' : null] },
          h('div', { class: 'titulo' }, m.nombre, h('span', { class: 'sub solo-lectura' }, ` ${m.codigo}`)),
          insignia(e.texto, e.clase),
          h('span', { class: 'dato' }, `Hay ${formatoNumero(m.stock)} ${m.unidad} · mínimo ${formatoNumero(m.minimo)} ${m.unidad}`),
          auth.puede('movimientos') ? h('a', { class: 'btn btn-secondary btn-sm', href: '#/movimientos' }, 'Registrar entrada') : null);
      }), 'Todos los insumos están por encima de su mínimo.'));
  }

  async function cargar() {
    const marca = ++marcaCarga;
    reemplazarHijos(cuerpo, cargando('Revisando vencimientos e insumos…'));
    try {
      const a = await api.get('/reportes/alertas', { dias });
      if (marca === marcaCarga) pintar(a);
    } catch (e) {
      if (marca === marcaCarga) reemplazarHijos(cuerpo, bannerError(e, cargar));
    }
  }

  return { el, titulo: 'Alertas', cargar, destruir() { marcaCarga++; } };
}

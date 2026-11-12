// Costos y márgenes (v1.1, admin y contador): costo por receta, costo promedio real y margen de cada producto.
import { h, reemplazarHijos, cargando, vacio, bannerError, tabla, insignia, encabezadoVista } from '../ui.js';
import { formatoCOP, formatoNumero } from '../format.js';
import { botonesExportar } from './exportar.js';

const UMBRAL_BAJO = 40; // % de margen bruto bajo el cual se resalta el producto

export function crearVista(ctx) {
  const { api } = ctx;
  let marcaCarga = 0;
  const cuerpo = h('div', {});
  const el = h('section', { class: 'vista activa', 'aria-labelledby': 'titulo-rentabilidad' },
    encabezadoVista('Costos y márgenes', 'Costo estándar con los precios actuales de los insumos y lo vendido en los últimos 30 días.',
      h('div', { class: 'panel-actions' }, botonesExportar(ctx, 'ventas'))),
    cuerpo);
  el.querySelector('h1').id = 'titulo-rentabilidad';

  function pintar({ datos }) {
    if (datos.length === 0) { reemplazarHijos(cuerpo, vacio('Aún no hay productos.', '📈')); return; }
    const totalVentas = datos.reduce((a, d) => a + d.ventas30Dias, 0);
    const totalMargen = datos.reduce((a, d) => a + d.margen30Dias, 0);
    const bajos = datos.filter((d) => d.margenPorcentaje !== null && d.margenPorcentaje < UMBRAL_BAJO);
    const mejor = [...datos].sort((a, b) => b.margen30Dias - a.margen30Dias)[0];
    reemplazarHijos(cuerpo,
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi destacado' }, h('h3', {}, 'Margen bruto (30 días)'), h('div', { class: 'valor' }, formatoCOP(totalMargen)),
          h('div', { class: 'nota' }, totalVentas > 0 ? `${formatoNumero(Math.round((totalMargen / totalVentas) * 1000) / 10)} % sobre ${formatoCOP(totalVentas)} vendidos` : 'Sin ventas en 30 días')),
        h('div', { class: 'kpi' }, h('h3', {}, 'Producto que más deja'), h('div', { class: 'valor', style: { fontSize: '20px' } }, mejor.margen30Dias > 0 ? mejor.nombre : '—'),
          h('div', { class: 'nota' }, mejor.margen30Dias > 0 ? `${formatoCOP(mejor.margen30Dias)} de margen` : '')),
        h('div', { class: ['kpi', bajos.length ? 'aviso' : 'tendencia-up'] }, h('h3', {}, `Margen menor al ${UMBRAL_BAJO} %`), h('div', { class: 'valor' }, String(bajos.length)),
          h('div', { class: 'nota' }, bajos.length ? bajos.map((b) => b.nombre).join(', ') : 'Todos los precios cubren bien su costo'))),
      h('div', { class: 'panel' },
        h('div', { class: 'panel-header' }, h('h2', {}, 'Por producto')),
        tabla({
          descripcion: 'Costo, margen y ventas por producto',
          columnas: [{ titulo: 'Producto' }, { titulo: 'Precio', num: true }, { titulo: 'Costo receta', num: true }, { titulo: 'Costo promedio', num: true },
            { titulo: 'Margen unit.', num: true }, { titulo: 'Vendidas 30 d', num: true }, { titulo: 'Margen 30 d', num: true }],
          filas: datos.map((d) => ({ celdas: [
            h('span', {}, d.nombre, h('span', { class: 'sub' }, `${d.sku} · ${d.categoria}`)),
            formatoCOP(d.precio),
            d.costoReceta === null ? h('span', { class: 'solo-lectura' }, 'Sin receta') : formatoCOP(d.costoReceta),
            formatoCOP(d.costoPromedio),
            h('span', {}, formatoCOP(d.margenUnitario), ' ',
              d.margenPorcentaje === null ? null : insignia(`${formatoNumero(d.margenPorcentaje)} %`, d.margenPorcentaje < 0 ? 'vencido' : d.margenPorcentaje < UMBRAL_BAJO ? 'por-vencer' : 'vigente')),
            formatoNumero(d.unidadesVendidas30Dias),
            formatoCOP(d.margen30Dias),
          ] })),
          pie: ['Total', '', '', '', '', formatoNumero(datos.reduce((a, d) => a + d.unidadesVendidas30Dias, 0)), formatoCOP(totalMargen)],
        }),
        h('p', { class: 'ayuda' }, 'El margen unitario usa el costo de la receta con los precios actuales de los insumos; si el producto no tiene receta, usa su costo promedio. El margen de 30 días usa el costo congelado en cada venta.')));
  }

  async function cargar() {
    const marca = ++marcaCarga;
    reemplazarHijos(cuerpo, cargando('Calculando costos…'));
    try {
      const r = await api.get('/reportes/rentabilidad');
      if (marca === marcaCarga) pintar(r);
    } catch (e) { if (marca === marcaCarga) reemplazarHijos(cuerpo, bannerError(e, cargar)); }
  }

  return { el, titulo: 'Costos y márgenes', cargar, destruir() { marcaCarga++; } };
}

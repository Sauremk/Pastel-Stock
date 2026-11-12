// Tablero: KPI y gráficos calculados desde datos reales. v1.1: ventas, margen y ROI salen de las ventas registradas.
import { h, reemplazarHijos, cargando, bannerError, vacio, tabla, insignia, encabezadoVista } from '../ui.js';
import { formatoCOP, formatoCOPCorto, formatoNumero, infoEstado, formatoFecha } from '../format.js';

const PALETA = ['#8A3B12', '#B8336A', '#1F7A4D', '#D08A2E', '#2E5AAC', '#6B4A36'];
const porcentaje = (v) => (v === null || v === undefined ? '—' : `${formatoNumero(v)} %`);

function colorTexto() {
  return getComputedStyle(document.documentElement).getPropertyValue('--color-texto').trim() || '#1F2937';
}
function colorBorde() {
  return getComputedStyle(document.documentElement).getPropertyValue('--color-borde').trim() || '#E5E7EB';
}

function kpi({ icono, titulo, valor, nota, clase, enlace }) {
  return h(enlace ? 'a' : 'div', { class: ['kpi', clase], href: enlace, style: enlace ? { textDecoration: 'none', color: 'inherit' } : null },
    h('div', { class: 'icono', 'aria-hidden': 'true' }, icono),
    h('h3', {}, titulo),
    h('div', { class: 'valor' }, valor),
    nota ? h('div', { class: 'nota' }, nota) : null);
}

function tarjetaGrafico(titulo, idCanvas, descripcion) {
  const canvas = h('canvas', { id: idCanvas, role: 'img', 'aria-label': descripcion });
  return { canvas, el: h('div', { class: 'chart-container' }, h('h3', {}, titulo), h('div', { class: 'chart-box' }, canvas)) };
}

export function crearVista(ctx) {
  const { api } = ctx;
  const cuerpo = h('div', {});
  const hoy = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
  const el = h('section', { class: 'vista activa', 'aria-labelledby': 'titulo-dashboard' },
    encabezadoVista('Tablero principal', h('div', { class: 'fecha' }, `📅 ${hoy}`)),
    cuerpo);
  el.querySelector('h1').id = 'titulo-dashboard';

  let graficos = [];
  let datos = null;
  let ultimaCarga = 0;

  function destruirGraficos() {
    graficos.forEach((g) => g.destroy());
    graficos = [];
  }

  function dibujarGraficos(refs) {
    destruirGraficos();
    if (typeof Chart === 'undefined') {
      refs.forEach((r) => r.canvas.parentElement.replaceChildren(vacio('No se pudo cargar la librería de gráficos.', '📉')));
      return;
    }
    const texto = colorTexto();
    const borde = colorBorde();
    const ejes = (formatoY) => ({
      x: { ticks: { color: texto }, grid: { color: borde } },
      y: { beginAtZero: true, ticks: { color: texto, callback: formatoY }, grid: { color: borde } },
    });
    const [rVentas, rVendidos, rCompras, rCategoria, rTop, rCaducidad] = refs;

    graficos.push(new Chart(rVentas.canvas, {
      type: 'bar',
      data: {
        labels: datos.ventasUltimos7Dias.map((d) => formatoFecha(d.fecha).slice(0, 5)),
        datasets: [
          { label: 'Ventas', data: datos.ventasUltimos7Dias.map((d) => d.total), backgroundColor: PALETA[0], borderRadius: 8, order: 2 },
          { label: 'Margen', type: 'line', data: datos.ventasUltimos7Dias.map((d) => d.margen), borderColor: PALETA[1], backgroundColor: PALETA[1], tension: 0.3, pointRadius: 4, order: 1 },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: texto } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${formatoCOP(c.parsed.y)}` } } }, scales: ejes((v) => formatoCOPCorto(v)) },
    }));

    graficos.push(new Chart(rVendidos.canvas, {
      type: 'bar',
      data: {
        labels: datos.topProductosVendidos.map((p) => p.nombre),
        datasets: [{ label: 'Vendido (COP)', data: datos.topProductosVendidos.map((p) => p.total), backgroundColor: PALETA.slice(0, 5), borderRadius: 8 }],
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${formatoCOP(c.parsed.x)} · ${datos.topProductosVendidos[c.dataIndex].unidades} und` } } },
        scales: { x: { beginAtZero: true, ticks: { color: texto, callback: (v) => formatoCOPCorto(v) }, grid: { color: borde } }, y: { ticks: { color: texto }, grid: { display: false } } },
      },
    }));

    graficos.push(new Chart(rCompras.canvas, {
      type: 'bar',
      data: {
        labels: datos.comprasUltimos7Dias.map((d) => formatoFecha(d.fecha).slice(0, 5)),
        datasets: [{ label: 'Compras de insumos (COP)', data: datos.comprasUltimos7Dias.map((d) => d.total), backgroundColor: PALETA[0], borderRadius: 8 }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => formatoCOP(c.parsed.y) } } }, scales: ejes((v) => formatoCOPCorto(v)) },
    }));

    graficos.push(new Chart(rCategoria.canvas, {
      type: 'doughnut',
      data: {
        labels: datos.stockPorCategoria.map((c) => c.categoria),
        datasets: [{ data: datos.stockPorCategoria.map((c) => c.valor), backgroundColor: PALETA, borderWidth: 0 }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: texto } }, tooltip: { callbacks: { label: (c) => `${c.label}: ${formatoCOP(c.parsed)}` } } } },
    }));

    graficos.push(new Chart(rTop.canvas, {
      type: 'bar',
      data: {
        labels: datos.topProductosPorValor.map((p) => p.nombre),
        datasets: [{ label: 'Valor en inventario (COP)', data: datos.topProductosPorValor.map((p) => p.valor), backgroundColor: PALETA.slice(0, 5), borderRadius: 8 }],
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => formatoCOP(c.parsed.x) } } },
        scales: { x: { beginAtZero: true, ticks: { color: texto, callback: (v) => formatoCOPCorto(v) }, grid: { color: borde } }, y: { ticks: { color: texto }, grid: { display: false } } },
      },
    }));

    const { vigentes, porVencer, vencidos } = datos.caducidad;
    graficos.push(new Chart(rCaducidad.canvas, {
      type: 'doughnut',
      data: { labels: ['Vigentes', 'Por vencer (≤ 3 días)', 'Vencidos'], datasets: [{ data: [vigentes, porVencer, vencidos], backgroundColor: ['#1F7A4D', '#D08A2E', '#B42318'], borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: texto } } } },
    }));
  }

  function pintar() {
    const d = datos;
    const criticos = d.ingredientesCriticos;
    const refs = [
      tarjetaGrafico('💵 Ventas y margen (últimos 7 días)', 'grafico-ventas', 'Barras con las ventas por día y línea con el margen bruto'),
      tarjetaGrafico('🥇 Más vendidos (30 días)', 'grafico-vendidos', 'Barras horizontales con los productos más vendidos en pesos'),
      tarjetaGrafico('🛒 Compras de insumos (últimos 7 días)', 'grafico-compras', 'Barras con el valor de las entradas de materia prima por día'),
      tarjetaGrafico('🥧 Valor del inventario por categoría', 'grafico-categorias', 'Distribución del valor de las materias primas por categoría'),
      tarjetaGrafico('🏆 Productos con mayor valor en inventario', 'grafico-top', 'Barras horizontales con los productos de mayor valor en stock'),
      tarjetaGrafico('📅 Estado de caducidad de productos', 'grafico-caducidad', 'Productos vigentes, por vencer y vencidos'),
    ];

    reemplazarHijos(cuerpo,
      h('p', { class: 'kpi-seccion' }, 'Ventas · últimos 30 días'),
      h('div', { class: 'kpis' },
        kpi({ icono: '💵', titulo: 'Ventas', valor: formatoCOP(d.ventasUltimos30Dias), nota: `${formatoNumero(d.numeroVentasUltimos30Dias)} venta(s) registradas`, clase: 'destacado' }),
        kpi({ icono: '📈', titulo: 'Margen bruto', valor: formatoCOP(d.margenBrutoUltimos30Dias), nota: `${porcentaje(d.margenPorcentaje30Dias)} de las ventas`, clase: 'tendencia-up' }),
        kpi({ icono: '🔁', titulo: 'ROI sobre el costo', valor: porcentaje(d.roi30Dias), nota: `Costo de lo vendido ${formatoCOP(d.costoVentasUltimos30Dias)}` }),
        kpi({ icono: '🗑️', titulo: 'Pérdidas (bajas y mermas)', valor: formatoCOP(d.perdidasUltimos30Dias), nota: 'Valorizadas a costo', clase: d.perdidasUltimos30Dias > 0 ? 'aviso' : null })),
      h('div', { class: 'graficos-grid' }, refs[0].el, refs[1].el),
      h('p', { class: 'kpi-seccion' }, 'Inventario'),
      h('div', { class: 'kpis' },
        kpi({ icono: '💰', titulo: 'Inventario de insumos', valor: formatoCOP(d.valorInventarioInsumos), nota: 'Σ stock × costo unitario' }),
        kpi({ icono: '🛒', titulo: 'Compras (últimos 30 días)', valor: formatoCOP(d.comprasUltimos30Dias), nota: 'Entradas registradas × costo' }),
        kpi({ icono: '🎂', titulo: 'Productos terminados', valor: formatoCOP(d.valorProductosTerminados), nota: 'Σ stock × precio de venta' }),
        kpi({
          icono: '⚠️', titulo: 'Ingredientes críticos o bajos', valor: formatoNumero(d.totalIngredientesCriticos),
          nota: `${formatoNumero(d.productosVencidos)} producto(s) vencido(s) · ${formatoNumero(d.productosPorVencer)} por vencer`,
          clase: d.totalIngredientesCriticos > 0 || d.productosVencidos > 0 ? 'alerta' : 'tendencia-up',
          enlace: '#/alertas',
        })),
      h('div', { class: 'graficos-grid' }, refs[2].el, refs[3].el),
      h('div', { class: 'graficos-grid' }, refs[4].el, refs[5].el),
      h('div', { class: 'panel' },
        h('div', { class: 'panel-header' }, h('h2', {}, '⚠️ Ingredientes críticos')),
        criticos.length === 0
          ? vacio('Todas las materias primas están por encima de su mínimo.', '✅')
          : tabla({
            descripcion: 'Materias primas en estado bajo o crítico',
            columnas: [{ titulo: 'Código' }, { titulo: 'Ingrediente' }, { titulo: 'Stock', num: true }, { titulo: 'Mínimo', num: true }, { titulo: 'Estado' }],
            filas: criticos.map((m) => {
              const e = infoEstado(m.estado);
              return { celdas: [m.codigo, m.nombre, `${formatoNumero(m.stock)} ${m.unidad}`, `${formatoNumero(m.minimo)} ${m.unidad}`, insignia(e.texto, e.clase)] };
            }),
          })));
    dibujarGraficos(refs);
  }

  async function cargar() {
    const marca = ++ultimaCarga;
    reemplazarHijos(cuerpo, cargando('Calculando indicadores…'));
    try {
      const [dash, productos] = await Promise.all([
        api.get('/reportes/dashboard'),
        api.get('/productos', { limite: 1 }).catch(() => null),
      ]);
      if (marca !== ultimaCarga) return;
      const total = productos?.paginacion?.total ?? dash.productosPorVencer + dash.productosVencidos;
      datos = {
        ...dash,
        caducidad: {
          vigentes: Math.max(0, total - dash.productosPorVencer - dash.productosVencidos),
          porVencer: dash.productosPorVencer,
          vencidos: dash.productosVencidos,
        },
      };
      pintar();
    } catch (error) {
      if (marca !== ultimaCarga) return;
      reemplazarHijos(cuerpo, bannerError(error, cargar));
    }
  }

  return {
    el,
    titulo: 'Tablero',
    cargar,
    temaCambiado() { if (datos && graficos.length) pintar(); },
    destruir() { ultimaCarga++; destruirGraficos(); },
  };
}

// Tablero v1.3 — "obrador en vivo". Mismos datos reales que v1.1 (GET /reportes/dashboard), presentados con:
// portada animada con saludo y reloj, cifras que cuentan, anillos de progreso, curva de ventas que se dibuja,
// podio de más vendidos, pulso de actividad reciente y barras de insumos. Todo respeta prefers-reduced-motion.
import { h, reemplazarHijos, bannerError } from '../ui.js';
import { formatoCOP, formatoCOPCorto, formatoNumero, formatoFecha } from '../format.js';
import { listaPasos } from './ayuda.js';

const SVG = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...hijos) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  hijos.forEach((x) => x && el.appendChild(x));
  return el;
};
const sinMovimiento = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const css = (nombre, defecto) => getComputedStyle(document.documentElement).getPropertyValue(nombre).trim() || defecto;
const esOscuro = () => document.documentElement.dataset.theme === 'dark';

// ------------------------------------------------------------------ animaciones
const facilitar = (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)); // easeOutExpo

/** Número que cuenta desde 0 hasta su valor. El texto final queda puesto siempre (lectores de pantalla y sin animación). */
function contador(valor, formato, { duracion = 1400, retraso = 0 } = {}) {
  const el = h('span', { class: 'db-num' }, formato(valor));
  if (sinMovimiento() || !Number.isFinite(valor) || valor === 0) return el;
  el.textContent = formato(0);
  setTimeout(() => {
    const inicio = performance.now();
    const paso = (t) => {
      const p = Math.min(1, (t - inicio) / duracion);
      el.textContent = formato(valor * facilitar(p));
      if (p < 1 && el.isConnected) requestAnimationFrame(paso); else el.textContent = formato(valor);
    };
    requestAnimationFrame(paso);
  }, retraso);
  return el;
}

/** Anillo de progreso SVG (0–100). `tope` permite mostrar valores > 100 (ROI) llenando el anillo completo. */
function anillo({ porcentaje, etiqueta, valorTexto, color, retraso = 0, ayuda, centro }) {
  const r = 46; const largo = 2 * Math.PI * r;
  const lleno = Math.max(0, Math.min(100, porcentaje ?? 0));
  const arco = s('circle', { cx: 60, cy: 60, r, fill: 'none', stroke: `url(#${color})`, 'stroke-width': 11, 'stroke-linecap': 'round',
    'stroke-dasharray': largo, 'stroke-dashoffset': sinMovimiento() ? largo * (1 - lleno / 100) : largo, transform: 'rotate(-90 60 60)', class: 'db-anillo-arco' });
  const svg = s('svg', { viewBox: '0 0 120 120', class: 'db-anillo-svg', 'aria-hidden': 'true' },
    s('circle', { cx: 60, cy: 60, r, fill: 'none', class: 'db-anillo-pista', 'stroke-width': 11 }), arco);
  if (!sinMovimiento()) setTimeout(() => requestAnimationFrame(() => arco.setAttribute('stroke-dashoffset', largo * (1 - lleno / 100))), 120 + retraso);
  return h('div', { class: 'db-anillo db-entra', style: { '--i': String(retraso / 90) }, role: 'group', 'aria-label': `${etiqueta}: ${valorTexto}` },
    h('div', { class: 'db-anillo-grafico' }, svg,
      h('div', { class: 'db-anillo-centro', 'aria-hidden': 'true' }, porcentaje === null ? h('span', { class: 'db-num' }, '—')
        : contador(centro ?? porcentaje, (v) => `${formatoNumero(Math.round(v * (centro > 99 ? 1 : 10)) / (centro > 99 ? 1 : 10))}%`, { retraso }))),
    h('div', { class: 'db-anillo-texto', 'aria-hidden': 'true' }, h('strong', {}, etiqueta), h('span', {}, ayuda)));
}

/** Curva de ventas de 7 días (área + línea) que se dibuja al aparecer. */
function curvaVentas(dias) {
  const w = 320; const alto = 96; const pad = 6;
  const max = Math.max(1, ...dias.map((d) => d.total));
  const pts = dias.map((d, i) => [pad + (i * (w - 2 * pad)) / Math.max(1, dias.length - 1), alto - pad - (d.total / max) * (alto - 2 * pad - 8)]);
  // Curva suave (Catmull-Rom → Bézier)
  const linea = pts.reduce((acc, [x, y], i, a) => {
    if (i === 0) return `M${x},${y}`;
    const [x0, y0] = a[i - 2] ?? a[i - 1]; const [x1, y1] = a[i - 1]; const [x3, y3] = a[i + 1] ?? [x, y];
    return `${acc} C${x1 + (x - x0) / 6},${y1 + (y - y0) / 6} ${x - (x3 - x1) / 6},${y - (y3 - y1) / 6} ${x},${y}`;
  }, '');
  const area = `${linea} L${pts.at(-1)[0]},${alto} L${pts[0][0]},${alto} Z`;
  const trazo = s('path', { d: linea, class: 'db-curva-linea', fill: 'none', 'stroke-width': 3, 'stroke-linecap': 'round', pathLength: 1 });
  const ultimo = pts.at(-1);
  return s('svg', { viewBox: `0 0 ${w} ${alto}`, class: 'db-curva', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    s('defs', {}, s('linearGradient', { id: 'db-curva-relleno', x1: 0, y1: 0, x2: 0, y2: 1 },
      s('stop', { offset: '0', 'stop-color': '#F7A8C8', 'stop-opacity': '.55' }), s('stop', { offset: '1', 'stop-color': '#F7A8C8', 'stop-opacity': '0' }))),
    s('path', { d: area, fill: 'url(#db-curva-relleno)', class: 'db-curva-area' }),
    trazo,
    s('circle', { cx: ultimo[0], cy: ultimo[1], r: 5, class: 'db-curva-punto' }));
}

/** Brillo que sigue al puntero sobre las tarjetas (efecto "foco"). */
function seguirPuntero(contenedor) {
  contenedor.addEventListener('pointermove', (e) => {
    const t = e.target.closest?.('.db-brillo');
    if (!t) return;
    const r = t.getBoundingClientRect();
    t.style.setProperty('--mx', `${e.clientX - r.left}px`);
    t.style.setProperty('--my', `${e.clientY - r.top}px`);
  });
}

// ------------------------------------------------------------------ utilidades de texto
function saludo(fecha = new Date()) {
  const hora = fecha.getHours();
  return hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';
}
const horaTexto = (f = new Date()) => f.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
function haceCuanto(iso) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const horas = Math.round(min / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? 'ayer' : `hace ${dias} días`;
}
const pct = (parte, total) => (total > 0 ? Math.round((parte / total) * 1000) / 10 : null);

// ------------------------------------------------------------------ vista
export function crearVista(ctx) {
  const { api, auth } = ctx;
  const cuerpo = h('div', { class: 'db' });
  const el = h('section', { class: 'vista activa', 'aria-labelledby': 'titulo-dashboard' }, cuerpo);
  seguirPuntero(cuerpo);

  let graficos = [];
  let datos = null;
  let ultimaCarga = 0;
  let reloj = null;

  const destruirGraficos = () => { graficos.forEach((g) => g.destroy()); graficos = []; };
  const pararReloj = () => { if (reloj) clearInterval(reloj); reloj = null; };

  // ---------------------------------------------------------------- portada
  function portada(d) {
    const nombre = (auth.usuario()?.nombre ?? '').split(' ')[0];
    const hoyTexto = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
    const relojEl = h('span', { class: 'db-reloj' }, horaTexto());
    pararReloj();
    reloj = setInterval(() => { relojEl.textContent = horaTexto(); }, 15000);
    const ticket = d.numeroVentasUltimos30Dias > 0 ? d.ventasUltimos30Dias / d.numeroVentasUltimos30Dias : 0;
    const mejorDia = [...d.ventasUltimos7Dias].sort((a, b) => b.total - a.total)[0];
    const chispas = h('div', { class: 'db-chispas', 'aria-hidden': 'true' },
      ...Array.from({ length: 14 }, (_, i) => h('i', { style: { '--x': `${(i * 37) % 100}%`, '--d': `${6 + (i % 5) * 1.7}s`, '--r': `${(i * 47) % 180}deg`, '--c': ['#F7A8C8', '#F2C36B', '#9EE6C2', '#F6EEE4', '#B9CCFF'][i % 5], '--retraso': `${-(i * 0.9)}s` } })));


    return h('header', { class: 'db-portada db-entra', style: { '--i': '0' } },
      h('div', { class: 'db-aurora', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')),
      chispas,
      h('div', { class: 'db-portada-contenido' },
        h('div', { class: 'db-portada-izq' },
          h('p', { class: 'db-sobretitulo' }, h('span', { class: 'db-punto-vivo' }), ' En vivo · ', hoyTexto, ' · ', relojEl),
          h('h1', { id: 'titulo-dashboard', tabindex: '-1' }, `${saludo()}${nombre ? `, ${nombre}` : ''} `, h('span', { class: 'db-mano', 'aria-hidden': 'true' }, '👋')),
          h('p', { class: 'db-bajada' }, 'Así va Dulce Hogar en los últimos 30 días.')),
        h('div', { class: 'db-portada-der' },
          h('p', { class: 'db-etiqueta' }, 'Vendiste en 30 días'),
          h('p', { class: 'db-cifra-gigante' }, contador(d.ventasUltimos30Dias, (v) => formatoCOP(Math.round(v)), { duracion: 1800 })),
          curvaVentas(d.ventasUltimos7Dias),
          h('div', { class: 'db-chips' },
            h('span', { class: 'db-chip' }, '💰 Ganaste ', h('strong', {}, formatoCOP(d.margenBrutoUltimos30Dias))),
            h('span', { class: 'db-chip' }, '🧾 ', h('strong', {}, formatoNumero(d.numeroVentasUltimos30Dias)), ' ventas'),
            h('span', { class: 'db-chip' }, '🎟️ Promedio por venta ', h('strong', {}, formatoCOP(Math.round(ticket)))),
            mejorDia?.total > 0 ? h('span', { class: 'db-chip' }, '🔥 Mejor día ', h('strong', {}, formatoFecha(mejorDia.fecha).slice(0, 5))) : null))));
  }

  // ---------------------------------------------------------------- anillos
  function anillos(d, extra) {
    const totalMp = extra.totalMaterias;
    const optimos = Math.max(0, totalMp - d.totalIngredientesCriticos);
    const totalPt = d.caducidad.vigentes + d.caducidad.porVencer + d.caducidad.vencidos;
    return h('div', { class: 'db-anillos' },
      anillo({ porcentaje: d.margenPorcentaje30Dias, etiqueta: 'Ganancia', ayuda: 'de cada peso que vendes', valorTexto: d.margenPorcentaje30Dias === null ? 'sin ventas' : `${d.margenPorcentaje30Dias} %`, color: 'db-g-frambuesa', retraso: 0 }),
      // El anillo del ROI se llena sobre una escala de 0 a 300 % (un ROI de 300 % o más lo completa); el centro muestra el valor real.
      anillo({ porcentaje: d.roi30Dias === null ? null : Math.min(100, d.roi30Dias / 3), centro: d.roi30Dias, etiqueta: 'Rendimiento', ayuda: 'lo que ganas sobre lo que gastas', valorTexto: d.roi30Dias === null ? 'sin datos' : `${d.roi30Dias} %`, color: 'db-g-caramelo', retraso: 90 }),
      anillo({ porcentaje: pct(optimos, totalMp), etiqueta: 'Ingredientes', ayuda: `${optimos} de ${totalMp} con suficiente cantidad`, valorTexto: `${pct(optimos, totalMp) ?? 0} %`, color: 'db-g-menta', retraso: 180 }),
      anillo({ porcentaje: pct(d.caducidad.vigentes, totalPt), etiqueta: 'Frescura', ayuda: `${d.caducidad.vigentes} de ${totalPt} productos lejos de vencer`, valorTexto: `${pct(d.caducidad.vigentes, totalPt) ?? 0} %`, color: 'db-g-cielo', retraso: 270 }),
      // Degradados compartidos por los anillos (un solo <defs> en el documento)
      s('svg', { width: 0, height: 0, style: 'position:absolute', 'aria-hidden': 'true' }, s('defs', {},
        ...[['db-g-frambuesa', '#F28DB6', '#B8336A'], ['db-g-caramelo', '#F6C177', '#C2621F'], ['db-g-menta', '#7FE0B0', '#1F7A4D'], ['db-g-cielo', '#9DBBF5', '#2E5AAC']]
          .map(([id, a, b]) => s('linearGradient', { id, x1: 0, y1: 0, x2: 1, y2: 1 }, s('stop', { offset: '0', 'stop-color': a }), s('stop', { offset: '1', 'stop-color': b }))))));
  }

  // ---------------------------------------------------------------- acciones rápidas (lo primero que busca una persona nueva)
  function accionesRapidas(d) {
    const pendientes = d.totalIngredientesCriticos + d.productosVencidos + d.productosPorVencer;
    const opciones = [
      auth.puede('ventas') && ['#/ventas/nueva', '🛒', 'Registrar una venta', 'Cada vez que vendas', 'frambuesa'],
      auth.puede('producir') && ['#/recetas/hornear', '🧁', 'Hornear', 'Descuenta los ingredientes solo', 'caramelo'],
      auth.puede('movimientos') && ['#/movimientos/entrada', '📦', 'Llegaron ingredientes', 'Anota lo que te trajeron', 'cielo'],
      auth.puede('ajustes') && ['#/materias', '⚖️', 'Contar el inventario', 'Corrige si algo no cuadra', 'menta'],
      !auth.puede('ventas') && ['#/ventas', '🧾', 'Ver las ventas', 'Qué se vendió y cuándo', 'frambuesa'],
      auth.puede('rentabilidad') && !auth.puede('producir') && ['#/rentabilidad', '📈', 'Ver ganancias', 'Cuánto deja cada producto', 'menta'],
      !auth.puede('ajustes') && ['#/alertas', '🔔', 'Ver avisos', pendientes ? `${pendientes} para revisar` : 'Todo en orden', 'alerta'],
    ].filter(Boolean).slice(0, 4);
    return h('section', { class: 'db-rapidas db-entra', style: { '--i': '2' }, 'aria-labelledby': 'db-rapidas-t' },
      h('h2', { id: 'db-rapidas-t', class: 'db-rapidas-titulo' }, '¿Qué quieres hacer?'),
      h('div', { class: 'db-rapidas-grid' }, ...opciones.map(([href, icono, titulo, ayuda, tono], i) => h('a', { class: ['db-rapida', 'db-brillo'], href, style: { '--i': String(i) } },
        h('span', { class: ['db-rapida-icono', `db-tono-${tono}`], 'aria-hidden': 'true' }, icono),
        h('span', { class: 'db-rapida-texto' }, h('strong', {}, titulo), h('span', {}, ayuda)),
        h('span', { class: 'db-rapida-flecha', 'aria-hidden': 'true' }, '→')))));
  }

  // Guía de bienvenida: se muestra la primera vez que cada usuario entra en este dispositivo.
  const claveGuia = () => `pastel-stock.guia-vista.${auth.usuario()?.nombre ?? 'x'}`;
  function guiaBienvenida() {
    let vista = false;
    try { vista = localStorage.getItem(claveGuia()) === '1'; } catch { vista = true; }
    if (vista) return null;
    const tarjeta = h('section', { class: 'db-guia db-entra', style: { '--i': '1' }, 'aria-labelledby': 'db-guia-t' },
      h('div', { class: 'db-guia-cab' }, h('span', { class: 'db-guia-emoji', 'aria-hidden': 'true' }, '👋'),
        h('div', {}, h('h2', { id: 'db-guia-t' }, '¿Primera vez? Es muy fácil'), h('p', {}, 'Con estas cuatro cosas ya sabes usar Pastel Stock.'))),
      listaPasos(),
      h('button', { type: 'button', class: 'btn', onClick: () => { try { localStorage.setItem(claveGuia(), '1'); } catch { /* sin almacenamiento */ } tarjeta.remove(); } }, '¡Entendido, empecemos!'));
    return tarjeta;
  }

  // ---------------------------------------------------------------- tarjetas de cifras
  function tarjetas(d) {
    const t = (i, icono, tono, titulo, valor, nota, enlace) => h(enlace ? 'a' : 'div', { class: ['db-tarjeta', 'db-brillo', 'db-entra'], href: enlace ?? null, style: { '--i': String(4 + i) } },
      h('span', { class: ['db-icono', `db-tono-${tono}`], 'aria-hidden': 'true' }, icono),
      h('span', { class: 'db-tarjeta-titulo' }, titulo),
      h('span', { class: 'db-tarjeta-valor' }, contador(valor, (v) => formatoCOP(Math.round(v)), { retraso: 200 + i * 80 })),
      h('span', { class: 'db-tarjeta-nota' }, nota));
    return h('div', { class: 'db-tarjetas' },
      t(0, '🧂', 'caramelo', 'Ingredientes en bodega', d.valorInventarioInsumos, 'Lo que costaron', '#/materias'),
      t(1, '🎂', 'frambuesa', 'Productos listos', d.valorProductosTerminados, 'Lo que valen al venderlos', '#/productos'),
      t(2, '🛒', 'cielo', 'Compraste (30 días)', d.comprasUltimos30Dias, 'Ingredientes que llegaron', '#/movimientos'),
      t(3, '🗑️', d.perdidasUltimos30Dias > 0 ? 'alerta' : 'menta', 'Se perdió (30 días)', d.perdidasUltimos30Dias, d.perdidasUltimos30Dias > 0 ? 'Vencidos y dañados' : 'Nada se perdió, ¡bien!', '#/alertas'));
  }

  // ---------------------------------------------------------------- podio de más vendidos
  function podio(d) {
    const lista = d.topProductosVendidos;
    const max = Math.max(1, ...lista.map((p) => p.total));
    const medallas = ['🥇', '🥈', '🥉', '4', '5'];
    return h('section', { class: 'db-panel db-entra', style: { '--i': '9' }, 'aria-labelledby': 'db-podio-t' },
      h('div', { class: 'db-panel-cab' }, h('h2', { id: 'db-podio-t' }, 'Los más vendidos'), h('span', { class: 'db-panel-sub' }, '30 días')),
      lista.length === 0 ? h('p', { class: 'db-vacio' }, 'Aún no hay ventas: el podio te espera 🏆') : h('ol', { class: 'db-podio' },
        ...lista.map((p, i) => h('li', { class: 'db-podio-fila', style: { '--i': String(i) } },
          h('span', { class: ['db-medalla', i < 3 ? `db-medalla-${i + 1}` : null], 'aria-hidden': 'true' }, medallas[i]),
          h('div', { class: 'db-podio-info' },
            h('div', { class: 'db-podio-linea' }, h('span', { class: 'db-podio-nombre' }, p.nombre), h('span', { class: 'db-podio-total' }, formatoCOP(p.total))),
            h('div', { class: 'db-barra', role: 'img', 'aria-label': `${p.unidades} unidades vendidas` },
              h('span', { class: 'db-barra-relleno', style: { '--ancho': `${(p.total / max) * 100}%` } })),
            h('span', { class: 'db-podio-unidades' }, `${formatoNumero(p.unidades)} unidades`))))));
  }

  // ---------------------------------------------------------------- pulso de actividad
  function pulso(eventos) {
    return h('section', { class: 'db-panel db-entra', style: { '--i': '10' }, 'aria-labelledby': 'db-pulso-t' },
      h('div', { class: 'db-panel-cab' }, h('h2', { id: 'db-pulso-t' }, 'Pulso de la pastelería'), h('span', { class: 'db-panel-sub' }, h('span', { class: 'db-punto-vivo' }), ' reciente')),
      eventos.length === 0 ? h('p', { class: 'db-vacio' }, 'Todavía no hay actividad.') : h('ol', { class: 'db-linea-tiempo' },
        ...eventos.map((e, i) => h('li', { class: ['db-evento', `db-evento-${e.tipo}`], style: { '--i': String(i) } },
          h('span', { class: 'db-evento-icono', 'aria-hidden': 'true' }, e.icono),
          h('div', { class: 'db-evento-cuerpo' },
            h('span', { class: 'db-evento-titulo' }, e.titulo),
            h('span', { class: 'db-evento-detalle' }, e.detalle)),
          h('time', { class: 'db-evento-hora', datetime: e.fecha, title: new Date(e.fecha).toLocaleString('es-CO') }, haceCuanto(e.fecha))))));
  }

  // ---------------------------------------------------------------- insumos que piden atención
  function insumos(d) {
    const lista = d.ingredientesCriticos;
    return h('section', { class: 'db-panel db-entra', style: { '--i': '11' }, 'aria-labelledby': 'db-insumos-t' },
      h('div', { class: 'db-panel-cab' }, h('h2', { id: 'db-insumos-t' }, 'Ingredientes por comprar'), h('a', { class: 'db-enlace', href: '#/alertas' }, 'Ver alertas →')),
      lista.length === 0 ? h('p', { class: 'db-vacio' }, '✨ Tienes suficiente de todos los ingredientes.') : h('ul', { class: 'db-insumos' },
        ...lista.map((m, i) => {
          const nivel = m.minimo > 0 ? Math.min(100, (m.stock / m.minimo) * 100) : 100;
          return h('li', { class: ['db-insumo', m.estado === 'CRITICO' ? 'db-insumo-critico' : 'db-insumo-bajo'], style: { '--i': String(i) } },
            h('div', { class: 'db-insumo-linea' },
              h('strong', {}, m.nombre),
              h('span', { class: 'db-insumo-estado' }, m.estado === 'CRITICO' ? 'Muy poco' : 'Poco')),
            h('div', { class: 'db-barra db-barra-fina', role: 'img', 'aria-label': `${formatoNumero(m.stock)} de un mínimo de ${formatoNumero(m.minimo)} ${m.unidad}` },
              h('span', { class: 'db-barra-relleno', style: { '--ancho': `${nivel}%` } })),
            h('span', { class: 'db-insumo-dato' }, `Hay ${formatoNumero(m.stock)} ${m.unidad} · avisar bajo ${formatoNumero(m.minimo)}`));
        })));
  }

  // ---------------------------------------------------------------- gráficos (Chart.js con degradados)
  function tarjetaGrafico(titulo, sub, descripcion, i, alto = 280) {
    const canvas = h('canvas', { role: 'img', 'aria-label': descripcion });
    const centro = h('div', { class: 'db-dona-centro', 'aria-hidden': 'true' });
    return {
      canvas, centro,
      el: h('section', { class: 'db-panel db-entra', style: { '--i': String(i) } },
        h('div', { class: 'db-panel-cab' }, h('h2', {}, titulo), h('span', { class: 'db-panel-sub' }, sub)),
        h('div', { class: 'db-grafico', style: { height: `${alto}px` } }, canvas, centro)),
    };
  }

  function dibujarGraficos(gVentas, gCategoria, gCompras) {
    destruirGraficos();
    if (typeof Chart === 'undefined') return;
    const texto = css('--color-texto-secundario', '#6A5B50');
    const rejilla = esOscuro() ? 'rgba(255,255,255,.06)' : 'rgba(42,29,21,.06)';
    const anim = sinMovimiento() ? false : { duration: 1400, easing: 'easeOutQuart' };
    const degradado = (a, b) => (c) => {
      const { ctx: g, chartArea: area } = c.chart;
      if (!area) return a;
      const grad = g.createLinearGradient(0, area.bottom, 0, area.top);
      grad.addColorStop(0, b); grad.addColorStop(1, a);
      return grad;
    };
    const tooltip = { backgroundColor: 'rgba(36,23,15,.94)', titleColor: '#fff', bodyColor: '#F3E9DE', padding: 12, cornerRadius: 12, displayColors: true, boxPadding: 4 };
    Chart.defaults.font.family = css('--fuente', 'system-ui');

    const dias = datos.ventasUltimos7Dias;
    graficos.push(new Chart(gVentas.canvas, {
      type: 'bar',
      data: {
        labels: dias.map((d) => new Date(`${d.fecha}T12:00:00`).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric' })),
        datasets: [
          { label: 'Ventas', data: dias.map((d) => d.total), backgroundColor: degradado('#C2621F', 'rgba(194,98,31,.35)'), borderRadius: 12, borderSkipped: false, maxBarThickness: 46, order: 2 },
          { label: 'Margen', type: 'line', data: dias.map((d) => d.margen), borderColor: '#D9437F', backgroundColor: degradado('rgba(217,67,127,.35)', 'rgba(217,67,127,0)'),
            fill: true, tension: 0.42, borderWidth: 3, pointRadius: 5, pointHoverRadius: 8, pointBackgroundColor: '#fff', pointBorderColor: '#D9437F', pointBorderWidth: 3, order: 1 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: anim, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { color: texto, usePointStyle: true, pointStyle: 'circle', padding: 18 } }, tooltip: { ...tooltip, callbacks: { label: (c) => ` ${c.dataset.label}: ${formatoCOP(c.parsed.y)}` } } },
        scales: { x: { ticks: { color: texto }, grid: { display: false }, border: { display: false } },
          y: { beginAtZero: true, ticks: { color: texto, callback: (v) => formatoCOPCorto(v), maxTicksLimit: 5 }, grid: { color: rejilla }, border: { display: false } } },
      },
    }));

    const cats = datos.stockPorCategoria;
    const totalCat = cats.reduce((a, c) => a + c.valor, 0);
    reemplazarHijos(gCategoria.centro, h('span', { class: 'db-dona-valor' }, formatoCOPCorto(totalCat)), h('span', { class: 'db-dona-etq' }, 'en insumos'));
    graficos.push(new Chart(gCategoria.canvas, {
      type: 'doughnut',
      data: { labels: cats.map((c) => c.categoria), datasets: [{ data: cats.map((c) => c.valor), backgroundColor: ['#C2621F', '#D9437F', '#2E9B6A', '#E0A43A', '#4C7BD9', '#8C6A55', '#B07CC6'], borderWidth: 0, hoverOffset: 14, spacing: 3, borderRadius: 8 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '72%', animation: sinMovimiento() ? false : { animateRotate: true, duration: 1600, easing: 'easeOutQuart' },
        plugins: { legend: { position: 'bottom', labels: { color: texto, usePointStyle: true, pointStyle: 'circle', padding: 14 } }, tooltip: { ...tooltip, callbacks: { label: (c) => ` ${c.label}: ${formatoCOP(c.parsed)} (${pct(c.parsed, totalCat)} %)` } } },
      },
    }));

    graficos.push(new Chart(gCompras.canvas, {
      type: 'line',
      data: {
        labels: datos.comprasUltimos7Dias.map((d) => new Date(`${d.fecha}T12:00:00`).toLocaleDateString('es-CO', { weekday: 'short' })),
        datasets: [{ label: 'Compras', data: datos.comprasUltimos7Dias.map((d) => d.total), borderColor: '#4C7BD9', backgroundColor: degradado('rgba(76,123,217,.35)', 'rgba(76,123,217,0)'),
          fill: true, tension: 0.42, borderWidth: 3, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: '#4C7BD9', pointBorderWidth: 2 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: anim,
        plugins: { legend: { display: false }, tooltip: { ...tooltip, callbacks: { label: (c) => ` Compras: ${formatoCOP(c.parsed.y)}` } } },
        scales: { x: { ticks: { color: texto }, grid: { display: false }, border: { display: false } },
          y: { beginAtZero: true, ticks: { color: texto, callback: (v) => formatoCOPCorto(v), maxTicksLimit: 4 }, grid: { color: rejilla }, border: { display: false } } },
      },
    }));
  }

  // ---------------------------------------------------------------- composición
  function pintar(extra) {
    const d = datos;
    const gVentas = tarjetaGrafico('Ventas y ganancia', 'últimos 7 días', 'Barras con las ventas por día y área con el margen bruto de los últimos 7 días', 8, 300);
    const gCategoria = tarjetaGrafico('Ingredientes por tipo', 'lo que costaron', 'Dona con el valor del inventario de insumos por categoría', 12, 280);
    const gCompras = tarjetaGrafico('Compras de ingredientes', 'últimos 7 días', 'Curva con el valor de las compras de insumos por día', 13, 220);
    const alertas = d.totalIngredientesCriticos + d.productosVencidos + d.productosPorVencer;
    const contenidoDetalles = h('div', { class: 'db', id: 'db-detalles' });
    const botonDetalles = h('button', { type: 'button', class: 'db-ver-mas', 'aria-controls': 'db-detalles', 'aria-expanded': 'false' }, 'Ver más detalles', h('span', { class: 'db-ver-mas-flecha', 'aria-hidden': 'true' }, '▾'));
    const detalles = h('div', { class: 'db-detalles' }, botonDetalles, contenidoDetalles);
    reemplazarHijos(cuerpo,
      portada(d),
      accionesRapidas(d),
      alertas > 0 ? h('a', { class: 'db-aviso db-entra', href: '#/alertas', style: { '--i': '1' } },
        h('span', { class: 'db-aviso-icono', 'aria-hidden': 'true' }, '⚡'),
        h('span', {}, h('strong', {}, `${alertas} cosa${alertas === 1 ? '' : 's'} para revisar hoy: `),
          [d.productosVencidos ? `${d.productosVencidos} vencido(s)` : null, d.productosPorVencer ? `${d.productosPorVencer} vence(n) pronto` : null, d.totalIngredientesCriticos ? `${d.totalIngredientesCriticos} ingrediente(s) por comprar` : null].filter(Boolean).join(' · ')),
        h('span', { class: 'db-aviso-flecha', 'aria-hidden': 'true' }, '→')) : null,
      guiaBienvenida(),
      anillos(d, extra),
      detalles);
    // Los detalles (cifras, gráficos, podio, actividad) quedan plegados: la pantalla de inicio se entiende de un vistazo.
    function abrirDetalles(abrir) {
      detalles.hidden = false;
      contenidoDetalles.hidden = !abrir;
      botonDetalles.setAttribute('aria-expanded', String(abrir));
      botonDetalles.firstChild.textContent = abrir ? 'Ocultar detalles' : 'Ver más detalles: gráficos, más vendidos y actividad';
      try { localStorage.setItem('pastel-stock.inicio-detalles', abrir ? '1' : '0'); } catch { /* sin almacenamiento */ }
      if (abrir && !graficos.length) requestAnimationFrame(() => dibujarGraficos(gVentas, gCategoria, gCompras));
    }
    botonDetalles.onclick = () => abrirDetalles(contenidoDetalles.hidden);
    reemplazarHijos(contenidoDetalles,
      tarjetas(d),
      h('div', { class: 'db-rejilla db-rejilla-principal' }, gVentas.el, podio(d)),
      h('div', { class: 'db-rejilla db-rejilla-tres' }, pulso(extra.eventos), insumos(d), h('div', { class: 'db-columna' }, gCategoria.el, gCompras.el)));
    destruirGraficos();
    let abiertos = false;
    try { abiertos = localStorage.getItem('pastel-stock.inicio-detalles') === '1'; } catch { abiertos = false; }
    abrirDetalles(abiertos);
  }

  function esqueleto() {
    return h('div', { class: 'db-esqueleto', 'aria-busy': 'true', 'aria-label': 'Cargando el tablero' },
      h('div', { class: 'db-esq db-esq-portada' }),
      h('div', { class: 'db-esq-fila' }, ...Array.from({ length: 4 }, () => h('div', { class: 'db-esq db-esq-anillo' }))),
      h('div', { class: 'db-esq-fila' }, ...Array.from({ length: 4 }, () => h('div', { class: 'db-esq db-esq-tarjeta' }))));
  }

  let extraActual = null;
  async function cargar() {
    const marca = ++ultimaCarga;
    if (!datos) reemplazarHijos(cuerpo, esqueleto());
    try {
      const [dash, productos, materias, ventas, movimientos] = await Promise.all([
        api.get('/reportes/dashboard'),
        api.get('/productos', { limite: 1 }).catch(() => null),
        api.get('/materias-primas', { limite: 1 }).catch(() => null),
        api.get('/ventas', { limite: 6 }).catch(() => null),
        api.get('/movimientos', { limite: 6 }).catch(() => null),
      ]);
      if (marca !== ultimaCarga) return;
      const total = productos?.paginacion?.total ?? dash.productosPorVencer + dash.productosVencidos;
      datos = { ...dash, caducidad: { vigentes: Math.max(0, total - dash.productosPorVencer - dash.productosVencidos), porVencer: dash.productosPorVencer, vencidos: dash.productosVencidos } };
      const TIPOS = { ENTRADA: ['📦', 'entrada', 'Entrada de'], SALIDA: ['🥣', 'salida', 'Consumo de'], AJUSTE: ['⚖️', 'ajuste', 'Ajuste de'], AJUSTE_NEGATIVO: ['⚖️', 'ajuste', 'Ajuste de'] };
      const eventos = [
        ...(ventas?.datos ?? []).map((v) => ({ tipo: 'venta', icono: '💵', fecha: v.creadoEn, titulo: `Venta #${v.id} · ${formatoCOP(v.total)}`,
          detalle: `${v.items.map((i) => `${i.cantidad}× ${i.nombre}`).join(', ')}${v.registradoPor ? ` — ${v.registradoPor}` : ''}` })),
        ...(movimientos?.datos ?? []).map((m) => {
          const [icono, tipo, verbo] = TIPOS[m.tipo] ?? ['•', 'ajuste', m.tipo];
          const nombre = m.nombre ?? m.codigo;
          return { tipo, icono, fecha: m.creadoEn, titulo: `${verbo} ${nombre}`, detalle: `${m.tipo === 'SALIDA' || m.tipo === 'AJUSTE_NEGATIVO' ? '−' : '+'}${formatoNumero(m.cantidad)} ${m.unidad ?? ''}${m.proveedor ? ` · ${m.proveedor}` : ''}${m.registradoPor ? ` — ${m.registradoPor}` : ''}` };
        }),
      ].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 7);
      extraActual = { totalMaterias: materias?.paginacion?.total ?? dash.totalIngredientesCriticos, eventos };
      pintar(extraActual);
    } catch (error) {
      if (marca !== ultimaCarga) return;
      reemplazarHijos(cuerpo, bannerError(error, cargar));
    }
  }

  return {
    el,
    titulo: 'Tablero',
    cargar,
    temaCambiado() { if (datos && extraActual) pintar(extraActual); },
    destruir() { ultimaCarga++; destruirGraficos(); pararReloj(); },
  };
}

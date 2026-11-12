// Ventas (v1.1): registrar ventas de productos terminados y consultar el historial con su margen.
import {
  h, reemplazarHijos, cargando, vacio, bannerError, tabla, paginador, encabezadoVista,
  abrirModal, toast, crearAvisoFormulario, conBotonOcupado, idCampo,
} from '../ui.js';
import { formatoCOP, formatoFechaHora, formatoNumero, hoyISO, mensajeDeError, nuevaClaveIdempotencia, estadoCaducidad } from '../format.js';
import { validarVenta } from '../validacion.js';
import { botonesExportar } from './exportar.js';

const r2 = (n) => Math.round(n * 100) / 100;
const desdeHace = (dias) => { const d = new Date(); d.setDate(d.getDate() - dias); return hoyISO(d); };

export function crearVista(ctx) {
  const { api, auth } = ctx;
  const puedeVender = auth.puede('ventas');
  const verGanancia = auth.puede('rentabilidad');
  const estado = { pagina: 1, limite: 15, desde: desdeHace(29), hasta: hoyISO() };
  let marcaCarga = 0;

  const zonaResumen = h('div', {});
  const zonaLista = h('div', {});
  const filtroDesde = h('input', { type: 'date', value: estado.desde, max: hoyISO(), id: idCampo('v-desde') });
  const filtroHasta = h('input', { type: 'date', value: estado.hasta, max: hoyISO(), id: idCampo('v-hasta') });
  const botonVender = puedeVender ? h('button', { type: 'button', class: 'btn btn-acento', onClick: () => abrirVenta() }, '＋ Registrar una venta') : null;

  const el = h('section', { class: 'vista activa', 'aria-labelledby': 'titulo-ventas' },
    encabezadoVista('Ventas', 'Toca «Registrar una venta» cada vez que vendas algo.', botonVender),
    zonaResumen,
    h('div', { class: 'panel' },
      h('div', { class: 'panel-header' },
        h('h2', {}, 'Historial'),
        h('div', { class: 'barra-filtros sin-margen' },
          h('div', { class: 'form-group' }, h('label', { for: filtroDesde.id }, 'Desde'), filtroDesde),
          h('div', { class: 'form-group' }, h('label', { for: filtroHasta.id }, 'Hasta'), filtroHasta)),
        h('div', { class: 'panel-actions' }, botonesExportar(ctx, 'ventas'))),
      zonaLista));
  el.querySelector('h1').id = 'titulo-ventas';

  const alFiltrar = () => { estado.desde = filtroDesde.value; estado.hasta = filtroHasta.value; estado.pagina = 1; cargar(); };
  filtroDesde.addEventListener('change', alFiltrar);
  filtroHasta.addEventListener('change', alFiltrar);

  async function cargar() {
    const marca = ++marcaCarga;
    reemplazarHijos(zonaLista, cargando());
    try {
      const r = await api.get('/ventas', { pagina: estado.pagina, limite: estado.limite, desde: estado.desde, hasta: estado.hasta });
      if (marca !== marcaCarga) return;
      pintarResumen(r);
      pintarLista(r);
    } catch (error) {
      if (marca === marcaCarga) reemplazarHijos(zonaLista, bannerError(error, cargar));
    }
  }

  function pintarResumen({ resumen, paginacion }) {
    const pct = resumen.total > 0 ? `${formatoNumero(r2((resumen.margen / resumen.total) * 100))} % del total` : 'Sin ventas en el período';
    const tarjeta = (titulo, valor, nota, clase) => h('div', { class: ['kpi', clase] }, h('h3', {}, titulo), h('div', { class: 'valor' }, valor), h('div', { class: 'nota' }, nota));
    reemplazarHijos(zonaResumen, h('div', { class: 'kpis' },
      tarjeta('Vendido en el período', formatoCOP(resumen.total), `${formatoNumero(paginacion.total)} venta(s)`, 'destacado'),
      auth.puede('rentabilidad') ? tarjeta('Lo que costó hacerlo', formatoCOP(resumen.costo), 'Ingredientes de lo vendido') : null,
      auth.puede('rentabilidad') ? tarjeta('Ganancia', formatoCOP(resumen.margen), pct, 'tendencia-up') : null));
  }

  function pintarLista({ datos, paginacion }) {
    if (datos.length === 0) {
      reemplazarHijos(zonaLista, vacio('No hay ventas en el período seleccionado.', '🧾'));
      return;
    }
    reemplazarHijos(zonaLista,
      tabla({
        descripcion: 'Historial de ventas',
        columnas: [{ titulo: 'Venta' }, { titulo: 'Fecha' }, { titulo: 'Productos' }, { titulo: 'Total', num: true }, ...(verGanancia ? [{ titulo: 'Ganancia', num: true }] : []), { titulo: 'Registró' }],
        filas: datos.map((v) => ({ celdas: [
          `#${v.id}`,
          formatoFechaHora(v.creadoEn),
          h('span', {}, v.items.map((i) => `${i.cantidad}× ${i.nombre}`).join(', '), v.nota ? h('span', { class: 'sub' }, v.nota) : null),
          formatoCOP(v.total),
          ...(verGanancia ? [h('span', {}, formatoCOP(v.margen), h('span', { class: 'sub' }, v.total > 0 ? `${formatoNumero(r2((v.margen / v.total) * 100))} %` : ''))] : []),
          v.registradoPor ?? '—',
        ] })),
      }),
      paginador({ ...paginacion, alCambiar: (p) => { estado.pagina = p; cargar(); } }));
  }

  // ------------------------------------------------------------ Registrar venta
  async function abrirVenta() {
    let productos;
    try {
      productos = (await api.get('/productos', { limite: 100 })).datos.filter((p) => p.stock > 0 && estadoCaducidad(p.caducidad).clave !== 'vencido');
    } catch (e) { toast(mensajeDeError(e), 'error'); return; }
    if (productos.length === 0) { toast('No hay productos con stock vigente para vender', 'warning'); return; }
    const porSku = new Map(productos.map((p) => [p.sku, p]));
    let clave = nuevaClaveIdempotencia(); // una por intención de venta (ADR-16): reintentar no duplica
    const aviso = crearAvisoFormulario();
    const lista = h('div', { class: 'lineas-venta' });
    const resumen = h('div', { class: 'resumen-venta', 'aria-live': 'polite' });
    const nota = h('input', { type: 'text', maxlength: '200', id: idCampo('v-nota'), placeholder: 'Ej. pedido de cumpleaños, mostrador' });
    const lineas = [];

    function nuevaLinea(skuInicial = '') {
      const ids = { sku: idCampo('vl-sku'), cant: idCampo('vl-cant'), precio: idCampo('vl-precio') };
      const sel = h('select', { id: ids.sku },
        h('option', { value: '' }, 'Elige qué vendiste…'),
        ...productos.map((p) => h('option', { value: p.sku }, `${p.nombre} · ${formatoNumero(p.stock)} disp.`)));
      sel.value = skuInicial;
      const cant = h('input', { id: ids.cant, type: 'number', min: '1', step: '1', inputmode: 'numeric', value: '1' });
      const precio = h('input', { id: ids.precio, type: 'number', min: '0', step: 'any', inputmode: 'decimal' });
      const errores = { sku: h('p', { class: 'error-campo', role: 'alert' }), cantidad: h('p', { class: 'error-campo', role: 'alert' }), precioUnitario: h('p', { class: 'error-campo', role: 'alert' }) };
      const linea = { sel, cant, precio, errores };
      const quitar = h('button', { type: 'button', class: 'btn-remove', 'aria-label': 'Quitar producto', title: 'Quitar', onClick: () => {
        if (lineas.length === 1) return;
        lineas.splice(lineas.indexOf(linea), 1); linea.el.remove(); recalcular();
      } }, '×');
      const ponerPrecio = () => { precio.placeholder = porSku.get(sel.value) ? String(porSku.get(sel.value).precio) : 'Se pone solo'; };
      sel.addEventListener('change', () => { ponerPrecio(); recalcular(); });
      cant.addEventListener('input', recalcular);
      precio.addEventListener('input', recalcular);
      ponerPrecio();
      linea.el = h('div', { class: 'linea-venta' },
        h('div', { class: 'form-group' }, h('label', { for: ids.sku }, '¿Qué vendiste?'), sel, errores.sku),
        h('div', { class: 'form-group' }, h('label', { for: ids.cant }, '¿Cuántos?'), cant, errores.cantidad),
        h('div', { class: 'form-group' }, h('label', { for: ids.precio }, 'Precio c/u'), precio, errores.precioUnitario),
        quitar);
      linea.quitar = quitar;
      lineas.push(linea);
      lista.appendChild(linea.el);
      return linea;
    }

    function recalcular() {
      let total = 0; let costo = 0;
      for (const l of lineas) {
        const p = porSku.get(l.sel.value);
        const c = Number(l.cant.value);
        if (!p || !Number.isFinite(c) || c <= 0) continue;
        const precio = l.precio.value === '' ? p.precio : Number(l.precio.value);
        total += c * (Number.isFinite(precio) ? precio : 0);
        costo += c * (p.costoUnitario ?? 0);
      }
      const margen = total - costo;
      // Solo el total para quien vende; la ganancia la ve quien administra (menos números en pantalla).
      reemplazarHijos(resumen,
        auth.puede('rentabilidad') ? h('div', { class: 'margen' }, h('span', {}, 'Ganas'), h('span', {}, `${formatoCOP(margen)}${total > 0 ? ` · ${formatoNumero(r2((margen / total) * 100))} %` : ''}`)) : null,
        h('div', { class: 'total' }, h('span', {}, 'Total a cobrar'), h('span', {}, formatoCOP(total))));
      lineas.forEach((l) => { l.quitar.hidden = lineas.length === 1; });
    }

    nuevaLinea();
    recalcular();
    const vender = h('button', { type: 'submit', class: 'btn btn-acento' }, 'Registrar venta');
    const form = h('form', { novalidate: true },
      aviso.el,
      lista,
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onClick: () => { const l = nuevaLinea(); recalcular(); l.sel.focus(); } }, '＋ Agregar otro producto'),
      h('div', { class: 'form-group', style: { marginTop: '14px' } }, h('label', { for: nota.id }, 'Nota (opcional)'), nota),
      resumen,
      h('p', { class: 'ayuda' }, 'El precio se pone solo. Cámbialo solo si hiciste un descuento.'),
      h('div', { class: 'form-acciones' }, h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => modal.cerrar() }, 'Cancelar'), vender));
    const modal = abrirModal({ titulo: 'Registrar venta', contenido: form, ancho: 720 });
    lineas[0].sel.focus();

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      aviso.ocultar();
      const { errores, items, valido } = validarVenta(
        lineas.map((l) => ({ sku: l.sel.value, cantidad: l.cant.value, precioUnitario: l.precio.value })),
        { stockPorSku: new Map(productos.map((p) => [p.sku, p.stock])) });
      lineas.forEach((l, i) => {
        for (const [k, nodo] of Object.entries(l.errores)) nodo.textContent = errores.filas?.[i]?.[k] ?? '';
        l.sel.toggleAttribute('aria-invalid', Boolean(errores.filas?.[i]?.sku));
        l.cant.toggleAttribute('aria-invalid', Boolean(errores.filas?.[i]?.cantidad));
      });
      if (!valido) { if (errores.general) aviso.mostrar(errores.general); return; }
      const cuerpo = { items, ...(nota.value.trim() ? { nota: nota.value.trim() } : {}) };
      try {
        const r = await conBotonOcupado(vender, () => api.post('/ventas', cuerpo, { cabeceras: { 'Idempotency-Key': clave } }), 'Registrando…');
        clave = nuevaClaveIdempotencia();
        toast(`Venta #${r.id} registrada · ${formatoCOP(r.total)}`);
        modal.cerrar();
        ctx.refrescarAlertas?.();
        cargar();
      } catch (e) { aviso.mostrar(mensajeDeError(e)); }
    });
  }

  return {
    el, titulo: 'Ventas', cargar,
    accion(a) { if (a === 'nueva' && puedeVender) abrirVenta(); }, destruir() { marcaCarga++; } };
}

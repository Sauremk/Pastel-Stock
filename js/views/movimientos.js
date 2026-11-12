// Movimientos: registro de entradas (solo admin/operador) + kardex con filtros. Corrige DT-08.
import {
  h, reemplazarHijos, cargando, vacio, bannerError, tabla, insignia, paginador, encabezadoVista,
  toast, campo, idCampo, selectControl, mostrarErrores, crearAvisoFormulario, conBotonOcupado,
} from '../ui.js';
import { formatoNumero, formatoFechaHora, infoEstado, mensajeDeError, hoyISO } from '../format.js';
import { validarEntrada } from '../validacion.js';
import { TEXTO_MOTIVO } from '../catalogos.js';
import { pestanasInventario } from '../ui.js';

const CLASE_TIPO = { ENTRADA: 'entrada', SALIDA: 'salida', AJUSTE: 'ajuste', AJUSTE_NEGATIVO: 'ajuste-neg' };
const TEXTO_TIPO = { ENTRADA: 'Entrada', SALIDA: 'Salida', AJUSTE: 'Ajuste +', AJUSTE_NEGATIVO: 'Ajuste −' };
const RESTA = new Set(['SALIDA', 'AJUSTE_NEGATIVO']);

export function crearVista(ctx) {
  const { api, auth } = ctx;
  const puedeRegistrar = auth.puede('movimientos');
  const estado = { pagina: 1, limite: 20, codigo: '', tipo: '', desde: '', hasta: '' };
  let marcaCarga = 0;
  let materias = [];

  const zonaFormulario = h('div', {});
  const zonaKardex = h('div', {});
  const filtroCodigo = selectControl([], { placeholder: 'Todas', 'aria-label': 'Filtrar por materia prima' });
  const filtroTipo = selectControl(Object.entries(TEXTO_TIPO).map(([valor, texto]) => ({ valor, texto })), { placeholder: 'Todos', 'aria-label': 'Filtrar por tipo' });
  const filtroDesde = h('input', { type: 'date', max: hoyISO() });
  const filtroHasta = h('input', { type: 'date', max: hoyISO() });

  const el = h('section', { class: 'vista activa', 'aria-labelledby': 'titulo-movimientos' },
    encabezadoVista('Inventario', 'Anota aquí los ingredientes que te llegan. Abajo ves todo lo que ha entrado y salido.'),
    pestanasInventario('movimientos'),
    puedeRegistrar ? h('div', { class: 'panel panel-destacado' }, h('h2', {}, '📦 ¿Llegaron ingredientes? Anótalos'), zonaFormulario) : null,
    h('div', { class: 'panel' },
      h('h2', {}, 'Historial de ingredientes'),
      h('div', { class: 'barra-filtros' },
        h('label', {}, 'Ingrediente', filtroCodigo),
        h('label', {}, 'Tipo', filtroTipo),
        h('label', {}, 'Desde', filtroDesde),
        h('label', {}, 'Hasta', filtroHasta)),
      zonaKardex));
  el.querySelector('h1').id = 'titulo-movimientos';

  filtroCodigo.addEventListener('change', () => { estado.codigo = filtroCodigo.value; estado.pagina = 1; cargarKardex(); });
  filtroTipo.addEventListener('change', () => { estado.tipo = filtroTipo.value; estado.pagina = 1; cargarKardex(); });
  filtroDesde.addEventListener('change', () => { estado.desde = filtroDesde.value; estado.pagina = 1; cargarKardex(); });
  filtroHasta.addEventListener('change', () => { estado.hasta = filtroHasta.value; estado.pagina = 1; cargarKardex(); });

  function llenarSelectores() {
    const opciones = materias.map((m) => ({ valor: m.codigo, texto: m.nombre }));
    const valorFiltro = filtroCodigo.value;
    filtroCodigo.replaceChildren(h('option', { value: '' }, 'Todas'), ...opciones.map((o) => h('option', { value: o.valor }, o.texto)));
    filtroCodigo.value = valorFiltro;
    if (puedeRegistrar) pintarFormulario(opciones);
  }

  function pintarFormulario(opciones) {
    const aviso = crearAvisoFormulario();
    const campos = {
      codigo: campo({ id: idCampo('ent-mp'), etiqueta: '¿Qué llegó?', requerido: true, control: selectControl(opciones, { placeholder: 'Elige el ingrediente…' }) }),
      cantidad: campo({ id: idCampo('ent-cant'), etiqueta: '¿Cuánto llegó?', requerido: true, ayuda: 'En la unidad del ingrediente (te la mostramos al elegirlo).',
        control: h('input', { type: 'number', min: '0', step: 'any', inputmode: 'decimal', placeholder: 'Ej. 10' }) }),
      proveedor: campo({ id: idCampo('ent-prov'), etiqueta: '¿Quién lo trajo?', requerido: true, control: h('input', { type: 'text', maxlength: '80', placeholder: 'Ej. Molinos del Valle' }) }),
      nota: campo({ id: idCampo('ent-nota'), etiqueta: 'Nota (opcional)', control: h('input', { type: 'text', maxlength: '200' }) }),
    };
    const unidad = h('span', { class: 'solo-lectura' });
    campos.codigo.control.addEventListener('change', () => {
      const m = materias.find((x) => x.codigo === campos.codigo.control.value);
      unidad.textContent = m ? `Se mide en ${m.unidad} · hoy hay ${formatoNumero(m.stock)} ${m.unidad}` : '';
    });
    const registrar = h('button', { type: 'submit', class: 'btn' }, '✓ Guardar lo que llegó');
    const form = h('form', { novalidate: true },
      aviso.el,
      h('div', { class: 'form-row' }, campos.codigo.grupo, campos.proveedor.grupo),
      h('div', { class: 'form-row' }, campos.cantidad.grupo, campos.nota.grupo),
      h('div', { class: 'form-acciones' }, unidad, registrar));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      aviso.ocultar();
      const crudo = Object.fromEntries(Object.entries(campos).map(([n, c]) => [n, c.control.value]));
      const { errores, datos, valido } = validarEntrada(crudo);
      mostrarErrores(campos, errores);
      if (!valido) return;
      try {
        const r = await conBotonOcupado(registrar, () => api.post('/movimientos/entradas', datos), 'Registrando…');
        const e = infoEstado(r.estado);
        toast(`Listo: ahora hay ${formatoNumero(r.stock)} ${materias.find((x) => x.codigo === r.codigo)?.unidad ?? ''} de ${materias.find((x) => x.codigo === r.codigo)?.nombre ?? r.codigo} (${e.texto.toLowerCase()})`);
        form.reset();
        unidad.textContent = '';
        const m = materias.find((x) => x.codigo === r.codigo);
        if (m) { m.stock = r.stock; m.estado = r.estado; }
        estado.pagina = 1;
        cargarKardex();
      } catch (e) { aviso.mostrar(mensajeDeError(e)); }
    });
    reemplazarHijos(zonaFormulario, form);
  }

  async function cargarKardex() {
    const marca = ++marcaCarga;
    reemplazarHijos(zonaKardex, cargando());
    try {
      const r = await api.get('/movimientos', { pagina: estado.pagina, limite: estado.limite, codigo: estado.codigo, tipo: estado.tipo, desde: estado.desde, hasta: estado.hasta });
      if (marca !== marcaCarga) return;
      if (r.datos.length === 0) {
        reemplazarHijos(zonaKardex, vacio('No hay movimientos para los filtros seleccionados.', '📒'));
        return;
      }
      const nombres = new Map(materias.map((m) => [m.codigo, m.nombre]));
      reemplazarHijos(zonaKardex,
        tabla({
          descripcion: 'Kardex de movimientos de inventario',
          columnas: [{ titulo: 'Fecha y hora' }, { titulo: 'Materia prima' }, { titulo: 'Tipo' }, { titulo: 'Cantidad', num: true }, { titulo: 'Proveedor' }, { titulo: 'Registrado por' }, { titulo: 'Motivo / nota' }],
          filas: r.datos.map((m) => ({ celdas: [
            formatoFechaHora(m.creadoEn),
            h('span', {}, nombres.get(m.codigo) ?? m.codigo, h('span', { class: 'sub' }, m.codigo)),
            insignia(TEXTO_TIPO[m.tipo] ?? m.tipo, CLASE_TIPO[m.tipo]),
            `${RESTA.has(m.tipo) ? '−' : '+'}${formatoNumero(m.cantidad)}`, m.proveedor ?? '—', m.registradoPor ?? '—',
            [...new Set([TEXTO_MOTIVO[m.motivo], m.nota].filter(Boolean))].join(' · ') || '—',
          ] })),
        }),
        paginador({ ...r.paginacion, alCambiar: (p) => { estado.pagina = p; cargarKardex(); } }));
    } catch (error) {
      if (marca === marcaCarga) reemplazarHijos(zonaKardex, bannerError(error, cargarKardex));
    }
  }

  async function cargar() {
    try {
      const r = await api.get('/materias-primas', { limite: 100 });
      materias = r.datos;
    } catch (error) {
      reemplazarHijos(zonaKardex, bannerError(error, cargar));
      return;
    }
    llenarSelectores();
    await cargarKardex();
  }

  return {
    el, titulo: 'Entradas', cargar,
    accion(a) { if (a === 'entrada') { const c = zonaFormulario.querySelector('select'); c?.scrollIntoView?.({ block: 'center' }); c?.focus(); } }, destruir() { marcaCarga++; } };
}

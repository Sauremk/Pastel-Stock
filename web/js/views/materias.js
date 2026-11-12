// Materias primas: CRUD con filtros del servidor (q, categoría, estado) y paginación.
import {
  h, reemplazarHijos, cargando, vacio, bannerError, tabla, insignia, paginador, debounce, encabezadoVista,
  abrirModal, confirmar, toast, toastError, campo, idCampo, selectControl, mostrarErrores, crearAvisoFormulario, conBotonOcupado,
} from '../ui.js';
import { CATEGORIAS_MP, UNIDADES } from '../catalogos.js';
import { formatoCOP, formatoNumero, infoEstado, mensajeDeError } from '../format.js';
import { validarMateria } from '../validacion.js';
import { botonesExportar } from './exportar.js';
import { abrirAjuste } from './ajuste.js';

export function crearVista(ctx) {
  const { api, auth } = ctx;
  const estado = { pagina: 1, limite: 20, q: '', categoria: '', estado: '' };
  const puedeEditar = auth.puede('catalogo');
  const puedeAjustar = auth.puede('ajustes');
  let marcaCarga = 0;

  const zona = h('div', { class: 'table-zona' });
  const buscar = h('input', { type: 'search', id: 'mp-buscar', placeholder: 'Buscar por código o nombre…', 'aria-label': 'Buscar materia prima', maxlength: '60' });
  const selCategoria = selectControl(CATEGORIAS_MP, { placeholder: 'Todas las categorías', class: 'filter-select', 'aria-label': 'Filtrar por categoría' });
  const selEstado = selectControl([{ valor: 'CRITICO', texto: 'Crítico' }, { valor: 'BAJO', texto: 'Bajo' }, { valor: 'OPTIMO', texto: 'Óptimo' }],
    { placeholder: 'Todos los estados', class: 'filter-select', 'aria-label': 'Filtrar por estado de stock' });

  const botonNueva = puedeEditar ? h('button', { type: 'button', class: 'btn', onClick: () => abrirFormulario(null) }, '+ Nueva') : null;

  const el = h('section', { class: 'vista activa', 'aria-labelledby': 'titulo-materias' },
    encabezadoVista('Materias primas'),
    h('div', { class: 'panel' },
      h('div', { class: 'panel-header' },
        h('div', { class: 'search-box' }, buscar),
        selCategoria, selEstado,
        h('div', { class: 'panel-actions' }, botonesExportar(ctx, 'materias'), botonNueva)),
      zona));
  el.querySelector('h1').id = 'titulo-materias';

  buscar.addEventListener('input', debounce(() => { estado.q = buscar.value.trim(); estado.pagina = 1; cargar(); }));
  selCategoria.addEventListener('change', () => { estado.categoria = selCategoria.value; estado.pagina = 1; cargar(); });
  selEstado.addEventListener('change', () => { estado.estado = selEstado.value; estado.pagina = 1; cargar(); });

  async function cargar() {
    const marca = ++marcaCarga;
    reemplazarHijos(zona, cargando());
    try {
      const r = await api.get('/materias-primas', { pagina: estado.pagina, limite: estado.limite, q: estado.q, categoria: estado.categoria, estado: estado.estado });
      if (marca !== marcaCarga) return;
      if (r.datos.length === 0 && r.paginacion.total > 0 && estado.pagina > 1) { estado.pagina -= 1; return cargar(); }
      pintar(r);
    } catch (error) {
      if (marca === marcaCarga) reemplazarHijos(zona, bannerError(error, cargar));
    }
  }

  function pintar({ datos, paginacion }) {
    if (datos.length === 0) {
      const filtrando = estado.q || estado.categoria || estado.estado;
      reemplazarHijos(zona, vacio(filtrando ? 'Ninguna materia prima coincide con los filtros.' : 'Aún no hay materias primas registradas.'));
      return;
    }
    const columnas = [{ titulo: 'Código' }, { titulo: 'Nombre' }, { titulo: 'Categoría' }, { titulo: 'Stock', num: true }, { titulo: 'Unidad' },
      { titulo: 'Mínimo', num: true }, { titulo: 'Costo (COP)', num: true }, { titulo: 'Estado' }, { titulo: 'Acciones' }];
    const filas = datos.map((m) => {
      const e = infoEstado(m.estado);
      const acciones = puedeEditar || puedeAjustar
        ? h('div', { class: 'action-buttons' },
          puedeAjustar ? h('button', { type: 'button', class: 'btn-icon', 'aria-label': `Ajustar stock de ${m.nombre} por conteo`, title: 'Ajustar por conteo', onClick: () => abrirAjuste({ api, tipo: 'materia', item: m, alTerminar: () => { ctx.refrescarAlertas?.(); cargar(); } }) }, '⚖️') : null,
          puedeEditar ? h('button', { type: 'button', class: 'btn-icon edit', 'aria-label': `Editar ${m.nombre}`, title: 'Editar', onClick: () => abrirFormulario(m) }, '✏️') : null,
          puedeEditar ? h('button', { type: 'button', class: 'btn-icon delete', 'aria-label': `Eliminar ${m.nombre}`, title: 'Eliminar', onClick: () => eliminar(m) }, '🗑️') : null)
        : h('span', { class: 'solo-lectura' }, 'Solo lectura');
      return { celdas: [m.codigo, m.nombre, m.categoria, formatoNumero(m.stock), m.unidad, formatoNumero(m.minimo), formatoCOP(m.costo), insignia(e.texto, e.clase), acciones] };
    });
    reemplazarHijos(zona,
      tabla({ columnas, filas, descripcion: 'Listado de materias primas' }),
      paginador({ ...paginacion, alCambiar: (p) => { estado.pagina = p; cargar(); } }));
  }

  async function eliminar(m) {
    const ok = await confirmar({ titulo: 'Eliminar materia prima', mensaje: `¿Eliminar «${m.nombre}» (${m.codigo})? Esta acción no se puede deshacer.` });
    if (!ok) return;
    try {
      await api.del(`/materias-primas/${encodeURIComponent(m.codigo)}`);
      toast('Materia prima eliminada');
      cargar();
    } catch (e) { toastError(e); }
  }

  function abrirFormulario(existente) {
    const editando = existente !== null;
    const aviso = crearAvisoFormulario();
    const campos = {};
    const nuevo = (nombre, config) => { campos[nombre] = campo({ id: idCampo(`mp-${nombre}`), ...config }); return campos[nombre]; };

    if (!editando) {
      nuevo('codigo', { etiqueta: 'Código', requerido: true, ayuda: 'Formato MP006', control: h('input', { type: 'text', placeholder: 'MP006', maxlength: '12', autocomplete: 'off' }) });
    }
    nuevo('nombre', { etiqueta: 'Nombre', requerido: true, control: h('input', { type: 'text', value: existente?.nombre ?? '', maxlength: '80', placeholder: 'Ej. Harina de almendra' }) });
    nuevo('categoria', { etiqueta: 'Categoría', requerido: true, control: selectControl(CATEGORIAS_MP, { valor: existente?.categoria ?? '', placeholder: 'Seleccionar…' }) });
    nuevo('unidad', { etiqueta: 'Unidad', requerido: true, control: selectControl(UNIDADES, { valor: existente?.unidad ?? 'g' }) });
    if (!editando) {
      nuevo('stock', { etiqueta: 'Stock inicial', requerido: true, control: h('input', { type: 'number', min: '0', step: 'any', inputmode: 'decimal', placeholder: '0' }) });
    }
    nuevo('minimo', { etiqueta: 'Stock mínimo', requerido: true, control: h('input', { type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: existente?.minimo ?? '', placeholder: '0' }) });
    nuevo('costo', { etiqueta: 'Costo unitario (COP)', requerido: true, control: h('input', { type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: existente?.costo ?? '', placeholder: 'Ej. 2500' }) });

    const guardar = h('button', { type: 'submit', class: 'btn' }, 'Guardar');
    const form = h('form', { novalidate: true },
      aviso.el,
      campos.codigo?.grupo,
      campos.nombre.grupo,
      h('div', { class: 'form-row' }, campos.categoria.grupo, campos.unidad.grupo),
      editando
        ? h('div', { class: 'form-group' }, h('div', { class: 'ayuda' }, 'Stock actual'),
          h('div', { class: 'campo-solo-lectura' }, `${formatoNumero(existente.stock)} ${existente.unidad} — el stock solo cambia con movimientos (entradas y producción).`))
        : campos.stock.grupo,
      h('div', { class: 'form-row' }, campos.minimo.grupo, campos.costo.grupo),
      h('div', { class: 'form-acciones' }, h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => modal.cerrar() }, 'Cancelar'), guardar));

    const modal = abrirModal({ titulo: editando ? `Editar ${existente.codigo}` : 'Nueva materia prima', contenido: form });

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      aviso.ocultar();
      const crudo = Object.fromEntries(Object.entries(campos).map(([n, c]) => [n, c.control.value]));
      const { errores, datos, valido } = validarMateria(crudo, { modo: editando ? 'editar' : 'crear' });
      mostrarErrores(campos, errores);
      if (!valido) return;
      try {
        await conBotonOcupado(guardar, () => (editando
          ? api.put(`/materias-primas/${encodeURIComponent(existente.codigo)}`, datos)
          : api.post('/materias-primas', datos)));
        toast(editando ? 'Materia prima actualizada' : 'Materia prima creada');
        modal.cerrar();
        cargar();
      } catch (e) {
        aviso.mostrar(mensajeDeError(e));
        aviso.el.scrollIntoView?.({ block: 'nearest' });
      }
    });
  }

  return { el, titulo: 'Materias primas', cargar, destruir() { marcaCarga++; } };
}

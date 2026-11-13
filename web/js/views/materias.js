// Materias primas: CRUD con filtros del servidor (q, categoría, estado) y paginación.
import {
  h, reemplazarHijos, cargando, vacio, bannerError, tabla, insignia, paginador, debounce, encabezadoVista,
  abrirModal, confirmar, toast, toastError, campo, idCampo, selectControl, mostrarErrores, crearAvisoFormulario, conBotonOcupado,
  pestanasInventario, siguienteCodigo,
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
  const buscar = h('input', { type: 'search', id: 'mp-buscar', placeholder: 'Buscar un ingrediente…', 'aria-label': 'Buscar ingrediente', maxlength: '60' });
  const selEstado = selectControl([{ valor: 'CRITICO', texto: 'Muy poco' }, { valor: 'BAJO', texto: 'Poco' }, { valor: 'OPTIMO', texto: 'Suficiente' }],
    { placeholder: 'Cualquier cantidad', class: 'filter-select', 'aria-label': 'Filtrar por cantidad' });

  const botonNueva = puedeEditar ? h('button', { type: 'button', class: 'btn', onClick: () => abrirFormulario(null) }, '＋ Agregar ingrediente') : null;

  const el = h('section', { class: 'vista activa', 'aria-labelledby': 'titulo-materias' },
    encabezadoVista('Inventario', 'Lo que tienes en bodega. Si la cantidad real es distinta, toca «Contar».'),
    pestanasInventario('materias'),
    h('div', { class: 'panel' },
      h('div', { class: 'panel-header' },
        h('div', { class: 'search-box' }, buscar),
        selEstado,
        h('div', { class: 'panel-actions' }, botonesExportar(ctx, 'materias'), botonNueva)),
      zona));
  el.querySelector('h1').id = 'titulo-materias';

  buscar.addEventListener('input', debounce(() => { estado.q = buscar.value.trim(); estado.pagina = 1; cargar(); }));
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
      reemplazarHijos(zona, vacio(filtrando ? 'Ningún ingrediente coincide con la búsqueda.' : 'Aún no hay ingredientes. Toca «Agregar ingrediente».'));
      return;
    }
    const columnas = [{ titulo: 'Ingrediente' }, { titulo: 'Hay', num: true }, { titulo: 'Avisar bajo', num: true }, { titulo: '¿Alcanza?' }, { titulo: '' }];
    const filas = datos.map((m) => {
      const e = infoEstado(m.estado);
      const acciones = puedeEditar || puedeAjustar
        ? h('div', { class: 'action-buttons' },
          puedeAjustar ? h('button', { type: 'button', class: 'btn-icon', 'aria-label': `Contar ${m.nombre}`, onClick: () => abrirAjuste({ api, tipo: 'materia', item: m, alTerminar: () => { ctx.refrescarAlertas?.(); cargar(); } }) }, '⚖️ Contar') : null,
          puedeEditar ? h('button', { type: 'button', class: 'btn-icon edit', 'aria-label': `Editar ${m.nombre}`, onClick: () => abrirFormulario(m) }, '✏️ Editar') : null)
        : h('span', { class: 'solo-lectura' }, 'Solo lectura');
      return { celdas: [
        h('span', {}, m.nombre, h('span', { class: 'sub' }, puedeEditar ? `${m.categoria} · ${formatoCOP(m.costo)} por ${m.unidad}` : m.categoria)),
        `${formatoNumero(m.stock)} ${m.unidad}`, `${formatoNumero(m.minimo)} ${m.unidad}`, insignia(e.texto, e.clase), acciones] };
    });
    reemplazarHijos(zona,
      tabla({ columnas, filas, descripcion: 'Ingredientes' }),
      paginador({ ...paginacion, alCambiar: (p) => { estado.pagina = p; cargar(); } }));
  }

  async function eliminar(m) {
    const ok = await confirmar({ titulo: 'Eliminar ingrediente', mensaje: `¿Eliminar «${m.nombre}»? Esta acción no se puede deshacer.` });
    if (!ok) return false;
    try {
      await api.del(`/materias-primas/${encodeURIComponent(m.codigo)}`);
      toast('Ingrediente eliminado');
      cargar();
      return true;
    } catch (e) { toastError(e); return false; }
  }

  async function abrirFormulario(existente) {
    const editando = existente !== null;
    // El código se asigna solo (MP006…): la persona no tiene que inventarlo.
    let codigoNuevo = null;
    if (!editando) {
      try { codigoNuevo = siguienteCodigo('MP', (await api.get('/materias-primas', { limite: 100 })).datos.map((m) => m.codigo)); } catch { codigoNuevo = null; }
    }
    const aviso = crearAvisoFormulario();
    const campos = {};
    const nuevo = (nombre, config) => { campos[nombre] = campo({ id: idCampo(`mp-${nombre}`), ...config }); return campos[nombre]; };

    if (!editando) {
      nuevo('codigo', { etiqueta: 'Código', requerido: true, ayuda: 'Se asigna solo; puedes dejarlo así.', control: h('input', { type: 'text', value: codigoNuevo ?? '', placeholder: 'MP006', maxlength: '12', autocomplete: 'off' }) });
    }
    nuevo('nombre', { etiqueta: 'Nombre', requerido: true, control: h('input', { type: 'text', value: existente?.nombre ?? '', maxlength: '80', placeholder: 'Ej. Harina de almendra' }) });
    nuevo('categoria', { etiqueta: 'Categoría', requerido: true, control: selectControl(CATEGORIAS_MP, { valor: existente?.categoria ?? '', placeholder: 'Seleccionar…' }) });
    nuevo('unidad', { etiqueta: 'Se mide en', requerido: true, control: selectControl(UNIDADES, { valor: existente?.unidad ?? 'g' }) });
    if (!editando) {
      nuevo('stock', { etiqueta: 'Cantidad que tienes ahora', requerido: true, control: h('input', { type: 'number', min: '0', step: 'any', inputmode: 'decimal', placeholder: '0' }) });
    }
    nuevo('minimo', { etiqueta: 'Avisarme cuando queden menos de', requerido: true, control: h('input', { type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: existente?.minimo ?? '', placeholder: '0' }) });
    nuevo('costo', { etiqueta: 'Cuánto te cuesta cada unidad ($)', requerido: true, control: h('input', { type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: existente?.costo ?? '', placeholder: 'Ej. 2500' }) });

    const guardar = h('button', { type: 'submit', class: 'btn' }, 'Guardar');
    const form = h('form', { novalidate: true },
      aviso.el,
      campos.codigo?.grupo,
      campos.nombre.grupo,
      h('div', { class: 'form-row' }, campos.categoria.grupo, campos.unidad.grupo),
      editando
        ? h('div', { class: 'form-group' }, h('div', { class: 'ayuda' }, 'Cantidad actual'),
          h('div', { class: 'campo-solo-lectura' }, `${formatoNumero(existente.stock)} ${existente.unidad} — para corregirla usa «Contar».`))
        : campos.stock.grupo,
      h('div', { class: 'form-row' }, campos.minimo.grupo, campos.costo.grupo),
      h('div', { class: 'form-acciones' },
        editando ? h('button', { type: 'button', class: 'btn btn-link texto-peligro', onClick: async () => { if (await eliminar(existente)) modal.cerrar(); } }, 'Eliminar ingrediente') : null,
        h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => modal.cerrar() }, 'Cancelar'), guardar));

    const modal = abrirModal({ titulo: editando ? `Editar ${existente.nombre}` : 'Agregar ingrediente', contenido: form });

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
        toast(editando ? 'Ingrediente actualizado' : 'Ingrediente agregado');
        modal.cerrar();
        cargar();
      } catch (e) {
        aviso.mostrar(mensajeDeError(e));
        aviso.el.scrollIntoView?.({ block: 'nearest' });
      }
    });
  }

  return { el, titulo: 'Ingredientes', cargar, destruir() { marcaCarga++; } };
}

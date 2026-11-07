// Productos terminados: CRUD con resaltado de vencidos / por vencer.
import {
  h, reemplazarHijos, cargando, vacio, bannerError, tabla, insignia, debounce, encabezadoVista,
  abrirModal, confirmar, toast, toastError, campo, idCampo, selectControl, mostrarErrores, crearAvisoFormulario, conBotonOcupado,
} from '../ui.js';
import { CATEGORIAS_PT } from '../catalogos.js';
import { formatoCOP, formatoFecha, estadoCaducidad, mensajeDeError } from '../format.js';
import { validarProducto } from '../validacion.js';
import { botonesExportar } from './exportar.js';

export function crearVista(ctx) {
  const { api, auth } = ctx;
  const puedeEditar = auth.puede('catalogo');
  let todos = [];
  let marcaCarga = 0;
  const filtros = { q: '', categoria: '' };

  const zona = h('div', {});
  const buscar = h('input', { type: 'search', placeholder: 'Buscar por SKU o nombre…', 'aria-label': 'Buscar producto', maxlength: '60' });
  const selCategoria = selectControl(CATEGORIAS_PT, { placeholder: 'Todas las categorías', class: 'filter-select', 'aria-label': 'Filtrar por categoría' });
  const botonNuevo = puedeEditar ? h('button', { type: 'button', class: 'btn', onClick: () => abrirFormulario(null) }, '+ Nuevo producto') : null;

  const el = h('section', { class: 'vista activa', 'aria-labelledby': 'titulo-productos' },
    encabezadoVista('Productos terminados'),
    h('div', { class: 'panel' },
      h('div', { class: 'panel-header' },
        h('div', { class: 'search-box' }, buscar), selCategoria,
        h('div', { class: 'panel-actions' }, botonesExportar(ctx, 'productos'), botonNuevo)),
      zona));
  el.querySelector('h1').id = 'titulo-productos';

  buscar.addEventListener('input', debounce(() => { filtros.q = buscar.value.trim().toLowerCase(); pintar(); }, 150));
  selCategoria.addEventListener('change', () => { filtros.categoria = selCategoria.value; cargar(); });

  async function cargar() {
    const marca = ++marcaCarga;
    reemplazarHijos(zona, cargando());
    try {
      const r = await api.get('/productos', { limite: 100, categoria: filtros.categoria });
      if (marca !== marcaCarga) return;
      todos = r.datos;
      pintar();
    } catch (error) {
      if (marca === marcaCarga) reemplazarHijos(zona, bannerError(error, cargar));
    }
  }

  function pintar() {
    const lista = todos.filter((p) => !filtros.q || p.sku.toLowerCase().includes(filtros.q) || p.nombre.toLowerCase().includes(filtros.q));
    if (lista.length === 0) {
      reemplazarHijos(zona, vacio(todos.length ? 'Ningún producto coincide con la búsqueda.' : 'Aún no hay productos registrados.', '🎂'));
      return;
    }
    const columnas = [{ titulo: 'SKU' }, { titulo: 'Nombre' }, { titulo: 'Categoría' }, { titulo: 'Stock', num: true }, { titulo: 'Precio (COP)', num: true }, { titulo: 'Caducidad' }, { titulo: 'Acciones' }];
    const filas = lista.map((p) => {
      const cad = estadoCaducidad(p.caducidad);
      const acciones = puedeEditar
        ? h('div', { class: 'action-buttons' },
          h('button', { type: 'button', class: 'btn-icon edit', 'aria-label': `Editar ${p.nombre}`, title: 'Editar', onClick: () => abrirFormulario(p) }, '✏️'),
          h('button', { type: 'button', class: 'btn-icon delete', 'aria-label': `Eliminar ${p.nombre}`, title: 'Eliminar', onClick: () => eliminar(p) }, '🗑️'))
        : h('span', { class: 'solo-lectura' }, 'Solo lectura');
      return {
        clase: cad.clave === 'vencido' ? 'fila-vencida' : cad.clave === 'por-vencer' ? 'fila-por-vencer' : null,
        celdas: [p.sku, p.nombre, p.categoria, String(p.stock), formatoCOP(p.precio),
          h('span', {}, formatoFecha(p.caducidad), ' ', insignia(cad.texto, cad.clase)), acciones],
      };
    });
    reemplazarHijos(zona, tabla({ columnas, filas, descripcion: 'Listado de productos terminados' }));
  }

  async function eliminar(p) {
    const ok = await confirmar({ titulo: 'Eliminar producto', mensaje: `¿Eliminar «${p.nombre}» (${p.sku})? Esta acción no se puede deshacer.` });
    if (!ok) return;
    try {
      await api.del(`/productos/${encodeURIComponent(p.sku)}`);
      toast('Producto eliminado');
      cargar();
    } catch (e) { toastError(e); }
  }

  function abrirFormulario(existente) {
    const editando = existente !== null;
    const aviso = crearAvisoFormulario();
    const campos = {};
    const nuevo = (nombre, config) => { campos[nombre] = campo({ id: idCampo(`pt-${nombre}`), ...config }); return campos[nombre]; };
    if (!editando) nuevo('sku', { etiqueta: 'SKU', requerido: true, ayuda: 'Formato PT005', control: h('input', { type: 'text', placeholder: 'PT005', maxlength: '12', autocomplete: 'off' }) });
    nuevo('nombre', { etiqueta: 'Nombre', requerido: true, control: h('input', { type: 'text', value: existente?.nombre ?? '', maxlength: '80', placeholder: 'Ej. Pastel Red Velvet' }) });
    nuevo('categoria', { etiqueta: 'Categoría', requerido: true, control: selectControl(CATEGORIAS_PT, { valor: existente?.categoria ?? '', placeholder: 'Seleccionar…' }) });
    nuevo('stock', { etiqueta: 'Stock (unidades)', requerido: true, control: h('input', { type: 'number', min: '0', step: '1', inputmode: 'numeric', value: existente?.stock ?? '', placeholder: '0' }) });
    nuevo('precio', { etiqueta: 'Precio de venta (COP)', requerido: true, control: h('input', { type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: existente?.precio ?? '', placeholder: 'Ej. 35000' }) });
    nuevo('caducidad', { etiqueta: 'Fecha de caducidad', requerido: true, control: h('input', { type: 'date', value: existente?.caducidad ?? '' }) });

    const guardar = h('button', { type: 'submit', class: 'btn' }, 'Guardar');
    const form = h('form', { novalidate: true },
      aviso.el,
      campos.sku?.grupo,
      campos.nombre.grupo,
      h('div', { class: 'form-row' }, campos.categoria.grupo, campos.caducidad.grupo),
      h('div', { class: 'form-row' }, campos.stock.grupo, campos.precio.grupo),
      h('div', { class: 'form-acciones' }, h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => modal.cerrar() }, 'Cancelar'), guardar));
    const modal = abrirModal({ titulo: editando ? `Editar ${existente.sku}` : 'Nuevo producto', contenido: form });

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      aviso.ocultar();
      const crudo = Object.fromEntries(Object.entries(campos).map(([n, c]) => [n, c.control.value]));
      const { errores, datos, valido } = validarProducto(crudo, { modo: editando ? 'editar' : 'crear' });
      mostrarErrores(campos, errores);
      if (!valido) return;
      try {
        await conBotonOcupado(guardar, () => (editando
          ? api.put(`/productos/${encodeURIComponent(existente.sku)}`, datos)
          : api.post('/productos', datos)));
        toast(editando ? 'Producto actualizado' : 'Producto creado');
        modal.cerrar();
        cargar();
      } catch (e) { aviso.mostrar(mensajeDeError(e)); }
    });
  }

  return { el, titulo: 'Productos', cargar, destruir() { marcaCarga++; } };
}

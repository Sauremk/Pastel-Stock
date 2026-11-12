// Productos terminados: CRUD con resaltado de vencidos / por vencer.
import {
  h, reemplazarHijos, cargando, vacio, bannerError, tabla, insignia, debounce, encabezadoVista,
  abrirModal, confirmar, toast, toastError, campo, idCampo, selectControl, mostrarErrores, crearAvisoFormulario, conBotonOcupado,
  pestanasInventario, siguienteCodigo,
} from '../ui.js';
import { CATEGORIAS_PT } from '../catalogos.js';
import { formatoCOP, formatoFecha, estadoCaducidad, mensajeDeError } from '../format.js';
import { validarProducto } from '../validacion.js';
import { botonesExportar } from './exportar.js';
import { abrirAjuste, abrirKardexProducto } from './ajuste.js';

export function crearVista(ctx) {
  const { api, auth } = ctx;
  const puedeEditar = auth.puede('catalogo');
  const puedeAjustar = auth.puede('ajustes');
  let todos = [];
  let marcaCarga = 0;
  const filtros = { q: '', categoria: '' };

  const zona = h('div', {});
  const buscar = h('input', { type: 'search', placeholder: 'Buscar un producto…', 'aria-label': 'Buscar producto', maxlength: '60' });
  const botonNuevo = puedeEditar ? h('button', { type: 'button', class: 'btn', onClick: () => abrirFormulario(null) }, '＋ Agregar producto') : null;

  const el = h('section', { class: 'vista activa', 'aria-labelledby': 'titulo-productos' },
    encabezadoVista('Inventario', 'Lo que ya está listo para vender. Rojo = vencido, amarillo = vence pronto.'),
    pestanasInventario('productos'),
    h('div', { class: 'panel' },
      h('div', { class: 'panel-header' },
        h('div', { class: 'search-box' }, buscar),
        h('div', { class: 'panel-actions' }, botonesExportar(ctx, 'productos'), botonNuevo)),
      zona));
  el.querySelector('h1').id = 'titulo-productos';

  buscar.addEventListener('input', debounce(() => { filtros.q = buscar.value.trim().toLowerCase(); pintar(); }, 150));

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
      reemplazarHijos(zona, vacio(todos.length ? 'Ningún producto coincide con la búsqueda.' : 'Aún no hay productos. Toca «Agregar producto».', '🎂'));
      return;
    }
    const columnas = [{ titulo: 'Producto' }, { titulo: 'Hay', num: true }, { titulo: 'Precio', num: true }, { titulo: 'Vence' }, { titulo: '' }];
    const filas = lista.map((p) => {
      const cad = estadoCaducidad(p.caducidad);
      const margen = p.precio > 0 && p.costoUnitario > 0 ? Math.round(((p.precio - p.costoUnitario) / p.precio) * 100) : null;
      const acciones = h('div', { class: 'action-buttons' },
        puedeAjustar ? h('button', { type: 'button', class: 'btn-icon', 'aria-label': `Contar ${p.nombre}`, onClick: () => abrirAjuste({ api, tipo: 'producto', item: p, alTerminar: () => { ctx.refrescarAlertas?.(); cargar(); } }) }, '⚖️ Contar') : null,
        h('button', { type: 'button', class: 'btn-icon', 'aria-label': `Historial de ${p.nombre}`, onClick: () => abrirKardexProducto({ api, producto: p }) }, '📜 Historial'),
        puedeEditar ? h('button', { type: 'button', class: 'btn-icon edit', 'aria-label': `Editar ${p.nombre}`, onClick: () => abrirFormulario(p) }, '✏️ Editar') : null);
      return {
        clase: cad.clave === 'vencido' ? 'fila-vencida' : cad.clave === 'por-vencer' ? 'fila-por-vencer' : null,
        celdas: [h('span', {}, p.nombre, h('span', { class: 'sub' }, p.categoria)), `${p.stock} und`,
          h('span', {}, formatoCOP(p.precio), puedeEditar && margen !== null ? h('span', { class: 'sub' }, `ganas ${margen} %`) : null),
          h('span', {}, insignia(cad.texto, cad.clase), h('span', { class: 'sub' }, formatoFecha(p.caducidad))), acciones],
      };
    });
    reemplazarHijos(zona, tabla({ columnas, filas, descripcion: 'Productos listos para vender' }));
  }

  async function eliminar(p) {
    const ok = await confirmar({ titulo: 'Eliminar producto', mensaje: `¿Eliminar «${p.nombre}»? Si ya se vendió o se horneó no se podrá: en ese caso déjalo en 0.` });
    if (!ok) return false;
    try {
      await api.del(`/productos/${encodeURIComponent(p.sku)}`);
      toast('Producto eliminado');
      cargar();
      return true;
    } catch (e) { toastError(e); return false; }
  }

  function abrirFormulario(existente) {
    const editando = existente !== null;
    const skuNuevo = editando ? null : siguienteCodigo('PT', todos.map((p) => p.sku));
    const aviso = crearAvisoFormulario();
    const campos = {};
    const nuevo = (nombre, config) => { campos[nombre] = campo({ id: idCampo(`pt-${nombre}`), ...config }); return campos[nombre]; };
    if (!editando) nuevo('sku', { etiqueta: 'Código', requerido: true, ayuda: 'Se asigna solo; puedes dejarlo así.', control: h('input', { type: 'text', value: skuNuevo, placeholder: 'PT005', maxlength: '12', autocomplete: 'off' }) });
    nuevo('nombre', { etiqueta: 'Nombre', requerido: true, control: h('input', { type: 'text', value: existente?.nombre ?? '', maxlength: '80', placeholder: 'Ej. Pastel Red Velvet' }) });
    nuevo('categoria', { etiqueta: 'Categoría', requerido: true, control: selectControl(CATEGORIAS_PT, { valor: existente?.categoria ?? '', placeholder: 'Seleccionar…' }) });
    nuevo('stock', { etiqueta: 'Cuántas unidades hay', requerido: true, control: h('input', { type: 'number', min: '0', step: '1', inputmode: 'numeric', value: existente?.stock ?? '', placeholder: '0' }) });
    nuevo('precio', { etiqueta: 'Precio de venta ($)', requerido: true, control: h('input', { type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: existente?.precio ?? '', placeholder: 'Ej. 35000' }) });
    nuevo('caducidad', { etiqueta: 'Vence el', requerido: true, control: h('input', { type: 'date', value: existente?.caducidad ?? '' }) });
    nuevo('costoUnitario', { etiqueta: 'Cuánto te cuesta hacerlo ($)', ayuda: 'Opcional. Si tiene receta, se calcula solo al hornear.',
      control: h('input', { type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: existente?.costoUnitario || '', placeholder: 'Ej. 9350' }) });

    const guardar = h('button', { type: 'submit', class: 'btn' }, 'Guardar');
    const form = h('form', { novalidate: true },
      aviso.el,
      campos.sku?.grupo,
      campos.nombre.grupo,
      h('div', { class: 'form-row' }, campos.categoria.grupo, campos.caducidad.grupo),
      h('div', { class: 'form-row' }, campos.stock.grupo, campos.precio.grupo),
      campos.costoUnitario.grupo,
      h('div', { class: 'form-acciones' },
        editando ? h('button', { type: 'button', class: 'btn btn-link texto-peligro', onClick: async () => { if (await eliminar(existente)) modal.cerrar(); } }, 'Eliminar producto') : null,
        h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => modal.cerrar() }, 'Cancelar'), guardar));
    const modal = abrirModal({ titulo: editando ? `Editar ${existente.nombre}` : 'Agregar producto', contenido: form });

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
        toast(editando ? 'Producto actualizado' : 'Producto agregado');
        modal.cerrar();
        cargar();
      } catch (e) { aviso.mostrar(mensajeDeError(e)); }
    });
  }

  return { el, titulo: 'Productos', cargar, destruir() { marcaCarga++; } };
}

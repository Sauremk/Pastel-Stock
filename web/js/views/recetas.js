// Recetas (fichas técnicas): ingredientes enlazados por CÓDIGO de materia prima (corrige DT-09) + producción.
import {
  h, reemplazarHijos, cargando, vacio, bannerError, tabla, insignia, encabezadoVista,
  abrirModal, confirmar, toast, toastError, campo, idCampo, selectControl, mostrarErrores, crearAvisoFormulario, conBotonOcupado,
} from '../ui.js';
import { UNIDADES } from '../catalogos.js';
import { formatoNumero, infoEstado, mensajeDeError, nuevaClaveIdempotencia } from '../format.js';
import { validarReceta, validarProduccion } from '../validacion.js';
import { botonesExportar } from './exportar.js';

export function crearVista(ctx) {
  const { api, auth } = ctx;
  const puedeEditar = auth.puede('catalogo');
  const puedeProducir = auth.puede('producir');
  let marcaCarga = 0;
  let recetas = [];

  const zona = h('div', {});
  const botonNueva = puedeEditar ? h('button', { type: 'button', class: 'btn', onClick: () => abrirFormulario(null) }, '+ Nueva receta') : null;
  const el = h('section', { class: 'vista activa', 'aria-labelledby': 'titulo-recetas' },
    encabezadoVista('Recetas / fichas técnicas'),
    h('div', { class: 'panel' },
      h('div', { class: 'panel-header' }, h('div', {}), h('div', { class: 'panel-actions' }, botonesExportar(ctx, 'recetas'), botonNueva)),
      zona));
  el.querySelector('h1').id = 'titulo-recetas';

  async function cargar() {
    const marca = ++marcaCarga;
    reemplazarHijos(zona, cargando());
    try {
      const r = await api.get('/recetas', { limite: 100 });
      if (marca !== marcaCarga) return;
      recetas = r.datos;
      pintar();
    } catch (error) {
      if (marca === marcaCarga) reemplazarHijos(zona, bannerError(error, cargar));
    }
  }

  function pintar() {
    if (recetas.length === 0) {
      reemplazarHijos(zona, vacio('Aún no hay recetas. Crea la primera para poder registrar producciones.', '📖'));
      return;
    }
    reemplazarHijos(zona, ...recetas.map((r) => h('article', { class: 'receta-card', 'aria-label': `Receta de ${r.productoNombre}` },
      h('h3', {}, `🎂 ${r.productoNombre} `, h('span', { class: 'solo-lectura' }, `(${r.productoSku})`)),
      h('div', { class: 'acciones' },
        puedeProducir ? h('button', { type: 'button', class: 'btn-icon producir', onClick: () => abrirProduccion(r) }, '🏭 Producir') : null,
        puedeEditar ? h('button', { type: 'button', class: 'btn-icon edit', 'aria-label': `Editar receta de ${r.productoNombre}`, onClick: () => abrirFormulario(r) }, '✏️ Editar') : null,
        puedeEditar ? h('button', { type: 'button', class: 'btn-icon delete', 'aria-label': `Eliminar receta de ${r.productoNombre}`, onClick: () => eliminar(r) }, '🗑️ Eliminar') : null),
      tabla({
        descripcion: `Ingredientes de ${r.productoNombre}`,
        columnas: [{ titulo: 'Código' }, { titulo: 'Ingrediente' }, { titulo: 'Cantidad', num: true }, { titulo: 'Unidad' }],
        filas: r.ingredientes.map((i) => ({ celdas: [i.codigoMateriaPrima, i.nombre, formatoNumero(i.cantidad), i.unidad] })),
      }))));
  }

  async function eliminar(r) {
    const ok = await confirmar({ titulo: 'Eliminar receta', mensaje: `¿Eliminar la receta de «${r.productoNombre}»? El producto no se borra.` });
    if (!ok) return;
    try {
      await api.del(`/recetas/${r.id}`);
      toast('Receta eliminada');
      cargar();
    } catch (e) { toastError(e); }
  }

  // ------------------------------------------------------------ Producir
  function abrirProduccion(r) {
    const aviso = crearAvisoFormulario();
    const resultado = h('div', {});
    // Una clave por intención: si la red falla y la persona reintenta, el servidor no vuelve a producir (ADR-16).
    let clave = nuevaClaveIdempotencia();
    const unidades = campo({ id: idCampo('prod-unidades'), etiqueta: 'Unidades a producir', requerido: true,
      ayuda: 'Cada unidad consume una vez los ingredientes de la receta.', control: h('input', { type: 'number', min: '1', max: '1000', step: '1', inputmode: 'numeric', value: '1' }) });
    const nota = campo({ id: idCampo('prod-nota'), etiqueta: 'Nota (opcional)', control: h('textarea', { maxlength: '200', rows: '2' }) });
    const enviar = h('button', { type: 'submit', class: 'btn' }, 'Registrar producción');
    const form = h('form', { novalidate: true },
      aviso.el,
      h('p', { class: 'ayuda' }, `Producto: ${r.productoNombre} (${r.productoSku})`),
      unidades.grupo, nota.grupo,
      h('div', { class: 'form-acciones' }, h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => modal.cerrar() }, 'Cerrar'), enviar));
    const modal = abrirModal({ titulo: `Producir ${r.productoNombre}`, contenido: h('div', {}, form, resultado) });

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      aviso.ocultar();
      reemplazarHijos(resultado);
      const { errores, datos, valido } = validarProduccion({ unidades: unidades.control.value, nota: nota.control.value });
      mostrarErrores({ unidades, nota }, errores);
      if (!valido) return;
      try {
        const res = await conBotonOcupado(enviar, () => api.post(`/recetas/${r.id}/producir`, datos, { cabeceras: { 'Idempotency-Key': clave } }), 'Produciendo…');
        clave = nuevaClaveIdempotencia(); // la siguiente producción es otra intención
        reemplazarHijos(resultado,
          h('div', { class: 'banner-ok', role: 'status' }, `Producción registrada. Stock de ${r.productoNombre}: ${formatoNumero(res.stockProducto)} unidades.`),
          tabla({
            descripcion: 'Ingredientes consumidos',
            columnas: [{ titulo: 'Ingrediente' }, { titulo: 'Consumido', num: true }, { titulo: 'Stock restante', num: true }, { titulo: 'Estado' }],
            filas: res.consumos.map((c) => {
              const e = infoEstado(c.estado);
              const nombre = r.ingredientes.find((i) => i.codigoMateriaPrima === c.codigoMateriaPrima)?.nombre ?? c.codigoMateriaPrima;
              return { celdas: [nombre, formatoNumero(c.cantidadConsumida), formatoNumero(c.stockRestante), insignia(e.texto, e.clase)] };
            }),
          }));
        toast('Producción registrada');
      } catch (e) {
        // 409: algún ingrediente no alcanza; el stock nunca queda negativo
        aviso.mostrar(mensajeDeError(e));
      }
    });
    form.addEventListener('input', () => { aviso.ocultar(); clave = nuevaClaveIdempotencia(); }); // si cambia el contenido, es otra intención
  }

  // ------------------------------------------------------------ Crear / editar
  async function abrirFormulario(existente) {
    const editando = existente !== null;
    let materias; let productos;
    try {
      [materias, productos] = await Promise.all([
        api.get('/materias-primas', { limite: 100 }),
        editando ? Promise.resolve(null) : api.get('/productos', { limite: 100 }),
      ]);
    } catch (e) { toastError(e); return; }
    const listaMaterias = materias.datos;
    if (listaMaterias.length === 0) { toast('Primero registra materias primas para armar una receta.', 'warning'); return; }

    const aviso = crearAvisoFormulario();
    let selProducto = null;
    if (!editando) {
      const conReceta = new Set(recetas.map((x) => x.productoSku));
      const opcionesProducto = productos.datos.map((p) => ({ valor: p.sku, texto: `${p.nombre} (${p.sku})${conReceta.has(p.sku) ? ' — ya tiene receta' : ''}` }));
      selProducto = campo({ id: idCampo('rec-producto'), etiqueta: 'Producto terminado', requerido: true,
        control: selectControl(opcionesProducto, { placeholder: 'Seleccionar producto…' }) });
      [...selProducto.control.options].forEach((o) => { if (o.text.endsWith('ya tiene receta')) o.disabled = true; });
    }

    const filasDOM = [];
    const lista = h('div', { class: 'ingredientes-lista', role: 'group', 'aria-label': 'Ingredientes' });
    const errorLista = h('p', { class: 'error-campo', role: 'alert' });
    const opcionesMateria = listaMaterias.map((m) => ({ valor: m.codigo, texto: `${m.nombre} (${m.codigo} · ${m.unidad})` }));
    const unidadDe = new Map(listaMaterias.map((m) => [m.codigo, m.unidad]));

    function agregarFila(dato = {}) {
      const fila = {};
      const n = filasDOM.length + 1;
      fila.materia = campo({ id: idCampo('rec-mp'), etiqueta: 'Materia prima', control: selectControl(opcionesMateria, { valor: dato.codigoMateriaPrima ?? '', placeholder: 'Seleccionar…' }) });
      fila.cantidad = campo({ id: idCampo('rec-cant'), etiqueta: 'Cantidad', control: h('input', { type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: dato.cantidad ?? '' }) });
      fila.unidad = campo({ id: idCampo('rec-uni'), etiqueta: 'Unidad', control: selectControl(UNIDADES, { valor: dato.unidad ?? 'g' }) });
      fila.materia.control.addEventListener('change', () => {
        const u = unidadDe.get(fila.materia.control.value);
        if (u) fila.unidad.control.value = u;
      });
      fila.quitar = h('button', { type: 'button', class: 'btn-remove', 'aria-label': `Quitar ingrediente ${n}`, onClick: () => {
        const i = filasDOM.indexOf(fila);
        if (i >= 0) filasDOM.splice(i, 1);
        fila.el.remove();
      } }, '×');
      fila.el = h('div', { class: 'ingrediente-item' }, fila.materia.grupo, fila.cantidad.grupo, fila.unidad.grupo, fila.quitar);
      filasDOM.push(fila);
      lista.appendChild(fila.el);
      return fila;
    }

    (existente?.ingredientes ?? [{}]).forEach((i) => agregarFila(i));

    const guardar = h('button', { type: 'submit', class: 'btn' }, 'Guardar');
    const form = h('form', { novalidate: true },
      aviso.el,
      editando ? h('p', { class: 'ayuda' }, `Producto: ${existente.productoNombre} (${existente.productoSku})`) : selProducto.grupo,
      h('div', { class: 'form-group' },
        h('label', {}, 'Ingredientes ', h('span', { class: 'requerido', 'aria-hidden': 'true' }, '*')),
        lista, errorLista,
        h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onClick: () => agregarFila().materia.control.focus() }, '+ Agregar ingrediente')),
      h('div', { class: 'form-acciones' }, h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => modal.cerrar() }, 'Cancelar'), guardar));
    const modal = abrirModal({ titulo: editando ? `Editar receta de ${existente.productoNombre}` : 'Nueva receta', contenido: form, ancho: 760 });

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      aviso.ocultar();
      const crudo = {
        productoSku: selProducto?.control.value ?? existente?.productoSku,
        ingredientes: filasDOM.map((f) => ({ codigoMateriaPrima: f.materia.control.value, cantidad: f.cantidad.control.value, unidad: f.unidad.control.value })),
      };
      const { errores, datos, valido } = validarReceta(crudo, { modo: editando ? 'editar' : 'crear' });
      if (selProducto) mostrarErrores({ productoSku: selProducto }, errores);
      errorLista.textContent = errores.ingredientes ?? '';
      filasDOM.forEach((f, i) => {
        const e = errores.filas?.[i] ?? {};
        f.materia.error(e.codigoMateriaPrima); f.cantidad.error(e.cantidad); f.unidad.error(e.unidad);
      });
      if (!valido) { form.querySelector('[aria-invalid="true"]')?.focus(); return; }
      try {
        const cuerpo = editando ? { ingredientes: datos.ingredientes } : { productoSku: datos.productoSku, ingredientes: datos.ingredientes };
        await conBotonOcupado(guardar, () => (editando ? api.put(`/recetas/${existente.id}`, cuerpo) : api.post('/recetas', cuerpo)));
        toast(editando ? 'Receta actualizada' : 'Receta creada');
        modal.cerrar();
        cargar();
      } catch (e) { aviso.mostrar(mensajeDeError(e)); }
    });
  }

  return { el, titulo: 'Recetas', cargar, destruir() { marcaCarga++; } };
}

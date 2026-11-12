// Recetas (fichas técnicas): ingredientes enlazados por CÓDIGO de materia prima (corrige DT-09) + producción.
import {
  h, reemplazarHijos, cargando, vacio, bannerError, tabla, insignia, encabezadoVista,
  abrirModal, confirmar, toast, toastError, campo, idCampo, selectControl, mostrarErrores, crearAvisoFormulario, conBotonOcupado,
} from '../ui.js';
import { UNIDADES } from '../catalogos.js';
import { formatoNumero, formatoCOP, infoEstado, mensajeDeError, nuevaClaveIdempotencia, hoyISO } from '../format.js';
import { validarReceta, validarProduccion } from '../validacion.js';
import { botonesExportar } from './exportar.js';

export function crearVista(ctx) {
  const { api, auth } = ctx;
  const puedeEditar = auth.puede('catalogo');
  const puedeProducir = auth.puede('producir');
  const puedeVerCostos = auth.puede('rentabilidad') || puedeEditar;
  let marcaCarga = 0;
  let recetas = [];
  let costeoPorId = new Map();

  const zona = h('div', {});
  const botonNueva = puedeEditar ? h('button', { type: 'button', class: 'btn', onClick: () => abrirFormulario(null) }, '＋ Nueva receta') : null;
  const el = h('section', { class: 'vista activa', 'aria-labelledby': 'titulo-recetas' },
    encabezadoVista('Hornear', 'Elige qué horneaste. Los ingredientes se descuentan solos según la receta.'),
    h('div', { class: 'panel' },
      puedeEditar ? h('div', { class: 'panel-header' }, h('div', {}), h('div', { class: 'panel-actions' }, botonesExportar(ctx, 'recetas'), botonNueva)) : null,
      zona));
  el.querySelector('h1').id = 'titulo-recetas';

  async function cargar() {
    const marca = ++marcaCarga;
    reemplazarHijos(zona, cargando());
    try {
      const r = await api.get('/recetas', { limite: 100 });
      if (marca !== marcaCarga) return;
      recetas = r.datos;
      // Costeo de cada receta (v1.1). Si falla, la receta se muestra igual, sin costo.
      const costeos = await Promise.all(recetas.map((x) => api.get(`/recetas/${x.id}/costeo`).catch(() => null)));
      if (marca !== marcaCarga) return;
      costeoPorId = new Map(recetas.map((x, i) => [x.id, costeos[i]]));
      pintar();
    } catch (error) {
      if (marca === marcaCarga) reemplazarHijos(zona, bannerError(error, cargar));
    }
  }

  function pintar() {
    if (recetas.length === 0) {
      reemplazarHijos(zona, vacio(puedeEditar ? 'Aún no hay recetas. Toca «Nueva receta» para crear la primera.' : 'Aún no hay recetas. Pídele al administrador que cree la primera.', '📖'));
      return;
    }
    // Una tarjeta grande por producto con UN botón principal: «Hornear». Los ingredientes se ven al desplegar.
    reemplazarHijos(zona, h('div', { class: 'recetas-grid' }, ...recetas.map((r) => {
      const c = costeoPorId.get(r.id);
      return h('article', { class: 'receta-card', 'aria-label': `Receta de ${r.productoNombre}` },
        h('h3', {}, `🎂 ${r.productoNombre}`),
        c && puedeVerCostos ? h('p', { class: 'receta-costo' },
          h('span', {}, 'Hacer uno cuesta ', h('strong', {}, formatoCOP(c.costoUnitario))),
          h('span', {}, 'se vende a ', h('strong', {}, formatoCOP(c.precioVenta))),
          typeof c.margenPorcentaje === 'number' ? insignia(`ganas ${formatoNumero(c.margenPorcentaje)} %`, c.margenPorcentaje < 40 ? 'por-vencer' : 'vigente') : null) : null,
        puedeProducir ? h('button', { type: 'button', class: 'btn btn-grande btn-block', onClick: () => abrirProduccion(r) }, `🧁 Hornear ${r.productoNombre}`) : null,
        h('details', { class: 'receta-detalle' },
          h('summary', {}, `Ver ingredientes (${r.ingredientes.length})`),
          h('ul', { class: 'receta-ingredientes' }, ...r.ingredientes.map((i) => h('li', {}, h('span', {}, i.nombre), h('strong', {}, `${formatoNumero(i.cantidad)} ${i.unidad}`))))),
        puedeEditar ? h('div', { class: 'acciones' },
          h('button', { type: 'button', class: 'btn-icon edit', 'aria-label': `Editar receta de ${r.productoNombre}`, onClick: () => abrirFormulario(r) }, '✏️ Editar receta'),
          h('button', { type: 'button', class: 'btn-icon delete', 'aria-label': `Eliminar receta de ${r.productoNombre}`, onClick: () => eliminar(r) }, '🗑️ Eliminar')) : null);
    })));
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
    const unidades = campo({ id: idCampo('prod-unidades'), etiqueta: '¿Cuántas unidades hiciste?', requerido: true,
      ayuda: 'Se descontarán los ingredientes de esa cantidad.', control: h('input', { type: 'number', min: '1', max: '1000', step: '1', inputmode: 'numeric', value: '1' }) });
    const nota = campo({ id: idCampo('prod-nota'), etiqueta: 'Nota (opcional)', control: h('textarea', { maxlength: '200', rows: '2' }) });
    const caducidad = campo({ id: idCampo('prod-cad'), etiqueta: '¿Hasta cuándo dura? (opcional)', ayuda: 'Así te avisamos antes de que se venza.',
      control: h('input', { type: 'date', min: hoyISO() }) });
    const enviar = h('button', { type: 'submit', class: 'btn' }, '✓ Guardar horneado');
    const form = h('form', { novalidate: true },
      aviso.el,

      h('div', { class: 'form-row' }, unidades.grupo, caducidad.grupo), nota.grupo,
      h('div', { class: 'form-acciones' }, h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => modal.cerrar() }, 'Cerrar'), enviar));
    const modal = abrirModal({ titulo: `Hornear ${r.productoNombre}`, contenido: h('div', {}, form, resultado) });

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      aviso.ocultar();
      reemplazarHijos(resultado);
      const { errores, datos, valido } = validarProduccion({ unidades: unidades.control.value, nota: nota.control.value, caducidad: caducidad.control.value });
      mostrarErrores({ unidades, nota, caducidad }, errores);
      if (!valido) return;
      try {
        const res = await conBotonOcupado(enviar, () => api.post(`/recetas/${r.id}/producir`, datos, { cabeceras: { 'Idempotency-Key': clave } }), 'Produciendo…');
        clave = nuevaClaveIdempotencia(); // la siguiente producción es otra intención
        reemplazarHijos(resultado,
          h('div', { class: 'banner-ok', role: 'status' }, `¡Listo! Ahora hay ${formatoNumero(res.stockProducto)} ${r.productoNombre} para vender.`
            + (res.costoLote !== undefined ? ` Costo del lote ${formatoCOP(res.costoLote)} (${formatoCOP(res.costoUnitarioLote)} c/u).` : '')),
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

  return {
    el, titulo: 'Hornear', cargar,
    accion(a) {
      if (a !== 'hornear' || !puedeProducir) return;
      if (recetas.length === 1) abrirProduccion(recetas[0]);
      else zona.querySelector('.btn-grande')?.focus();
    }, destruir() { marcaCarga++; } };
}

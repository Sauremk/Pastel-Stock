// Diálogo de ajuste por conteo físico (materias primas y productos) y kardex de producto. Compartido por varias vistas.
import {
  h, reemplazarHijos, abrirModal, campo, idCampo, selectControl, mostrarErrores, crearAvisoFormulario, conBotonOcupado,
  toast, tabla, insignia, cargando, bannerError, vacio, paginador,
} from '../ui.js';
import { MOTIVOS_AJUSTE, TEXTO_MOTIVO } from '../catalogos.js';
import { formatoCOP, formatoNumero, formatoFechaHora, mensajeDeError } from '../format.js';
import { validarAjuste } from '../validacion.js';

/**
 * @param tipo 'materia' | 'producto'
 * @param item materia prima ({ codigo, nombre, stock, unidad }) o producto ({ sku, nombre, stock })
 * @param motivo motivo preseleccionado (p. ej. VENCIMIENTO desde Alertas); stockContado inicial opcional
 */
export function abrirAjuste({ api, tipo, item, motivo = 'CONTEO_FISICO', stockContado, alTerminar }) {
  const esProducto = tipo === 'producto';
  const unidad = esProducto ? 'unidades' : item.unidad;
  const aviso = crearAvisoFormulario();
  const campos = {
    stockContado: campo({ id: idCampo('aj-stock'), etiqueta: `Stock contado (${unidad})`, requerido: true,
      ayuda: `El sistema dice ${formatoNumero(item.stock)} ${unidad}. Escribe lo que hay físicamente.`,
      control: h('input', { type: 'number', min: '0', step: esProducto ? '1' : 'any', inputmode: esProducto ? 'numeric' : 'decimal', value: String(stockContado ?? item.stock) }) }),
    motivo: campo({ id: idCampo('aj-motivo'), etiqueta: 'Motivo', requerido: true, control: selectControl(MOTIVOS_AJUSTE, { valor: motivo }) }),
    nota: campo({ id: idCampo('aj-nota'), etiqueta: 'Nota (opcional)', control: h('input', { type: 'text', maxlength: '200', placeholder: 'Ej. bolsa rota, conteo de cierre' }) }),
  };
  const diferencia = h('p', { class: 'ayuda', 'aria-live': 'polite', style: { margin: '-4px 0 12px' } });
  const actualizarDiferencia = () => {
    const n = Number(String(campos.stockContado.control.value).replace(',', '.'));
    if (!Number.isFinite(n)) { diferencia.textContent = ''; return; }
    const d = Math.round((n - item.stock) * 1e6) / 1e6;
    diferencia.textContent = d === 0 ? 'Sin diferencia: no se registrará movimiento.' : `Diferencia: ${d > 0 ? '+' : ''}${formatoNumero(d)} ${unidad}${d < 0 ? ' (se descuenta)' : ' (se suma)'}.`;
  };
  campos.stockContado.control.addEventListener('input', actualizarDiferencia);
  actualizarDiferencia();

  const guardar = h('button', { type: 'submit', class: 'btn' }, 'Aplicar ajuste');
  const form = h('form', { novalidate: true },
    aviso.el,
    h('p', { class: 'campo-solo-lectura' }, `${item.nombre} · ${esProducto ? item.sku : item.codigo}`),
    h('div', { class: 'form-row' }, campos.stockContado.grupo, campos.motivo.grupo),
    diferencia,
    campos.nota.grupo,
    h('div', { class: 'form-acciones' }, h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => modal.cerrar() }, 'Cancelar'), guardar));
  const modal = abrirModal({ titulo: esProducto ? 'Ajustar stock del producto' : 'Ajustar stock por conteo', contenido: form, ancho: 520 });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    aviso.ocultar();
    const { errores, datos, valido } = validarAjuste({
      stockContado: campos.stockContado.control.value, motivo: campos.motivo.control.value, nota: campos.nota.control.value,
    }, { entero: esProducto });
    mostrarErrores(campos, errores);
    if (!valido) return;
    try {
      const r = await conBotonOcupado(guardar, () => (esProducto
        ? api.post(`/productos/${encodeURIComponent(item.sku)}/ajustes`, datos)
        : api.post('/movimientos/ajustes', { codigo: item.codigo, ...datos })), 'Aplicando…');
      toast(r.diferencia === 0 ? 'Conteo confirmado: sin diferencias' : `Ajuste aplicado (${r.diferencia > 0 ? '+' : ''}${formatoNumero(r.diferencia)} ${unidad} · ${formatoCOP(r.valorDiferencia ?? 0)})`);
      modal.cerrar();
      alTerminar?.(r);
    } catch (e) { aviso.mostrar(mensajeDeError(e)); }
  });
}

const TIPO_PRODUCTO = {
  PRODUCCION: ['Producción', 'produccion'], VENTA: ['Venta', 'venta'], BAJA: ['Baja', 'baja'],
  AJUSTE: ['Ajuste +', 'ajuste'], AJUSTE_NEGATIVO: ['Ajuste −', 'ajuste-neg'],
};
const SUMA = new Set(['PRODUCCION', 'AJUSTE']);

/** Kardex del producto terminado en un diálogo paginado. */
export function abrirKardexProducto({ api, producto }) {
  const zona = h('div', {}, cargando());
  abrirModal({ titulo: `Kardex · ${producto.nombre}`, contenido: zona, ancho: 820 });
  const cargar = async (pagina = 1) => {
    reemplazarHijos(zona, cargando());
    try {
      const r = await api.get(`/productos/${encodeURIComponent(producto.sku)}/movimientos`, { pagina, limite: 15 });
      if (r.datos.length === 0) { reemplazarHijos(zona, vacio('Este producto aún no tiene movimientos.', '📒')); return; }
      reemplazarHijos(zona,
        tabla({
          descripcion: `Movimientos de ${producto.nombre}`,
          columnas: [{ titulo: 'Fecha' }, { titulo: 'Tipo' }, { titulo: 'Cantidad', num: true }, { titulo: 'Costo unit.', num: true }, { titulo: 'Motivo / nota' }, { titulo: 'Por' }],
          filas: r.datos.map((m) => {
            const [texto, clase] = TIPO_PRODUCTO[m.tipo] ?? [m.tipo, 'neutro'];
            return { celdas: [formatoFechaHora(m.creadoEn), insignia(texto, clase), `${SUMA.has(m.tipo) ? '+' : '−'}${formatoNumero(m.cantidad)}`,
              formatoCOP(m.costoUnitario), [TEXTO_MOTIVO[m.motivo], m.nota].filter(Boolean).join(' · ') || '—', m.registradoPor ?? '—'] };
          }),
        }),
        paginador({ ...r.paginacion, alCambiar: cargar }));
    } catch (e) { reemplazarHijos(zona, bannerError(e, () => cargar(pagina))); }
  };
  cargar();
}

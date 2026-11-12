// Botones «PDF» y «Excel»: el servidor genera el archivo; el navegador lo descarga con el token en memoria.
import { h, toast, toastError, descargarArchivo, conBotonOcupado } from '../ui.js';
import { hoyISO } from '../format.js';

const MIME = { pdf: 'PDF', xlsx: 'Excel' };

export function botonesExportar(ctx, tipo) {
  if (!ctx.auth.puede('reportes')) return null;
  const crear = (formato) => {
    const boton = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', 'aria-label': `Exportar a ${MIME[formato]}` }, `${formato === 'pdf' ? '📄' : '📊'} ${MIME[formato]}`);
    boton.addEventListener('click', async () => {
      try {
        await conBotonOcupado(boton, async () => {
          const { blob, nombre } = await ctx.api.descargar('/reportes/export', { tipo, formato });
          descargarArchivo(blob, nombre ?? `reporte-${tipo}-${hoyISO()}.${formato}`);
        }, 'Generando…');
        toast(`${MIME[formato]} exportado`);
      } catch (e) { toastError(e); }
    });
    return boton;
  };
  return [crear('pdf'), crear('xlsx')];
}

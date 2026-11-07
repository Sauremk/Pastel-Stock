import { armarDashboard, fechaLocal, sumarDias, DIAS_POR_VENCER } from '../domain/dashboard.js';
import { generarPdf, generarXlsx, DEFINICIONES } from '../adapters/exporters/exportadores.js';
import { crearReportesRepo } from '../adapters/pg/reportesRepo.js';
import { solicitudInvalida } from '../../shared/errors.js';

export function crearCasosReportes({ pool, reloj = () => new Date(), zona = 'America/Bogota' }) {
  const repo = crearReportesRepo(pool, zona);
  return {
    async dashboard() {
      const hoy = fechaLocal(reloj(), zona);
      const datos = await repo.datosDashboard(hoy, sumarDias(hoy, -29), sumarDias(hoy, -6), sumarDias(hoy, DIAS_POR_VENCER));
      return armarDashboard(datos);
    },
    async exportar(tipo, formato, usuario) {
      if (!DEFINICIONES[tipo]) throw solicitudInvalida('Tipo de reporte inválido', 'Use materias, productos o recetas.');
      if (!['pdf', 'xlsx'].includes(formato)) throw solicitudInvalida('Formato inválido', 'Use pdf o xlsx.');
      const filas = tipo === 'materias' ? await repo.materias() : tipo === 'productos' ? await repo.productos() : await repo.recetasPlanas();
      const fecha = fechaLocal(reloj(), zona);
      const buffer = formato === 'pdf' ? await generarPdf(tipo, filas, { usuarioNombre: usuario.nombre ?? `usuario ${usuario.id}`, fecha }) : await generarXlsx(tipo, filas);
      return { buffer, nombreArchivo: `reporte-${tipo}-${fecha}.${formato}` };
    },
  };
}

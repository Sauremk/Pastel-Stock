import { armarDashboard, armarAlertasCaducidad, fechaLocal, sumarDias, DIAS_POR_VENCER } from '../domain/dashboard.js';
import { costearReceta, margen } from '../../catalog/domain/costeo.js';
import { generarPdf, generarXlsx, DEFINICIONES } from '../adapters/exporters/exportadores.js';
import { crearReportesRepo } from '../adapters/pg/reportesRepo.js';
import { solicitudInvalida, validacion } from '../../shared/errors.js';
import { estadoStock } from '../../inventory/domain/stock.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function crearCasosReportes({ pool, reloj = () => new Date(), zona = 'America/Bogota' }) {
  const repo = crearReportesRepo(pool, zona);
  return {
    async dashboard() {
      const hoy = fechaLocal(reloj(), zona);
      const datos = await repo.datosDashboard(hoy, sumarDias(hoy, -29), sumarDias(hoy, -6), sumarDias(hoy, DIAS_POR_VENCER));
      return armarDashboard(datos);
    },
    /** Productos por vencer (≤ `dias`) o vencidos con stock, e ingredientes bajo su mínimo. */
    async alertas(dias = DIAS_POR_VENCER) {
      if (!Number.isInteger(dias) || dias < 0 || dias > 30) throw validacion('Parámetro "dias" inválido', 'Debe ser un entero entre 0 y 30.');
      const hoy = fechaLocal(reloj(), zona);
      const [filas, materias] = await Promise.all([repo.alertasCaducidad(hoy, sumarDias(hoy, dias)), repo.materias()]);
      const ingredientesCriticos = materias.map((m) => ({ ...m, estado: estadoStock(m.stock, m.minimo) })).filter((m) => m.estado !== 'OPTIMO')
        .map(({ codigo, nombre, unidad, stock, minimo, estado }) => ({ codigo, nombre, unidad, stock, minimo, estado }));
      const cad = armarAlertasCaducidad(filas);
      return { fecha: hoy, diasAviso: dias, ...cad, ingredientesCriticos, total: cad.vencidos.length + cad.porVencer.length + ingredientesCriticos.length };
    },

    /**
     * Rentabilidad por producto: costo estándar de la receta (insumos a costo actual), costo promedio real de lo
     * producido, margen unitario y lo vendido en los últimos 30 días. Sin receta, el costo estándar es null.
     */
    async rentabilidad() {
      const hoy = fechaLocal(reloj(), zona);
      const { productos, ingredientes, materias, vendidos } = await repo.datosRentabilidad(sumarDias(hoy, -29), hoy);
      const mapaMp = new Map(materias.map((m) => [m.codigo, m]));
      const porReceta = new Map();
      for (const { recetaId, ...i } of ingredientes) porReceta.set(recetaId, [...(porReceta.get(recetaId) ?? []), i]);
      const ventas = new Map(vendidos.map((v) => [v.sku, v]));
      const datos = productos.map((p) => {
        const costoReceta = p.recetaId && porReceta.has(p.recetaId) ? costearReceta(porReceta.get(p.recetaId), mapaMp).costoUnitario : null;
        const referencia = costoReceta ?? p.costoUnitario;
        const v = ventas.get(p.sku);
        return {
          sku: p.sku, nombre: p.nombre, categoria: p.categoria, precio: p.precio,
          costoReceta, costoPromedio: p.costoUnitario, ...margen(p.precio, referencia),
          unidadesVendidas30Dias: v?.unidades ?? 0, ventas30Dias: r2(v?.ventas), margen30Dias: r2(v?.margen),
        };
      });
      return { fecha: hoy, datos };
    },

    async exportar(tipo, formato, usuario) {
      if (!DEFINICIONES[tipo]) throw solicitudInvalida('Tipo de reporte inválido', 'Use materias, productos, recetas o ventas.');
      if (!['pdf', 'xlsx'].includes(formato)) throw solicitudInvalida('Formato inválido', 'Use pdf o xlsx.');
      const fecha = fechaLocal(reloj(), zona);
      const filas = tipo === 'materias' ? await repo.materias()
        : tipo === 'productos' ? await repo.productos()
          : tipo === 'ventas' ? await repo.ventasPlanas(sumarDias(fecha, -29), fecha)
            : await repo.recetasPlanas();
      const buffer = formato === 'pdf' ? await generarPdf(tipo, filas, { usuarioNombre: usuario.nombre ?? `usuario ${usuario.id}`, fecha }) : await generarXlsx(tipo, filas);
      return { buffer, nombreArchivo: `reporte-${tipo}-${fecha}.${formato}` };
    },
  };
}

import { estadoStock, FACTOR_CRITICO } from '../../domain/stock.js';

const COLS = 'codigo, nombre, categoria, stock, unidad, minimo, costo';
const conEstado = (r) => (r ? { ...r, estado: estadoStock(r.stock, r.minimo) } : null);

export function crearMateriasPrimasRepo(db) {
  return {
    async listar({ q, categoria, estado, limite, offset }) {
      const where = []; const p = [];
      if (q) { p.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`); where.push(`(codigo ILIKE $${p.length} OR nombre ILIKE $${p.length})`); }
      if (categoria) { p.push(categoria); where.push(`categoria = $${p.length}`); }
      if (estado) {
        p.push(FACTOR_CRITICO);
        const f = `$${p.length}`;
        where.push({
          CRITICO: `stock <= minimo * ${f}`,
          BAJO: `(stock > minimo * ${f} AND stock <= minimo)`,
          OPTIMO: 'stock > minimo',
        }[estado]);
      }
      const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = (await db.query(`SELECT count(*)::int AS n FROM materias_primas ${cond}`, p)).rows[0].n;
      const { rows } = await db.query(`SELECT ${COLS} FROM materias_primas ${cond} ORDER BY codigo LIMIT ${Number(limite)} OFFSET ${Number(offset)}`, p);
      return { filas: rows.map(conEstado), total };
    },
    async obtener(codigo, { bloquear = false } = {}) {
      const { rows } = await db.query(`SELECT ${COLS} FROM materias_primas WHERE codigo = $1 ${bloquear ? 'FOR UPDATE' : ''}`, [codigo]);
      return conEstado(rows[0]);
    },
    async obtenerVariasBloqueadasLectura(codigos) {
      const { rows } = await db.query(`SELECT ${COLS} FROM materias_primas WHERE codigo = ANY($1)`, [codigos]);
      return rows.map(conEstado);
    },
    /** Bloquea varias filas en orden de código (evita interbloqueos entre producciones concurrentes). */
    async obtenerVariasBloqueadas(codigos) {
      const { rows } = await db.query(`SELECT ${COLS} FROM materias_primas WHERE codigo = ANY($1) ORDER BY codigo FOR UPDATE`, [codigos]);
      return rows.map(conEstado);
    },
    async crear(m) {
      const { rows } = await db.query(
        `INSERT INTO materias_primas (codigo, nombre, categoria, stock, unidad, minimo, costo) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${COLS}`,
        [m.codigo, m.nombre, m.categoria, m.stock, m.unidad, m.minimo, m.costo],
      );
      return conEstado(rows[0]);
    },
    async actualizar(codigo, m) {
      const { rows } = await db.query(
        `UPDATE materias_primas SET nombre=$2, categoria=$3, unidad=$4, minimo=$5, costo=$6, actualizado_en=now() WHERE codigo=$1 RETURNING ${COLS}`,
        [codigo, m.nombre, m.categoria, m.unidad, m.minimo, m.costo],
      );
      return conEstado(rows[0]);
    },
    /** Suma (o resta, con delta negativo) de forma atómica; el CHECK (stock >= 0) impide dejarlo negativo. */
    async ajustarStock(codigo, delta) {
      const { rows } = await db.query(
        `UPDATE materias_primas SET stock = stock + $2, actualizado_en = now() WHERE codigo = $1 RETURNING ${COLS}`,
        [codigo, delta],
      );
      return conEstado(rows[0]);
    },
    async eliminar(codigo) {
      const { rowCount } = await db.query('DELETE FROM materias_primas WHERE codigo = $1', [codigo]);
      return rowCount === 1;
    },
    async contarRecetasQueLaUsan(codigo) {
      return (await db.query('SELECT count(*)::int AS n FROM receta_ingredientes WHERE materia_prima_codigo = $1', [codigo])).rows[0].n;
    },
  };
}

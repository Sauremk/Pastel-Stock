import { enTransaccion } from '../../../db/pool.js';
import { crearMateriasPrimasRepo } from './materiasPrimasRepo.js';
import { crearMovimientosRepo } from './movimientosRepo.js';

/** Puerto de persistencia del contexto Inventario: lecturas sobre el pool y transacciones con repos ligados al mismo cliente. */
export function crearInventarioUow(pool) {
  const repos = (db) => ({ materias: crearMateriasPrimasRepo(db), movimientos: crearMovimientosRepo(db) });
  return {
    leer: () => repos(pool),
    transaccion: (fn) => enTransaccion(pool, (client) => fn(repos(client))),
    reposEn: repos, // para que otros contextos (Catálogo/producir) participen en SU transacción mediante la interfaz pública
  };
}

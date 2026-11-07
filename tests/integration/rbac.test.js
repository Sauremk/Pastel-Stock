import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearEntorno } from '../helpers/entorno.js';
import { operaciones } from '../helpers/contrato.js';

// La matriz de permisos NO se escribe a mano: se DERIVA de `x-roles` del contrato OpenAPI. Si el código y el contrato
// se desalinean (un endpoint abierto por error), esta prueba falla. Corrige DT-02 con evidencia automatizada.
const ROLES = ['admin', 'operador', 'contador'];
let e; const cabeceras = {};
before(async () => { e = await crearEntorno(); for (const r of ROLES) cabeceras[r] = await e.como(r); });
after(async () => { await e.cerrar(); });

const protegidas = () => operaciones().filter(({ op }) => !(Array.isArray(op.security) && op.security.length === 0));
const url = (ruta) => `/api/v1${ruta.replace('{codigo}', 'MP001').replace('{sku}', 'PT001').replace('{id}', '1')}${ruta === '/reportes/export' ? '?tipo=materias&formato=xlsx' : ''}`;
const llamar = (metodo, ruta, h) => { let r = e.api[metodo](url(ruta)); if (h) r = r.set(h); return metodo === 'get' || metodo === 'delete' ? r : r.send({}); };

test('sin token: TODAS las operaciones protegidas responden 401', async () => {
  for (const { ruta, metodo } of protegidas()) assert.equal((await llamar(metodo, ruta)).status, 401, `${metodo.toUpperCase()} ${ruta}`);
});

test('rol no permitido: 403 en cada operación (matriz derivada del contrato)', async () => {
  let comprobaciones = 0;
  for (const { ruta, metodo, op } of protegidas()) {
    for (const rol of ROLES.filter((r) => !op['x-roles'].includes(r))) {
      assert.equal((await llamar(metodo, ruta, cabeceras[rol])).status, 403, `${rol} → ${metodo.toUpperCase()} ${ruta}`);
      comprobaciones += 1;
    }
  }
  assert.ok(comprobaciones >= 15, `se esperaban muchas comprobaciones, hubo ${comprobaciones}`);
});

test('rol permitido: nunca 401/403 y la ruta existe (los DELETE van al final por sus efectos)', async () => {
  const ordenadas = protegidas().sort((a, b) => (a.metodo === 'delete') - (b.metodo === 'delete'));
  for (const { ruta, metodo, op } of ordenadas) {
    for (const rol of op['x-roles']) {
      const r = await llamar(metodo, ruta, cabeceras[rol]);
      assert.ok(![401, 403].includes(r.status), `${rol} → ${metodo.toUpperCase()} ${ruta} dio ${r.status}`);
      assert.notEqual(r.body?.title, 'Ruta no encontrado', `la ruta ${metodo.toUpperCase()} ${ruta} del contrato no existe en el servidor`);
    }
  }
});

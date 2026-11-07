import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { crearEntorno } from '../helpers/entorno.js';

// Contrato: las respuestas reales deben cumplir el esquema declarado en openapi/openapi.yaml.
const spec = parse(readFileSync(new URL('../../openapi/openapi.yaml', import.meta.url), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(spec, 'spec');

const ptr = (s) => s.replaceAll('~', '~0').replaceAll('/', '~1');
function validador(ruta, metodo, status, tipo = 'application/json') {
  const op = spec.paths[ruta]?.[metodo]?.responses?.[String(status)];
  assert.ok(op, `el contrato no declara ${metodo.toUpperCase()} ${ruta} → ${status}`);
  if (!op.content?.[tipo]?.schema) return null;
  return ajv.getSchema(`spec#/paths/${ptr(ruta)}/${metodo}/responses/${status}/content/${ptr(tipo)}/schema`);
}

let e; let admin;
before(async () => { e = await crearEntorno(); admin = await e.como('admin'); });
after(async () => { await e.cerrar(); });

const GETS = ['/materias-primas', '/productos', '/recetas', '/movimientos', '/reportes/dashboard'].filter((r) => spec.paths[r]?.get);

for (const ruta of GETS) {
  test(`contrato: GET ${ruta} cumple el esquema 200`, async () => {
    const r = await e.api.get(`/api/v1${ruta}`).set(admin);
    assert.equal(r.status, 200);
    const v = validador(ruta, 'get', 200);
    assert.ok(v, `sin esquema para GET ${ruta}`);
    assert.ok(v(r.body), JSON.stringify(v.errors?.slice(0, 3)));
  });
}

test('contrato: error de validación cumple RFC 9457 (problem+json)', async () => {
  const r = await e.api.post('/api/v1/movimientos/entradas').set(admin).send({ codigo: 'MP001', cantidad: -5 });
  assert.equal(r.status, 422);
  assert.match(r.headers['content-type'], /application\/problem\+json/);
  assert.equal(typeof r.body.title, 'string');
  assert.equal(r.body.status, 422);
});

test('contrato: sin token responde 401 con WWW-Authenticate', async () => {
  const r = await e.api.get('/api/v1/materias-primas');
  assert.equal(r.status, 401);
  assert.match(r.headers['www-authenticate'] ?? '', /Bearer/);
});

test('contrato: toda ruta documentada existe en la API (no devuelve 404 de ruta)', async () => {
  for (const [ruta, ops] of Object.entries(spec.paths)) {
    if (!ops.get || ruta.includes('{')) continue;
    const r = await e.api.get(`/api/v1${ruta}`).set(admin);
    assert.notEqual(r.status, 404, `GET ${ruta} documentada pero no implementada`);
  }
});

import { cargarContrato, crearValidadores, anclarRefs } from '../../src/shared/validador.js';

export const contrato = cargarContrato();
const { ajv } = crearValidadores(contrato);

const resolver = (nodo) => (nodo?.$ref ? nodo.$ref.replace('#/', '').split('/').reduce((a, k) => a[k], contrato) : nodo);

/** Devuelve el validador Ajv del esquema de respuesta documentado para (ruta, método, estado, tipo de contenido). */
export function validadorRespuesta(ruta, metodo, estado, tipo = 'application/json') {
  const op = contrato.paths[ruta][metodo];
  const resp = resolver(op.responses[String(estado)]);
  if (!resp) throw new Error(`El contrato no documenta ${metodo.toUpperCase()} ${ruta} → ${estado}`);
  const esquema = resp.content?.[tipo]?.schema;
  if (!esquema) throw new Error(`El contrato no documenta el contenido ${tipo} de ${metodo.toUpperCase()} ${ruta} → ${estado}`);
  return ajv.compile(anclarRefs(esquema));
}

export function operaciones() {
  const lista = [];
  for (const [ruta, item] of Object.entries(contrato.paths)) {
    for (const metodo of ['get', 'post', 'put', 'delete']) {
      if (item[metodo]) lista.push({ ruta, metodo, op: item[metodo] });
    }
  }
  return lista;
}

// k6 — prueba de carga del endpoint crítico POST /api/v1/movimientos/entradas (ADR-08).
// NUNCA contra producción. Variables de entorno (ninguna credencial va en el script):
//   TARGET_ENV=local   TARGET_URL=http://127.0.0.1:3000 K6_USER=operador K6_PASS=... k6 run k6/entradas.js
//   TARGET_ENV=staging TARGET_URL=https://<staging>     K6_USER=operador K6_PASS=... k6 run k6/entradas.js
import http from 'k6/http';
import { check, sleep, fail } from 'k6';

const BASE = (__ENV.TARGET_URL || '').replace(/\/+$/, '');
const ENTORNO = __ENV.TARGET_ENV;
const CODIGO_MP = __ENV.K6_CODIGO_MP || 'MP005'; // Cacao en Polvo del catálogo de demostración

export const options = {
  // 20 VUs ≈ 4× la concurrencia pico supuesta de Dulce Hogar (≈ 3 usuarios; ADR-08). Máximo de la guía: 50.
  stages: [
    { duration: '30s', target: 20 }, // rampa de subida
    { duration: '60s', target: 20 }, // sostenimiento
    { duration: '30s', target: 0 }, // bajada
  ],
  thresholds: {
    http_req_duration: ['p(95)<300'], // meta de latencia (SLO, ADR-14)
    'http_req_duration{endpoint:entradas}': ['p(95)<300', 'p(99)<800'],
    http_req_failed: ['rate<0.01'], // < 1 % de errores
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  // Guardas anti-autoDoS: sin entorno explícito, o con un host que parezca producción, la prueba ABORTA.
  if (!BASE) fail('Falta TARGET_URL');
  if (!['local', 'staging'].includes(ENTORNO)) fail(`TARGET_ENV debe ser "local" o "staging" (recibido: ${ENTORNO})`);
  if (/prod/i.test(BASE)) fail(`TARGET_URL parece producción: ${BASE}`);
  if (!__ENV.K6_USER || !__ENV.K6_PASS) fail('Faltan K6_USER / K6_PASS (variables de entorno; nunca en el script)');

  const login = http.post(
    `${BASE}/api/v1/auth/login`,
    JSON.stringify({ usuario: __ENV.K6_USER, contrasena: __ENV.K6_PASS }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (login.status !== 200) fail(`Login falló (${login.status})`);
  // El access token dura 15 min (ADR-06); la prueba dura 2 min, no necesita refresh.
  return { token: login.json('accessToken') };
}

export default function (data) {
  const res = http.post(
    `${BASE}/api/v1/movimientos/entradas`,
    JSON.stringify({ codigo: CODIGO_MP, cantidad: 1, proveedor: 'k6-carga', nota: 'prueba de carga k6' }),
    {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.token}` },
      tags: { endpoint: 'entradas' },
    },
  );
  check(res, {
    'status 201': (r) => r.status === 201,
    'devuelve movimientoId y stock numéricos': (r) => typeof r.json('movimientoId') === 'number' && typeof r.json('stock') === 'number',
  });
  sleep(1 + Math.random() * 2); // "tiempo de pensar" de una persona registrando entradas (1–3 s)
}

export function handleSummary(data) {
  return { 'k6/resultado-entradas.json': JSON.stringify(data, null, 2) };
}

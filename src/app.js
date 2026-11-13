import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { trace } from '@opentelemetry/api';

import { crearLogger } from './shared/logger.js';
import { crearValidadores } from './shared/validador.js';
import { AppError, traducirErrorPg, noEncontrado, esBaseNoDisponible } from './shared/errors.js';
import { asyncH } from './shared/http.js';

import { crearUsuariosRepo, crearRefreshRepo } from './identity/adapters/pg/usuariosRepo.js';
import { crearAuthService } from './identity/application/authService.js';
import { autenticar } from './identity/adapters/http/middleware.js';
import { crearAuthRouter } from './identity/adapters/http/authRouter.js';
import { crearEquipoService } from './identity/application/equipoService.js';
import { crearEquipoRouter } from './identity/adapters/http/equipoRouter.js';

import { crearInventarioUow } from './inventory/adapters/pg/unidadDeTrabajo.js';
import { crearCasosInventario } from './inventory/application/casosDeUso.js';
import { crearInventarioRouter } from './inventory/adapters/http/inventarioRouter.js';

import { crearCasosCatalogo } from './catalog/application/casosDeUso.js';
import { crearCatalogoRouter } from './catalog/adapters/http/catalogoRouter.js';

import { crearCasosVentas } from './sales/application/casosDeUso.js';
import { crearVentasRouter } from './sales/adapters/http/ventasRouter.js';

import { crearCasosReportes } from './reporting/application/casosDeUso.js';
import { crearReportesRouter } from './reporting/adapters/http/reportesRouter.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const problema = (res, req, status, slug, title, detail, extra = {}) =>
  res.status(status).type('application/problem+json').json({ type: `/errores/${slug}`, title, status, ...(detail ? { detail } : {}), instance: req.originalUrl, ...extra });


function cabecerasSeguridad(config) {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"],
        ...(config.produccion ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    strictTransportSecurity: config.produccion ? undefined : false,
    crossOriginEmbedderPolicy: false,
  });
}

/** Frontend estático (carpeta web/) y Chart.js local, sin CDN: corrige DT-04. */
function montarFrontend(app, config) {
  const dirWeb = config.dirWeb ?? join(aqui, '..', 'web');
  try {
    const archivoChart = join(dirname(require.resolve('chart.js')), 'chart.umd.js'); // require.resolve('chart.js') → .../dist/chart.cjs
    if (existsSync(archivoChart)) app.get('/vendor/chart.umd.js', (_req, res) => res.sendFile(archivoChart, { maxAge: '7d' }));
  } catch { /* chart.js no instalado: el tablero mostrará solo tablas */ }
  if (existsSync(dirWeb)) app.use(express.static(dirWeb, { maxAge: config.produccion ? '1h' : 0, index: 'index.html' }));
}

/**
 * Raíz de composición: aquí (y solo aquí) se conectan los adaptadores con los casos de uso (ADR-04).
 * Recibe el pool y la config; no abre conexiones por su cuenta, por eso es fácil de probar.
 */
export function crearApp({ pool, config, reloj = () => new Date(), logger = crearLogger(config.logLevel) }) {
  const app = express();
  const validar = crearValidadores();

  app.disable('x-powered-by');
  if (config.confiarProxy) app.set('trust proxy', config.confiarProxy);

  app.use(pinoHttp({
    logger,
    quietReqLogger: true,
    customProps: () => { const ctx = trace.getActiveSpan()?.spanContext(); return ctx ? { trace_id: ctx.traceId, span_id: ctx.spanId } : {}; },
    autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/api/v1/health' },
    serializers: { req: (req) => ({ id: req.id, method: req.method, url: req.url }), res: (res) => ({ statusCode: res.statusCode }) },
  }));

  app.use(cabecerasSeguridad(config));

  // --- Salud (pública; no expone información interna)
  const salud = asyncH(async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.set('Cache-Control', 'no-store').json({ estado: 'ok', status: 'ok', db: 'up', version: config.version });
    } catch (e) {
      req.log?.error({ err: e.message }, 'healthcheck: base de datos no disponible');
      problema(res, req, 503, 'servicio-no-disponible', 'Servicio no disponible');
    }
  });
  app.get('/health', salud);

  // --- Composición de contextos
  const usuariosRepo = crearUsuariosRepo(pool);
  const authService = crearAuthService({ usuariosRepo, refreshRepo: crearRefreshRepo(pool), secreto: config.jwtSecret, accessTtl: config.accessTtlSeg, refreshTtl: config.refreshTtlSeg, bcryptCost: config.bcryptCost, tienda: config.nombreTienda });
  const equipo = crearEquipoService({ pool, authService });
  const uowInventario = crearInventarioUow(pool);
  const casosInventario = crearCasosInventario({ uow: uowInventario });
  const casosCatalogo = crearCasosCatalogo({ pool, inventario: uowInventario });
  const casosVentas = crearCasosVentas({ pool, catalogo: casosCatalogo, reloj, zona: 'America/Bogota' });
  const casosReportes = crearCasosReportes({ pool, reloj, zona: 'America/Bogota' });

  const api = express.Router();
  api.use(rateLimit({ windowMs: 60_000, limit: config.limiteGlobalPorMinuto, standardHeaders: 'draft-7', legacyHeaders: false, skip: (req) => req.path === '/health',
    handler: (req, res) => problema(res, req, 429, 'demasiadas-solicitudes', 'Demasiadas solicitudes, intente de nuevo en un minuto') }));
  api.use(express.json({ limit: '100kb' }));
  api.get('/health', salud);
  api.use(crearAuthRouter({ authService, validar, limitePorMinuto: config.limiteLoginPorMinuto }));
  api.use(autenticar(authService)); // todo lo que sigue exige JWT (el contrato declara security global bearerAuth)
  api.use(crearEquipoRouter({ equipo, validar }));
  api.use(crearInventarioRouter({ casos: casosInventario, validar }));
  api.use(crearCatalogoRouter({ casos: casosCatalogo, validar }));
  api.use(crearVentasRouter({ casos: casosVentas, validar }));
  api.use(crearReportesRouter({ casos: casosReportes, usuariosRepo }));
  api.use((req) => { throw noEncontrado('Ruta', req.originalUrl); });
  app.use('/api/v1', api);

  montarFrontend(app, config);

  // --- Errores → application/problem+json (RFC 9457)
  app.use((req, res) => problema(res, req, 404, 'no-encontrado', 'Recurso no encontrado'));
  app.use((err, req, res, _next) => {
    const e = traducirErrorPg(err);
    if (e instanceof AppError) {
      if (e.status === 401) res.set('WWW-Authenticate', 'Bearer');
      return problema(res, req, e.status, e.slug, e.title, e.detail, e.extra);
    }
    if (e.type === 'entity.parse.failed') return problema(res, req, 400, 'json-invalido', 'El cuerpo no es JSON válido');
    if (e.type === 'entity.too.large') return problema(res, req, 413, 'cuerpo-demasiado-grande', 'El cuerpo de la solicitud es demasiado grande');
    if (esBaseNoDisponible(e)) {
      req.log?.error({ err: { message: e.message, code: e.code } }, 'base de datos no disponible');
      res.set('Retry-After', String(config.reintentarTrasSeg ?? 5));
      return problema(res, req, 503, 'servicio-no-disponible', 'Servicio no disponible', 'La base de datos no responde. Intente de nuevo en unos segundos.');
    }
    req.log?.error({ err: { message: e.message, stack: e.stack, code: e.code } }, 'error no controlado');
    return problema(res, req, 500, 'error-interno', 'Error interno del servidor');
  });

  return app;
}

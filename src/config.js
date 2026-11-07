// Configuración leída SOLO desde variables de entorno (corrige DT-01: nada de secretos en el código).
const entero = (v, def) => (v === undefined || v === '' ? def : Number.parseInt(v, 10));

export function cargarConfig(env = process.env) {
  const produccion = env.NODE_ENV === 'production';
  const config = {
    entorno: env.NODE_ENV ?? 'development',
    produccion,
    puerto: entero(env.PORT, 3000),
    databaseUrl: env.DATABASE_URL,
    jwtSecret: env.JWT_SECRET,
    version: env.APP_VERSION ?? 'dev',
    logLevel: env.LOG_LEVEL ?? 'info',
    ejecutarMigraciones: (env.RUN_MIGRATIONS ?? 'true') !== 'false',
    confiarProxy: entero(env.TRUST_PROXY, 0),
    bcryptCost: entero(env.BCRYPT_COST, 12),
    limiteLoginPorMinuto: entero(env.RATE_LIMIT_LOGIN_PER_MIN, 5),
    limiteGlobalPorMinuto: entero(env.RATE_LIMIT_GLOBAL_PER_MIN, 600),
    dirWeb: env.WEB_DIR,
    accessTtlSeg: entero(env.ACCESS_TTL_SECONDS, 15 * 60),
    refreshTtlSeg: entero(env.REFRESH_TTL_SECONDS, 7 * 24 * 60 * 60),
  };
  return config;
}

export function validarConfig(config) {
  const faltantes = [];
  if (!config.databaseUrl) faltantes.push('DATABASE_URL');
  if (!config.jwtSecret || config.jwtSecret.length < 32) faltantes.push('JWT_SECRET (mínimo 32 caracteres)');
  if (faltantes.length) {
    throw new Error(`Configuración incompleta: defina ${faltantes.join(', ')} como variables de entorno (vea .env.example).`);
  }
  return config;
}

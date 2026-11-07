import pino from 'pino';

// Logs JSON estructurados. Se redactan credenciales y datos personales (Ley 1581 de 2012).
export function crearLogger(nivel = 'info') {
  return pino({
    level: process.env.NODE_ENV === 'test' ? 'silent' : nivel,
    base: { servicio: 'pastel-stock' },
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'req.body.contrasena', 'req.body.refreshToken', '*.password', '*.passwordHash'],
      censor: '[REDACTADO]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

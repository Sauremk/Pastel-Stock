import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { noAutenticado } from '../../shared/errors.js';

const OPCIONES = { algorithms: ['HS256'], issuer: 'pastel-stock', audience: 'pastel-stock-api' }; // alg fijo: evita "alg: none"

/**
 * Casos de uso de Identidad: login, renovación con rotación de refresh token y verificación de access token.
 * Depende de puertos (usuariosRepo, refreshRepo), no de Express ni de pg (ADR-04).
 */
export function crearAuthService({ usuariosRepo, refreshRepo, secreto, accessTtl, refreshTtl, bcryptCost }) {
  const firmar = (payload, ttl) => jwt.sign(payload, secreto, { algorithm: 'HS256', expiresIn: ttl, issuer: OPCIONES.issuer, audience: OPCIONES.audience });
  const hashFicticio = bcrypt.hashSync('relleno-para-igualar-tiempos', bcryptCost);

  async function emitirPar(usuario) {
    const jti = crypto.randomUUID();
    await refreshRepo.guardar({ jti, usuarioId: usuario.id, expiraEn: new Date(Date.now() + refreshTtl * 1000) });
    return {
      accessToken: firmar({ sub: String(usuario.id), rol: usuario.rol, typ: 'access' }, accessTtl),
      refreshToken: firmar({ sub: String(usuario.id), rol: usuario.rol, typ: 'refresh', jti }, refreshTtl),
      expiraEn: accessTtl,
      rol: usuario.rol,
      nombre: usuario.nombre,
    };
  }

  return {
    async login({ usuario, contrasena }) {
      const u = await usuariosRepo.porUsuario(usuario);
      // Se compara SIEMPRE contra un hash: el tiempo de respuesta no revela si el usuario existe.
      const ok = await bcrypt.compare(String(contrasena ?? ''), u?.passwordHash ?? hashFicticio);
      if (!u || !u.activo || !ok) throw noAutenticado('Usuario o contraseña incorrectos');
      return emitirPar(u);
    },

    async renovar(refreshToken) {
      let p;
      try { p = jwt.verify(refreshToken, secreto, OPCIONES); } catch { throw noAutenticado('Refresh token inválido o vencido'); }
      if (p.typ !== 'refresh' || !p.jti) throw noAutenticado('Refresh token inválido');
      const usuarioId = Number(p.sub);
      const consumido = await refreshRepo.consumir(p.jti, usuarioId);
      if (!consumido) {
        await refreshRepo.revocarTodos(usuarioId); // reutilización detectada
        throw noAutenticado('Refresh token ya utilizado o revocado');
      }
      const u = await usuariosRepo.porId(usuarioId);
      if (!u || !u.activo) throw noAutenticado('Usuario inactivo');
      return emitirPar(u);
    },

    /** Verifica un access token y devuelve la identidad. Sin consultar la base de datos (stateless, 15 min). */
    verificarAccess(token) {
      let p;
      try { p = jwt.verify(token, secreto, OPCIONES); } catch { throw noAutenticado(); }
      if (p.typ !== 'access') throw noAutenticado();
      return { id: Number(p.sub), rol: p.rol };
    },

    async hashear(contrasena) { return bcrypt.hash(contrasena, bcryptCost); },
  };
}

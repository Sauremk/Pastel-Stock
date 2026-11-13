export function crearUsuariosRepo(db) {
  return {
    async porUsuario(usuario) {
      const { rows } = await db.query('SELECT id, usuario, password_hash AS "passwordHash", nombre, rol, activo FROM usuarios WHERE usuario = $1', [usuario]);
      return rows[0] ?? null;
    },
    async porId(id) {
      const { rows } = await db.query('SELECT id, usuario, nombre, rol, activo FROM usuarios WHERE id = $1', [id]);
      return rows[0] ?? null;
    },
    async listar() {
      const { rows } = await db.query('SELECT id, usuario, nombre, rol, activo, creado_en AS "creadoEn" FROM usuarios ORDER BY activo DESC, nombre, id');
      return rows;
    },
    /** Lee un usuario bloqueando su fila (dentro de una transacción). */
    async porIdParaActualizar(id) {
      const { rows } = await db.query('SELECT id, usuario, nombre, rol, activo, creado_en AS "creadoEn" FROM usuarios WHERE id = $1 FOR UPDATE', [id]);
      return rows[0] ?? null;
    },
    /** Cuenta los administradores activos bloqueando sus filas: dos cambios a la vez no pueden dejar la tienda sin administrador. */
    async contarAdminsActivos() {
      const { rows } = await db.query("SELECT id FROM usuarios WHERE rol = 'admin' AND activo FOR UPDATE");
      return rows.length;
    },
    async crear({ usuario, passwordHash, nombre, rol }) {
      const { rows } = await db.query(
        'INSERT INTO usuarios (usuario, password_hash, nombre, rol) VALUES ($1,$2,$3,$4) RETURNING id, usuario, nombre, rol, activo, creado_en AS "creadoEn"',
        [usuario, passwordHash, nombre, rol],
      );
      return rows[0];
    },
    async actualizar(id, { nombre, rol, activo }) {
      const { rows } = await db.query(
        `UPDATE usuarios SET nombre = COALESCE($2, nombre), rol = COALESCE($3, rol), activo = COALESCE($4, activo)
         WHERE id = $1 RETURNING id, usuario, nombre, rol, activo, creado_en AS "creadoEn"`,
        [id, nombre ?? null, rol ?? null, activo ?? null],
      );
      return rows[0] ?? null;
    },
    async cambiarClave(id, passwordHash) {
      const { rowCount } = await db.query('UPDATE usuarios SET password_hash = $2 WHERE id = $1', [id, passwordHash]);
      return rowCount === 1;
    },
    async crearSiNoExiste({ usuario, passwordHash, nombre, rol }) {
      const { rowCount } = await db.query(
        'INSERT INTO usuarios (usuario, password_hash, nombre, rol) VALUES ($1,$2,$3,$4) ON CONFLICT (usuario) DO NOTHING',
        [usuario, passwordHash, nombre, rol],
      );
      return rowCount === 1;
    },
  };
}

export function crearRefreshRepo(db) {
  return {
    async guardar({ jti, usuarioId, expiraEn }) {
      await db.query('INSERT INTO refresh_tokens (jti, usuario_id, expira_en) VALUES ($1,$2,$3)', [jti, usuarioId, expiraEn]);
    },
    /** Marca como usado de forma atómica. Devuelve true solo si estaba vigente y sin usar. */
    async consumir(jti, usuarioId) {
      const { rowCount } = await db.query(
        'UPDATE refresh_tokens SET usado = TRUE WHERE jti = $1 AND usuario_id = $2 AND usado = FALSE AND expira_en > now()',
        [jti, usuarioId],
      );
      return rowCount === 1;
    },
    /** Reutilización de un refresh token = posible robo: se revocan todos los del usuario. */
    async revocarTodos(usuarioId) {
      await db.query('DELETE FROM refresh_tokens WHERE usuario_id = $1', [usuarioId]);
    },
    async purgarVencidos() {
      await db.query('DELETE FROM refresh_tokens WHERE expira_en < now() - interval \'1 day\'');
    },
  };
}

-- Reintentos seguros de POST /recetas/{id}/producir (cabecera Idempotency-Key).
-- La clave se inserta DENTRO de la transacción de producción: si la producción se revierte, la clave también.
-- La huella (sha256 del cuerpo) detecta que una misma clave se reutilice con otra solicitud.
CREATE TABLE claves_idempotencia (
  usuario_id INTEGER     NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  clave      VARCHAR(64) NOT NULL CHECK (clave ~ '^[A-Za-z0-9_-]{8,64}$'),
  huella     CHAR(64)    NOT NULL,
  estado     SMALLINT,
  respuesta  JSONB,
  creada_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, clave)
);
CREATE INDEX claves_idempotencia_creada_idx ON claves_idempotencia (creada_en);

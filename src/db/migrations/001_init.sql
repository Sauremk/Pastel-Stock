-- Esquema inicial de Pastel Stock v1.0 (paga DT-06, DT-08, DT-09).
-- Reglas de integridad en la base: el stock NUNCA puede quedar negativo y las
-- recetas se enlazan por código de materia prima, no por nombre.

CREATE TABLE usuarios (
  id            SERIAL PRIMARY KEY,
  usuario       VARCHAR(40)  NOT NULL UNIQUE,
  password_hash TEXT         NOT NULL,
  nombre        VARCHAR(80)  NOT NULL,
  rol           TEXT         NOT NULL CHECK (rol IN ('admin', 'operador', 'contador')),
  activo        BOOLEAN      NOT NULL DEFAULT TRUE,
  creado_en     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  jti         UUID PRIMARY KEY,
  usuario_id  INTEGER     NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_en   TIMESTAMPTZ NOT NULL,
  usado       BOOLEAN     NOT NULL DEFAULT FALSE,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_usuario_idx ON refresh_tokens (usuario_id);

CREATE TABLE materias_primas (
  codigo         VARCHAR(12)   PRIMARY KEY CHECK (codigo ~ '^MP[0-9]{3,}$'),
  nombre         VARCHAR(80)   NOT NULL,
  categoria      TEXT          NOT NULL CHECK (categoria IN ('Harinas','Endulzantes','Lácteos','Lácteos/Huevos','Saborizantes','Frutas')),
  stock          NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (stock >= 0),
  unidad         TEXT          NOT NULL CHECK (unidad IN ('g','kg','ml','L','unid','docena')),
  minimo         NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (minimo >= 0),
  costo          NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (costo >= 0),
  creado_en      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE productos (
  sku       VARCHAR(12)   PRIMARY KEY CHECK (sku ~ '^PT[0-9]{3,}$'),
  nombre    VARCHAR(80)   NOT NULL,
  categoria TEXT          NOT NULL CHECK (categoria IN ('Pasteles','Panes','Galletas','Tartas','Postres')),
  stock     INTEGER       NOT NULL DEFAULT 0 CHECK (stock >= 0),
  precio    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (precio >= 0),
  caducidad DATE          NOT NULL
);

CREATE TABLE recetas (
  id           SERIAL PRIMARY KEY,
  producto_sku VARCHAR(12) NOT NULL UNIQUE REFERENCES productos(sku) ON DELETE CASCADE
);

CREATE TABLE receta_ingredientes (
  receta_id            INTEGER       NOT NULL REFERENCES recetas(id) ON DELETE CASCADE,
  materia_prima_codigo VARCHAR(12)   NOT NULL REFERENCES materias_primas(codigo) ON DELETE RESTRICT,
  cantidad             NUMERIC(14,3) NOT NULL CHECK (cantidad > 0),
  unidad               TEXT          NOT NULL CHECK (unidad IN ('g','kg','ml','L','unid','docena')),
  PRIMARY KEY (receta_id, materia_prima_codigo)
);

-- Kardex: cada cambio de stock deja un movimiento (auditable). cantidad siempre > 0;
-- el signo lo da el tipo (ENTRADA y AJUSTE suman, SALIDA resta).
CREATE TABLE movimientos (
  id                   BIGSERIAL PRIMARY KEY,
  materia_prima_codigo VARCHAR(12)   NOT NULL REFERENCES materias_primas(codigo) ON DELETE RESTRICT,
  tipo                 TEXT          NOT NULL CHECK (tipo IN ('ENTRADA','SALIDA','AJUSTE')),
  cantidad             NUMERIC(14,3) NOT NULL CHECK (cantidad > 0),
  costo_unitario       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (costo_unitario >= 0),
  proveedor            VARCHAR(80),
  usuario_id           INTEGER       REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  nota                 VARCHAR(200)
);
CREATE INDEX movimientos_codigo_fecha_idx ON movimientos (materia_prima_codigo, creado_en DESC);
CREATE INDEX movimientos_fecha_idx ON movimientos (creado_en DESC);

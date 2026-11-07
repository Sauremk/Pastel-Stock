// Funciones puras de formato y errores. Sin acceso a `document`: se prueban en Node.

const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0, minimumFractionDigits: 0 });
const NUM = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 });
const MILLONES = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

const aNumero = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** 35000 → "$ 35.000" (COP, sin decimales). */
export function formatoCOP(valor) {
  return COP.format(aNumero(valor));
}

/** Versión corta para ejes de gráficos: 2_500_000 → "$2,5 M". */
export function formatoCOPCorto(valor) {
  const n = aNumero(valor);
  if (Math.abs(n) >= 1e6) return `$${MILLONES.format(n / 1e6)} M`;
  if (Math.abs(n) >= 1e3) return `$${NUM.format(Math.round(n / 1e3))} mil`;
  return `$${NUM.format(n)}`;
}

/** 25000.5 → "25.000,5" (hasta 3 decimales). */
export function formatoNumero(valor) {
  return NUM.format(aNumero(valor));
}

/** "2026-10-07" → "07/10/2026" (sin convertir zonas horarias). */
export function formatoFecha(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso ?? '');
}

/** Fecha y hora local legible para el kardex. */
export function formatoFechaHora(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso ?? '');
  return d.toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Fecha local de hoy como AAAA-MM-DD. */
export function hoyISO(ahora = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${ahora.getFullYear()}-${p(ahora.getMonth() + 1)}-${p(ahora.getDate())}`;
}

// ---- Estado de stock (misma regla que el servidor y que el MVP: líneas 1589-1593) --------------------
export const ESTADOS_STOCK = {
  CRITICO: { clave: 'CRITICO', clase: 'critico', texto: 'Crítico' },
  BAJO: { clave: 'BAJO', clase: 'bajo', texto: 'Bajo' },
  OPTIMO: { clave: 'OPTIMO', clase: 'optimo', texto: 'Óptimo' },
};

/** Calcula el estado cuando solo se conocen stock y mínimo. */
export function estadoStock(stock, minimo) {
  const s = aNumero(stock);
  const m = aNumero(minimo);
  if (s <= m * 0.5) return ESTADOS_STOCK.CRITICO;
  if (s <= m) return ESTADOS_STOCK.BAJO;
  return ESTADOS_STOCK.OPTIMO;
}

/** Traduce el enum del API (CRITICO | BAJO | OPTIMO) a texto y clase CSS. */
export function infoEstado(clave) {
  return ESTADOS_STOCK[clave] ?? { clave, clase: '', texto: String(clave ?? '—') };
}

// ---- Caducidad ----------------------------------------------------------------------------------------
export const DIAS_POR_VENCER = 3;
const ETIQUETAS_CADUCIDAD = {
  vencido: 'Vencido',
  'por-vencer': 'Por vencer',
  vigente: 'Vigente',
};

/** Días (enteros) desde `hoy` hasta la fecha AAAA-MM-DD; negativo si ya pasó. */
export function diasHasta(iso, ahora = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!m) return NaN;
  const objetivo = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const hoy = Date.UTC(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  return Math.round((objetivo - hoy) / 86_400_000);
}

/** 'vencido' (fecha pasada) · 'por-vencer' (hoy a 3 días) · 'vigente'. */
export function estadoCaducidad(iso, ahora = new Date()) {
  const dias = diasHasta(iso, ahora);
  if (Number.isNaN(dias)) return { clave: 'vigente', clase: 'vigente', texto: '—', dias };
  const clave = dias < 0 ? 'vencido' : dias <= DIAS_POR_VENCER ? 'por-vencer' : 'vigente';
  return { clave, clase: clave, texto: ETIQUETAS_CADUCIDAD[clave], dias };
}

// ---- Errores problem+json (RFC 9457) ------------------------------------------------------------------
const MENSAJES_POR_ESTADO = {
  0: 'No se pudo contactar al servidor. Revisa tu conexión a internet.',
  400: 'La solicitud no es válida.',
  401: 'Tu sesión no es válida o venció. Inicia sesión de nuevo.',
  403: 'Tu rol no tiene permiso para esta acción.',
  404: 'No se encontró el recurso solicitado.',
  409: 'La operación entra en conflicto con el estado actual de los datos.',
  422: 'Los datos no cumplen las reglas de negocio.',
  429: 'Demasiados intentos. Espera un momento antes de reintentar.',
};

export class ApiError extends Error {
  constructor({ status, title, detail, type, mensaje, errores }) {
    super(mensaje);
    this.name = 'ApiError';
    this.status = status;
    this.title = title;
    this.detail = detail;
    this.type = type;
    this.errores = errores ?? [];
  }
}

/** Convierte (status, cuerpo) del API en datos legibles. `cuerpo` puede ser objeto, texto o null. */
export function parseProblema(status, cuerpo) {
  const c = cuerpo !== null && typeof cuerpo === 'object' ? cuerpo : {};
  const title = typeof c.title === 'string' ? c.title : undefined;
  const detail = typeof c.detail === 'string' ? c.detail : undefined;
  const errores = Array.isArray(c.errors)
    ? c.errors.map((e) => (typeof e === 'string' ? e : [e?.campo ?? e?.field, e?.mensaje ?? e?.message].filter(Boolean).join(': '))).filter(Boolean)
    : [];

  let mensaje;
  if (title && detail && title !== detail) mensaje = `${title}. ${detail}`;
  else mensaje = title ?? detail ?? MENSAJES_POR_ESTADO[status] ?? (status >= 500 ? 'Error del servidor. Intenta de nuevo en un momento.' : `Error ${status}.`);
  if (errores.length) mensaje += ` (${errores.join('; ')})`;

  return { status, title, detail, type: typeof c.type === 'string' ? c.type : undefined, errores, mensaje };
}

/** Texto seguro para mostrar al usuario a partir de cualquier error capturado. */
export function mensajeDeError(error) {
  if (error instanceof ApiError) return error.message;
  if (error && typeof error.message === 'string' && error.message) return error.message;
  return 'Ocurrió un error inesperado.';
}

/** Extrae el nombre de archivo de Content-Disposition, o devuelve `respaldo`. */
export function nombreDeArchivo(contentDisposition, respaldo) {
  const cd = String(contentDisposition ?? '');
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (utf8) { try { return decodeURIComponent(utf8[1]); } catch { /* usa respaldo */ } }
  const simple = /filename="?([^";]+)"?/i.exec(cd);
  return simple ? simple[1].trim() : respaldo;
}

/** Construye ?a=1&b=2 omitiendo valores vacíos. */
export function construirConsulta(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === null || v === '') continue;
    q.append(k, String(v));
  }
  const texto = q.toString();
  return texto ? `?${texto}` : '';
}

/** Clave de idempotencia (32 hex = 128 bits aleatorios; cumple ^[A-Za-z0-9_-]{8,64}$ del contrato). Usa getRandomValues, que no exige HTTPS. */
export function nuevaClaveIdempotencia(cripto = globalThis.crypto) {
  const b = cripto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

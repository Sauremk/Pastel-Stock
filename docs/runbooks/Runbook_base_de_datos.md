# Runbook — Base de datos no responde (Pastel Stock)

> Procedimiento de contingencia (ADR-14). Los comandos de PostgreSQL se ejecutaron contra un servidor PostgreSQL 16 local; los pasos que dependen de la interfaz web del proveedor (Render) se marcan *«verificar en staging»* porque no se pudieron ejecutar fuera de ese entorno. Mantener este documento junto al código: un runbook que no se prueba envejece.
>
> Relacionado: [`../runbook.md`](../runbook.md) (operación general) · [`../SLO.md`](../SLO.md) · [`../postmortem-simulacion.md`](../postmortem-simulacion.md).

| Campo | Valor |
|---|---|
| Alerta que lo activa | `EntradasErroresAltos` (> 1 % de respuestas 5xx por 5 min) o `/health` ≠ 200 |
| Severidad | Crítica (afecta el registro de entradas de materia prima) |
| Responsable primario | Kevin Andres Rojas Marin (único integrante; guardia permanente en horario laboral) |
| Escalamiento | 1) si no responde en 15 min → docente asesor (Abel Fernando Becerra Carrillo); 2) si pasa de 30 min → comunicar a Dulce Hogar y activar el rollback; 3) comunicación a Dulce Hogar a cargo de Kevin Rojas |
| Metas de tiempo | Reconocer ≤ 10 min · mitigar ≤ 30 min · avisar al negocio ≤ 30 min |
| Requisitos | `psql` y `pg_isready` instalados; `DATABASE_URL` en el gestor de secretos del equipo (nunca pegar en chats ni commits) |

**Paso 0 — Confirmar el síntoma (2 min).**

```bash
curl -fsS -m 5 https://<URL-de-produccion>/health ; echo "exit=$?"
```

Si responde 200 con `"status":"ok"`, mirar primero el dashboard de Grafana (¿es solo latencia?). Si falla o expira, seguir.

**Paso 1 — ¿Responde la base de datos?**

```bash
pg_isready -d "$DATABASE_URL" -t 5 ; echo "exit=$?"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT 1"
```

`pg_isready` devuelve 0 (acepta conexiones), 1 (rechaza), 2 (sin respuesta) o 3 (sin intento). Verificado: con el servidor activo devolvió 0 y con el servidor detenido 2. **Exit 2 o `psql` sin conexión → ir al Paso 4 (problema de la base).** Si `SELECT 1` devuelve `1`, la base responde y el problema está entre la API y la base: **Paso 2.**

**Paso 2 — ¿Se agotaron las conexiones o hay sesiones colgadas?**

```sql
-- conexiones por estado y límite del servidor
SELECT coalesce(state,'(background)') AS estado, count(*) FROM pg_stat_activity
 WHERE datname = current_database() GROUP BY 1 ORDER BY 2 DESC;
SHOW max_connections;
-- sesiones con transacción abierta sin actividad (síntoma típico de fuga de conexiones)
SELECT pid, state, now() - state_change AS inactiva_desde, left(query,50) AS ultima_consulta
  FROM pg_stat_activity
 WHERE datname = current_database() AND state = 'idle in transaction' AND pid <> pg_backend_pid();
```

Ejecutar con `psql "$DATABASE_URL" -c "<consulta>"`. Si hay muchas filas `idle in transaction`, **Paso 3.**

**Paso 3 — Liberar sesiones colgadas (solo las viejas y de la aplicación).**

```sql
SELECT count(pg_terminate_backend(pid)) AS sesiones_cerradas
  FROM pg_stat_activity
 WHERE datname = current_database() AND pid <> pg_backend_pid()
   AND state = 'idle in transaction' AND now() - state_change > interval '5 minutes';
```

Verificado (con el intervalo reducido a 1 segundo para la prueba): cerró la sesión de prueba (resultado `1`) y una segunda consulta de conteo dio `0`. **No** quitar el filtro de antigüedad: cerraría transacciones legítimas en curso. Si hay bloqueos, ver quién bloquea:

```sql
SELECT pid, pg_blocking_pids(pid) AS bloqueado_por, wait_event_type, left(query,45) AS consulta
  FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0;
```

(Verificado: reportó `6807 | {6803} | Lock | UPDATE materias_primas …`.) Si tras cerrar sesiones los errores continúan, reiniciar la API (panel del proveedor → *Restart*; *verificar en staging*) y, si el problema apareció justo tras un despliegue, **hacer rollback a la imagen anterior** (ADR-11: se reimplanta la etiqueta SHA previa en el panel del proveedor; *verificar en staging*).

**Paso 4 — La base de datos no responde.**

1. Revisar el estado en el panel del proveedor (incidentes, disco, reinicios). *Verificar en staging.*
2. Reintentar `pg_isready` cada minuto durante 5 min (el proveedor puede estar reiniciando).
3. Si la base está caída más de 15 min o dañada, restaurar a una base nueva a partir del último respaldo (el del proveedor o el `pg_dump` semanal del equipo):

```bash
createdb "$NUEVA_BD"                                   # o crearla desde el panel del proveedor
pg_restore --no-owner --clean --if-exists -d "$NUEVA_BD_URL" respaldo.dump
psql "$NUEVA_BD_URL" -Atc "SELECT count(*) FROM materias_primas"
```

Verificado: `pg_dump -Fc` + `pg_restore` recuperó las 2 filas de prueba y `--clean --if-exists` funcionó sobre una base ya existente. Después, cambiar `DATABASE_URL` en el servicio y reiniciar.

**Paso 5 — Verificar la recuperación.** `pg_isready` = 0, `/health` = 200, el panel de errores del dashboard vuelve a 0 y se registra una entrada de prueba en `POST /api/v1/movimientos/entradas` con un código de materia prima de staging.

**Contingencia manual para Dulce Hogar (mientras dure la caída).** Anotar las entradas de materia prima en la hoja impresa o en una hoja de cálculo compartida (fecha, ingrediente, cantidad, proveedor) y digitarlas cuando el sistema vuelva. Mensaje tipo: *«Dulce Hogar: el sistema de inventarios tiene una falla desde las [hora]. Sus datos están a salvo. Por favor anote las entradas en la hoja de contingencia; le avisamos apenas se restablezca.»*

**Después del incidente.** Registrar hora de inicio y fin, calcular el presupuesto de error consumido y, si pasó de 10 minutos, abrir un postmortem sin culpables (use `docs/postmortem-simulacion.md` como plantilla y guárdelo en `docs/postmortems/`).

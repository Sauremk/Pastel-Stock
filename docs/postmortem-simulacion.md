# Postmortem sin culpables — SIMULACIÓN (ejercicio de mesa)

> **⚠ SIMULACIÓN.** Este incidente es hipotético y se elaboró para practicar el formato y validar el [runbook](runbooks/Runbook_base_de_datos.md). **No ocurrió en producción.** El mecanismo técnico (fuga de conexiones del pool de PostgreSQL) sí se reprodujo localmente (ver «Evidencia»). Use este archivo como **plantilla** para postmortems reales: cópielo a `docs/postmortems/AAAA-MM-DD-titulo.md` y cámbielo por los datos reales.
>
> Estado de las acciones preventivas en v1.0: el `/health` ya ejecuta `SELECT 1` contra la base (acción 4). Siguen pendientes la prueba de ráfaga contra un pool pequeño, las métricas del pool y la verificación post-despliegue con una entrada sintética (ver [`DEUDA_TECNICA.md`](DEUDA_TECNICA.md), DT-15, y [`ROADMAP.md`](ROADMAP.md)).

**Resumen.** Un despliegue de funcionalidad dejó la API de Pastel Stock respondiendo 5xx a todos los registros de entradas durante **30 minutos**, porque cada solicitud con cantidad inválida dejaba una conexión de la base de datos sin liberar hasta agotar el pool.

**Impacto.** 30 minutos sin poder registrar entradas de materia prima. Consumo del presupuesto de error del SLO de disponibilidad (99,5 %, 216 min/mes): 30 / 216 = **13,9 %**; la disponibilidad del mes, si fuera el único incidente, sería 100 − 30/43 200·100 = **99,93 %**. No hubo pérdida de datos. Gravedad: media.

**Cronología (hora de Colombia, día simulado).**

| Hora | Evento |
|---|---|
| 10:00 | Se despliega la versión que agrega una validación temprana de `cantidad` en `registrarEntrada` (CD, ADR-11). |
| 10:05 | Dulce Hogar prueba cantidades inválidas al capacitar a un nuevo operario; empiezan a acumularse conexiones con transacción abierta. |
| 10:12 | El pool (máximo 10 conexiones) se agota; las peticiones válidas expiran tras 5 s y responden 500. **Inicio del impacto.** |
| 10:19 | Se dispara `EntradasErroresAltos` (error > 1 % durante 5 min). |
| 10:21 | La persona de turno reconoce la alerta y abre el Runbook. |
| 10:24 | Paso 1: `pg_isready` = 0 y `SELECT 1` responde: la base está viva. Paso 2: 10 conexiones `idle in transaction`. |
| 10:27 | Paso 3: se cierran las sesiones colgadas; los errores bajan, pero reaparecen al seguir enviando cantidades inválidas. |
| 10:36 | Se decide el rollback a la imagen anterior (ADR-11). |
| 10:42 | **Fin del impacto**; verificación con entrada de prueba correcta. |
| 10:45 | Aviso a Dulce Hogar de que el servicio se restableció. |

**Detección.** Por alerta (7 minutos después del inicio del impacto); ningún usuario lo reportó primero. **Reconocimiento y mitigación:** 2 min y 23 min, respectivamente, desde la alerta.

**Causa raíz (análisis de procesos, «5 porqués»).**

1. *¿Por qué hubo 500?* El pool de conexiones no tenía conexiones libres.
2. *¿Por qué no había libres?* La ruta de error de `registrarEntrada` retornaba antes de `client.release()`, así que cada solicitud inválida retenía una conexión con `BEGIN` abierto.
3. *¿Por qué llegó eso a producción?* La revisión de código no tenía un criterio explícito de «todo recurso adquirido se libera en `finally`», y la suite de integración (ADR-07) cubría solo el caso feliz y el 404, no una ráfaga de entradas inválidas contra un pool real.
4. *¿Por qué no lo frenó el despliegue?* El pipeline de CD (ADR-11) no tiene canario y el `/health` no ejerce el pool: solo responde 200 si el proceso vive.
5. *¿Por qué tardamos 7 minutos en saberlo?* No existía una alerta de saturación del pool; solo la de errores, con ventana de 5 minutos.

La causa raíz es de **proceso y de defensas**, no de una persona: quien escribió el cambio hizo lo razonable con la información que tenía, y los mecanismos que debían atrapar el defecto (revisión, pruebas, canario, alerta) no estaban.

**Qué salió bien.** La alerta se disparó; el Runbook permitió descartar la caída de la base en 3 minutos; el rollback con imagen inmutable (SHA) funcionó; la comunicación a Dulce Hogar fue rápida. **Qué salió mal.** Detección tardía; la mitigación inicial (cerrar sesiones) fue parcial. **Suerte.** El incidente ocurrió en horario de baja actividad.

**Acciones preventivas.**

| # | Acción | Tipo | Responsable | Plazo |
|---|---|---|---|---|
| 1 | Prueba de integración: N entradas inválidas seguidas contra un pool de tamaño 2 y luego una válida debe responder 201 | Prevenir | Kevin Rojas | Antes del próximo despliegue |
| 2 | Estandarizar el patrón `try/catch/finally` con `release()` (o usar `pool.query` cuando no hay transacción) y agregarlo a la lista de revisión de PR | Prevenir | Kevin Rojas | 1 semana |
| 3 | Exponer `db.pool.in_use` y `db.pool.waiting` y alertar si el pool supera 80 % durante 2 min | Detectar | Kevin Rojas | 2 semanas |
| 4 | Hacer que `/health` ejecute `SELECT 1` a través del pool y que el despliegue falle si no responde | Detectar | Kevin Rojas | 2 semanas |
| 5 | Evaluar despliegue canario o verificación post-despliegue con una entrada sintética | Mitigar | Kevin Rojas | Próximo ciclo |

**Evidencia (reproducción local del mecanismo).** Con un pool de 2 conexiones contra PostgreSQL, la versión defectuosa respondió `[422, 422, "ERROR: timeout exceeded when trying to connect", "ERROR: timeout exceeded when trying to connect"]`: tras dos validaciones fallidas, las peticiones válidas ya no consiguen conexión. La versión con `try/finally` respondió `[422, 422, 201, 201]` y dejó 1 conexión libre.

```js
async function entradaCorrecta(pool, codigo, cantidad) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!(cantidad > 0)) { await client.query('ROLLBACK'); return { status: 422 }; }
    await client.query('UPDATE materias_primas SET stock = stock + $1 WHERE codigo = $2', [cantidad, codigo]);
    await client.query('COMMIT'); return { status: 201 };
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}
```

# Runbook de operación — Pastel Stock

Guía rápida de operación. Para contingencias específicas vea los runbooks de [`runbooks/`](runbooks/) (hoy: [base de datos no responde](runbooks/Runbook_base_de_datos.md)). Responsable: Kevin Andres Rojas Marin. Escalamiento: asesor académico, Abel Fernando Becerra Carrillo.

## Verificar el estado

```bash
curl -fsS https://<url-del-servicio>/health    # {"estado":"ok","status":"ok","db":"up","version":"<sha>"}
```

`/health` es público, no expone datos internos y ejecuta `SELECT 1` contra la base: si responde 503, la base no está disponible para la API. `version` es el SHA del commit desplegado (lo usa el CD para confirmar que corre la versión nueva).

## Desplegar

El despliegue es automático (ADR-11): un *push* a `main` ejecuta **CI**; si termina en verde, **CD** construye la imagen `ghcr.io/sauremk/pastel-stock:<sha>`, despliega a *staging*, espera la **aprobación manual** del Environment `production` y despliega a producción con healthcheck. Si el healthcheck de producción falla, se restaura la última imagen `:stable` automáticamente.

## Rollback manual

GitHub → **Actions → CD → Run workflow** → marcar `rollback`:

- Vacío en `rollback_sha`: vuelve a la última imagen `:stable` (la última que pasó el healthcheck en producción).
- Con `rollback_sha=<sha completo>`: vuelve a esa imagen inmutable (debe existir en GHCR).

El workflow ejecuta el healthcheck tras el rollback. Después de revertir, abra un postmortem si el impacto superó 10 minutos.

## Entrega y reversión (ensayada en II-05)

El procedimiento completo está automatizado y se ensaya con datos ficticios en dos clústeres PostgreSQL 16 separados:

```bash
scripts/ensayo-despliegue.sh <SHA_ANTERIOR> <SHA_CANDIDATA> [/tmp/ensayo]   # deja el registro en ensayo.log
```

Orden de una entrega (parada controlada): 1) respaldo `pg_dump -Fc` y **restauración en una base aislada con comparación de conteos** → 2) detener la versión anterior (SIGTERM) → 3) `npm run migrate` **una sola vez**, con la versión candidata (`RUN_MIGRATIONS=false` en las instancias; el bloqueo consultivo evita carreras, pero un único responsable simplifica el diagnóstico) → 4) iniciar la candidata → 5) `scripts/healthcheck.sh <url> <sha>` (exige que `/health` informe **esa** versión) → 6) prueba funcional con datos ficticios (entrada, producción con `Idempotency-Key`, reinicio y relectura) → 7) observar y decidir conservar o recuperar.

**No vuelva al ejecutable anterior después de aplicar la migración 002** sin leer esto: la versión 1.0.0 arranca y responde 200 sobre el esquema de 6 decimales, pero **redondea a 3 decimales al escribir** (ensayo G4: 0,333333 → 0,333) y desconoce `claves_idempotencia`. Ante un defecto de la candidata, la salida preferida es **corregir hacia adelante**. Si debe restaurar el respaldo previo, se perderán todos los movimientos posteriores a él (ensayo H1); antes de decidir, exporte los movimientos nuevos (`COPY … TO`) para reaplicarlos.

## Respaldo y restauración de la base de datos

```bash
# Respaldo (formato personalizado, comprimido)
pg_dump -Fc "$DATABASE_URL" -f pastel-stock-$(date +%F).dump

# Restauración en una base nueva y verificación
createdb pastel_stock_restaurada
pg_restore --no-owner --clean --if-exists -d "<url de la base nueva>" pastel-stock-AAAA-MM-DD.dump
psql "<url de la base nueva>" -Atc "SELECT count(*) FROM materias_primas"
```

Verifique en el panel del proveedor las condiciones de respaldo automático del plan contratado (los planes gratuitos pueden tener retención o vigencia limitadas) y mantenga además un `pg_dump` semanal fuera del proveedor. Un respaldo que nunca se restauró no es un respaldo: pruebe la restauración periódicamente.

## Rotar secretos

| Secreto | Dónde vive | Efecto de rotarlo |
|---|---|---|
| `JWT_SECRET` | Variable del servicio en Render / `.env` local | Invalida todas las sesiones: los usuarios deben iniciar sesión de nuevo |
| Contraseña de PostgreSQL | Render (base) y `DATABASE_URL` del servicio | Reiniciar el servicio tras actualizar `DATABASE_URL` |
| Contraseñas de usuarios de la app | Tabla `usuarios` (hash bcrypt) | Cambiar con el procedimiento de administración; nunca en el código |
| `RENDER_DEPLOY_HOOK_*`, `SONAR_TOKEN`, `K6_*` | Secrets del repositorio en GitHub | Regenerar en el proveedor y actualizar el secret |

Si un secreto real llegó alguna vez al historial de Git, **rótelo de inmediato**: borrar el commit no lo des-expone (ver `docs/SEGURIDAD.md`).

## Sembrar datos de demostración (solo desarrollo o staging)

```bash
docker compose --profile seed run --rm seed     # con Docker
npm run seed                                    # sin Docker (requiere DATABASE_URL y las SEED_*_PASSWORD)
```

Nunca siembre las contraseñas de demostración en producción.

## Prueba de carga

```bash
TARGET_ENV=local TARGET_URL=http://127.0.0.1:3000 K6_USER=operador K6_PASS='<contraseña>' k6 run k6/entradas.js
```

El script aborta si `TARGET_ENV` no es `local`/`staging` o si la URL parece producción. Umbrales: p95 < 300 ms, errores < 1 %. También se puede lanzar el workflow manual *Prueba de carga (manual, solo staging)*.

## Ver logs y trazas

Con el perfil de observabilidad: Grafana → *Explore* → Loki (`{service_name="pastel-stock"}`) o Tempo (buscar por `trace_id`; cada línea de log de una petición lo incluye). Los logs son JSON, rotan localmente (10 MB × 3) y se retienen 30 días en Loki. No contienen cédulas, teléfonos ni contraseñas (Ley 1581 de 2012).

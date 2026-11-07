#!/usr/bin/env bash
# Ensayo de entrega controlada (II-05). Dos entornos LOCALES y SEPARADOS, con datos ficticios:
#   PRUEBAS : PostgreSQL 16 en el puerto 54411 (aquí se restaura la copia aislada del respaldo)
#   PILOTO  : PostgreSQL 16 en el puerto 54412 (aquí corren la versión anterior y la candidata)
# No toca ninguna base real ni escribe secretos en el repositorio: las claves se generan al vuelo y se guardan solo en $WORK/secretos.env.
# Uso:  scripts/ensayo-despliegue.sh <SHA_ANTERIOR> <SHA_CANDIDATA> [DIRECTORIO_TRABAJO]
# Requisitos: git, node 22, jq, curl, PostgreSQL 16 (initdb/pg_ctl/pg_dump/pg_restore), y ejecutarse como root o como un usuario que pueda iniciar PostgreSQL.
set -uo pipefail

ANT="${1:?SHA de la versión anterior (p. ej. 4c20044)}"
CAND="${2:?SHA de la versión candidata (p. ej. e121de1)}"
WORK="${3:-/tmp/ensayo-ii05}"
REPO="$(git rev-parse --show-toplevel)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PG_PRUEBAS=54411; PG_PILOTO=54412; APP_PUERTO=3102
LOG="$WORK/ensayo.log"
USR_PG="postgres"

mkdir -p "$WORK"; chmod 755 "$WORK"; : > "$LOG"
t0=$(date +%s.%N)
now() { date +%s.%N; }
dur() { awk -v a="$1" -v b="$(now)" 'BEGIN{printf "%.1f", b-a}'; }
reg() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$LOG"; }
pg() { runuser -u "$USR_PG" -- "$@"; }

# ---------- Secretos efímeros (no se registran) ----------
if [ ! -f "$WORK/secretos.env" ]; then
  { echo "PGPASS_PRUEBAS=$(openssl rand -hex 12)"; echo "PGPASS_PILOTO=$(openssl rand -hex 12)"
    echo "JWT_PILOTO=$(openssl rand -hex 32)"
    echo "SEED_ADMIN_PASSWORD=$(openssl rand -base64 15)"; echo "SEED_OPERADOR_PASSWORD=$(openssl rand -base64 15)"; echo "SEED_CONTADOR_PASSWORD=$(openssl rand -base64 15)"; } > "$WORK/secretos.env"
  chmod 600 "$WORK/secretos.env"
fi
set -a; . "$WORK/secretos.env"; set +a

# ---------- Clústeres PostgreSQL separados ----------
crear_cluster() { # nombre puerto clave
  local dir="$WORK/pg_$1"
  if [ ! -d "$dir" ]; then
    mkdir -p "$dir"; chown "$USR_PG" "$dir"; chmod 700 "$dir"
    echo "$3" > "$WORK/pw_$1"; chown "$USR_PG" "$WORK/pw_$1"
    pg "$PGBIN/initdb" -D "$dir" -U pastel -A scram-sha-256 --pwfile="$WORK/pw_$1" -E UTF8 >/dev/null
    rm -f "$WORK/pw_$1"
  fi
  pg "$PGBIN/pg_ctl" -D "$dir" -o "-p $2 -k $dir -c listen_addresses=127.0.0.1" -l "$dir/servidor.log" -w start >/dev/null || { echo "No arrancó PostgreSQL ($1); vea $dir/servidor.log" >&2; exit 1; }
}
parar_cluster() { pg "$PGBIN/pg_ctl" -D "$WORK/pg_$1" -m fast -w stop >/dev/null 2>&1; }
sql() { PGPASSWORD="$PGPASS_PILOTO" psql -h 127.0.0.1 -p "$PG_PILOTO" -U pastel -d "${2:-pastel_piloto}" -Atc "$1"; }
sql_pruebas() { PGPASSWORD="$PGPASS_PRUEBAS" psql -h 127.0.0.1 -p "$PG_PRUEBAS" -U pastel -d "${2:-postgres}" -Atc "$1"; }
url_piloto="postgres://pastel:${PGPASS_PILOTO}@127.0.0.1:${PG_PILOTO}/pastel_piloto"
url_pruebas="postgres://pastel:${PGPASS_PRUEBAS}@127.0.0.1:${PG_PRUEBAS}/pastel_pruebas"

# ---------- Código de cada versión (worktrees; node_modules compartido) ----------
preparar_fuente() { # sha carpeta
  local d="$WORK/$2"
  git -C "$REPO" worktree prune
  [ -d "$d" ] || git -C "$REPO" worktree add --detach "$d" "$1" >/dev/null 2>&1
  [ -f "$d/package.json" ] || { echo "No se pudo preparar el código de $1 en $d" >&2; exit 1; }
  [ -e "$d/node_modules" ] || ln -s "$REPO/node_modules" "$d/node_modules"
}

APP_PID=""
iniciar_app() { # carpeta version [VAR=valor ...]  (en segundo plano; exec deja el PID de node)
  local d="$WORK/$1" v="$2"; shift 2
  cd "$d" || return 1
  env NODE_ENV=production PORT=$APP_PUERTO DATABASE_URL="$url_piloto" JWT_SECRET="$JWT_PILOTO" APP_VERSION="$v" \
      RUN_MIGRATIONS=false LOG_LEVEL=info BCRYPT_COST=10 "$@" node src/server.js >> "$WORK/app_$v.log" 2>&1 &
  APP_PID=$!
  cd - >/dev/null
}
parar_app() { [ -n "$APP_PID" ] && kill -TERM "$APP_PID" 2>/dev/null; for _ in $(seq 1 50); do kill -0 "$APP_PID" 2>/dev/null || return 0; sleep 0.1; done; kill -KILL "$APP_PID" 2>/dev/null; }
esperar_salud() { # versión_esperada  → imprime segundos hasta 200/ok
  local ini; ini=$(now)
  MAX_ATTEMPTS=60 SLEEP_SECONDS=1 "$REPO/scripts/healthcheck.sh" "http://127.0.0.1:$APP_PUERTO" "${1:-}" >> "$LOG" 2>&1 && dur "$ini" || echo "FALLO"
}
H="http://127.0.0.1:$APP_PUERTO/api/v1"
login() { curl -sS -X POST "$H/auth/login" -H 'content-type: application/json' -d "{\"usuario\":\"$1\",\"contrasena\":\"$2\"}" | jq -r '.accessToken // empty'; }

reg "== INICIO ensayo II-05 · anterior=$ANT candidata=$CAND =="
preparar_fuente "$ANT" src_ant; preparar_fuente "$CAND" src_cand
reg "Código anterior : $(git -C "$WORK/src_ant" rev-parse --short HEAD) · $(jq -r .version "$WORK/src_ant/package.json")"
reg "Código candidata: $(git -C "$WORK/src_cand" rev-parse --short HEAD) · $(jq -r .version "$WORK/src_cand/package.json")"
reg "Node $(node -v) · $(pg "$PGBIN/postgres" --version)"

# =====================================================================
# A. Dos entornos separados (base, clave, puerto y secretos distintos)
# =====================================================================
i=$(now); crear_cluster pruebas "$PG_PRUEBAS" "$PGPASS_PRUEBAS"; crear_cluster piloto "$PG_PILOTO" "$PGPASS_PILOTO"
sql_pruebas "CREATE DATABASE pastel_pruebas" >/dev/null 2>&1
PGPASSWORD="$PGPASS_PILOTO" psql -h 127.0.0.1 -p "$PG_PILOTO" -U pastel -d postgres -Atc "CREATE DATABASE pastel_piloto" >/dev/null 2>&1
reg "A1 clústeres PRUEBAS(:$PG_PRUEBAS) y PILOTO(:$PG_PILOTO) arriba en $(dur "$i") s"
reg "A2 separación: cada clúster tiene su directorio, puerto y contraseña; bases visibles en PILOTO = $(sql "SELECT string_agg(datname, ',' ORDER BY datname) FROM pg_database WHERE NOT datistemplate" postgres) | en PRUEBAS = $(sql_pruebas "SELECT string_agg(datname, ',' ORDER BY datname) FROM pg_database WHERE NOT datistemplate")"

# =====================================================================
# B. Versión ANTERIOR en el piloto (estado de partida)
# =====================================================================
( cd "$WORK/src_ant" && DATABASE_URL="$url_piloto" JWT_SECRET="$JWT_PILOTO" node src/db/migrate.js ) >> "$LOG" 2>&1
( cd "$WORK/src_ant" && NODE_ENV=production DATABASE_URL="$url_piloto" JWT_SECRET="$JWT_PILOTO" BCRYPT_COST=10 node src/db/seed.js ) >> "$LOG" 2>&1
reg "B1 migraciones aplicadas con la versión anterior: $(sql "SELECT string_agg(nombre, ', ' ORDER BY nombre) FROM schema_migrations")"
iniciar_app src_ant "$ANT"; s=$(esperar_salud "$ANT"); reg "B2 versión anterior sana en $s s (healthcheck exige version=$ANT)"
TOK=$(login operador "$SEED_OPERADOR_PASSWORD")
r=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$H/movimientos/entradas" -H "authorization: Bearer $TOK" -H 'content-type: application/json' -d '{"codigo":"MP004","cantidad":500,"proveedor":"ENSAYO-II05 anterior"}')
reg "B3 entrada ficticia con la versión anterior → HTTP $r"
reg "B4 estado de partida: movimientos=$(sql 'SELECT count(*) FROM movimientos') stock_MP004=$(sql "SELECT stock FROM materias_primas WHERE codigo='MP004'")"
parar_app

# =====================================================================
# C. Respaldo y restauración en copia aislada (ANTES de migrar)
# =====================================================================
i=$(now); PGPASSWORD="$PGPASS_PILOTO" pg_dump -h 127.0.0.1 -p "$PG_PILOTO" -U pastel -Fc -f "$WORK/respaldo_pre.dump" pastel_piloto
reg "C1 respaldo pg_dump -Fc: $(du -k "$WORK/respaldo_pre.dump" | cut -f1) KB en $(dur "$i") s"
i=$(now); PGPASSWORD="$PGPASS_PRUEBAS" pg_restore -h 127.0.0.1 -p "$PG_PRUEBAS" -U pastel --no-owner -d pastel_pruebas "$WORK/respaldo_pre.dump" >> "$LOG" 2>&1
reg "C2 restauración en la copia aislada (PRUEBAS) en $(dur "$i") s"
huella() { echo "$1" | md5sum | cut -c1-12; }
q="SELECT count(*), COALESCE(sum(cantidad),0) FROM movimientos"
reg "C3 comparación original vs copia: movimientos(count,suma) PILOTO=$(sql "$q") | COPIA=$(sql_pruebas "$q" pastel_pruebas)"
reg "C4 stocks MP: PILOTO=$(huella "$(sql 'SELECT codigo||stock FROM materias_primas ORDER BY codigo')") COPIA=$(huella "$(sql_pruebas 'SELECT codigo||stock FROM materias_primas ORDER BY codigo' pastel_pruebas)")"

# =====================================================================
# D. Entrega de la CANDIDATA (migración explícita + artefacto)
# =====================================================================
i=$(now); ( cd "$WORK/src_cand" && DATABASE_URL="$url_piloto" JWT_SECRET="$JWT_PILOTO" node src/db/migrate.js ) >> "$LOG" 2>&1
reg "D1 migración con la candidata en $(dur "$i") s · historial: $(sql "SELECT string_agg(nombre, ', ' ORDER BY nombre) FROM schema_migrations") · escala stock: $(sql "SELECT numeric_scale FROM information_schema.columns WHERE table_name='materias_primas' AND column_name='stock'")"
i=$(now); iniciar_app src_cand "$CAND"; s=$(esperar_salud "$CAND"); reg "D2 candidata sana (version=$CAND) en $s s desde el arranque"
reg "D3 /health: $(curl -sS "http://127.0.0.1:$APP_PUERTO/health")"
TOK=$(login operador "$SEED_OPERADOR_PASSWORD"); ADM=$(login admin "$SEED_ADMIN_PASSWORD"); CON=$(login contador "$SEED_CONTADOR_PASSWORD")
reg "D4 login: operador=$([ -n "$TOK" ] && echo ok || echo FALLA) admin=$([ -n "$ADM" ] && echo ok || echo FALLA) contador=$([ -n "$CON" ] && echo ok || echo FALLA)"
ant=$(sql "SELECT count(*) FROM movimientos")
r=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$H/movimientos/entradas" -H "authorization: Bearer $TOK" -H 'content-type: application/json' -d '{"codigo":"MP004","cantidad":250.5,"proveedor":"ENSAYO-II05 candidata"}')
reg "D5 entrada ficticia 250,5 g con la candidata → HTTP $r · movimientos $ant → $(sql 'SELECT count(*) FROM movimientos')"
CLAVE="ensayo-ii05-$(date +%s)"
p1=$(curl -sS -D - -o "$WORK/p1.json" -X POST "$H/recetas/1/producir" -H "authorization: Bearer $TOK" -H 'content-type: application/json' -H "Idempotency-Key: $CLAVE" -d '{"unidades":1}')
p2=$(curl -sS -D - -o "$WORK/p2.json" -X POST "$H/recetas/1/producir" -H "authorization: Bearer $TOK" -H 'content-type: application/json' -H "Idempotency-Key: $CLAVE" -d '{"unidades":1}')
reg "D6 producir con Idempotency-Key: 1.ª → $(echo "$p1" | head -1 | tr -d '\r') replayed=$(echo "$p1" | grep -i '^idempotency-replayed' | tr -d '\r' | cut -d' ' -f2) | 2.ª → $(echo "$p2" | head -1 | tr -d '\r') replayed=$(echo "$p2" | grep -i '^idempotency-replayed' | tr -d '\r' | cut -d' ' -f2) | cuerpos iguales como JSON=$([ "$(jq -S . "$WORK/p1.json")" = "$(jq -S . "$WORK/p2.json")" ] && echo sí || echo no) (el orden de las claves puede variar: la respuesta se guarda como JSONB) | SALIDAs de esa producción=$(sql "SELECT count(*) FROM movimientos WHERE tipo='SALIDA'")"
snap_pre_reinicio="$(sql "SELECT count(*)||'/'||(SELECT stock FROM materias_primas WHERE codigo='MP004')||'/'||(SELECT stock FROM productos WHERE sku='PT001') FROM movimientos")"
parar_app; iniciar_app src_cand "$CAND"; s=$(esperar_salud "$CAND")
TOK=$(login operador "$SEED_OPERADOR_PASSWORD")
via_api=$(curl -sS "$H/materias-primas/MP004" -H "authorization: Bearer $TOK" | jq -r .stock)
reg "D7 persistencia tras reinicio: BD antes=$snap_pre_reinicio · API tras reinicio stock_MP004=$via_api · reinicio sano en $s s"
reg "D8 reporte (contador) → HTTP $(curl -sS -o /dev/null -w '%{http_code}' "$H/reportes/dashboard" -H "authorization: Bearer $CON") · escritura del contador (debe ser 403) → HTTP $(curl -sS -o /dev/null -w '%{http_code}' -X POST "$H/movimientos/entradas" -H "authorization: Bearer $CON" -H 'content-type: application/json' -d '{"codigo":"MP004","cantidad":1,"proveedor":"x"}')"

# =====================================================================
# E. Observación: SLI de disponibilidad del endpoint crítico, calculado desde los registros
# =====================================================================
: > "$WORK/carga.log"
N=120; ok=0
for k in $(seq 1 $N); do
  c=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$H/movimientos/entradas" -H "authorization: Bearer $TOK" -H 'content-type: application/json' -d '{"codigo":"MP001","cantidad":1,"proveedor":"ENSAYO-II05 carga"}'); echo "$c" >> "$WORK/carga.log"
done
tot=$(wc -l < "$WORK/carga.log"); e5=$(grep -c '^5' "$WORK/carga.log"); e4=$(grep -c '^4' "$WORK/carga.log")
reg "E1 tráfico sintético al endpoint crítico: total=$tot 5xx=$e5 4xx=$e4 → SLI(no-5xx)=$(awk -v t="$tot" -v e="$e5" 'BEGIN{printf "%.2f", 100*(t-e)/t}') % (denominador $tot; no es tráfico real)"
reg "E2 registros estructurados (muestra, sin datos personales): $(grep -m1 '"statusCode"' "$WORK/app_$CAND.log" | jq -c '{level,time,servicio,req:.req.method,url:.req.url,status:.res.statusCode,ms:.responseTime}' 2>/dev/null)"
reg "E3 el log contiene la clave o el token? → $(grep -c -E "$JWT_PILOTO|$SEED_OPERADOR_PASSWORD|Bearer ey" "$WORK/app_$CAND.log" "$WORK/app_$ANT.log" | tr '\n' ' ') (0 = no aparece)"

# =====================================================================
# F. Incidente 1: PostgreSQL se detiene (fallo reversible en el piloto)
# =====================================================================
reg "F0 línea base: /health=$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$APP_PUERTO/health")"
ini=$(now); parar_cluster piloto; reg "F1 INICIO del incidente: PostgreSQL del piloto detenido"
det=""; for _ in $(seq 1 60); do c=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$APP_PUERTO/health"); [ "$c" = "503" ] && { det=$(dur "$ini"); break; }; sleep 0.5; done
reg "F2 detección: /health devolvió 503 a los ${det:-NO DETECTADO} s · proceso de la app vivo=$(kill -0 "$APP_PID" 2>/dev/null && echo sí || echo no)"
f3=$(curl -sS -w ' HTTP %{http_code}' --max-time 8 "$H/materias-primas" -H "authorization: Bearer $TOK"); reg "F3 la API de negocio durante el incidente → ${f3: -8} · cuerpo: ${f3:0:150}"
rec=$(now); crear_cluster piloto "$PG_PILOTO" "$PGPASS_PILOTO"
rest=""; for _ in $(seq 1 120); do c=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$APP_PUERTO/health"); [ "$c" = "200" ] && { rest=$(dur "$rec"); break; }; sleep 0.5; done
reg "F4 recuperación: /health volvió a 200 a los ${rest:-NO RECUPERA} s de reiniciar PostgreSQL (SIN reiniciar la app) · total incidente=$(dur "$ini") s"
TOK=$(login operador "$SEED_OPERADOR_PASSWORD")
reg "F5 prueba funcional posterior: entrada → HTTP $(curl -sS -o /dev/null -w '%{http_code}' -X POST "$H/movimientos/entradas" -H "authorization: Bearer $TOK" -H 'content-type: application/json' -d '{"codigo":"MP005","cantidad":10,"proveedor":"ENSAYO-II05 post-incidente"}') · movimientos=$(sql 'SELECT count(*) FROM movimientos')"

# =====================================================================
# G. Incidente 2: la versión ANTERIOR lee datos escritos por la candidata (el «ejercicio sin IA»)
# =====================================================================
parar_app; iniciar_app src_ant "$ANT"; s=$(esperar_salud "$ANT"); reg "G1 versión anterior (ejecutable previo) sobre el esquema migrado: sana=$([ "$s" = FALLO ] && echo NO || echo sí)"
TOK=$(login operador "$SEED_OPERADOR_PASSWORD")
for ruta in "materias-primas?limite=100" "movimientos?limite=100" "productos" "recetas" "reportes/dashboard"; do
  reg "G2 versión anterior GET /$ruta → HTTP $(curl -sS -o "$WORK/g.json" -w '%{http_code}' "$H/$ruta" -H "authorization: Bearer $TOK")"
done
reg "G3 versión anterior LEE lo que escribió la candidata (huevos, SALIDA de 1 pastel): $(curl -sS "$H/movimientos?codigo=MP003&limite=10" -H "authorization: Bearer $TOK" | jq -c '[.datos[] | select(.tipo=="SALIDA") | .cantidad]')"
r=$(curl -sS -w ' HTTP %{http_code}' -X POST "$H/recetas/1/producir" -H "authorization: Bearer $TOK" -H 'content-type: application/json' -d '{"unidades":1}'); reg "G4 versión anterior produce 1 pastel sobre el esquema migrado → ${r: -8} · SALIDAs de huevos en la BD (id, cantidad): $(sql "SELECT string_agg(id||':'||cantidad, ' ; ' ORDER BY id) FROM movimientos WHERE materia_prima_codigo='MP003' AND tipo='SALIDA'") · stock_MP003=$(sql "SELECT stock FROM materias_primas WHERE codigo='MP003'")  ← la anterior escribe 0,333 en vez de 0,333333 (redondea a 3 decimales) sin avisar"
parar_app

# =====================================================================
# H. Restauración: qué se pierde si se vuelve al respaldo previo a la migración
# =====================================================================
perd=$(( $(sql 'SELECT count(*) FROM movimientos') - $(sql_pruebas 'SELECT count(*) FROM movimientos' pastel_pruebas) ))
reg "H1 movimientos en el piloto: $(sql 'SELECT count(*) FROM movimientos') · en el respaldo previo: $(sql_pruebas 'SELECT count(*) FROM movimientos' pastel_pruebas) → faltarían $perd registros posteriores al respaldo (RPO real de este ensayo = tiempo entre respaldo y fallo)"
reg "H1b datos propios del ensayo (proveedor «ENSAYO-II05…») en el piloto: $(sql "SELECT count(*) FROM movimientos WHERE proveedor LIKE 'ENSAYO-II05%'") entradas; el resto son SALIDAs de producción y datos de la siembra. Todo el entorno es ficticio y desechable: se destruye al terminar (no hay datos ajenos)."
reg "H2 la copia restaurada NO tiene las tablas nuevas: claves_idempotencia existe en la copia = $(sql_pruebas "SELECT to_regclass('public.claves_idempotencia') IS NOT NULL" pastel_pruebas) · en el piloto = $(sql "SELECT to_regclass('public.claves_idempotencia') IS NOT NULL")"

# =====================================================================
# I. Configuración incompleta (fallo reversible) — la app debe negarse a arrancar sin revelar secretos
# =====================================================================
out=$(cd "$WORK/src_cand" && env -u JWT_SECRET NODE_ENV=production DATABASE_URL="$url_piloto" node src/server.js 2>&1); cod=$?
reg "I1 sin JWT_SECRET: código de salida=$cod · mensaje='$(echo "$out" | head -1)'"
out=$(cd "$WORK/src_cand" && env NODE_ENV=production JWT_SECRET=corto DATABASE_URL="$url_piloto" node src/server.js 2>&1); cod=$?
reg "I2 JWT_SECRET corto: código de salida=$cod · mensaje='$(echo "$out" | head -1)'"

reg "== FIN ensayo: $(dur "$t0") s en total =="
[ "${CONSERVAR:-0}" = 1 ] || { parar_cluster pruebas; parar_cluster piloto; }

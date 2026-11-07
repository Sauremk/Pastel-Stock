#!/usr/bin/env bash
# Uso: healthcheck.sh <URL_BASE> [VERSION_ESPERADA]
# Sale con código 0 solo si /health responde 200 con estado "ok" y, si se indica una versión,
# con esa versión (evita dar por bueno el despliegue ANTERIOR que sigue vivo).
# Acepta {"estado":"ok"} (contrato OpenAPI) o {"status":"ok"}.
set -uo pipefail

BASE_URL="${1:?Falta la URL base, ej. https://pastel-stock.onrender.com}"
EXPECTED_VERSION="${2:-}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-30}"   # 30 x 10 s = 5 min (arranque en frío del plan gratuito)
SLEEP_SECONDS="${SLEEP_SECONDS:-10}"

for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  body="$(curl -sS --max-time 10 -w '\n%{http_code}' "${BASE_URL%/}/health" 2>/dev/null || true)"
  code="$(printf '%s' "$body" | tail -n1)"
  json="$(printf '%s' "$body" | sed '$d')"
  echo "[$attempt/$MAX_ATTEMPTS] HTTP ${code:-000} ${json}"
  if [ "$code" = "200" ] && printf '%s' "$json" | grep -Eq '"(estado|status)" *: *"ok"'; then
    if [ -z "$EXPECTED_VERSION" ] || printf '%s' "$json" | grep -q "\"version\" *: *\"${EXPECTED_VERSION}\""; then
      echo "Healthcheck OK (versión ${EXPECTED_VERSION:-cualquiera})"
      exit 0
    fi
  fi
  sleep "$SLEEP_SECONDS"
done

echo "::error::El healthcheck falló tras ${MAX_ATTEMPTS} intentos"
exit 1

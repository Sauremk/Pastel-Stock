# Objetivos de nivel de servicio (SLI/SLO) — Pastel Stock

Documento operativo del [ADR-14](adr/ADR-14-sli-slo-y-presupuesto-de-error.md). Las reglas de grabación y las alertas viven en [`obs/slo-rules.yml`](../obs/slo-rules.yml) y [`obs/alerts.yml`](../obs/alerts.yml); el tablero, en [`obs/grafana/dashboards/pastel-stock-red-slo.json`](../obs/grafana/dashboards/pastel-stock-red-slo.json).

> **Estado.** Son **metas acordadas en el proyecto**, no resultados medidos. Los valores reales se leen en Grafana tras al menos 7 días de operación (ver «Cómo medir»). El SLO está pendiente de ratificación escrita por Dulce Hogar.

## Endpoint crítico

`POST /api/v1/movimientos/entradas`: es la escritura que mantiene el stock correcto (ADR-08). Se mide con la métrica HTTP estándar de OpenTelemetry `http.server.request.duration`, etiquetada por plantilla de ruta (`http_route`), método y código de respuesta.

## Matriz de niveles de servicio

| SLI | Definición | SLO | Presupuesto de error |
|---|---|---|---|
| **Disponibilidad** | Peticiones al endpoint crítico con respuesta distinta de 5xx sobre el total, en 30 días móviles. Los 4xx cuentan como correctos (error del cliente). | **99,5 %** | 0,5 % = **3,6 h/mes** (216 min) |
| **Latencia** | p95 de la duración < 300 ms, evaluada en ventanas de 5 minutos. | **95 %** de las ventanas del mes cumplen | 5 % de 8 640 ventanas = 432 ventanas = **36 h/mes** fuera de meta |
| **Tasa de error de ventana corta** | % de respuestas 5xx en 5 min < 1 %. | Sin presupuesto propio: alimenta `EntradasErroresAltos` | Si falla 5 min seguidos se alerta y consume presupuesto de disponibilidad |

### Aritmética del presupuesto

- 30 días × 24 h × 60 min = 43 200 min. El 0,5 % son **216 min = 3,6 h**.
- Ventanas de 5 min en 30 días: 30 × 24 × 12 = 8 640. El 5 % son **432 ventanas = 36 h**.

| Disponibilidad | Error permitido | Tiempo caído por mes (30 d) |
|---|---|---|
| **99,5 %** | 0,5 % | 216 min = **3,6 h** |
| 99,9 % | 0,1 % | 43,2 min |
| 99,95 % | 0,05 % | 21,6 min |
| 99,99 % | 0,01 % | 4,32 min |

Se eligió 99,5 % y no 99,95 %: este último dejaría solo 21,6 min al mes y exigiría base de datos y API redundantes y guardia a cualquier hora, algo desproporcionado para una pastelería (ADR-14).

## Consultas (PromQL)

```promql
# SLI de disponibilidad (30 d)  → regla sli:entradas_disponibilidad:ratio_30d
1 - (sum(increase(http_server_request_duration_count{http_route="/api/v1/movimientos/entradas",http_response_status_code=~"5.."}[30d])) or vector(0))
  / sum(increase(http_server_request_duration_count{http_route="/api/v1/movimientos/entradas"}[30d]))

# Presupuesto restante (1 = intacto, 0 = agotado, < 0 = excedido)
1 - ((1 - sli:entradas_disponibilidad:ratio_30d) / 0.005)

# Latencia p95 en ventanas de 5 min y cumplimiento mensual
sli:entradas_latencia_p95:5m
avg_over_time(sli:entradas_ventana_buena:5m[30d])
```

## Política del presupuesto de error

| Presupuesto restante | Acción | Alerta |
|---|---|---|
| < 25 % durante 30 min | Avisar; priorizar estabilidad sobre funcionalidades nuevas | `PresupuestoDeErrorBajo` (warning) |
| < 0 durante 5 min | **Congelar despliegues de funcionalidades**; solo se despliegan correcciones de estabilidad hasta recuperar el presupuesto | `PresupuestoDeErrorAgotado` (critical) |
| Incidente de > 10 min | Postmortem sin culpables ([plantilla](postmortem-simulacion.md)) | — |

Otras alertas relacionadas (`obs/alerts.yml`): `EntradasLatenciaP95Alta` (p95 > 300 ms por 10 min), `EntradasErroresAltos` (> 1 % de 5xx por 5 min; enlaza al [runbook](runbooks/Runbook_base_de_datos.md)) y `ApiSinMetricas`.

## Cómo medir

1. Levantar la observabilidad: `docker compose -f docker-compose.yml -f docker-compose.obs.yml up -d --build` (ver README).
2. Abrir Grafana (`http://localhost:3001`) → carpeta **Pastel Stock** → **Pastel Stock – RED y SLO**.
3. Generar tráfico representativo con la prueba de carga (`k6/entradas.js`, solo contra local o staging) o con uso real.
4. Tras ≥ 7 días de operación, registrar el valor de `sli:entradas_disponibilidad:ratio_30d` y del presupuesto restante. Sin esa evidencia el SLO sigue siendo una meta.

> **Nota técnica.** La etiqueta `http_route` solo aparece si la API arranca con el loader ESM de OpenTelemetry y `OTEL_SEMCONV_STABILITY_OPT_IN=http`; `docker-compose.obs.yml` ya lo configura. Se verificó con el Collector real que sin el loader la métrica no trae la ruta y las consultas del SLO quedan vacías.

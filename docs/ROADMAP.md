# Roadmap técnico (próximos 6 meses)

Supuesto de capacidad: 16 h por semana, de las cuales el 20 % se reserva siempre para deuda técnica (ADR-15). Las horas son estimaciones por validar. Cada hito tiene un **disparador**: se adelanta o se pospone según lo que pase en producción, no según el calendario.

## Ahora — diciembre 2026 a enero 2027 (perfectivo)

| Trabajo | Paga / aporta | Esfuerzo | Disparador |
|---|---|---|---|
| **Ventas y costeo real:** registrar ventas de productos terminados, costo por receta y margen real; volver a mostrar ventas, margen y ROI en el tablero, ahora calculados | Completa DT-10; valor de negocio para fijar precios | ≈ 40 h | La administradora pide costeo por receta o margen real |
| **Alertas de caducidad:** avisos de productos por vencer (hoy solo se cuentan en el tablero) | Reduce merma | ≈ 12 h | Producto vencido en inventario |
| **Métricas del pool y alerta de saturación** (`db.pool.*`) | Cierra DT-15 | ≈ 8 h | Antes del primer despliegue a producción |
| **Respaldo verificado:** `pg_dump` semanal fuera del proveedor y prueba de restauración trimestral | Reduce riesgo de pérdida de datos | ≈ 6 h | Primer mes en producción |
| **Conteo físico vs sistema:** pantalla de ajustes (`AJUSTE`) con motivo | Confiabilidad del stock | ≈ 16 h | Diferencia > 5 % entre stock del sistema y conteo físico mensual |

## Siguiente — febrero a marzo 2027 (adaptativo)

| Trabajo | Paga / aporta | Esfuerzo | Disparador |
|---|---|---|---|
| **Migrar a Node.js 24 LTS** (imagen Docker, `engines`, CI) y actualizar dependencias; ejecutar la suite completa y k6 de regresión | Paga DT-16 | ≈ 24 h | Fecha fija: 1 de marzo de 2027, 60 días antes del fin de soporte de Node.js 22 |
| **Modo degradado sin conexión:** cola local de entradas de materia prima que se sincroniza al volver internet | Todo el sistema depende de internet; la conectividad de Dulce Hogar aún no está medida | ≈ 30 h | Caídas de internet del local > 1 h al mes (medir primero) |
| **Notificaciones** de stock crítico por correo o WhatsApp | Menos faltantes | ≈ 16 h | Faltantes de insumos reportados |

## Después — abril a mayo 2027 (preventivo)

| Trabajo | Paga / aporta | Esfuerzo | Disparador |
|---|---|---|---|
| **Pruebas E2E del navegador** (flujo login → entrada → tablero) y más pruebas del frontend | Refuerza DT-05 | ≈ 32 h | Dos regresiones de interfaz en un mes |
| **Repositorio genérico** en el backend para eliminar el CRUD repetido | Reduce el interés de DT-11 | ≈ 16 h | Se añade una cuarta entidad con CRUD |
| **Logs de producción al Collector** (reenvío desde Render o servicio gestionado) | Paga DT-14 | ≈ 24 h | Primer incidente que no se pueda diagnosticar con los logs del proveedor |

## Condicional

| Trabajo | Disparador |
|---|---|
| **Extraer Reportes** como servicio separado (ADR-05) | p95 de exportes > 1 s o CPU sostenida > 70 % durante una semana |
| **Multisucursal** (inventario por sede) | Dulce Hogar abre una segunda sede |
| **Plan de pago de infraestructura** (base de datos y servicio sin suspensión) | Superar el SLO de disponibilidad por arranques en frío del plan gratuito |

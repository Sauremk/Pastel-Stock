# ADR-19: Equipo (usuarios gestionados por el administrador) y tiendas en la app sin servidor

| Campo | Valor |
|---|---|
| **Estado** | Aceptado (v1.5) |
| **Autor** | Kevin Andres Rojas Marin |
| **Relacionado** | ADR-04 (núcleo hexagonal), ADR-06 (JWT y RBAC), ADR-18 (PWA sin servidor) |
| **Implementación** | `src/identity/domain/equipo.js`, `src/identity/application/equipoService.js`, `src/identity/adapters/http/equipoRouter.js`, `pwa/servidor.js`, `pwa/modo-local.js`, `web/js/views/equipo.js` |

## Contexto

Hasta la v1.4 los usuarios eran los tres de la semilla (`admin`, `operador`, `contador`) y no había forma de agregar a nadie desde la app. Se pidió poder **crear usuarios y tiendas para más personas**: que una pastelería registre a su equipo y que otras pastelerías puedan usar Pastel Stock con sus propios datos.

## Decisión

**1. Equipo, en ambas versiones (servidor y app sin servidor).**
- Endpoints solo para `admin`: `GET/POST /usuarios`, `PATCH /usuarios/{id}` (nombre, rol, activo) y `POST /usuarios/{id}/contrasena`. Esquemas en el contrato OpenAPI; la matriz RBAC se deriva de `x-roles`, como el resto.
- Reglas puras en `src/identity/domain/equipo.js`, importadas por el servidor y por `pwa/servidor.js`:
  - usuario de 3 a 40 caracteres en minúsculas, sin espacios; contraseña de 8 a 72 caracteres;
  - nadie se quita su propio rol de administrador ni se desactiva;
  - siempre queda al menos un administrador activo. En PostgreSQL el conteo bloquea las filas de los administradores (`FOR UPDATE`) para que dos cambios simultáneos no dejen la tienda sin administrador.
- No se borran usuarios: se **desactivan**. Las ventas y movimientos conservan a quien los registró (claves foráneas intactas).
- Desactivar, cambiar el rol o poner una contraseña nueva revoca los refresh tokens de esa persona. En el servidor, el access token en curso sigue siendo válido hasta que vence (máximo 15 minutos, ADR-06); en la app sin servidor la sesión se corta de inmediato.

**2. Tiendas, solo en la app sin servidor.**
- Un registro `pastel-stock.tiendas` en el dispositivo lista las tiendas; cada una guarda sus datos en su propia clave (`pastel-stock.datos.<id>`). La demostración conserva la clave de la v1.2, así que quien ya la usaba no pierde nada.
- «Crear una tienda nueva» crea datos vacíos con el nombre de la tienda y su primer administrador, y entra de una vez.
- El login devuelve `tienda` (nombre) y `usuario`; la interfaz muestra el nombre de la tienda. En el servidor el nombre sale de `TIENDA_NOMBRE`.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Registro abierto de tiendas en el servidor (multi-inquilino ya) | Exige `tienda_id` en todas las tablas, aislar cada consulta y un hosting con base de datos permanente. Es el siguiente paso (ver abajo), no un cambio para hacer sin decidir dónde se aloja. |
| Borrar usuarios | Rompe el historial (ventas y movimientos quedarían sin autor) o exigiría borrados en cascada. |
| Que cada persona elija su contraseña al registrarse | Sin correo ni servidor no hay forma segura de verificar a quien se registra; el administrador entrega una contraseña inicial y la persona la cambia en «Datos y cuenta». |

## Consecuencias

- Una pastelería puede manejar a su equipo sin tocar la base de datos ni volver a sembrar.
- En la app sin servidor, cada tienda y su equipo viven en **un** dispositivo (ADR-18): varias personas comparten el mismo celular o computador. Respaldo por tienda.
- **Pendiente (nube):** para que cada persona entre desde su propio celular a los mismos datos, hace falta el servidor desplegado y multi-inquilino: tabla `tiendas`, `tienda_id` en todas las tablas con índices y aislamiento por tienda en cada repositorio, registro de tienda nueva, y un hosting con PostgreSQL gestionado. Se decidirá en un ADR propio cuando se elija el proveedor.

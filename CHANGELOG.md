# Changelog — Sportanet

Este archivo registra los cambios relevantes realizados en Sportanet, incluyendo nuevas funcionalidades, modificaciones, correcciones y verificaciones.

El formato está inspirado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). El versionado se organiza por fases de desarrollo para facilitar el seguimiento incremental del proyecto.

## [Fase 1C] - 2026-10-17

### Añadido
- `backend/middleware/authorize.js`: `requireRole(...roles)`, `parseIdParam` (valida `:id` como entero positivo ≤ 2147483647) y `requireSelfOrAdmin`. Fallan cerrados: sin `req.auth` responden 401; `requireSelfOrAdmin` sin `parseIdParam` antes lanza un error en lugar de autorizar.
- `backend/db/users.js`: `listActiveUsers`, `findPublicUserById`, `createUser`, `updateUser` (lista blanca de columnas) y `softDeleteUser`. Ninguna consulta pública selecciona `pwd`.
- `backend/test/authorize.test.js`: 13 pruebas unitarias sin BD.
- 12 pruebas de integración en `sql.test.js` para `/api/users`; la limpieza ahora también borra organizadores, eventos e inscripciones de prueba.
- Códigos de error: `FORBIDDEN`, `INVALID_ID`, `NOT_FOUND`, `VALIDATION_ERROR`, `NO_FIELDS`, `EMAIL_TAKEN`, `PHONE_TAKEN`, `DUPLICATE`.

### Cambiado
- `backend/routes/users.js` reescrito. `router.use(authenticate)` protege todas las rutas:
  - `GET /api/users` y `POST /api/users`: solo Admin.
  - `GET`, `PUT` y `DELETE /api/users/:id`: el propio usuario o Admin.
  - `PUT` acepta únicamente `full_name`, `email`, `phone` y `pwd`; `role`, `is_active` y cualquier otra clave se ignoran. `pwd` vacío o `null` sigue significando "no cambiar".
  - `DELETE` es **borrado lógico** (`is_active = 0`, `deleted_at = NOW()`); ya no borra `user_profile` y funciona con usuarios que tienen inscripciones.
- Contrato: `GET /api/users/:id` devuelve un objeto (antes un array de una fila); `POST /api/users` responde 201 (antes 200); los duplicados responden 409 con código (en `register` siguen siendo 400, sin cambios). El frontend (`JS/header.js`) solo usa `PUT` y `DELETE` sobre el propio id y ya envía el token, por lo que no requirió cambios.

### Seguridad
- Antes cualquiera, sin sesión, podía listar, leer (con el hash `pwd`), crear con contraseña en claro, editar o borrar cualquier cuenta.
- Los errores de BD ya no llegan al cliente (respuesta `500 DB_ERROR` genérica) y el log solo registra el código de MySQL, porque el objeto de error de mysql2 incluye el SQL con los valores (p. ej. el hash).
- Contraseñas de más de 72 bytes se rechazan en `PUT`/`POST /api/users` (bcrypt las truncaría en silencio).

### Verificación
- Entorno: MariaDB 10.11 con `schema.sql` parcheado solo en la collation (ver Fase 1B.1) y Node 22.22.
- `npm test` (glob `test/*.test.js`): 28/28 (15 + 13). `npm run testsql`: 26/26.
- Pruebas de sensibilidad: se rompió el código a propósito de 6 formas (quitar `authenticate`, quitar `requireSelfOrAdmin` del DELETE, volver al borrado físico, clasificar duplicados por texto, devolver `SELECT *`, aceptar `role` en `PUT`) y cada una hizo fallar los tests correspondientes; restaurado vuelve a 26/26.
- Error de BD forzado (columna renombrada en la BD de pruebas): respuesta `500 {"error":"Internal error","code":"DB_ERROR"}` y log con solo `ER_BAD_FIELD_ERROR`.
- El `DELETE` físico de un usuario con inscripciones falla con `ER_ROW_IS_REFERENCED_2` (comprobado en un test); el borrado lógico lo evita.

### Pendiente de verificar
- Todo lo anterior contra MySQL 8/9.1 con el `schema.sql` original, y `npm test` en Node 24.11.1.
- Si `test` en `package.json` lista archivos uno a uno, añadir `test/authorize.test.js`.
- Email y teléfono de una cuenta eliminada siguen reservados por los UNIQUE (decidir si se anonimizan).
- `routes/auth.js` (`register`, `login`) aún devuelve `err.message` de MySQL en los 500.

## [Fase 1B.1] - 2026-10-16

### Añadido
- `backend/scripts/migrate.js`: aplica migraciones SQL versionadas (`Base de Datos/migrations/NNN_descripcion.sql`) y registra cada versión en `schema_migrations`. Opciones: `--status`, `--dry-run`, `--reset` (recrea la BD desde `schema.sql`, **solo** si el nombre termina en `_test`), `--yes`, `--dir`, `--schema`. Fuera de una BD `*_test` exige escribir el nombre de la BD para confirmar (o `--yes` sin terminal). Usa un bloqueo (`GET_LOCK`) contra ejecuciones simultáneas.
- `backend/test/integration/sql.test.js`: 14 pruebas contra MySQL real (`sportanet_test`): `findUserById` con columnas y tipos reales, estados de cuenta, rol y email desde la BD, y flujo `register → login → /me` con bcrypt real. Se niega a ejecutarse si `DB_NAME` no termina en `_test`.
- `Base de Datos/migrations/README.md`: convención y flujo de migraciones.
- Scripts npm que se añaden a `backend/package.json` (los agrega el equipo): `testsql` (`node --env-file=.env.test --test test/integration/sql.test.js`), `migrate`, `migrate:test` y `db:reset:test`.

### Cambiado
- Los tests de BD viven en `test/integration/` y no en `test/`, porque `npm test` usa el glob `test/*.test.js`: un archivo `test/sql.test.js` lo ejecutaría `npm test` contra la BD de `backend/.env` en lugar de `sportanet_test`.

### Verificación
- Entorno: **MariaDB 10.11** (no MySQL) en el puerto 6603, con una copia de `schema.sql` cuya collation `utf8mb4_0900_ai_ci` se cambió por `utf8mb4_unicode_ci` solo para esta prueba (MariaDB < 11.4.5 no la soporta). Node 22.22.
- `migrate.js`: reset, `--dry-run` sin cambios, aplicar, reejecutar (idempotente), migración que se registra a sí misma, migración con error (no se registra, salida 1), versión duplicada, `--reset` rechazado fuera de `*_test`, aborto sin terminal y sin `--yes`, y confirmación interactiva correcta e incorrecta (con pseudo-terminal).
- `sql.test.js`: 14/14. El guard rechaza `DB_NAME` ausente y `sportanet_v1`. Al romper a propósito la consulta de `db/users.js` fallan 9 de 14, así que las pruebas no son vacuas.
- `npm test`: sigue en 15/15 y no ejecuta las pruebas de integración.

### Pendiente de verificar
- Todo lo anterior contra **MySQL 8/9.1** con el `schema.sql` original (en el equipo local).
- La numeración de la primera migración: revisar `SELECT * FROM schema_migrations;` en `sportanet_v1`.
- `npm run migrate` contra `sportanet_v1` (requiere respaldo y autorización).

## [Fase 1B] - 2026-10-15

### Añadido
- `backend/db/users.js`: `findUserById(userId)`, consulta `user_id, email, role, is_active, deleted_at` (nunca `pwd`).
- `backend/middleware/requireAuth.js`: instancia de `authenticate` conectada a MySQL; es lo que importan las rutas.
- Códigos de error `ACCOUNT_DISABLED`, `ACCOUNT_DELETED` y `DB_ERROR`.
- `role` en `req.auth` y en la respuesta de `GET /api/auth/me`.
- 6 tests nuevos (cuenta desactivada, eliminada, fila inexistente, fallo de BD sin filtrar detalle, identidad desde BD ignorando `role` del token, validación de la factory).

### Cambiado
- `backend/middleware/authenticate.js`: pasa de función directa a factory `createAuthenticate({ findUserById })`; tras validar el JWT consulta el estado de la cuenta. Un token firmado y vigente ya no basta si la cuenta está desactivada o eliminada.
- `backend/routes/auth.js`: usa `requireAuth`; `POST /login` responde `403` con `ACCOUNT_DISABLED`/`ACCOUNT_DELETED` (se comprueba después de bcrypt, para no revelar el estado de cuentas ajenas) y no emite token.
- `backend/test/authenticate.test.js`: adaptado a la factory con un `findUserById` en memoria; los tests de rechazo de token comprueban además que no se consultó la BD.
- `backend/app.js` no se modificó.

### Seguridad
- Un usuario desactivado o eliminado pierde acceso de inmediato en rutas protegidas, sin esperar a que el JWT (7 días) expire.
- El rol se lee de la BD; un `role` incluido en el token se ignora.
- Los fallos de BD en el middleware se registran en el servidor y se devuelven como `DB_ERROR` genérico.

### Verificación
- `npm test` en `backend/`: 15/15 pasan (Node 22.22.0, entorno de desarrollo de Claude).
- Cableado real de `routes/auth.js` + `requireAuth` + `db/users.js` comprobado con un pool simulado (10/10): login activo/desactivado/eliminado, `/me` antes y después de desactivar, reactivar y borrar la cuenta, y que la consulta no selecciona `pwd`.

### Pendiente de verificar
- Ejecución contra MySQL real (`UPDATE users SET is_active = 0` y comprobar `401 ACCOUNT_DISABLED`).
- `npm test` en el Node 24.11.1 local.
- `routes/users.js` sigue sin protección (siguiente tarea).

## [Fase 1A.1] - 2026-10-14

### Añadido
- `DB_PORT` en `backend/.env.example` y en `backend/db/connection.js` (preparación para Railway).
- `waitForConnections: true` en el pool de conexiones MySQL.

### Cambiado
- `backend/config/jwt.js` y `backend/db/connection.js` cargan el `.env` con path absoluto (`path.resolve(__dirname, '../.env')`), garantizando que se lea desde `backend/` sin importar el directorio de trabajo.
- `backend/app.js` lee `process.env.PORT || 5000` en lugar de un puerto fijo (preparación para Render).
- `backend/test/authenticate.test.js`: el test "sin JWT_SECRET" ahora se ejecuta con `JWT_SECRET: ''` en el entorno del subproceso, eliminando la dependencia del filesystem y del `.env` real.

### Seguridad
- El arranque del servidor falla con un error explícito si `JWT_SECRET` no está definido, sin valores por defecto inseguros.
- Compatibilidad verificada con Node.js 24.11.1 (Claude había probado en Node 22).

### Verificación
- `npm test` pasa 9/9 tras los cambios.
- Arranque end-to-end verificado con `curl`: `GET /api/auth/me` sin token devuelve `401 TOKEN_MISSING`.
- Verificación manual del fail-safe: sin `.env`, el servidor falla al arrancar con `Error: JWT_SECRET no está definido`; los tests siguen pasando 9/9.
- Verificación del puerto dinámico: el servidor respeta `PORT=5055` cuando se configura en `.env`.

### Pendiente de verificar
- Despliegue en Railway (base de datos) y Render (backend).
- Migración del frontend a Render.


## [Fase 1A] - 2026-10-13

### Añadido
- Middleware de autenticación JWT en `backend/middleware/authenticate.js`.
- Configuración centralizada de JWT en `backend/config/jwt.js`.
- Endpoint `GET /api/auth/me` para consultar la identidad del usuario a partir del token.
- Pruebas unitarias del middleware en `backend/test/authenticate.test.js`.
- Script `npm test` en `backend/package.json`, utilizando el ejecutor de pruebas nativo de Node.js.
- Variable de entorno `JWT_SECRET` documentada en `backend/.env.example`.

### Cambiado
- `backend/routes/auth.js`: el inicio de sesión y el registro generan tokens JWT con una vigencia de siete días.
- `backend/app.js`: carga la configuración JWT durante el arranque del servidor y detiene la inicialización si falta el secreto obligatorio.
- `backend/package.json`: incorpora la configuración de pruebas y los cambios de scripts correspondientes a esta fase.

### Seguridad
- La verificación de tokens restringe el algoritmo admitido a HS256.
- Se validan la presencia y el formato del encabezado Bearer, la firma, la expiración y el identificador del usuario.
- Se establecen respuestas de error para tokens ausentes, malformados, inválidos o expirados.

### Verificación
- Se reportaron nueve pruebas unitarias aprobadas en el entorno de desarrollo utilizado para implementar la fase.
- Se reportaron pruebas funcionales del endpoint de identidad y de los casos de autenticación válidos e inválidos.
- Pendiente: reproducir las pruebas en el entorno local del proyecto y verificar el funcionamiento del inicio de sesión y el registro contra la base de datos real.

### Pendiente de verificar
- Resultado definitivo de `npm audit` y confirmación de las vulnerabilidades corregidas.
- Pruebas de integración de registro e inicio de sesión con la base de datos local.
- Revisión de los endpoints de usuarios para corregir los riesgos de autorización y exposición de información sensible.

## [Fase 0] - Fecha por confirmar

### Estado inicial conocido
- Aplicación web con frontend estático basado en HTML, CSS y JavaScript.
- Backend desarrollado con Node.js y Express.
- Persistencia de datos mediante MySQL.
- Funcionalidades previas de registro e inicio de sesión de usuarios.

### Pendiente de documentar
- Fecha exacta de inicio del proyecto.
- Estructura y funcionalidades verificadas de la versión inicial.
- Estructura confirmada del esquema de base de datos aplicado.
- Pruebas iniciales y problemas identificados antes de la Fase 1A.

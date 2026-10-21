# Changelog — Sportanet

Este archivo registra los cambios relevantes realizados en Sportanet, incluyendo nuevas funcionalidades, modificaciones, correcciones y verificaciones.

El formato está inspirado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). El versionado se organiza por fases de desarrollo para facilitar el seguimiento incremental del proyecto.

## [Fase 1E] - 2026-10-21

### Añadido
- `backend/db/accounts.js`: `createAccount`, alta transaccional de una cuenta. Para un Organizador inserta en la misma transacción la fila de `users` (rol `Organizer`) y la de `event_organizers` con `display_name` = nombre del usuario; si cualquier paso falla se hace rollback y no queda un Organizador sin su fila de organizador. Rechaza cualquier rol que no sea `Participant` u `Organizer` (segunda barrera: Admin no se crea por registro).
- `backend/utils/userInput.js`: `resolveAccountType`, lista blanca del campo `account_type`: `Atleta` → `Participant`, `Organizador` → `Organizer` (un `Map`, para que `constructor` o `__proto__` no resuelvan a nada).
- Frontend: selector «Tipo de cuenta» (Atleta / Organizador) en el formulario de registro (`includes/header.html`, `CSS/header.css`, `JS/header.js`).
- 8 pruebas unitarias en `auth.test.js` y 8 de integración en `sql.test.js`.

### Cambiado
- `POST /api/auth/register` acepta `account_type` opcional (por defecto `Atleta`, compatible con clientes anteriores); cualquier otro valor, incluido `Admin`, responde 400 `VALIDATION_ERROR` con `fields: ["account_type"]`. `role` en el body sigue ignorándose.
- `register` y `login` devuelven también `user.role` (`Participant` / `Organizer`); `findAuthUserByEmail` selecciona `role`.
- `JS/header.js`: envía `account_type`; los errores de registro y login muestran un mensaje en español según el `code` de la API. Antes leía `data.message`, que la API nunca envía, y siempre mostraba el texto genérico (también para `EMAIL_TAKEN`, `PHONE_TAKEN`, `ACCOUNT_DISABLED` y `ACCOUNT_DELETED`).

### Decisiones de producto
- Un Organizador puede crear eventos sin verificación por ahora; a futuro se estudiará un esquema de verificación para eventos patrocinados, promocionales o auditados por Sportanet.
- Las cuentas Admin son solo para gestionar la plataforma: un administrador debe tener además una cuenta de Atleta aparte.

### Verificación
- Unitarias 64/64 y de integración 45/45 (dos ejecuciones) en MariaDB 10.11; prueba manual en Chromium: selector, envío de `account_type`, `role` guardado y mensaje de correo duplicado.
- Mutaciones detectadas por las pruebas: quitar el rollback, quitar el guard de rol, admitir `Admin` en la lista blanca y no crear la fila de organizador.

## [Fase 1D] - 2026-10-20

### Añadido
- `backend/utils/userInput.js`: validación compartida de los datos de una cuenta (`validateBody`, `badRequest`, y `validateLogin` para el login). Es el código que estaba dentro de `routes/users.js`, movido sin cambios de reglas.
- `backend/utils/dbFail.js`: respuesta uniforme ante errores de BD (el `dbFail` de `routes/users.js`, ahora compartido y con una etiqueta de log por ruta).
- `backend/db/users.js`: función nueva `findAuthUserByEmail(email)`, con columnas explícitas. Es la única función que devuelve `pwd`, solo para el login.
- `backend/test/auth.test.js` (17 pruebas) y `backend/test/userInput.test.js` (11): unitarias, sin MySQL. `auth.test.js` sustituye `db/connection` por un pool simulado y ejecuta el router, `db/users.js`, `utils/` y bcrypt reales.
- 11 pruebas de integración nuevas en `sql.test.js` (Fase 1D) contra la BD real.

### Cambiado
- `backend/routes/auth.js`:
  - `register` valida con las mismas reglas que `/api/users` (tipo, longitud, formato de email y contraseña ≤ 72 bytes) **antes** de hashear o consultar la BD, recorta nombre, correo y teléfono, y crea la cuenta con `createUser` (columnas fijas; rol y estado por defecto del esquema).
  - `login` valida que `email` y `pwd` sean texto no vacío (400 `VALIDATION_ERROR` en otro caso), usa `findAuthUserByEmail` en lugar de `SELECT *` y recorta el correo.
  - Ambos pasan a `async/await` con `try/catch`; los errores de BD responden con `dbFail`.
- `backend/routes/users.js`: usa `utils/userInput.js` y `utils/dbFail.js` en lugar de copias locales. Sin cambios de comportamiento (las 26 pruebas de integración anteriores siguen pasando).
- Contrato: en `register`, un correo o teléfono repetido responde **409** (antes 400) con `EMAIL_TAKEN` o `PHONE_TAKEN` (antes siempre "Email already registered", también para el teléfono); un body inválido responde 400 `VALIDATION_ERROR` con la lista de campos (antes "Missing fields" o un 500). El texto de `error` en los duplicados no cambia. El frontend (`JS/header.js`) solo comprueba `response.ok`, así que no requiere cambios.

### Seguridad
- **Caída del servidor:** `POST /api/auth/login` con un correo existente y `pwd` que no fuera texto (por ejemplo `{"email":"a@b.co","pwd":12345678}`) hacía que `bcrypt.compare` lanzara dentro de un callback fuera de Express: la petición nunca recibía respuesta y quedaba un `unhandledRejection`, que termina el proceso en Node 15 o superior. Cualquiera sin sesión podía provocarlo con un correo existente.
- **Fuga de detalles internos:** los 500 de `register` y `login` devolvían `err.message` de MySQL (por ejemplo `Data too long for column 'full_name' at row 1`). Ahora responden `500 {"error":"Internal error","code":"DB_ERROR"}` y el log solo registra el código del error (el objeto de error de mysql2 incluye el SQL con los valores, p. ej. el hash).
- **Valores fuera de tipo o límite:** ya no llegan a la consulta; antes, un objeto en `email` se formateaba como condición SQL (`WHERE email = \`email\` = 1`) y un nombre de 101 caracteres producía un 500.
- **Enumeración de cuentas por tiempo de respuesta:** con un correo inexistente el login no ejecutaba bcrypt y respondía mucho más rápido que con uno registrado. Ahora compara contra un hash falso de la misma dificultad, de modo que ambos casos tardan lo mismo y dan la misma respuesta 401.
- Sin cuerpo JSON (`POST` sin `Content-Type`), `register` y `login` respondían 500 con una traza en el log; ahora 400.
- Se conserva y se prueba que `role`, `is_active`, `user_id` y `deleted_at` del body de `register` se ignoran (los privilegios no se conceden desde el formulario público: PROJECT_LOGIC §3.3). Esa prueba también pasaba con el código anterior: es una guarda para el registro de organizadores.

### Verificación
- Entorno de Claude (MariaDB 10.11 con `schema.sql` parcheado solo en la collation, Node 22.22): `npm test` **56/56** (15 + 13 + 17 + 11) y `npm run testsql` **37/37**. Tres rondas seguidas dan el mismo resultado.
- Contra el `auth.js` anterior, la suite de integración falla en 7 pruebas y el proceso muere en la de `login` con `pwd` numérico.
- Se rompió el código nuevo de 7 formas (login sin `validateLogin`, sin hash falso, `err.message` en el 500, duplicados clasificados por texto, estado de cuenta revelado antes de la contraseña, `SELECT *`, límite de contraseña en 100 bytes) y cada una hizo fallar pruebas; restaurado vuelve a verde.
- Arranque real de `app.js` con peticiones HTTP: registro válido 200, teléfono repetido 409 `PHONE_TAKEN`, nombre de 101 caracteres 400, `pwd` numérico 400 y el servidor sigue vivo, sin cuerpo 400, JSON malformado 400 `INVALID_JSON` (comprobación manual con `curl`; no hay prueba automática del manejador global de `app.js`), login válido 200. El log solo mostró `Server running on port 5055`.

### Pendiente de verificar
- `npm test` y `npm run testsql` en el equipo (MySQL 8.0.46, Node 24.22.0). La prueba que fuerza un error real de MySQL renombra temporalmente `users.phone` en `sportanet_test` y siempre lo restaura; si una ejecución se interrumpe a mitad, `npm run db:reset:test` deja la BD de pruebas como nueva.
- Política de contraseña (mínimo y complejidad) y límite de intentos en `/api/auth/login`: no se tocaron; requieren decisión y, para el límite de intentos, una dependencia nueva.

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
- Equipo (Windows, Node 24.22.0, **MySQL 8.0.46** con el `schema.sql` original): `npm test` 28/28 y `npm run testsql` 26/26.
- Entorno de Claude: MariaDB 10.11 con `schema.sql` parcheado solo en la collation (ver Fase 1B.1) y Node 22.22. Mismos resultados: `npm test` 28/28 (15 + 13) y `npm run testsql` 26/26.
- Pruebas de sensibilidad: se rompió el código a propósito de 6 formas (quitar `authenticate`, quitar `requireSelfOrAdmin` del DELETE, volver al borrado físico, clasificar duplicados por texto, devolver `SELECT *`, aceptar `role` en `PUT`) y cada una hizo fallar los tests correspondientes; restaurado vuelve a 26/26.
- Error de BD forzado (columna renombrada en la BD de pruebas): respuesta `500 {"error":"Internal error","code":"DB_ERROR"}` y log con solo `ER_BAD_FIELD_ERROR`.
- El `DELETE` físico de un usuario con inscripciones falla con `ER_ROW_IS_REFERENCED_2` (comprobado en un test); el borrado lógico lo evita.

### Pendiente de verificar
- Nota de configuración: `test` en `package.json` usa el glob `test/*.test.js`, así que recoge `authorize.test.js` solo; si algún día se cambia a una lista de archivos, hay que añadirlo.
- Email y teléfono de una cuenta eliminada siguen reservados por los UNIQUE (decidir si se anonimizan).
- ~~`routes/auth.js` (`register`, `login`) aún devuelve `err.message` de MySQL en los 500.~~ Resuelto en la Fase 1D.

## [Fase 1B.1] - 2026-10-16

### Añadido
- `backend/scripts/migrate.js`: aplica migraciones SQL versionadas (`Base de Datos/migrations/NNN_descripcion.sql`) y registra cada versión en `schema_migrations`. Opciones: `--status`, `--dry-run`, `--reset` (recrea la BD desde `schema.sql`, **solo** si el nombre termina en `_test`), `--yes`, `--dir`, `--schema`. Fuera de una BD `*_test` exige escribir el nombre de la BD para confirmar (o `--yes` sin terminal). Usa un bloqueo (`GET_LOCK`) contra ejecuciones simultáneas.
- `backend/test/integration/sql.test.js`: 14 pruebas contra MySQL real (`sportanet_test`): `findUserById` con columnas y tipos reales, estados de cuenta, rol y email desde la BD, y flujo `register → login → /me` con bcrypt real. Se niega a ejecutarse si `DB_NAME` no termina en `_test`.
- `Base de Datos/migrations/MIGRATE.md`: convención y flujo de migraciones (entregado como `README.md`; renombrado por el equipo).
- Scripts npm que se añaden a `backend/package.json` (los agrega el equipo): `testsql` (`node --env-file=.env.test --test test/integration/sql.test.js`), `migrate`, `migrate:test` y `db:reset:test`.

### Cambiado
- Los tests de BD viven en `test/integration/` y no en `test/`, porque `npm test` usa el glob `test/*.test.js`: un archivo `test/sql.test.js` lo ejecutaría `npm test` contra la BD de `backend/.env` en lugar de `sportanet_test`.

### Verificación
- Equipo (Windows, Node 24.22.0, **MySQL 8.0.46** con el `schema.sql` original): tras `npm run db:reset:test`, `npm run testsql` y `npm test` pasan (resultado reportado por el equipo). El dump trae cabecera de MySQL 9.1, pero la collation `utf8mb4_0900_ai_ci` existe desde MySQL 8.0 y no requirió parches.
- Entorno de Claude: **MariaDB 10.11** (no MySQL) en el puerto 6603, con una copia de `schema.sql` cuya collation `utf8mb4_0900_ai_ci` se cambió por `utf8mb4_unicode_ci` solo para esta prueba (MariaDB < 11.4.5 no la soporta). Node 22.22.
- `migrate.js`: reset, `--dry-run` sin cambios, aplicar, reejecutar (idempotente), migración que se registra a sí misma, migración con error (no se registra, salida 1), versión duplicada, `--reset` rechazado fuera de `*_test`, aborto sin terminal y sin `--yes`, y confirmación interactiva correcta e incorrecta (con pseudo-terminal).
- `sql.test.js`: 14/14. El guard rechaza `DB_NAME` ausente y `sportanet_v1`. Al romper a propósito la consulta de `db/users.js` fallan 9 de 14, así que las pruebas no son vacuas.
- `npm test`: sigue en 15/15 y no ejecuta las pruebas de integración.

### Pendiente de verificar
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
- Equipo: `npm test` 15/15 al aplicar la fase (reportado por el equipo; no se registró la versión de Node de esa ejecución).

### Pendiente de verificar
- Ninguno. La ejecución contra MySQL real se cubrió en la Fase 1B.1 (pruebas de integración) y la protección de `routes/users.js` en la Fase 1C.

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

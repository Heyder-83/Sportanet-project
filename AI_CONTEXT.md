# Sportanet — Contexto para desarrollo con IA

## Objetivo
Desarrollar incrementalmente el backend de Sportanet para gestionar usuarios, organizadores, eventos deportivos, inscripciones, confirmaciones y calendario.

## Tecnologías
- Frontend: HTML, CSS y JavaScript.
- Backend: Node.js y Express.
- Base de datos: MySQL.
- Autenticación: bcrypt y JWT.

## Estado inicial
- `backend/app.js`: servidor Express y registro de rutas.
- `backend/db/connection.js`: conexión a MySQL.
- `backend/routes/auth.js`: registro e inicio de sesión.
- `backend/routes/users.js`: CRUD de usuarios.
- `events.html`: página de eventos con contenido estático.
- No existen todavía rutas de eventos ni de inscripciones en el backend.

## Reglas obligatorias
1. No reconstruir el proyecto desde cero.
2. No modificar funcionalidades terminadas salvo que sea indispensable y se justifique.
3. No cambiar nombres de tablas, columnas, rutas o campos sin verificar el esquema real.
4. Antes de escribir consultas SQL, revisar el esquema de base de datos seleccionado.
5. No eliminar archivos ni dependencias sin autorización.
6. No mostrar contraseñas, hashes, tokens ni secretos en respuestas o registros.
7. Implementar únicamente la fase solicitada.
8. Entregar los archivos modificados, los cambios realizados y las instrucciones para probarlos.
9. Si falta información necesaria, preguntar antes de inventar estructuras.
10. Si una prueba falla, corregir primero el problema de la tarea actual.

## Esquema real de la base de datos (verificado)

### Tabla `users`
- `user_id` — int, PK, auto_increment
- `full_name` — varchar(100), NOT NULL
- `email` — varchar(100), NOT NULL, UNIQUE
- `phone` — varchar(20), NULL, UNIQUE
- `pwd` — varchar(255), NOT NULL (hash bcrypt; **el nombre canónico es `pwd`, no `password`**)
- `role` — enum('Participant','Organizer','Admin'), NOT NULL, default 'Participant'
- `is_active` — tinyint(1), NOT NULL, default 1
- `deleted_at` — datetime, NULL (soft-delete)
- `created_at` — datetime, NOT NULL, default CURRENT_TIMESTAMP
- `updated_at` — datetime, NOT NULL, default CURRENT_TIMESTAMP on update CURRENT_TIMESTAMP

**Notas:**
- El PK se llama `user_id`, no `id`.
- El campo de contraseña se llama `pwd` en BD, backend y frontend. La documentación previa decía `password`; está corregida.
- El rol `Organizer` **ya existe en el esquema**. Falta definir cómo se asigna (endpoint o script) antes de la Fase 4.
- El soft-delete (`is_active`, `deleted_at`) **ya existe en el esquema**. Verificar que el DELETE de `/api/users` lo use.

## Estado de trabajo

### Fases terminadas
- **Fase 0** (fecha por confirmar): frontend estático + backend con registro/login.
- **Fase 1A** (2026-10-13): Middleware de autenticación JWT, configuración centralizada (`config/jwt.js`), endpoint `/api/auth/me`, tests unitarios (9/9 con `node --test`), fail-safe si falta `JWT_SECRET`. Commit `8393ca5`.
- **Fase 1A.1** (2026-10-14): Preparación para despliegue. `process.env.PORT || 5000` en `app.js`, `DB_PORT` en `connection.js`, path absoluto al `.env` (`path.resolve(__dirname, '../.env')`) en `config/jwt.js` y `connection.js`, test "sin JWT_SECRET" desacoplado del filesystem. Commit `75a60f5`.
- **Fase 1B** (2026-10-15): Verificación de estado de cuenta. `authenticate.js` es ahora una factory `createAuthenticate({ findUserById })`; tras validar el JWT consulta la cuenta y rechaza con `401 ACCOUNT_DISABLED` (`is_active` ≠ 1), `401 ACCOUNT_DELETED` (`deleted_at` o fila inexistente) o `500 DB_ERROR`. `req.auth` ahora incluye `role` (leído de la BD, nunca del token). Nuevos: `db/users.js` (`findUserById`) y `middleware/requireAuth.js` (instancia conectada al pool). `routes/auth.js`: importa `requireAuth`; `POST /login` devuelve `403 ACCOUNT_DISABLED/ACCOUNT_DELETED` (tras validar la contraseña) y no emite token; `/me` devuelve también `role`. `app.js` no cambió. Tests: **9 → 15**. Verificada por el equipo en MySQL 8.0.46 (Node 24.22.0) y por Claude en MariaDB 10.11. *(Una versión anterior de este archivo la daba por terminada sin que el código existiera; corregido.)*
- **Fase 1B.1** (2026-10-16): Pruebas contra BD real y migraciones. `backend/scripts/migrate.js` (aplica `Base de Datos/migrations/NNN_*.sql`, registra en `schema_migrations`; `--status`, `--dry-run`, `--reset` solo en `*_test`, `--yes`; confirmación por nombre de BD fuera de `*_test`), `backend/test/integration/sql.test.js` (14 pruebas contra `sportanet_test`, con guard que exige `DB_NAME` terminado en `_test`) y `Base de Datos/migrations/MIGRATE.md`. Los scripts npm (`testsql`, `migrate`, `migrate:test`, `db:reset:test`) los añade el equipo a `backend/package.json`. Verificado por el equipo en MySQL 8.0.46 y por Claude en MariaDB 10.11.
- **Fase 1C** (2026-10-17): Protección de `/api/users`. Todas las rutas exigen sesión. `GET /` y `POST /` solo Admin; `GET /:id`, `PUT /:id` y `DELETE /:id` el propio usuario o Admin (`middleware/authorize.js`). Nunca se devuelve `pwd`; `role`/`is_active` no se leen del body; validación 400 y duplicados 409 (`EMAIL_TAKEN`/`PHONE_TAKEN`, distinguidos por el nombre de la clave); errores de BD genéricos y sin SQL en el log. DELETE pasa a borrado lógico (`is_active = 0`, `deleted_at = NOW()`), conservando perfil e inscripciones. `db/users.js` gana `listActiveUsers`, `findPublicUserById`, `createUser`, `updateUser`, `softDeleteUser`. Cambios de contrato: `GET /:id` devuelve un objeto (antes un array) y `POST /` responde 201; el frontend (`header.js`) solo usa PUT y DELETE sobre el propio id y no cambia. Tests: +13 unitarios, +12 de integración. Verificado por el equipo en MySQL 8.0.46 (28/28 y 26/26) y por Claude en MariaDB 10.11.
- **Fase 1D** (2026-10-20): Seguridad de `/api/auth`. `register` y `login` validan tipo, longitud y formato antes de tocar bcrypt o la BD (reglas compartidas con `/api/users` en `utils/userInput.js`); errores de BD genéricos y sin SQL en el log (`utils/dbFail.js`); duplicados `409 EMAIL_TAKEN`/`PHONE_TAKEN` (antes 400 y siempre "Email already registered"); el login usa `findAuthUserByEmail` (sin `SELECT *`) y compara contra un hash falso si el correo no existe. Corrige que `login` con un correo existente y `pwd` no textual (p. ej. un número) dejaba la petición sin respuesta y provocaba un `unhandledRejection` que termina el proceso. Cambios de contrato: duplicados 409 (antes 400); body inválido 400 `VALIDATION_ERROR` con `fields` (antes `Missing fields` o 500); el frontend solo comprueba `response.ok`, no cambia. Tests: +28 unitarios, +11 de integración. Verificado por el equipo en MySQL 8.0.46 y por Claude en MariaDB 10.11 (commit `9a78728`).
- **Fase 1E** (2026-10-21): Registro por tipo de cuenta. `POST /api/auth/register` acepta `account_type` (`Atleta` → `Participant`, por defecto; `Organizador` → `Organizer`) con lista blanca en `utils/userInput.js`; cualquier otro valor, incluido `Admin`, es 400. `db/accounts.js` (`createAccount`) crea en una transacción el usuario y, si es Organizador, su fila en `event_organizers` con `display_name` = nombre del usuario. `register` y `login` devuelven `user.role`. Frontend: selector «Tipo de cuenta» y mensajes de error en español según `code` (corrige que se leía `data.message`). Tests: +8 unitarios, +8 de integración. Verificado por Claude en MariaDB 10.11 y en Chromium; falta confirmar en MySQL 8.0.46.

### Estado actual del código
- Backend: Node.js + Express 5 + MySQL2 + JWT (HS256) + bcrypt.
- Tests unitarios (sin BD): `authenticate` (15) + `authorize` (13) + `auth` (25) + `userInput` (11) = **64/64** (Claude, Node 22). El equipo confirmó 56/56 en la Fase 1D (Node 24.22.0, commit `9a78728`); falta confirmar los 64. El script `test` usa el glob `test/*.test.js`.
- Pruebas de integración: `npm run testsql` (**45 pruebas**, `test/integration/sql.test.js`) contra `sportanet_test`; 45/45 en MariaDB 10.11 (Claude, dos rondas). El equipo confirmó 37/37 en MySQL 8.0.46 en la Fase 1D; falta confirmar las 45. `npm test` no las ejecuta. Algunas renombran una columna (`users.phone`, `event_organizers.display_name`) para provocar un error real de MySQL y siempre la restauran; si una ejecución se interrumpe, `npm run db:reset:test`.
- Autorización: `middleware/authorize.js` (`requireRole`, `parseIdParam`, `requireSelfOrAdmin`; falla cerrado sin `req.auth`). `routes/users.js` aplica `router.use(authenticate)` a todo.
- `.env.test` (fuera del repo, en `.gitignore`) define `DB_NAME=sportanet_test`; `connection.js` usa `sportanet_v1` si `DB_NAME` no está definido, por eso `sql.test.js` y `migrate.js --reset` se niegan a correr contra una BD cuyo nombre no termine en `_test`.
- `npm audit --omit=dev`: 0 vulnerabilidades (reejecutado por Claude el 2026-10-17 sobre `origin/main` a7437f3; sin cambios de dependencias desde entonces).
- Preparado para despliegue en Railway (DB) + Render (backend + frontend).

### Fase siguiente
- Antes de la primera migración: `SELECT * FROM schema_migrations;` en `sportanet_v1` para numerar por encima de las versiones registradas.
- **Decisiones de producto ya tomadas (1E):** un Organizador puede crear eventos sin verificación por ahora (a futuro, verificación para eventos patrocinados, promocionales o auditados por Sportanet). Las cuentas Admin son solo de gestión de la plataforma: un administrador debe tener además una cuenta de Atleta aparte.
- **Fase 1F (diseño del equipo, pendiente de revisión; NO implementar sin cerrar las preguntas):**
  - TSU (Token de Seguridad Único): serial alfanumérico generado por los dueños con un generador de claves y asignado a cada cuenta admin; se guarda en una BD dedicada a los datos de login de administradores (p. ej. `SPN_AD`). Actúa como «verificador de actividad» (notifica cada inicio de sesión con TSU), no como única medida.
  - Crear cuenta admin desde el header (login/registro): Nombre, Contraseña, TSU → conectar app 2FA (clave o QR) → código de 6 dígitos → cuenta creada.
  - `SPN_AD` tendrá además una tabla de inicios de sesión por cuenta: fecha y hora, IP, ubicación ciudad-país.
  - Login admin: nombre + contraseña; si la IP difiere de la del último login se pide de nuevo el TSU; si es la misma, se pide el código 2FA; luego sesión.
  - Entrega del TSU: correo con un PDF protegido con contraseña (por ahora un PDF simple; la contraseña está por definir) junto con el contrato firmado antes (confidencialidad, honestidad, investigación y suspensión temporal).
  - Límite de intentos: 5; al superarlo salta una alerta al sistema interno.
  - El primer admin se crea directamente en la BD con INSERT por el usuario root; más adelante se decidirá si los «admins principales» (equipo fundador) tendrán más seguridad.
  - Preguntas abiertas: hash del TSU en reposo; si el 2FA se exige también tras el TSU cuando cambia la IP; identificador del admin (nombre no es único); relación entre la identidad en `SPN_AD` y `users.role = 'Admin'`; dependencias nuevas (TOTP, correo/SMTP, límite de intentos; requieren autorización); migración de `SPN_AD` con respaldo; IP detrás de proxy (Render) y geolocalización/privacidad (Ley 1581); contador de intentos persistente.
- Decidir la política de contraseña (mínimo y complejidad) y limitar intentos en `/api/auth/login`; hoy solo se exige 1 a 72 bytes (límite real de bcrypt), tanto en `register` como en `/api/users`.
- Reorganización de estructura de carpetas (cosmética).
- Creación de script `make-zip-for-claude.sh` (automatizar ZIP limpio para Claude).
- Despliegue de base de datos en Railway.
- Despliegue de backend en Render.
- Migración de frontend a Render (según avance de Claude).

### Errores conocidos / pendientes
- CORS abierto (`Access-Control-Allow-Origin: *`) → restringir en producción.
- Falta rate limiting en `/api/auth/login`.
- Falta política de contraseña (mínimo 8 caracteres, complejidad): hoy `register` solo exige entre 1 y 72 bytes.
- El `.env` de la raíz y el de `backend/` están desalineados en PORT (raíz dice 3000, backend dice 5000). Revisar.
- El handler global de `app.js` devuelve JSON (`INVALID_JSON`) para body malformado: comprobado a mano con `curl` en la Fase 1D, pero sin prueba automática (`app.js` arranca el servidor al importarse).
- `JS/header.js` muestra `data.message` en los errores de login y registro, pero la API responde con `error`: el usuario siempre ve el texto genérico de reserva (incluidos `ACCOUNT_DISABLED`, `ACCOUNT_DELETED` y los 409 de duplicados). **Resuelto en 1E** (mensajes por `code`).
- `register` revela si un correo o un teléfono ya están registrados (409): es inherente a las restricciones UNIQUE; la mitigación sería limitar intentos.
- **Resuelto en 1E:** el registro de Organizadores crea la fila de `event_organizers` en la misma transacción; `Admin` no se puede obtener desde el formulario público.
- **Resuelto en 1D:** `routes/auth.js` ya no filtra errores de MySQL, valida los datos de entrada, distingue email de teléfono en los duplicados, y `login` con un `pwd` no textual ya no cuelga la petición ni termina el proceso.
- **Resuelto en 1C:** `routes/users.js` ya exige sesión, no devuelve `pwd`, no filtra errores de MySQL y el DELETE es borrado lógico (antes era físico y fallaba por la FK de `event_registrations`).
- **Consecuencia conocida del borrado lógico:** el email y el teléfono de una cuenta eliminada siguen ocupados por los UNIQUE de `users`; esa persona no puede volver a registrarse con ellos. Decidir si se anonimizan al eliminar (decisión de producto/privacidad).
- No hay forma de asignar el rol `Organizer`/`Admin` desde la API (el body de `/api/users` no lo acepta a propósito); hoy se haría por SQL. Definirla antes de la Fase 4. Tampoco hay protección contra eliminar al último Admin.

## Formato obligatorio al finalizar cada tarea
- Archivos creados.
- Archivos modificados.
- Funcionalidad implementada.
- Endpoints y campos utilizados.
- Pruebas ejecutadas y resultados reales.
- Errores pendientes.
- Comandos para ejecutar y probar.
- Estado actualizado de las fases.
- Siguiente tarea recomendada.

No marques una tarea como terminada si no se ha comprobado su funcionamiento.
# Sportanet — Contexto actual para desarrollo con IA

## Objetivo y tecnologías

Sportanet es una plataforma web para descubrir eventos deportivos y, en fases futuras, gestionar eventos e inscripciones. El frontend usa HTML, CSS y JavaScript; el backend usa Node.js, Express 5 y MySQL. La autenticación de usuarios utiliza bcrypt y JWT.

 HEAD
## Estado inicial
- `backend/app.js`: servidor Express y registro de rutas.
- `backend/db/connection.js`: conexión a MySQL.
- `backend/routes/auth.js`: registro e inicio de sesión.
- `backend/routes/users.js`: CRUD de usuarios.
- `events.html`: página de eventos con contenido estático (el frontend aún no consume la API de eventos: Fase 2.4).
- `backend/routes/events.js` (+ `eventHandlers.js`, `db/events.js`, `utils/eventInput.js`): consulta pública y publicación de eventos (Fase 2.1).
- No existen todavía rutas de inscripciones en el backend (Fase 2.3).

## Estado del repositorio
 origin/main

Estado revisado el 2026-11-03. Después de SPNdev.4 se implementó localmente el flujo inicial de organizadores e inscripciones (SPNdev.5). `npm run testevents` cubre el flujo de perfil de Organizador, eventos del club SportaClub y registro de un Atleta; el resto de estados aún requiere pruebas.

### Funcionalidades implementadas

- Registro e inicio de sesión de cuentas Participante y Organizador. El formulario público no puede crear administradores; la creación de Organizador y su perfil se realiza en una transacción.
- JWT de usuario y middleware que consulta el estado y rol vigentes de la cuenta. `GET /api/auth/me` devuelve la identidad autenticada.
- API de usuarios protegida por autenticación y autorización por rol/propiedad. No expone el hash de contraseña y elimina cuentas mediante borrado lógico.
- El perfil permite ver el tipo de cuenta y guardar una imagen JPG/PNG/WebP de hasta 512 KB. La migración `005_user_profile_image.sql` está pendiente de aplicar en la base principal.
- Eventos: listado y detalle públicos (`GET /api/events`, `GET /api/events/:id`), además de gestión autenticada para organizadores y registro/cancelación de atletas. El detalle de rutas está abajo.
- `events.html` consulta la API y ofrece búsqueda, filtros, orden y paginación; también muestra el panel de creación/gestión al organizador y las inscripciones propias al atleta.
- Línea de administración separada en la base `SPN_AD`: alta con TSU de un solo uso (`POST /api/admin/register`), login (`POST /api/admin/login`), consulta de sesión (`GET /api/admin/me`), JWT de administrador de 30 minutos y bloqueo temporal tras cinco intentos fallidos. Las rutas se montan solo al configurar `DB_AD_NAME`. No hay 2FA ni interfaz de administración.
- Límite global de solicitudes, límite de 1 MB para cuerpos JSON/form-urlencoded y métricas en `GET /api/health/metrics`.
- Migraciones de esquema versionadas y pruebas unitarias y de integración. `sportanet_v1` es la base principal; `sportanet_test`, `spn_ad` y `spn_ad_test` tienen funciones separadas. Los comandos de reset solo permiten nombres terminados en `_test`.

## Esquema y migraciones

- El esquema base está en `Base de Datos/schema.sql`; las migraciones del repositorio van de `001_events_staff_mode.sql` a `005_user_profile_image.sql`.
- El esquema efectivo incluye las migraciones pendientes según cada base. Entre otros cambios, estas añaden `staff_mode`, `event_staff`, `event_images` e imagen de perfil, y eliminan la visibilidad privada y los tokens de compartir.
- `sport_events` contiene título, deporte, descripción, portada, fechas de inicio/fin, zona horaria, modalidad, capacidad, precio/moneda, límite de inscripción, estado, sede/club y organizador. Los estados del esquema son `Draft`, `Published`, `Completed` y `Canceled`; la modalidad es `InPerson`, `Virtual` o `Hybrid`.
- El esquema incluye `event_registrations` con estados `Pending`, `Confirmed`, `Waitlisted` y `Canceled`, además de estados de pago. El flujo de inscripción ya está conectado a esa tabla; los pagos todavía no se procesan.
- SPN_AD es una base aparte: los administradores no son filas de `users` ni usan `users.role = 'Admin'`.
- Antes de proponer consultas o cambios de esquema, revisar los SQL y migraciones reales. Antes de numerar la siguiente migración, consultar `schema_migrations` de la base destino y usar una versión superior a la más alta aplicada.

 HEAD
### Fases terminadas
- **Fase 0** (fecha por confirmar): frontend estático + backend con registro/login.
- **Fase 1A** (2026-10-13): Middleware de autenticación JWT, configuración centralizada (`config/jwt.js`), endpoint `/api/auth/me`, tests unitarios (9/9 con `node --test`), fail-safe si falta `JWT_SECRET`. Commit `8393ca5`.
- **Fase 1A.1** (2026-10-14): Preparación para despliegue. `process.env.PORT || 5000` en `app.js`, `DB_PORT` en `connection.js`, path absoluto al `.env` (`path.resolve(__dirname, '../.env')`) en `config/jwt.js` y `connection.js`, test "sin JWT_SECRET" desacoplado del filesystem. Commit `75a60f5`.
- **Fase 1B** (2026-10-15): Verificación de estado de cuenta. `authenticate.js` es ahora una factory `createAuthenticate({ findUserById })`; tras validar el JWT consulta la cuenta y rechaza con `401 ACCOUNT_DISABLED` (`is_active` ≠ 1), `401 ACCOUNT_DELETED` (`deleted_at` o fila inexistente) o `500 DB_ERROR`. `req.auth` ahora incluye `role` (leído de la BD, nunca del token). Nuevos: `db/users.js` (`findUserById`) y `middleware/requireAuth.js` (instancia conectada al pool). `routes/auth.js`: importa `requireAuth`; `POST /login` devuelve `403 ACCOUNT_DISABLED/ACCOUNT_DELETED` (tras validar la contraseña) y no emite token; `/me` devuelve también `role`. `app.js` no cambió. Tests: **9 → 15**. Verificada por el equipo en MySQL 8.0.46 (Node 24.22.0) y por Claude en MariaDB 10.11. *(Una versión anterior de este archivo la daba por terminada sin que el código existiera; corregido.)*
- **Fase 1B.1** (2026-10-16): Pruebas contra BD real y migraciones. `backend/scripts/migrate.js` (aplica `Base de Datos/migrations/NNN_*.sql`, registra en `schema_migrations`; `--status`, `--dry-run`, `--reset` solo en `*_test`, `--yes`; confirmación por nombre de BD fuera de `*_test`), `backend/test/integration/sql.test.js` (14 pruebas contra `sportanet_test`, con guard que exige `DB_NAME` terminado en `_test`) y `Base de Datos/migrations/MIGRATE.md`. Los scripts npm (`testsql`, `migrate`, `migrate:test`, `db:reset:test`) los añade el equipo a `backend/package.json`. Verificado por el equipo en MySQL 8.0.46 y por Claude en MariaDB 10.11.
- **Fase 1C** (2026-10-17): Protección de `/api/users`. Todas las rutas exigen sesión. `GET /` y `POST /` solo Admin; `GET /:id`, `PUT /:id` y `DELETE /:id` el propio usuario o Admin (`middleware/authorize.js`). Nunca se devuelve `pwd`; `role`/`is_active` no se leen del body; validación 400 y duplicados 409 (`EMAIL_TAKEN`/`PHONE_TAKEN`, distinguidos por el nombre de la clave); errores de BD genéricos y sin SQL en el log. DELETE pasa a borrado lógico (`is_active = 0`, `deleted_at = NOW()`), conservando perfil e inscripciones. `db/users.js` gana `listActiveUsers`, `findPublicUserById`, `createUser`, `updateUser`, `softDeleteUser`. Cambios de contrato: `GET /:id` devuelve un objeto (antes un array) y `POST /` responde 201; el frontend (`header.js`) solo usa PUT y DELETE sobre el propio id y no cambia. Tests: +13 unitarios, +12 de integración. Verificado por el equipo en MySQL 8.0.46 (28/28 y 26/26) y por Claude en MariaDB 10.11.
- **Fase 1D** (2026-10-20): Seguridad de `/api/auth`. `register` y `login` validan tipo, longitud y formato antes de tocar bcrypt o la BD (reglas compartidas con `/api/users` en `utils/userInput.js`); errores de BD genéricos y sin SQL en el log (`utils/dbFail.js`); duplicados `409 EMAIL_TAKEN`/`PHONE_TAKEN` (antes 400 y siempre "Email already registered"); el login usa `findAuthUserByEmail` (sin `SELECT *`) y compara contra un hash falso si el correo no existe. Corrige que `login` con un correo existente y `pwd` no textual (p. ej. un número) dejaba la petición sin respuesta y provocaba un `unhandledRejection` que termina el proceso. Cambios de contrato: duplicados 409 (antes 400); body inválido 400 `VALIDATION_ERROR` con `fields` (antes `Missing fields` o 500); el frontend solo comprueba `response.ok`, no cambia. Tests: +28 unitarios, +11 de integración. Verificado por el equipo en MySQL 8.0.46 y por Claude en MariaDB 10.11 (commit `9a78728`).
- **Fase 1E** (2026-10-21): Registro por tipo de cuenta. `POST /api/auth/register` acepta `account_type` (`Atleta` → `Participant`, por defecto; `Organizador` → `Organizer`) con lista blanca en `utils/userInput.js`; cualquier otro valor, incluido `Admin`, es 400. `db/accounts.js` (`createAccount`) crea en una transacción el usuario y, si es Organizador, su fila en `event_organizers` con `display_name` = nombre del usuario. `register` y `login` devuelven `user.role`. Frontend: selector «Tipo de cuenta» y mensajes de error en español según `code` (corrige que se leía `data.message`). Tests: +8 unitarios, +8 de integración. Verificado por Claude en MariaDB 10.11 y en Chromium; falta confirmar en MySQL 8.0.46.
- **Fase 1F.1** (2026-10-21): esquema de SPN_AD (`Base de Datos/spn_ad/`), `db/connectionAd.js`, `migrate.js --ad` y 13 pruebas (`npm run testad`). Solo base de datos; sin rutas ni login todavía. Verificado por Claude en MariaDB 10.11; falta MySQL 8.0.46 y crear `spn_ad` real con su usuario aislado.
- **Fase 2.1** (2026-10-24): API de eventos. `GET /api/events` y `GET /api/events/:id` (públicos; solo `event_status = 'Published'` y `visibility = 'Public'`; cualquier otro caso es 404) y `POST /api/events` (solo `Organizer`; `authenticate` + `requireRole`). El organizador sale de `req.auth.userId` → `event_organizers.user_id`; `event_organizers_id`, `user_id`, `role`, `event_status`, `visibility` y `share_token` del body se ignoran. Todo evento creado nace `Published`/`Public` (con `published_at = NOW()`); no se introducen borradores ni estados nuevos. Campos: `title`, `sport`, `max_capacity`, `start_at`, `end_at` (obligatorios) y `event_description`, `timezone`, `modality`, `online_url`, `price`, `currency`, `registration_deadline`, `cover_image` (opcionales) más ubicación: `venue` (recinto nuevo: `name`, `address`, `city`, `region?`, `country_code?`, `latitude?`+`longitude?`) o `venue_id` (existente); recinto y evento se crean en UNA transacción. Sin cambios de esquema ni migraciones. Archivos nuevos: `utils/eventInput.js`, `db/events.js`, `routes/eventHandlers.js`, `routes/events.js` y 4 archivos de prueba; `app.js` solo monta la ruta. **Estado de verificación:** 61 pruebas unitarias nuevas EJECUTADAS (61/61, Node 22.22.0, sin MySQL); 8 mutaciones del código detectadas por ellas. La prueba de integración `test/integration/events.test.js` (16 pruebas) está ESCRITA PERO NO EJECUTADA: el entorno de Claude no tenía MySQL/MariaDB ni acceso a npm, así que `npm test` completo, `testsql` y los 16 casos contra MySQL real quedan **pendientes de ejecutar por el equipo**. No se marca como terminada hasta entonces.

### Estado actual del código
- Backend: Node.js + Express 5 + MySQL2 + JWT (HS256) + bcrypt.
- Tests unitarios (sin BD): `authenticate` (15) + `authorize` (13) + `auth` (25) + `userInput` (11) = **64/64** (Claude, Node 22). El equipo confirmó 56/56 en la Fase 1D (Node 24.22.0, commit `9a78728`); falta confirmar los 64. El script `test` usa el glob `test/*.test.js`.
- Pruebas de integración: `npm run testsql` (**45 pruebas**, `test/integration/sql.test.js`) contra `sportanet_test`; 45/45 en MariaDB 10.11 (Claude, dos rondas). El equipo confirmó 37/37 en MySQL 8.0.46 en la Fase 1D; falta confirmar las 45. `npm test` no las ejecuta. Algunas renombran una columna (`users.phone`, `event_organizers.display_name`) para provocar un error real de MySQL y siempre la restauran; si una ejecución se interrumpe, `npm run db:reset:test`.
- Autorización: `middleware/authorize.js` (`requireRole`, `parseIdParam`, `requireSelfOrAdmin`; falla cerrado sin `req.auth`). `routes/users.js` aplica `router.use(authenticate)` a todo.
- `.env.test` (fuera del repo, en `.gitignore`) define `DB_NAME=sportanet_test`; `connection.js` usa `sportanet_v1` si `DB_NAME` no está definido, por eso `sql.test.js` y `migrate.js --reset` se niegan a correr contra una BD cuyo nombre no termine en `_test`.
- `npm audit --omit=dev`: 0 vulnerabilidades (reejecutado por Claude el 2026-10-17 sobre `origin/main` a7437f3; sin cambios de dependencias desde entonces).
- Eventos (Fase 2.1): `test/eventInput.test.js` (23), `test/eventsDb.test.js` (14), `test/eventHandlers.test.js` (17) y `test/eventsRouter.test.js` (7) se recogen solos con `npm test` (61 nuevas, sin BD; los recuentos anteriores de este archivo no incluyen estas). Integración: `node --env-file=.env.test --test test/integration/events.test.js` (16 pruebas; usan el prefijo `evtest-` para no chocar con `sql.test.js`; un script `testevents` en `package.json` queda para el equipo). Una de ellas renombra `sport_events.sport` para provocar un error real y siempre lo restaura; si se interrumpe, `npm run db:reset:test`.
- Preparado para despliegue en Railway (DB) + Render (backend + frontend).

### Fase siguiente
- **Plan Fase 2 (aprobado por el usuario):** 2.1 API de eventos (hecha, pendiente de verificar en MySQL) · 2.2 administración de eventos propios (editar/cancelar; permisos administrativos cuando existan) · 2.3 inscripciones (cupos, duplicados) · 2.4 frontend (plantilla de creación, tarjetas dinámicas, detalle, enlaces a mapas, menú por rol, reemplazo del botón «Salir») · 2.5 despliegue (Render + Railway) · 2.6 correos con Make y asistente IA (el chat con IA queda diferido al siguiente semestre; ver «Chat con IA (diferido)» más abajo). Nota de numeración: el CHANGELOG usa «1F.2/1F.3» para estabilidad y prueba de carga, y este archivo usa «1F.2…1F.5» para TSU/2FA/login de admin; conviene renumerar uno de los dos.
- Antes de la primera migración: `SELECT * FROM schema_migrations;` en `sportanet_v1` para numerar por encima de las versiones registradas.
- **Medición y estabilidad del backend (1F.2, aplicado):** se incorporó un monitor de carga (`createStabilityMonitor`), un limitador de ráfagas (`createRateLimiter`) y un endpoint `/api/health/metrics` para medir peticiones aceptadas/bloqueadas. También se restringió el tamaño del payload JSON y URL-encoded a `1mb` para evitar sobrecarga por cuerpos excesivos. Existe un script `npm run measure:load` para ejecutar una prueba de carga simple.
- **Prueba de sobrecarga configurable (1F.3, aplicado):** se añadió `backend/config.json`, `backend/utils/loadConfig.js`, `backend/utils/loadPlan.js`, `backend/test/loadConfig.test.js` y `backend/test/loadPlan.test.js` para aceptar el formato `Calls = {número, frecuencia, duración unidad}` con validación de `1-60` y unidades `seg|min|hor|dia`. La configuración se centraliza en un único sitio y el script `backend/scripts/load-test.js` lo ejecuta de forma reproducible, con soporte de overrides por CLI.
- **Decisiones de producto ya tomadas (1E):** un Organizador puede crear eventos sin verificación por ahora (a futuro, verificación para eventos patrocinados, promocionales o auditados por Sportanet). Las cuentas Admin son solo de gestión de la plataforma: un administrador debe tener además una cuenta de Atleta aparte.
- **Fase 1F (diseño cerrado, en pasos):** 1F.1 SPN_AD (hecho); 1F.2 TSU y creación de cuenta admin con 2FA (TOTP por librería, secreto cifrado AES-256-GCM); 1F.3 login admin (id interno + contraseña + 2FA siempre) y `authenticateAdmin`; 1F.4 límite de 5 intentos por cuenta y alerta (log del sistema + correo de historial); 1F.5 frontend del header.
  - **Decisiones del equipo:** el TSU lo generan los dueños y se guarda solo como hash (HMAC-SHA-256); se usa para crear la cuenta (y, a decidir, para reiniciar el 2FA), no en cada login. **No se guarda IP ni ubicación**: solo fecha y hora de login, con cláusula de seguridad en el contrato (Ley 1581 de 2012). El 2FA se pide siempre. Los admins no usan `users.role = 'Admin'`: viven en SPN_AD con `admin_id` único (el nombre puede repetirse) y deben tener además una cuenta de Atleta aparte. El envío del PDF con el TSU es manual. Primer admin: INSERT directo en SPN_AD con root. Cada intento consulta SPN_AD; a los 5 fallos se envía alerta al log del sistema y a un correo dedicado de historial.
  - **Abierto:** login con id interno (propuesto); bloqueo temporal tras 5 fallos (propuesto, por cuenta); servicio que envía el correo de historial; retención (propuesto 12 meses); `/api/users` pasa a aceptar el token de administrador; cookie `httpOnly` o token en memoria para el admin (depende de si front y API comparten dominio); redacción de la cláusula del contrato y validación legal; RNBD y transferencia internacional (Render/Railway) según el abogado.
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
- **(2.1) Admin no puede gestionar eventos todavía.** `users.role = 'Admin'` existe, pero no tiene fila en `event_organizers` (no hay organizador al que atribuir el evento) y, según el diseño de la Fase 1F, los administradores vivirán en SPN_AD con un `authenticateAdmin` que aún no existe. No hay atajo; `POST /api/events` devuelve 403 a un Admin. Resolver cuando el mecanismo de administración esté integrado (Fase 2.2 o posterior).
- **(2.1) Un organizador no ve sus propios borradores/cancelados por la API.** `GET /api/events/:id` solo devuelve eventos Published y Public (404 para el resto). La consulta del propio organizador llega con la Fase 2.2.
- **(2.1) El listado no oculta eventos ya terminados.** Un evento `Published` sigue listado aunque `end_at` haya pasado; no existe aún la transición automática a `Completed`. `POST` tampoco rechaza fechas pasadas (solo exige fechas válidas y `end_at > start_at`).
- **(2.1) Fechas sin zona horaria en la API.** `start_at`/`end_at`/`registration_deadline` entran y salen como hora local del evento (`YYYY-MM-DDTHH:MM:SS`, campo `timezone` aparte); se rechazan `Z` y desplazamientos. El frontend debe mostrarlas con esa convención.
- **(2.1) El listado no informa de cupos ocupados.** Depende de las reglas de inscripción (Fase 2.3: qué estados cuentan contra `max_capacity`).
- **(2.1) `venue_id` acepta cualquier recinto existente**, también de otro organizador (los recintos son reutilizables; no hay aún endpoint para listarlos).

## Contrato vigente de eventos

- `GET /api/events`: ruta pública sin sesión. Acepta `q` (búsqueda por título, máximo 100 caracteres), `when=upcoming|past|all` (por defecto `upcoming`), `sort=name_asc|name_desc|newest|oldest`, `page` (por defecto 1) y `limit` (por defecto 12, máximo 50). Devuelve `{ data, page, limit, total, total_pages }`; parámetros inválidos dan `400 VALIDATION_ERROR`.
- `GET /api/events/:id`: ruta pública de detalle. Los borradores y eventos inexistentes devuelven `404 NOT_FOUND`. Un evento cancelado puede consultarse por ID y muestra el motivo de cancelación.
- `GET /api/events/mine`, `POST /api/events`, `PUT /api/events/:id`, `POST /api/events/:id/cancel` y `POST /api/events/:id/complete`: requieren JWT de un organizador. Solo se listan/modifican eventos de su perfil. No se borran eventos para conservar historial.
- `GET /api/events/:id/registrations` y `PATCH /api/events/:id/registrations/:registrationId`: el organizador dueño consulta inscripciones y confirma/cancela las pendientes. La capacidad se vuelve a comprobar al confirmar.
- `POST /api/events/:id/registrations`, `GET /api/events/registrations/mine` y `DELETE /api/events/:id/registrations/mine`: requieren JWT de atleta. La base registra estados `Confirmed`, `Pending`, `Waitlisted` o `Canceled`, y evita duplicados activos.
- Inscripción gratuita automática confirma en el momento; aprobación manual queda `Pending`; evento lleno queda `Waitlisted`; evento pagado queda pendiente de pago. No hay pasarela ni endpoint para verificar pagos, por lo que una inscripción pagada no se puede confirmar desde este flujo.
- Próximos son eventos `Published` cuyo `end_at` aún no pasó. Pasados son eventos `Completed` o `Published` cuyo `end_at` ya pasó. El listado no incluye `Canceled`. La comparación de fechas se calcula en la aplicación con la zona `America/Bogota`.
- Listado y detalle incluyen cupo, cantidad confirmada y cupos restantes; el total cuenta solo inscripciones `Confirmed`. El detalle puede incluir sede, club, organizador, personal y galería.
- Los endpoints públicos no exponen `online_url`, identificadores de usuarios del personal, correos ni listas de inscritos. Los datos de inscritos solo se devuelven al organizador dueño del evento. El listado y detalle públicos usan caché de 30 segundos.
- La interfaz conserva búsqueda, pestañas Próximos/Pasados, orden, paginación incremental y detalle. Los atletas pueden inscribirse desde tarjetas/detalle y revisar o cancelar sus inscripciones; los organizadores pueden crear y gestionar sus eventos desde el panel.

## Pendiente conocido

- Ampliar las pruebas de gestión de eventos e inscripciones para incluir edición, cancelación, lista de espera, aprobación manual y pagos.
- API para editar sedes, personal y galería del evento; estos datos se muestran en el detalle y todavía no se administran desde el panel.
- Subida de imágenes (la portada acepta una ruta local segura o URL HTTPS).
- Pasarela y verificación de pagos; las inscripciones pagadas quedan pendientes.
- Interfaz de administración, 2FA y envío de alertas por correo; el alta aún depende de `tsu_reserve`, lista de desarrollo con TSU en claro.
- Restringir CORS para producción y añadir limitación específica de intentos a `/api/auth/login`.
- Revisar política de contraseñas y decisión sobre liberar correo/teléfono al borrar lógicamente una cuenta.
- Despliegue de base de datos, backend y frontend.
- **Chat con IA (diferido al siguiente semestre):** asistente para que los usuarios consulten sobre la página, el servicio y los eventos. Se pospone porque evaluar los costos excede el tiempo del semestre actual. Estado: solo diseño; no hay código, rutas ni dependencias. Notas en «Chat con IA (diferido)».
 origin/main

La especificación funcional de `PROJECT_LOGIC.md` describe capacidades objetivo; no implica que ya estén implementadas. Para el estado real, contrastar este archivo con el código y el changelog.

## Chat con IA (diferido)

Decisión del equipo (2026-11-11): se implementa el siguiente semestre. Nada de esto está implementado; son notas para retomar el tema.

- **Objetivo:** chat para que los usuarios consulten sobre la página, el servicio y los eventos.
- **Proveedor candidato:** Retell AI, recomendado al equipo y ya usado junto con Cal. Datos consultados el 2026-11-11 (pueden haber cambiado; verificar antes de decidir): créditos gratis al registrarse, pago por uso sin mínimo mensual, chat agents cobrados por mensaje de IA, widget que se incrusta con un `<script>` y una public key, y soporte de knowledge base y funciones personalizadas. Alternativas: la API de chat de Retell con interfaz propia, o un LLM directo desde el backend (p. ej. modelos gratuitos de OpenRouter, con límites bajos).
- **Conocimiento del asistente:** solo texto redactado para usuarios. No usar `AI_CONTEXT.md` ni `PROJECT_LOGIC.md` como fuente: describen SPN_AD, TSU y el bloqueo de administradores.
- **Eventos en vivo:** solo lectura, con las mismas reglas de visibilidad de la API pública (eventos `Published`, sin `online_url` ni inscritos), reutilizando `db/events.js`. No se darían herramientas que inscriban o cancelen.
- **Datos de la cuenta del usuario:** fase posterior, con JWT; el id sale de `req.auth`, nunca del modelo.
- **Controles previstos:** límite de peticiones propio, clave pública restringida por dominio, reCAPTCHA v3 y tope de gasto.
- **Privacidad:** el historial quedaría en un tercero; avisar en el widget, revisar la Ley 1581 de 2012 y no guardar IP.
- **Fases tentativas:** 2.6.1 agente de chat con su knowledge base y widget; 2.6.2 endpoint de solo lectura para eventos públicos, con tests; 2.6.3 (opcional) interfaz propia sobre la API de chat.
- **Decisiones abiertas:** widget tal cual o interfaz propia; cuenta de Retell y public key; Cal dentro del chat o solo FAQ y eventos; uso anónimo o solo con sesión; guardar o no las conversaciones; destino del despliegue (este archivo menciona Render y Railway, pero `.env.example` y `docs/` mencionan Azure).

## Reglas para futuros cambios

1. Implementar solo el alcance solicitado y conservar funcionalidades existentes.
2. Revisar primero rutas, esquema y migraciones reales; no inventar columnas, campos o contratos.
3. Mantener secretos y credenciales fuera de respuestas, registros y documentos compartidos.
4. No eliminar archivos ni dependencias como parte de cambios no relacionados.
5. No declarar pruebas exitosas si no se ejecutaron. Las pruebas unitarias se ejecutan con `npm test` desde `backend/`; las de integración requieren `.env.test` y las bases de prueba preparadas.
6. Actualizar este contexto y `CHANGELOG.md` cuando una funcionalidad se implemente y verifique.

## Documentación relacionada

- `README.md`: instalación, configuración de bases y comandos de prueba.
- `PROJECT_LOGIC.md`: comportamiento funcional objetivo y principios de diseño.
- `CHANGELOG.md`: historial de cambios implementados.
- `spec.md`: instrucciones de trabajo del proyecto.

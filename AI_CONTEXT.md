# Sportanet — Contexto actual para desarrollo con IA

## Objetivo y tecnologías

Sportanet es una plataforma web para descubrir eventos deportivos y, en fases futuras, gestionar eventos e inscripciones. El frontend usa HTML, CSS y JavaScript; el backend usa Node.js, Express 5 y MySQL. La autenticación de usuarios utiliza bcrypt y JWT.

## Estado del repositorio

Estado revisado el 2026-11-03. La rama `main` está sincronizada con `origin/main` y no tenía cambios locales al realizar la revisión. El último cambio registrado es `SPNdev.3` (2026-10-29), que incorporó el esquema ampliado de eventos, la API pública y la página conectada a la base de datos.

### Funcionalidades implementadas

- Registro e inicio de sesión de cuentas Participante y Organizador. El formulario público no puede crear administradores; la creación de Organizador y su perfil se realiza en una transacción.
- JWT de usuario y middleware que consulta el estado y rol vigentes de la cuenta. `GET /api/auth/me` devuelve la identidad autenticada.
- API de usuarios protegida por autenticación y autorización por rol/propiedad. No expone el hash de contraseña y elimina cuentas mediante borrado lógico.
- API pública de eventos de solo lectura: `GET /api/events` (búsqueda, orden y paginación) y `GET /api/events/:id` (detalle). Los borradores no son públicos; el listado excluye cancelados. Las respuestas omiten enlaces privados y datos personales de inscritos.
- `events.html` consulta la API y ofrece búsqueda, filtros de próximos/pasados, orden, paginación incremental y detalle. El botón de inscripción informa que esa función aún no está disponible; no crea una inscripción.
- Línea de administración separada en la base `SPN_AD`: alta con TSU de un solo uso (`POST /api/admin/register`), login (`POST /api/admin/login`), consulta de sesión (`GET /api/admin/me`), JWT de administrador de 30 minutos y bloqueo temporal tras cinco intentos fallidos. Las rutas se montan solo al configurar `DB_AD_NAME`. No hay 2FA ni interfaz de administración.
- Límite global de solicitudes, límite de 1 MB para cuerpos JSON/form-urlencoded y métricas en `GET /api/health/metrics`.
- Migraciones de esquema versionadas y pruebas unitarias y de integración. `sportanet_v1` es la base principal; `sportanet_test`, `spn_ad` y `spn_ad_test` tienen funciones separadas. Los comandos de reset solo permiten nombres terminados en `_test`.

## Esquema y migraciones

- El esquema base está en `Base de Datos/schema.sql`; las migraciones actuales son `001_events_staff_mode.sql` a `004_events_drop_visibility.sql`.
- El esquema efectivo es `schema.sql` más las cuatro migraciones. Entre otros cambios, estas añaden `staff_mode`, `event_staff` y `event_images`, y eliminan la visibilidad privada y los tokens de compartir.
- `sport_events` contiene título, deporte, descripción, portada, fechas de inicio/fin, zona horaria, modalidad, capacidad, precio/moneda, límite de inscripción, estado, sede/club y organizador. Los estados del esquema son `Draft`, `Published`, `Completed` y `Canceled`; la modalidad es `InPerson`, `Virtual` o `Hybrid`.
- El esquema incluye `event_registrations` con estados `Pending`, `Confirmed`, `Waitlisted` y `Canceled`, además de estados de pago. La API de inscripciones aún no existe, así que tener la tabla no significa que los usuarios puedan inscribirse desde el producto.
- SPN_AD es una base aparte: los administradores no son filas de `users` ni usan `users.role = 'Admin'`.
- Antes de proponer consultas o cambios de esquema, revisar los SQL y migraciones reales. Antes de numerar la siguiente migración, consultar `schema_migrations` de la base destino y usar una versión superior a la más alta aplicada.

## Contrato vigente de eventos

- `GET /api/events`: ruta pública sin sesión. Acepta `q` (búsqueda por título, máximo 100 caracteres), `when=upcoming|past|all` (por defecto `upcoming`), `sort=name_asc|name_desc|newest|oldest`, `page` (por defecto 1) y `limit` (por defecto 12, máximo 50). Devuelve `{ data, page, limit, total, total_pages }`; parámetros inválidos dan `400 VALIDATION_ERROR`.
- `GET /api/events/:id`: ruta pública de detalle. Los borradores y eventos inexistentes devuelven `404 NOT_FOUND`. Un evento cancelado puede consultarse por ID y muestra el motivo de cancelación.
- Próximos son eventos `Published` cuyo `end_at` aún no pasó. Pasados son eventos `Completed` o `Published` cuyo `end_at` ya pasó. El listado no incluye `Canceled`. La comparación de fechas se calcula en la aplicación con la zona `America/Bogota`.
- Listado y detalle incluyen cupo, cantidad confirmada y cupos restantes; el total cuenta solo inscripciones `Confirmed`. El detalle puede incluir sede, club, organizador, personal y galería.
- No se exponen `online_url`, identificadores de usuarios del personal, correos ni listas de inscritos. El endpoint no requiere autenticación y usa caché pública de 30 segundos.
- La interfaz conserva búsqueda, pestañas Próximos/Pasados, orden, paginación incremental y detalle. Aunque muestra capacidad, precio y botón «Inscribirse», el botón no crea una inscripción ni reserva cupo.

## Pendiente conocido

- API y flujo de inscripciones (crear, consultar y cancelar, validando estado del evento, duplicados, cupos y reglas de pago).
- API y pantallas para que organizadores creen y administren sus propios eventos.
- Validación de `cover_image` en el servidor y carga de imágenes.
- Interfaz de administración, 2FA y envío de alertas por correo; el alta aún depende de `tsu_reserve`, lista de desarrollo con TSU en claro.
- Restringir CORS para producción y añadir limitación específica de intentos a `/api/auth/login`.
- Revisar política de contraseñas y decisión sobre liberar correo/teléfono al borrar lógicamente una cuenta.
- Despliegue de base de datos, backend y frontend.

La especificación funcional de `PROJECT_LOGIC.md` describe capacidades objetivo; no implica que ya estén implementadas. Para el estado real, contrastar este archivo con el código y el changelog.

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

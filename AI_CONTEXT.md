# Sportanet — Contexto actual para desarrollo con IA

## Objetivo y tecnologías

Sportanet es una plataforma web para descubrir eventos deportivos y, en fases futuras, gestionar eventos e inscripciones. El frontend usa HTML, CSS y JavaScript; el backend usa Node.js, Express 5 y MySQL. La autenticación de usuarios utiliza bcrypt y JWT.

## Estado del repositorio

Estado revisado el 2026-11-03. Después de SPNdev.4 se implementó localmente el flujo inicial de organizadores e inscripciones (SPNdev.5). `npm run testevents` cubre el flujo de perfil de Organizador, eventos del club SportaClub y registro de un Atleta; el resto de estados aún requiere pruebas.

### Funcionalidades implementadas

- Registro e inicio de sesión de cuentas Participante y Organizador. El formulario público no puede crear administradores; la creación de Organizador y su perfil se realiza en una transacción.
- JWT de usuario y middleware que consulta el estado y rol vigentes de la cuenta. `GET /api/auth/me` devuelve la identidad autenticada.
- API de usuarios protegida por autenticación y autorización por rol/propiedad. No expone el hash de contraseña y elimina cuentas mediante borrado lógico.
- Eventos: listado y detalle públicos (`GET /api/events`, `GET /api/events/:id`), además de gestión autenticada para organizadores y registro/cancelación de atletas. El detalle de rutas está abajo.
- `events.html` consulta la API y ofrece búsqueda, filtros, orden y paginación; también muestra el panel de creación/gestión al organizador y las inscripciones propias al atleta.
- Línea de administración separada en la base `SPN_AD`: alta con TSU de un solo uso (`POST /api/admin/register`), login (`POST /api/admin/login`), consulta de sesión (`GET /api/admin/me`), JWT de administrador de 30 minutos y bloqueo temporal tras cinco intentos fallidos. Las rutas se montan solo al configurar `DB_AD_NAME`. No hay 2FA ni interfaz de administración.
- Límite global de solicitudes, límite de 1 MB para cuerpos JSON/form-urlencoded y métricas en `GET /api/health/metrics`.
- Migraciones de esquema versionadas y pruebas unitarias y de integración. `sportanet_v1` es la base principal; `sportanet_test`, `spn_ad` y `spn_ad_test` tienen funciones separadas. Los comandos de reset solo permiten nombres terminados en `_test`.

## Esquema y migraciones

- El esquema base está en `Base de Datos/schema.sql`; las migraciones actuales son `001_events_staff_mode.sql` a `004_events_drop_visibility.sql`.
- El esquema efectivo es `schema.sql` más las cuatro migraciones. Entre otros cambios, estas añaden `staff_mode`, `event_staff` y `event_images`, y eliminan la visibilidad privada y los tokens de compartir.
- `sport_events` contiene título, deporte, descripción, portada, fechas de inicio/fin, zona horaria, modalidad, capacidad, precio/moneda, límite de inscripción, estado, sede/club y organizador. Los estados del esquema son `Draft`, `Published`, `Completed` y `Canceled`; la modalidad es `InPerson`, `Virtual` o `Hybrid`.
- El esquema incluye `event_registrations` con estados `Pending`, `Confirmed`, `Waitlisted` y `Canceled`, además de estados de pago. El flujo de inscripción ya está conectado a esa tabla; los pagos todavía no se procesan.
- SPN_AD es una base aparte: los administradores no son filas de `users` ni usan `users.role = 'Admin'`.
- Antes de proponer consultas o cambios de esquema, revisar los SQL y migraciones reales. Antes de numerar la siguiente migración, consultar `schema_migrations` de la base destino y usar una versión superior a la más alta aplicada.

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

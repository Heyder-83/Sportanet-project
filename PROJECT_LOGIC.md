# Lógica del Sistema — Sportanet

Este documento explica, paso a paso y de forma narrativa, cómo fluye la información en la aplicación Sportanet: desde la interfaz de usuario hasta el backend y la base de datos. Está pensado para un desarrollador que quiere entender qué archivos ejecutan cada acción, qué datos se mueven y qué validaciones/transformaciones suceden.

---

## Resumen general

- Frontend: páginas estáticas (`index.html`, `events.html`) + JavaScript en `JS/` (p. ej. `header.js`, `auth-examples.js`) manejan la UI, envían peticiones al backend y guardan el token/usuario en `localStorage`.
- Backend: Node.js + Express en `backend/` con rutas en `backend/routes/` (principalmente `auth.js` y `users.js`) y DB connection en `backend/db/connection.js`.
- Base de datos: MySQL (`sportanet_v1`) con tablas principales `users` y `user_profile` (entre otras relacionadas a eventos).
- Autenticación: JWT emitido en `auth.js` al registrarse o iniciar sesión. El token se guarda en el frontend y se envía en cabecera `Authorization: Bearer <token>` en peticiones subsecuentes. Las rutas sensibles ahora requieren verificación de token.

---

## Flujo: Registro (UI → backend → DB)

1. Usuario completa formulario de registro en la UI (archivo `index.html` o modal de registro). Campos: `full_name`, `email`, `phone`, `pwd`.
2. JavaScript (por ejemplo `header.js` o `auth-examples.js`) captura submit y envía un `fetch` POST a `/api/auth/register` con body JSON:
   ```json
   { "full_name": "...", "email": "...", "phone": "...", "pwd": "..." }
   ```
3. Backend — `backend/routes/auth.js` recibe la petición en `router.post('/register', ...)`.
   - Valida que no falten campos.
   - Hashea la contraseña con `bcrypt.hash(pwd, 10)`.
   - Inserta el usuario en la tabla `users` con `INSERT INTO users SET ?` usando el `pool` de `backend/db/connection.js`.
   - Si el insert es exitoso, genera un token JWT con `jwt.sign({ id: result.insertId, email }, JWT_SECRET, { expiresIn: '7d' })`.
   - Devuelve JSON al cliente: `{ message, token, user: { id, full_name, email, phone } }`.
4. Frontend recibe la respuesta:
   - Guarda `token` en `localStorage` (p. ej. `localStorage.setItem('auth_token', token)` o en `APP_STATE.token`).
   - Guarda `user` en `localStorage` o `APP_STATE.currentUser`.
   - Actualiza UI (muestra nombre en navbar, redirige, etc.).

---

## Flujo: Login (UI → backend → token)

1. Usuario pone email y contraseña en el modal de login.
2. JS envía POST a `/api/auth/login` con `email` y `pwd`.
3. Backend (`auth.js`):
   - Busca usuario por email: `SELECT * FROM users WHERE email = ?`.
   - Compara contraseña enviada con la almacenada usando `bcrypt.compare(pwd, user.pwd)`.
   - Si es correcto, firma un JWT: `jwt.sign({ id: user.user_id, email: user.email }, JWT_SECRET, { expiresIn: '7d' })`.
   - Responde `{ message: 'Login successful', token, user: { id, full_name, email, phone } }`.
4. Frontend guarda token y usuario en `localStorage` y lo usa para peticiones autenticadas.

---

## JWT y cómo se usa (emisión, almacenamiento y envío)

- Emisión: en `backend/routes/auth.js` con `jsonwebtoken` (`jwt.sign`). El `JWT_SECRET` se lee de `process.env.JWT_SECRET` (ver `.env.example`).
- Almacenamiento frontend: `localStorage` (clave `auth_token`) y objeto `user` para datos básicos.
- Envío: JS añade cabecera `Authorization: Bearer ${APP_STATE.token}` a las peticiones que requieren autenticación (ej. editar perfil, eliminar cuenta). Código relacionado en `JS/header.js` y `JS/auth-examples.js`.
- Estado actual: las rutas del backend ahora verifican el token en rutas sensibles (GET /api/users/:id, PUT /api/users/:id, DELETE /api/users/:id) usando un middleware `authenticateToken` que verifica con `jwt.verify`.

---

## Flujo: Ver Eventos y Detalles

1. Página `events.html` carga y JS solicita lista de eventos al backend (endpoint puede ser `/api/events` si existe).
2. Si la lista es pública, la petición se hace sin token. Si requiere autenticación (inscripción), se añade `Authorization`.
3. El backend consulta la tabla `events` y devuelve el listado. Frontend renderiza.

(Nota: en este repo hay HTML para eventos, pero las rutas de eventos en backend pueden implementarse en otro archivo; revisa `backend/routes/` si usas endpoints de eventos.)

---

## Flujo: Inscribirse a un evento

1. Usuario hace click en "Inscribirme" en un evento.
2. Frontend construye una petición POST (algo como `/api/events/:id/register`) incluyendo token en `Authorization`.
3. Backend debe verificar token (si implementas middleware) y luego insertar una fila en tabla de inscripciones (p. ej. `event_registrations`) con `user_id` y `event_id`.
4. Frontend muestra confirmación.

---

## Flujo: Editar Perfil

1. El modal "Mi Perfil" muestra datos que vienen del `APP_STATE.currentUser` o de `localStorage.getItem('user')`.
2. Por defecto, campos son `readonly`. Al pulsar "Editar Perfil" JS (función `enableProfileEdit()` en `JS/header.js`) habilita inputs y muestra botones Guardar/Cancelar.
3. Al enviar cambios, JS hace `fetch` PUT a `/api/users/:id` con body que contiene solo los campos modificados: `{ full_name?, email?, phone?, pwd? }`.
4. Backend `backend/routes/users.js` en `router.put('/:id')`:
   - Construye un objeto `data` sólo con campos definidos.
   - Si `pwd` viene, lo hashea con `bcrypt.hash` y se incluye en `data`.
   - Si `data` está vacío responde 400.
   - Ejecuta `UPDATE users SET ? WHERE user_id = ?`.
   - Si éxito, responde `{ message: 'User updated' }`.
5. Frontend procesa respuesta y actualiza `localStorage` y UI.

---

## Flujo: Eliminar Cuenta (cascada segura)

1. Usuario solicita eliminar su cuenta desde el modal de perfil.
2. Frontend solicita `DELETE /api/users/:id` con `Authorization`.
3. Backend (`users.js`) implementa una eliminación segura:
   - Primero ejecuta `DELETE FROM user_profile WHERE user_id = ?` para evitar errores de FK.
   - Luego `DELETE FROM users WHERE user_id = ?`.
   - Responde `{ message: 'User deleted' }`.
4. Frontend al recibir confirmación limpia `localStorage` (quita token y user) y redirige al inicio.

---

## Backend — Archivos clave y responsabilidades

- `backend/app.js`
  - Inicializa Express, middlewares (`cors`, `express.json()`), carga variables de entorno con `dotenv`, sirve archivos estáticos del frontend, y registra rutas: `/api/users` y `/api/auth`.
  - Escucha en el puerto (5000 por defecto o según `PORT` en `.env`).

- `backend/db/connection.js`
  - Exporta `pool` (mysql2) configurado con `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.

- `backend/routes/auth.js`
  - Rutas: `POST /register`, `POST /login`.
  - Maneja hash de password con `bcrypt`, inserciones y comprobaciones en DB.
  - Genera JWT con `jsonwebtoken` y devuelve `{ token, user }`.

- `backend/routes/users.js`
  - CRUD para usuarios: `GET /` (público, sin contraseñas), `GET /:id` (autenticado, sin contraseña), `POST /` (hashea contraseña), `PUT /:id` (autenticado, hashea si pwd), `DELETE /:id` (autenticado).
  - PUT: actualiza solo campos enviados y hashea contraseña si se proporciona.
  - DELETE: elimina filas dependientes en `user_profile` antes de eliminar de `users`.

---

## Base de datos — puntos importantes

- Tabla `users` contiene al menos: `user_id` (PK), `full_name`, `email`, `phone`, `pwd` (hash).
- Tabla `user_profile` referencia `users(user_id)` con FK. Por eso la eliminación requiere limpiar `user_profile` primero.
- Otras tablas esperadas para eventos y registros de inscripción (nombres dependientes de la implementación).

---

## Mensajes de error y UX

- Backend envía objetos `{ error: '...' }` o errores SQL en caso de fallo.
- Frontend usa un helper `extractServerErrorMessage()` para extraer mensajes legibles y mostrarlos en la UI (sin serializar objetos enteros).
- Evita exponer errores internos y SQL al cliente en producción; transformar a mensajes amigables.

---

## Seguridad y recomendaciones prácticas

1. Mantener `JWT_SECRET` en .env (no comitearlo). `.env.example` está bien para referencia.
2. Implementar middleware `verifyToken` que use `jwt.verify(token, JWT_SECRET)` y exponer `req.user = decoded`.
3. Proteger rutas sensibles (`/api/users` PUT/DELETE, endpoints de eventos que modifiquen datos) con `verifyToken`.
4. Verificar autorización: por ejemplo, en `PUT /api/users/:id` verificar `req.user.id === Number(req.params.id)` o permitir si `req.user.role === 'admin'`.
5. Usar HTTPS en producción para proteger tokens en tránsito.

---

## Ejemplos de payloads y respuestas

- Registro - Request (frontend → backend):
```json
POST /api/auth/register
{ "full_name": "Heyder", "email": "heyder@example.com", "phone": "3001234567", "pwd": "MiPassword123" }
```
- Registro - Response (backend → frontend):
```json
{ "message": "User registered successfully", "token": "<jwt>", "user": { "id": 1, "full_name": "Heyder", "email": "heyder@example.com", "phone": "3001234567" } }
```

- Login - Request:
```json
POST /api/auth/login
{ "email": "heyder@example.com", "pwd": "MiPassword123" }
```
- Login - Response:
```json
{ "message": "Login successful", "token": "<jwt>", "user": { "id": 1, "full_name": "Heyder", "email": "heyder@example.com", "phone": "3001234567" } }
```

- Editar perfil - Request:
```json
PUT /api/users/1
{ "phone": "3110000000" }
```

- Eliminar cuenta - Request:
```http
DELETE /api/users/1
Authorization: Bearer <token>
```

---

## Dónde ejecutar (rápido)

- Backend:
```powershell
cd backend
npm install
npm start
# o en desarrollo: nodemon app.js
```
- Frontend:
  - Abrir `http://localhost:5000` en un navegador (el backend sirve los archivos estáticos). Asegúrate de que endpoints apunten a `http://localhost:5000` (o el puerto configurado).
- Base de datos: MySQL con base de datos `sportanet_v1`. Ver `.env.example` para valores de ejemplo.

---
## Interpretaciones de resultados de pruebas de resistencia y estrés

Cantidad de éxitos alta + 0 bloqueos + cantidad de respuestas lentas altas = sistema saturado, pero aun funcional

Cantidad de éxitos baja + cantidad de errores alta + 0 bloqueos = colapso evidente del servidor

Comparar cantidad de éxitos vs cantidad de bloqueos para medir el rate limit

rps bajo + cantidad de llamadas demoradas alta = pérdida de estabilidad

## Lista de URLs/rutas de entrada del servidor

Base local del backend:
- http://127.0.0.1:5000

### Endpoints públicos / no protegidos
- GET /api/health/metrics
  - Ruta de diagnóstico y monitoreo del servidor.
  - No aplica rate limiting ni autenticación.
  - Útil para medir latencia y saturación del servicio, pero no refleja el tráfico real del negocio.

### Endpoints de autenticación
- POST /api/auth/register
  - Registro de usuario con validación del payload y creación de cuenta.
  - Tiene carga por validación, bcrypt y escritura en base de datos.
- POST /api/auth/login
  - Login con comparación bcrypt y verificación de cuenta activa.
  - Muy útil para medir latencia de autenticación y uso de BD.
- GET /api/auth/me
  - Ruta protegida por JWT.
  - Sirve para validar el middleware de autenticación y la lectura de identidad.

### Endpoints de usuarios (protegidos por JWT y roles)
- GET /api/users
  - Requiere sesión y rol Admin.
  - Punto de prueba para listado de usuarios.
- GET /api/users/:id
  - Requiere sesión; solo propio usuario o Admin.
  - Útil para medir acceso por identidad y autorización.
- POST /api/users
  - Requiere sesión y rol Admin.
  - Crea usuarios, incluye hash bcrypt y escritura en BD.
- PUT /api/users/:id
  - Requiere sesión; solo propio usuario o Admin.
  - Actualización parcial de perfil, útil para medir carga de update.
- DELETE /api/users/:id
  - Requiere sesión; solo propio usuario o Admin.
  - Borrado lógico, útil para probar estabilidad y consistencia del estado.

## Recomendación para pruebas por URL

Cada una de estas rutas debe probarse por separado para identificar su límite real:

1. /api/health/metrics -> latencia y estabilidad del sistema sin protección
2. /api/auth/login -> autenticación y bcrypt
3. /api/auth/register -> creación de cuentas y validaciones
4. /api/users -> carga de listado protegido por Admin
5. /api/users/:id -> lectura/edición/borrado con autorización
6. /api/auth/me -> validación de token y middleware

## Criterio de comparación entre rutas

Para cada endpoint conviene registrar:
- totalCallsAttempted
- success
- blocked
- errors
- slowResponses
- elapsedMs
- rps

Así se puede comparar qué rutas se degradan antes, cuáles bloquean y cuáles colapsan realmente bajo carga.

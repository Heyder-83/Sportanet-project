# Changelog — Sportanet

Este archivo registra los cambios relevantes realizados en Sportanet, incluyendo nuevas funcionalidades, modificaciones, correcciones y verificaciones.

El formato está inspirado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). El versionado se organiza por fases de desarrollo para facilitar el seguimiento incremental del proyecto.

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
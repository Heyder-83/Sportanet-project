# Changelog — Sportanet

Este archivo registra los cambios relevantes realizados en Sportanet, incluyendo nuevas funcionalidades, modificaciones, correcciones y verificaciones.

El formato está inspirado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). El versionado se organiza por fases de desarrollo para facilitar el seguimiento incremental del proyecto.

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

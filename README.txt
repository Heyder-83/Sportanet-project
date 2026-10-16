# Pendiente de reemplazar/actualizar README.md

# Sportanet

## Descripción del Proyecto

Sportanet es una plataforma web diseñada para facilitar la búsqueda, gestión y participación en eventos deportivos. Permite a los usuarios registrarse, crear perfiles personalizados, explorar eventos disponibles e inscribirse en actividades deportivas de su interés.

El sistema contempla tres roles: **Participant** (inscripción a eventos), **Organizer** (creación y administración de eventos) y **Admin** (supervisión de la plataforma).

## Tecnologías Usadas

### Frontend
- **HTML5** — Estructura semántica
- **CSS3** — Diseño responsive con Flexbox y Grid
- **JavaScript** — Lógica de aplicación y validaciones
- **Fetch API** — Comunicación con el backend

### Backend
- **Node.js** — Runtime de JavaScript
- **Express.js** — Framework web
- **MySQL2** — Driver de base de datos
- **bcrypt** — Encriptación de contraseñas
- **JWT (jsonwebtoken)** — Autenticación basada en tokens (HS256)
- **CORS** — Control de acceso entre dominios

### Base de Datos
- **MySQL** — Sistema de gestión de base de datos relacional
- Nombre de la base de datos: `sportanet_v1`

## Estructura del Proyecto

Sportanet-project/
├── backend/
│ ├── app.js # Servidor Express y registro de rutas
│ ├── config/jwt.js # Configuración centralizada de JWT
│ ├── db/connection.js # Pool de conexiones MySQL
│ ├── middleware/
│ │ └── authenticate.js # Middleware de autenticación JWT (factory)
│ ├── routes/
│ │ ├── auth.js # Registro e inicio de sesión
│ │ └── users.js # CRUD de usuarios
│ ├── test/
│ │ └── authenticate.test.js
│ └── package.json
├── JS/ # Lógica del frontend
├── CSS/ # Estilos
├── img/ # Imágenes
├── Base de Datos/ # Schema SQL (sin datos)
├── index.html
├── events.html
├── CHANGELOG.md
├── PROJECT_LOGIC.md
└── README.md

## Requisitos Previos

- Node.js (v14 o superior; verificado en v24.11.1)
- MySQL Server ejecutándose
- Un navegador web moderno
- MySQL en el PATH del sistema (opcional, pero recomendado)

## Cómo Ejecutarlo

### 1. Clonar el repositorio

(bash)
git clone https://github.com/Heyder-83/Sportanet-project.git
cd Sportanet-project

## 2. Configurar la base de datos
Crear una base de datos MySQL llamada sportanet_v1

Ejecutar el schema disponible en Base de Datos/

## 3. Configurar variables de entorno
En backend/, crear un archivo .env a partir de .env.example:

PORT=5000
DB_HOST=localhost
DB_PORT=3306
DB_USER=tu_usuario
DB_PASSWORD=tu_password
DB_NAME=sportanet_v1
JWT_SECRET=un_secreto_largo_y_aleatorio

[ El servidor falla al arrancar si JWT_SECRET no está definido. ]

## 4. Instalar dependencias del backend

cd backend
npm install

## 5. Ejecutar los tests

npm test

## 6. Iniciar el backend

node app.js

El servidor estará disponible en http://localhost:5000 (o el PORT configurado).

## 7. Abrir el Frontend
Abrir index.html en el navegador, o servir con un servidor HTTP local:

python -m http.server 8080

La aplicación se conectará al backend en http://localhost:5000

## API endpoints

Autenticación (/api/auth)
Método	Ruta	Auth	Descripción
POST	/api/auth/register	No	Registro de nuevo usuario
POST	/api/auth/login	No	Inicio de sesión
GET	/api/auth/me	JWT	Datos del usuario autenticado
Usuarios (/api/users)
Método	Ruta	Auth	Descripción
GET	/api/users/:id	JWT	Consultar usuario
PUT	/api/users/:id	JWT	Actualizar usuario
DELETE	/api/users/:id	JWT	Eliminar/desactivar usuario
Eventos e inscripciones
🚧 Pendiente de implementación — ver sección "Estado del Proyecto".

Base de Datos
Tabla users
Columna	Tipo	Notas
user_id	int, PK, auto_increment	
full_name	varchar(100)	
email	varchar(100), UNIQUE	
phone	varchar(20), UNIQUE, nullable	
pwd	varchar(255)	Hash bcrypt (no texto plano)
role	enum('Participant','Organizer','Admin')	Default: Participant
is_active	tinyint(1)	Default: 1
deleted_at	datetime, nullable	Soft-delete
created_at	datetime	Auto
updated_at	datetime	Auto
Flujo de Uso
Registrarse — Crea una cuenta con nombre, email, teléfono y contraseña

Iniciar Sesión — Accede con tus credenciales

Mi Perfil — Visualiza y edita tu información personal o elimina tu cuenta

Eventos — Explora eventos deportivos disponibles (pendiente)

Inscripción — Participa en eventos de tu interés (pendiente)

Estado del Proyecto
✅ Implementado
Registro e inicio de sesión con JWT (HS256)

Middleware de autenticación (authenticate.js) con códigos de error específicos

Verificación de estado de cuenta (is_active, deleted_at) en el middleware

Endpoint GET /api/auth/me

Configuración centralizada de JWT (config/jwt.js)

Fail-safe: el servidor no arranca sin JWT_SECRET

Preparación para despliegue (PORT dinámico, DB_PORT, .env con path absoluto)

Tests unitarios del middleware (13/13)

Handler global de errores en app.js

🚧 Pendiente
Rutas de eventos (/api/events)

Rutas de inscripciones (/api/registrations)

Conexión del frontend con la API (eventos)

Vista de calendario y exportación .ics

Pagos

Rate limiting en /api/auth/login

Política de contraseña (mínimo 8 caracteres, complejidad)

Restricción de CORS para producción

Pruebas de integración con base de datos real

Despliegue en Railway (DB) + Render (backend + frontend)

Documentación Adicional
PROJECT_LOGIC.md — Lógica funcional del proyecto y reglas de desarrollo

CHANGELOG.md — Registro de cambios por fases

AI_CONTEXT.md — Contexto para desarrollo asistido por IA

Equipo de Desarrollo
Heyder Ivan Ramos Rodriguez

Daniel Gustavo Montañez

Juherles Jesus Renia

Danilo Jose Cantor

Grupo: Tecnología en Desarrollo de Software
Universidad: Universidad San Buenaventura


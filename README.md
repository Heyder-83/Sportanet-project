# Sportanet

## Descripción del Proyecto

Sportanet es una plataforma web diseñada para facilitar la búsqueda, gestión y participación en eventos deportivos. Permite a los usuarios registrarse, crear perfiles personalizados, explorar eventos disponibles e inscribirse en actividades deportivas de su interés.

## Tecnologías Usadas

### Frontend
- **HTML5** - Estructura semántica
- **CSS3** - Diseño responsive con Flexbox y Grid
- **JavaScript** - Lógica de aplicación y validaciones
- **Fetch API** - Comunicación con el backend

### Backend
- **Node.js** - Runtime de JavaScript
- **Express.js** - Framework web
- **MySQL2** - Driver de base de datos
- **bcrypt** - Encriptación de contraseñas
- **JWT (jsonwebtoken)** - Autenticación basada en tokens
- **CORS** - Control de acceso entre dominios

### Base de Datos
- **MySQL** - Sistema de gestión de base de datos relacional

## Cómo Ejecutarlo

### Requisitos Previos
- Node.js (v14 o superior)
- MySQL Server ejecutándose
- Un navegador web moderno

### Pasos de Instalación

#### 1. Clonar el repositorio
```bash
git clone https://github.com/Heyder-83/Sportanet-project.git
cd Sportanet-project
```

#### 2. Configurar la base de datos
- Crear una base de datos MySQL llamada `sportanet_v1`
- Ejecutar las migraciones necesarias para crear las tablas

#### 3. Instalar dependencias del backend
```bash
cd backend
npm install
```

#### 4. Iniciar el backend
```bash
node app.js
```
El servidor estará disponible en `http://localhost:5000`

#### 5. Abrir el frontend
- Abre `index.html` en el navegador o sirve los archivos con un servidor HTTP local
- La aplicación se conectará automáticamente al backend en `http://localhost:5000`

### Flujo de Uso
1. **Registrarse** - Crea una cuenta con tu nombre, email, teléfono y contraseña
2. **Iniciar Sesión** - Accede con tus credenciales
3. **Mi Perfil** - Visualiza y edita tu información personal o elimina tu cuenta
4. **Eventos** - Explora eventos deportivos disponibles
5. **Inscripción** - Participa en eventos de tu interés

---

## Equipo de Desarrollo

- **Heyder Ivan Ramos Rodriguez**
- **Daniel Gustavo Montañez**
- **Juherles Jesus Renia**
- **Danilo Jose Cantor**

**Grupo:** Tecnología en Desarrollo de Software  
**Universidad:** Universidad San Buenaventura

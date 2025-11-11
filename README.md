# 🏆 Sportanet - Plataforma de Eventos Deportivos

Plataforma web para descubrir y participar en eventos deportivos. Cuenta con un sistema robusto de autenticación (login/registro) integrado con un backend Node.js.

## 📋 Tabla de Contenidos

- [Características](#características)
- [Estructura del Proyecto](#estructura-del-proyecto)
- [Instalación y Configuración](#instalación-y-configuración)
- [Mejoras Implementadas](#mejoras-implementadas)
- [Guía de Integración Backend](#guía-de-integración-backend)
- [Características de Seguridad](#características-de-seguridad)
- [Uso del Sistema de Autenticación](#uso-del-sistema-de-autenticación)

---

## ✨ Características

### Frontend
✅ **Navbar responsive** con menú hamburguesa para móviles  
✅ **Modal de login/registro** elegante y accesible  
✅ **Validación de formularios** en cliente y servidor  
✅ **Sistema de autenticación** con JWT  
✅ **Almacenamiento seguro** de tokens en localStorage  
✅ **Interfaz adaptable** (mobile-first design)  
✅ **Gestión de sesiones** (login/logout)  
✅ **Animaciones fluidas** y microinteracciones  

### Backend (Listo para implementar)
✅ Endpoints preparados para `/api/auth/login` y `/api/auth/register`  
✅ Ejemplo de código con bcrypt y JWT  
✅ Middleware de autenticación  
✅ Manejo de errores robusto  

---

## 📁 Estructura del Proyecto

```
Sportanet-project/
├── index.html                  # Página de inicio
├── events.html                 # Página de eventos
├── README.md                   # Este archivo
├── BACKEND_INTEGRATION.md      # Guía de integración con backend
│
├── CSS/
│   ├── header.css             # Estilos del navbar y modal (MEJORADO)
│   └── style.css              # Estilos generales (OPTIMIZADO)
│
├── JS/
│   ├── header.js              # Lógica del header y autenticación (MEJORADO)
│   └── auth-examples.js       # Ejemplos de uso del sistema auth
│
├── includes/
│   ├── header.html            # Header reutilizable (MEJORADO)
│   └── footer.html            # Footer (vacío, editar según necesidad)
│
├── img/                        # Imágenes del proyecto
│
└── backend/
    ├── app.js                 # Servidor Express
    ├── package.json           # Dependencias
    ├── db/
    │   └── connection.js      # Conexión a BD
    └── routes/
        ├── auth.js            # Rutas de autenticación
        └── users.js           # Rutas de usuarios
```

---

## 🚀 Instalación y Configuración

### Frontend (HTML/CSS/JS)

1. **Clonar o descargar el proyecto**
   ```bash
   git clone <tu-repo>
   cd Sportanet-project
   ```

2. **Servir localmente** (necesitas un servidor local)
   ```bash
   # Opción 1: Usar Live Server de VS Code (recomendado)
   # Click derecho en index.html → Open with Live Server
   
   # Opción 2: Usar Python
   python -m http.server 8000
   
   # Opción 3: Usar Node.js con http-server
   npm install -g http-server
   http-server
   ```

3. **Acceder**
   - Abre `http://localhost:8000` en tu navegador

### Backend (Node.js + Express)

Ver archivo **`BACKEND_INTEGRATION.md`** para detalles completos.

Resumen rápido:
```bash
cd backend
npm install
npm start
```

El backend debe correr en `http://localhost:3000`

---

## 🎨 Mejoras Implementadas

### 1. **Header Mejorado**
- ✅ Navbar sticky con diseño moderno
- ✅ Logo clickeable
- ✅ Menú de navegación responsive
- ✅ Botón hamburguesa para móviles
- ✅ Visualización del usuario logueado
- ✅ Botón de logout

### 2. **Sistema de Autenticación Robusto**
- ✅ Modal accesible con ARIA labels
- ✅ Validación de formularios en cliente
- ✅ Mensajes de error y éxito
- ✅ Gestión de estado global (`APP_STATE`)
- ✅ Almacenamiento seguro de tokens

### 3. **Formularios Mejorados**
- ✅ Estructura semántica con `<label>` correctos
- ✅ Validación en tiempo real
- ✅ Mensajes de error precisos
- ✅ Confirmación de contraseña en registro
- ✅ Atributos de accesibilidad

### 4. **CSS Optimizado**
- ✅ Sin duplicados (consolidado)
- ✅ Media queries para responsive
- ✅ Animaciones fluidas
- ✅ Variables de color consistentes
- ✅ Enfoque en mobile-first design

### 5. **JavaScript Profesional**
- ✅ Código modular y comentado
- ✅ Manejo de errores robusto
- ✅ Funciones reutilizables
- ✅ Soporte para async/await
- ✅ Debugging facilitado

### 6. **Accesibilidad**
- ✅ Semántica HTML5 adecuada
- ✅ ARIA labels y roles
- ✅ Navegación por teclado
- ✅ Contraste de colores WCAG AA
- ✅ Textos descriptivos

### 7. **Seguridad**
- ✅ Validación en cliente y servidor
- ✅ JWT para autenticación
- ✅ Prevención de XSS
- ✅ CORS configurado
- ✅ Manejo seguro de tokens

---

## 🔗 Guía de Integración Backend

Para conectar el login/registro con tu base de datos:

1. **Ver archivo**: `BACKEND_INTEGRATION.md`
2. **Endpoints necesarios**:
   - `POST /api/auth/login`
   - `POST /api/auth/register`

3. **Respuesta esperada** (ambos endpoints):
   ```json
   {
     "success": true,
     "token": "jwt-token-aqui",
     "user": {
       "id": 1,
       "nombre": "Juan",
       "email": "juan@example.com"
     }
   }
   ```

4. **El frontend automáticamente**:
   - Guardará el token en `localStorage.auth_token`
   - Guardará datos del usuario en `localStorage.user`
   - Actualizará la UI (mostrar/ocultar login)
   - Recargaráá la página

---

## 🔒 Características de Seguridad

### Cliente
- ✅ Validación de formularios
- ✅ Sanitización de entrada
- ✅ Almacenamiento seguro de tokens
- ✅ Limpieza de sesión al logout

### Servidor (a implementar)
- ✅ Hash de contraseñas con bcrypt
- ✅ JWT con expiración
- ✅ CORS configurado
- ✅ Rate limiting (recomendado)
- ✅ HTTPS en producción (recomendado)

---

## 💻 Uso del Sistema de Autenticación

### Verificar si está logueado
```javascript
if (isUserLoggedIn()) {
    console.log('Usuario logueado');
}
```

### Obtener datos del usuario
```javascript
const user = getCurrentUser();
console.log(user.nombre); // "Juan Pérez"
```

### Hacer peticiones autenticadas
```javascript
const response = await authenticatedFetch('/api/user/profile');
const data = await response.json();
```

### Proteger rutas
```javascript
function miPágina() {
    if (!requireAuth()) {
        return; // Abre el modal de login
    }
    // Tu código aquí
}
```

Ver archivo **`JS/auth-examples.js`** para más ejemplos.

---

## 📱 Responsividad

El proyecto usa **mobile-first design** con breakpoints en:
- `768px` - Tablets
- `480px` - Móviles

Se adapta correctamente a:
- ✅ Desktop (1920px+)
- ✅ Laptop (1024px)
- ✅ Tablet (768px)
- ✅ Móvil (375px+)

---

## 🐛 Troubleshooting

### "Error al cargar el encabezado"
- Verifica que `includes/header.html` existe
- Revisa la consola del navegador
- Comprueba que usas un servidor local (no abrir archivo directo)

### "Login no funciona"
- Verifica que el backend esté corriendo
- Abre DevTools → Network → ve si la petición se envía
- Revisa la consola para errores

### "Token no se guarda"
- Verifica que la respuesta incluye `token` en el JSON
- Comprueba que localStorage está habilitado
- Revisa la estructura de respuesta esperada

### "CORS error"
- Verifica que el backend usa `cors()`
- Asegúrate que los headers son correctos
- En desarrollo, considera usar `"*"` como origen CORS

---

## 📦 Dependencias Backend (npm install)

```
express
mysql2
cors
bcrypt
jsonwebtoken
dotenv
```

---

## 🌟 Next Steps

- [ ] Implementar endpoints de autenticación en backend
- [ ] Crear tabla de usuarios en BD
- [ ] Configurar variables de entorno (.env)
- [ ] Agregar rate limiting
- [ ] Implementar recuperación de contraseña
- [ ] Agregar verificación de email
- [ ] Crear página de perfil de usuario
- [ ] Implementar vista de eventos del usuario
- [ ] Agregar funcionalidad de inscripción a eventos

---

## 📝 Licencia

Este proyecto es de código abierto. Siéntete libre de modificarlo según tus necesidades.

---

## 👨‍💻 Autor

Desarrollado con ❤️ para Sportanet

---

## 📞 Soporte

Para consultas sobre la integración backend, ver: **`BACKEND_INTEGRATION.md`**

¡Mucho éxito con tu proyecto! 🚀

## 🧪 GUÍA RÁPIDA DE PRUEBA

### ✅ Pruebas del Frontend (Sin Backend)

#### 1. Verificar que el Header carga correctamente
1. Abre `index.html` con Live Server
2. Debería verse:
   - 🏆 Sportanet (con emoji)
   - Menú: Inicio | Eventos | Iniciar Sesión
   - En móvil: menú hamburguesa

#### 2. Probar Modal de Login
1. Click en "Iniciar Sesión"
2. Debería:
   - Abrirse modal con transición
   - Mostrar formulario con labels
   - Mostrar placeholder "tu@email.com"

#### 3. Validación de Login
Intenta submit sin llenar:
- Campo email: Debe mostrar "El correo es requerido"
- Campo password: Debe mostrar "La contraseña es requerida"

Intenta con email inválido:
- Debe mostrar "Ingresa un correo válido"

Intenta contraseña < 6 caracteres:
- Debe mostrar "La contraseña debe tener al menos 6 caracteres"

#### 4. Alternar a Registro
1. Click en "Regístrate"
2. Debería cambiar a formulario de registro
3. Ver campos adicionales:
   - Nombre completo
   - Confirmación de contraseña

#### 5. Validación de Registro
Llena todos los campos:
- Nombre: "Juan" (mínimo 3 caracteres)
- Email: "juan@example.com"
- Password: "123456"
- Confirmar: "123456" (deben coincidir)

#### 6. Cerrar Modal
- Click en X: debe cerrar
- Click fuera: debe cerrar
- Tecla ESC: debe cerrar

#### 7. Responsividad
Redimensiona ventana:
- < 768px: Aparece menú hamburguesa
- > 768px: Menú visible normal

---

### 🔌 Cuando Tengas Backend Implementado

#### Paso 1: Configurar Base de Datos
```sql
CREATE DATABASE sportanet_db;

CREATE TABLE usuarios (
    id INT PRIMARY KEY AUTO_INCREMENT,
    nombre VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    rol VARCHAR(20) DEFAULT 'usuario',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### Paso 2: Verificar Conexión Backend
1. Asegúrate que `http://localhost:3000` está activo
2. Abre DevTools (F12) → Console
3. Intenta:
```javascript
fetch('http://localhost:3000')
    .then(r => console.log('Backend conectado!'))
    .catch(e => console.log('Backend no disponible:', e))
```

#### Paso 3: Probar Login con Backend
1. Llena el formulario de login
2. Abre DevTools → Network
3. Debería haber una petición POST a `/api/auth/login`
4. Respuesta debería ser:
```json
{
    "success": true,
    "token": "eyJ...",
    "user": { "id": 1, "nombre": "Juan", "email": "juan@example.com" }
}
```

#### Paso 4: Verificar Token Guardado
1. Abre DevTools → Application → Local Storage
2. Debería haber:
   - `auth_token`: El JWT
   - `user`: JSON con datos del usuario

#### Paso 5: Probar UI Actualizada
1. Después de login exitoso, la página recarga
2. Debería mostrar "Hola, Juan" en lugar de "Iniciar Sesión"
3. Botón "Salir" debe estar visible

#### Paso 6: Probar Logout
1. Click en "Salir"
2. Confirmar el prompt
3. Debería borrar tokens
4. Recargar página
5. Volver a mostrar "Iniciar Sesión"

---

### 🐛 Debug con DevTools

#### Consola
```javascript
// Ver estado actual
debugAuthStatus()

// Ver token
console.log(getAuthToken())

// Ver usuario
console.log(getCurrentUser())

// Verificar si está logueado
console.log(isUserLoggedIn())
```

#### Network
1. F12 → Network tab
2. Intenta login
3. Busca petición POST a `/api/auth/login`
4. Verifica:
   - Request: tiene email y password
   - Response: tiene token y user
   - Status: 200 (éxito) o 401 (error)

#### Application
1. F12 → Application
2. Local Storage
3. Verifica que se guardan:
   - `auth_token`
   - `user`

---

### ✅ Checklist de Pruebas Antes de Producción

#### Frontend Funcional
- [ ] Header carga sin errores
- [ ] Modal abre/cierra correctamente
- [ ] Validación funciona
- [ ] Responsive en 375px, 768px, 1920px

#### Backend Conectado
- [ ] Login funciona
- [ ] Registro funciona
- [ ] Token se guarda
- [ ] UI se actualiza
- [ ] Logout funciona

#### Seguridad
- [ ] Contraseñas hasheadas en BD
- [ ] Tokens expiran
- [ ] CORS configurado
- [ ] Sin console.log en producción

#### Rendimiento
- [ ] Carga rápida (< 3s)
- [ ] Sin errores en consola
- [ ] Sin memory leaks
- [ ] Responsive rápido

---

### 📊 Metricas Útiles

#### Velocidad
- Page Load: < 3 segundos
- Time to Interactive: < 5 segundos
- First Contentful Paint: < 1.5 segundos

#### Lighthouse
- Performance: > 90
- Accessibility: > 90
- Best Practices: > 90
- SEO: > 90

#### Compatibilidad
- Chrome: ✅
- Firefox: ✅
- Safari: ✅
- Edge: ✅
- Mobile Safari: ✅
- Chrome Mobile: ✅

---

### 🎬 Flujo Completo de Prueba

```
1. INICIO
   ↓
2. Abre index.html con Live Server
   ↓
3. Verifica que carga correctamente
   ↓
4. Click en "Iniciar Sesión"
   ↓
5. Intenta enviar sin datos → Errores de validación ✅
   ↓
6. Intenta con datos inválidos → Errores específicos ✅
   ↓
7. Llena correctamente
   ↓
8. Click Submit
   ↓
   ├─ SIN BACKEND: Debe mostrar "Error de conexión"
   │
   └─ CON BACKEND:
      ├─ Datos correctos → Login exitoso → Recarga → Muestra nombre ✅
      └─ Datos incorrectos → Muestra error → No recarga ✅
   ↓
9. Click en "Salir"
   ↓
10. Confirma → Logout
    ↓
11. Vuelve al estado inicial ✅
```

---

### 🚨 Solución de Problemas

#### "Error al cargar el encabezado"
```javascript
// En consola
console.log(document.getElementById('header-container'))
// Debería mostrar el elemento, no null
```

#### "Modal no abre"
```javascript
// En consola
document.getElementById('modal-auth').classList.add('show')
// Debería abrirse inmediatamente
```

#### "Validación no funciona"
```javascript
// En consola
validateLoginForm()
// Debería devolver true/false
```

#### "Token no se guarda"
```javascript
// En consola
localStorage.getItem('auth_token')
// Debería devolver el token, no null
```

#### "Login pero no actualiza UI"
```javascript
// En consola
updateUIAfterLogin()
// Debería mostrar el nombre del usuario
```

---

### 📝 Reporte de Prueba Template

```markdown
## Prueba de Login - [FECHA]

### Ambiente
- [ ] Desarrollo
- [ ] Staging
- [ ] Producción

### Browser
- [ ] Chrome
- [ ] Firefox
- [ ] Safari
- [ ] Edge

### Dispositivo
- [ ] Desktop
- [ ] Tablet
- [ ] Mobile

### Resultados

#### Login
- [ ] Abre modal
- [ ] Validación funciona
- [ ] Submit envía petición
- [ ] Éxito muestra mensaje
- [ ] Error muestra mensaje
- [ ] Token se guarda

#### Registro
- [ ] Abre formulario
- [ ] Validación funciona
- [ ] Submit envía petición
- [ ] Éxito crea usuario
- [ ] Error muestra mensaje

#### Logout
- [ ] Botón visible
- [ ] Limpia tokens
- [ ] Recarga página

### Issues Encontrados
- [ ] Ninguno
- [ ] Menor
- [ ] Mayor
- [ ] Crítico

### Notas
[Espacio para notas]

### Sign-off
Probado por: _______________
Fecha: _______________
```

---

¡Listo para empezar a probar! 🧪

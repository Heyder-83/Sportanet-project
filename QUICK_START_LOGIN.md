# ✅ GUÍA RÁPIDA: Cómo Verificar que el Login Funciona

## 🚀 Inicio Rápido (3 minutos)

### Paso 1: Reinicia el Backend
Abre una terminal en la carpeta `backend` y ejecuta:
```bash
node app.js
```

**Deberías ver**: `Server running on port 5000`

---

### Paso 2: Abre el Frontend
En tu navegador, ve a:
```
http://localhost:3000
```
(o donde esté tu frontend)

---

### Paso 3: Registra un Usuario
1. Haz clic en **"Registrarse"**
2. Llena los datos:
   - **Nombre**: `Juan Pérez`
   - **Email**: `juan@sportanet.com`
   - **Teléfono**: `1234567890`
   - **Contraseña**: `MiPassword123`
3. Haz clic en **"Crear Cuenta"**

**Resultado esperado**:
- ✅ Mensaje: "¡Cuenta creada exitosamente! Iniciando sesión..."
- ✅ Modal se cierra automáticamente
- ✅ Página recarga
- ✅ Botón "Iniciar Sesión" cambia a **"Mi Perfil"**

---

### Paso 4: Verifica el Perfil
1. Haz clic en **"Mi Perfil"** (en la navbar)
2. Se abre un modal con tus datos

**Deberías ver**:
- ✅ Nombre: `Juan Pérez`
- ✅ Email: `juan@sportanet.com`
- ✅ Teléfono: `1234567890`

---

### Paso 5: Edita el Perfil
1. En el modal de perfil, modifica algo (ej: el nombre a `Juan Carlos`)
2. Haz clic en **"Guardar Cambios"**

**Resultado esperado**:
- ✅ Mensaje: "¡Perfil actualizado exitosamente!"

---

### Paso 6: Cierra Sesión
1. Haz clic en **"Cerrar Sesión"** (abajo en el modal)
2. Se abre un diálogo pidiendo confirmación
3. Haz clic en **"Aceptar"**

**Resultado esperado**:
- ✅ Sesión se cierra
- ✅ Botón "Mi Perfil" cambia a "Iniciar Sesión"

---

### Paso 7: Inicia Sesión Nuevamente
1. Haz clic en **"Iniciar Sesión"**
2. Llena los datos:
   - **Email**: `juan@sportanet.com`
   - **Contraseña**: `MiPassword123`
3. Haz clic en **"Ingresar"**

**Resultado esperado**:
- ✅ Mensaje: "¡Sesión iniciada exitosamente!"
- ✅ Modal se cierra
- ✅ Botón muestra **"Mi Perfil"**

---

### Paso 8: Verifica el Perfil Actualizado
1. Haz clic en **"Mi Perfil"**

**Deberías ver**:
- ✅ Nombre: `Juan Carlos` (cambio guardado)
- ✅ Email: `juan@sportanet.com`
- ✅ Teléfono: `1234567890`

---

## 🧪 Testing Avanzado (Consola del Navegador)

Si necesitas verificar los tokens, abre la consola del navegador (F12) y ejecuta:

```javascript
// Ver token
console.log(localStorage.getItem('auth_token'));

// Ver datos del usuario
console.log(JSON.parse(localStorage.getItem('user')));
```

**Deberías ver algo como**:
```javascript
// Token (JWT):
"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MiwiZW1haWwiOiJqdWFuQHNwb3J0YW5ldC5jb20iLCJpYXQiOjE3MzE0MDc3MDIsImV4cCI6MTczMjAxMjUwMn0.kQE..."

// Usuario:
{
  id: 2,
  full_name: "Juan Carlos",
  email: "juan@sportanet.com",
  phone: "1234567890"
}
```

---

## ❌ Solución de Problemas

### Problema: "Error de conexión"
**Causa**: El backend no está corriendo en puerto 5000

**Solución**:
1. Verifica que ejecutaste `node app.js` en la carpeta `/backend`
2. Verifica que el puerto 5000 no esté siendo usado por otra aplicación
3. Reinicia el servidor

---

### Problema: "Error al iniciar sesión. Verifica tus credenciales"
**Causa**: Contraseña incorrecta o email no existe

**Solución**:
1. Abre F12 → Console
2. Intenta login nuevamente
3. Verifica el error exacto en la consola
4. Si dice "Invalid credentials": verifica email y contraseña
5. Si dice "Missing email or password": asegúrate de llenar ambos campos

---

### Problema: "Email already registered"
**Causa**: Ya existe una cuenta con ese email

**Solución**:
1. Usa otro email en el registro (ej: `juan2@sportanet.com`)
2. O accede a phpMyAdmin y elimina ese usuario de la BD
3. Luego intenta registrarte de nuevo

---

### Problema: El perfil no carga después del login
**Causa**: El usuario no se está guardando en localStorage

**Solución**:
1. Abre F12 → Console
2. Ejecuta:
   ```javascript
   console.log(localStorage.getItem('user'));
   ```
3. Si devuelve `null`: El login no guardó el usuario
4. Abre la pestaña "Network" y observa la respuesta del login
5. Debería incluir: `token` y `user` con sus datos

---

### Problema: El token es inválido
**Causa**: El token expiró (válido por 7 días) o está corrupto

**Solución**:
1. Cierra sesión y vuelve a iniciar sesión
2. Se generará un nuevo token válido por 7 días más

---

## ✅ Checklist Final

Marca todo esto como hecho:

- [ ] Backend iniciado correctamente (`node app.js`)
- [ ] Frontend accesible en http://localhost:3000
- [ ] Registro funciona
- [ ] Token se guarda en localStorage
- [ ] Usuario se guarda en localStorage
- [ ] Perfil carga después del registro
- [ ] Perfil se puede editar
- [ ] Cambios se guardan en la base de datos
- [ ] Cierre de sesión funciona
- [ ] Login funciona con credenciales correctas
- [ ] Login rechaza credenciales incorrectas
- [ ] Perfil se actualiza después de editar

---

## 📝 Nota Importante

Si algo no funciona después de estos cambios:

1. **Borra el cache del navegador** (Ctrl+Shift+Delete)
2. **Actualiza la página** (Ctrl+F5)
3. **Reinicia el backend** (`Ctrl+C` en la terminal y `node app.js` nuevamente)
4. **Prueba en incógnito** para evitar cache

Si aún no funciona, **abre la consola del navegador (F12)** y comparte el error que ves.

---

## 🎯 Resumen

**Cambios realizados**:
- ✅ Frontend ahora envía `pwd` en lugar de `password`
- ✅ Backend ahora genera JWT tokens
- ✅ Backend devuelve usuario completo con teléfono
- ✅ Backend maneja email duplicado correctamente

**Resultado**:
- ✅ Registro funciona
- ✅ Login funciona
- ✅ Perfil se carga
- ✅ Perfil se puede editar
- ✅ Cuenta se puede eliminar

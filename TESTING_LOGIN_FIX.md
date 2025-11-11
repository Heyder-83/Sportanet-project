# 🧪 Testing del Fix de Login

## Cambios Realizados

### 1. **Frontend (header.js)**
✅ **Línea ~299**: Cambio de `password` a `pwd` en el login:
```javascript
// ANTES:
body: JSON.stringify({ email, password })

// DESPUÉS:
body: JSON.stringify({ email, pwd: password })
```

### 2. **Backend (routes/auth.js)**
✅ **JWT Instalado**: `jsonwebtoken@9.0.0`

✅ **Login ahora devuelve token y usuario completo**:
```javascript
// AHORA DEVUELVE:
{
  message: 'Login successful',
  token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  user: {
    id: 1,
    full_name: 'Juan Pérez',
    email: 'juan@example.com',
    phone: '+1234567890'
  }
}
```

✅ **Registro ahora devuelve token y usuario completo**:
```javascript
// AHORA DEVUELVE:
{
  message: 'User registered successfully',
  token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  user: {
    id: 1,
    full_name: 'Juan Pérez',
    email: 'juan@example.com',
    phone: '+1234567890'
  }
}
```

## Pasos para Testear

### Opción A: Desde el Browser (RECOMENDADO)

1. **Reinicia el backend** (si está corriendo):
   ```bash
   cd backend
   node app.js
   ```

2. **Abre el navegador** en `http://localhost:3000` (o donde esté tu frontend)

3. **Test de Registro**:
   - Haz clic en "Registrarse"
   - Llena los datos:
     - Nombre: `Test User`
     - Email: `test@example.com`
     - Teléfono: `1234567890`
     - Contraseña: `123456`
   - Haz clic en "Crear Cuenta"
   - **Deberías ver**: "¡Cuenta creada exitosamente! Iniciando sesión..."

4. **Test de Login**:
   - Haz clic en "Iniciar Sesión"
   - Llena los datos:
     - Email: `test@example.com`
     - Contraseña: `123456`
   - Haz clic en "Ingresar"
   - **Deberías ver**: "¡Sesión iniciada exitosamente!"
   - **Deberías ver**: El modal se cierra y la página recarga
   - **Deberías ver**: El botón "Iniciar Sesión" cambia a "Mi Perfil"

5. **Test de Perfil**:
   - Haz clic en "Mi Perfil"
   - **Deberías ver**: Tus datos (nombre, email, teléfono)
   - **Deberías ver**: El botón "Guardar Cambios"

6. **Test de Editar Perfil**:
   - Modifica el nombre o email o teléfono
   - Haz clic en "Guardar Cambios"
   - **Deberías ver**: "¡Perfil actualizado exitosamente!"

7. **Test de Eliminar Cuenta**:
   - En el modal de perfil, baja hasta "Zona de Peligro"
   - Haz clic en "Eliminar Mi Cuenta"
   - **Deberías ver**: Modal de confirmación
   - Haz clic en "Sí, eliminar"
   - **Deberías ver**: "¡Cuenta eliminada exitosamente!"
   - **Deberías ver**: Te redirige a la página de inicio sin sesión

### Opción B: Usando cURL (desde terminal)

```bash
# Test de Registro
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "Test User",
    "email": "test@example.com",
    "phone": "1234567890",
    "pwd": "123456"
  }'

# Deberías recibir:
{
  "message": "User registered successfully",
  "token": "eyJ...",
  "user": {
    "id": 1,
    "full_name": "Test User",
    "email": "test@example.com",
    "phone": "1234567890"
  }
}

# Test de Login
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "pwd": "123456"
  }'

# Deberías recibir:
{
  "message": "Login successful",
  "token": "eyJ...",
  "user": {
    "id": 1,
    "full_name": "Test User",
    "email": "test@example.com",
    "phone": "1234567890"
  }
}

# Test de Login con credenciales incorrectas
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "pwd": "wrongpassword"
  }'

# Deberías recibir:
{
  "error": "Invalid credentials"
}
```

## Checklist de Validación

- [ ] **Registro**: Se crea cuenta exitosamente
- [ ] **Registro**: Se devuelve token válido
- [ ] **Registro**: Se devuelve usuario con teléfono
- [ ] **Login**: Se inicia sesión con credenciales correctas
- [ ] **Login**: Se devuelve token válido
- [ ] **Login**: Se devuelve usuario completo
- [ ] **Login**: Rechaza credenciales incorrectas
- [ ] **Perfil**: Se carga la información del usuario
- [ ] **Perfil**: Se puede editar nombre
- [ ] **Perfil**: Se puede editar email
- [ ] **Perfil**: Se puede editar teléfono
- [ ] **Perfil**: Se puede eliminar cuenta
- [ ] **Logout**: Se cierra sesión correctamente

## Problemas Comunes

### ❌ "Error de conexión"
**Solución**: Asegúrate de que el backend está corriendo en puerto 5000

### ❌ "Error al iniciar sesión. Verifica tus credenciales"
**Solución**: Revisa la consola del navegador (F12 > Console) para ver el error exacto

### ❌ "Email already registered"
**Solución**: Usa un email diferente en el registro o elimina el usuario de la BD manualmente

### ❌ Token no se guarda en localStorage
**Solución**: Revisa si el navegador permite localStorage (no estés en incógnito)

## Notas Importantes

- El token expira en **7 días**
- La contraseña se encripta con **bcrypt** (10 rounds)
- El token se guarda en **localStorage** bajo la clave `auth_token`
- El usuario se guarda en **localStorage** bajo la clave `user`

# Conexión Frontend-Backend

## Estado Actual

✅ **Frontend ESTÁ conectado al backend**

El frontend está configurado para comunicarse con el backend en `http://localhost:5000`

## Arquitectura

```
Frontend (Puerto 80/3000)
├─ index.html
├─ events.html
├─ JS/header.js
└─ CSS/

Backend (Puerto 5000)
├─ app.js
├─ routes/
│  ├─ auth.js
│  └─ users.js
└─ db/connection.js
```

## Endpoints Conectados

### Autenticación
- `POST /api/auth/login` - Iniciar sesión
- `POST /api/auth/register` - Registro de usuario

### Usuarios
- `GET /api/users/:id` - Obtener datos de usuario
- `PUT /api/users/:id` - Actualizar datos de usuario
- `DELETE /api/users/:id` - Eliminar usuario

## Cómo Ejecutar

### 1. Iniciar Backend
```bash
cd backend
npm install
node app.js
```

El backend estará disponible en: `http://localhost:5000`

### 2. Ejecutar Frontend
Opción A - Usar live server (VS Code):
- Click derecho en `index.html`
- Select "Open with Live Server"

Opción B - Usar un servidor HTTP simple:
```bash
python -m http.server 8000
```

Luego acceder a: `http://localhost:8000`

## Flujo de Conexión

### Registro
1. Usuario llena formulario en `index.html`
2. Frontend valida datos
3. Envía `POST http://localhost:5000/api/auth/register`
4. Backend procesa y guarda en BD
5. Frontend recibe respuesta y logea usuario

### Login
1. Usuario introduce credenciales
2. Frontend envía `POST http://localhost:5000/api/auth/login`
3. Backend verifica en BD
4. Devuelve token y datos de usuario
5. Frontend guarda en localStorage

### Editar Perfil
1. Usuario modifica datos
2. Frontend envía `PUT http://localhost:5000/api/users/:id`
3. Backend actualiza en BD
4. Frontend actualiza UI

### Eliminar Cuenta
1. Usuario confirma eliminación
2. Frontend envía `DELETE http://localhost:5000/api/users/:id`
3. Backend elimina de BD
4. Frontend limpia sesión

## Variables Clave

En `JS/header.js`:
```javascript
const APP_STATE = {
    API_URL: 'http://localhost:5000'  // Cambiar si backend está en otra URL
}
```

Si el backend está en otro servidor, cambiar esta URL.

## Status de Integración

- ✅ Frontend conectado
- ✅ Endpoints disponibles
- ✅ CORS habilitado en backend
- ✅ Validaciones funcionando
- ✅ Autenticación lista
- ⚠️ JWT recomendado (próximo paso)

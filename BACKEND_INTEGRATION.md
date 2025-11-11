# 🔗 Guía de Integración Frontend - Backend

## 📋 Resumen de cambios en el Frontend

El sistema de login/registro ahora está estructurado para conectarse fácilmente a tu backend. Los endpoints esperados son:

### 1. **Endpoint de Login**
```
POST /api/auth/login
Content-Type: application/json

{
  "email": "usuario@example.com",
  "password": "contraseña123"
}

Respuesta esperada (200 OK):
{
  "success": true,
  "message": "Login exitoso",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "nombre": "Juan Pérez",
    "email": "usuario@example.com",
    "rol": "usuario"
  }
}

Respuesta de error (401):
{
  "success": false,
  "message": "Credenciales inválidas"
}
```

### 2. **Endpoint de Registro**
```
POST /api/auth/register
Content-Type: application/json

{
  "nombre": "Juan Pérez",
  "email": "usuario@example.com",
  "password": "contraseña123"
}

Respuesta esperada (201 Created):
{
  "success": true,
  "message": "Cuenta creada exitosamente",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "nombre": "Juan Pérez",
    "email": "usuario@example.com",
    "rol": "usuario"
  }
}

Respuesta de error (400):
{
  "success": false,
  "message": "El email ya está registrado"
}
```

---

## 🛠️ Backend (Node.js + Express)

Aquí está la estructura recomendada para tu backend:

### **Archivo: `backend/routes/auth.js`**

```javascript
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db/connection');

const SECRET_KEY = process.env.JWT_SECRET || 'tu-clave-secreta-aqui';

// ===== LOGIN =====
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validar entrada
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email y contraseña son requeridos'
      });
    }

    // Buscar usuario en la base de datos
    const query = 'SELECT * FROM usuarios WHERE email = ?';
    db.query(query, [email], async (error, results) => {
      if (error) {
        return res.status(500).json({
          success: false,
          message: 'Error en el servidor'
        });
      }

      // Si el usuario no existe o la contraseña es incorrecta
      if (results.length === 0 || !await bcrypt.compare(password, results[0].password)) {
        return res.status(401).json({
          success: false,
          message: 'Email o contraseña incorrectos'
        });
      }

      const user = results[0];

      // Crear token JWT
      const token = jwt.sign(
        { 
          id: user.id, 
          email: user.email,
          nombre: user.nombre 
        },
        SECRET_KEY,
        { expiresIn: '24h' }
      );

      // Enviar respuesta
      res.status(200).json({
        success: true,
        message: 'Login exitoso',
        token: token,
        user: {
          id: user.id,
          nombre: user.nombre,
          email: user.email,
          rol: user.rol || 'usuario'
        }
      });
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({
      success: false,
      message: 'Error en el servidor'
    });
  }
});

// ===== REGISTER =====
router.post('/register', async (req, res) => {
  try {
    const { nombre, email, password } = req.body;

    // Validar entrada
    if (!nombre || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Todos los campos son requeridos'
      });
    }

    // Validar que la contraseña tenga al menos 6 caracteres
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'La contraseña debe tener al menos 6 caracteres'
      });
    }

    // Verificar si el email ya existe
    const checkQuery = 'SELECT email FROM usuarios WHERE email = ?';
    db.query(checkQuery, [email], async (error, results) => {
      if (error) {
        return res.status(500).json({
          success: false,
          message: 'Error en el servidor'
        });
      }

      if (results.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'El email ya está registrado'
        });
      }

      // Hashear la contraseña
      const hashedPassword = await bcrypt.hash(password, 10);

      // Insertar nuevo usuario
      const insertQuery = 'INSERT INTO usuarios (nombre, email, password, created_at) VALUES (?, ?, ?, NOW())';
      db.query(insertQuery, [nombre, email, hashedPassword], (error, results) => {
        if (error) {
          console.error('Error al insertar usuario:', error);
          return res.status(500).json({
            success: false,
            message: 'Error al crear la cuenta'
          });
        }

        const userId = results.insertId;

        // Crear token JWT
        const token = jwt.sign(
          { 
            id: userId, 
            email: email,
            nombre: nombre 
          },
          SECRET_KEY,
          { expiresIn: '24h' }
        );

        // Responder
        res.status(201).json({
          success: true,
          message: 'Cuenta creada exitosamente',
          token: token,
          user: {
            id: userId,
            nombre: nombre,
            email: email,
            rol: 'usuario'
          }
        });
      });
    });
  } catch (error) {
    console.error('Error en register:', error);
    res.status(500).json({
      success: false,
      message: 'Error en el servidor'
    });
  }
});

module.exports = router;
```

### **Archivo: `backend/app.js`**

Asegúrate de que tu app.js esté configurado así:

```javascript
const express = require('express');
const cors = require('cors');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rutas de autenticación
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// Otras rutas...
app.use('/api/users', require('./routes/users'));

// Manejo de errores
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({
    success: false,
    message: 'Error en el servidor'
  });
});

// Puerto
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en puerto ${PORT}`);
});
```

### **Schema de Base de Datos**

```sql
CREATE TABLE usuarios (
  id INT PRIMARY KEY AUTO_INCREMENT,
  nombre VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  rol VARCHAR(20) DEFAULT 'usuario',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX idx_email ON usuarios(email);
```

### **Dependencias necesarias en `backend/package.json`**

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "mysql2": "^3.6.0",
    "cors": "^2.8.5",
    "bcrypt": "^5.1.1",
    "jsonwebtoken": "^9.1.2",
    "dotenv": "^16.3.1"
  }
}
```

---

## 🔒 Seguridad - Middleware de Autenticación

Crea este middleware para proteger rutas que requieren autenticación:

### **Archivo: `backend/middleware/auth.js`**

```javascript
const jwt = require('jsonwebtoken');

const SECRET_KEY = process.env.JWT_SECRET || 'tu-clave-secreta-aqui';

const verifyToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Token no proporcionado'
    });
  }

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    req.userId = decoded.id;
    req.userEmail = decoded.email;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Token inválido o expirado'
    });
  }
};

module.exports = verifyToken;
```

**Uso:**
```javascript
const verifyToken = require('./middleware/auth');

// Ruta protegida
router.get('/profile', verifyToken, (req, res) => {
  // Solo accesible con token válido
  res.json({ userId: req.userId });
});
```

---

## 🌐 Frontend - Cómo funciona

### **Almacenamiento local**
- El token se guarda en `localStorage.auth_token`
- Los datos del usuario se guardan en `localStorage.user`

### **Cómo hacer peticiones autenticadas desde el frontend**

```javascript
// Obtener el token guardado
const token = localStorage.getItem('auth_token');

// Hacer petición con autenticación
fetch('/api/user/profile', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
})
.then(res => res.json())
.then(data => console.log(data))
.catch(err => console.error(err));
```

---

## ✅ Checklist de implementación

- [ ] Instalar dependencias: `npm install`
- [ ] Crear tabla `usuarios` en la base de datos
- [ ] Configurar variables de entorno (`.env`)
- [ ] Implementar rutas `/api/auth/login` y `/api/auth/register`
- [ ] Implementar middleware de verificación de token
- [ ] Probar login/registro con Postman
- [ ] Verificar que los tokens se guardan en localStorage
- [ ] Probar logout
- [ ] Verificar que la UI se actualiza después de login

---

## 🧪 Pruebas con Postman

### **POST /api/auth/login**
```json
{
  "email": "usuario@example.com",
  "password": "password123"
}
```

### **POST /api/auth/register**
```json
{
  "nombre": "Juan Pérez",
  "email": "juan@example.com",
  "password": "password123"
}
```

---

## 🐛 Troubleshooting

**Problema**: "Error de conexión" en el frontend
- **Solución**: Verifica que el backend esté corriendo en `http://localhost:3000`

**Problema**: CORS error
- **Solución**: Asegúrate de usar `cors()` en tu app.js

**Problema**: El token no se guarda
- **Solución**: Verifica que la respuesta del servidor incluya `token` en el JSON

**Problema**: Login funciona pero no recarga la página
- **Solución**: Revisa la consola del navegador para errores

---

¡Listo! Tu sistema de autenticación está completamente integrado. 🚀

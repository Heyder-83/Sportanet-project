## 📂 Estructura Recomendada para el Backend

Cuando crees tu backend, usa esta estructura:

```
backend/
├── app.js                          # Archivo principal
├── package.json                    # Dependencias
├── .env                           # Variables de entorno (NO COMMITAR)
├── .env.example                   # Ejemplo de .env
├── .gitignore                     # Archivos a ignorar
│
├── config/
│   ├── database.js               # Configuración BD
│   └── constants.js              # Constantes
│
├── routes/
│   ├── auth.js                   # Rutas de autenticación ⭐
│   ├── users.js                  # Rutas de usuarios
│   └── events.js                 # Rutas de eventos
│
├── middleware/
│   ├── auth.js                   # Verificación de token
│   ├── errorHandler.js           # Manejo de errores
│   └── validation.js             # Validación de datos
│
├── controllers/
│   ├── authController.js         # Lógica de auth
│   └── userController.js         # Lógica de usuarios
│
├── models/
│   ├── User.js                   # Modelo de usuario
│   └── Event.js                  # Modelo de evento
│
├── db/
│   ├── connection.js             # Conexión a BD
│   ├── init.sql                  # Script de creación
│   └── seeds.sql                 # Datos de prueba
│
├── utils/
│   ├── validators.js             # Funciones de validación
│   ├── jwt.js                    # Funciones JWT
│   └── hash.js                   # Funciones de hash
│
├── tests/
│   ├── auth.test.js              # Tests de auth
│   └── users.test.js             # Tests de usuarios
│
└── logs/
    └── error.log                 # Archivo de logs
```

---

## 📄 Archivos que DEBES Crear

### 1. `backend/app.js`

```javascript
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rutas
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Error en servidor' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
```

### 2. `backend/package.json`

```json
{
  "name": "sportanet-backend",
  "version": "1.0.0",
  "description": "Backend para Sportanet",
  "main": "app.js",
  "scripts": {
    "start": "node app.js",
    "dev": "nodemon app.js",
    "test": "jest"
  },
  "dependencies": {
    "express": "^4.18.2",
    "mysql2": "^3.6.0",
    "cors": "^2.8.5",
    "bcrypt": "^5.1.1",
    "jsonwebtoken": "^9.1.2",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "nodemon": "^3.0.1",
    "jest": "^29.7.0"
  }
}
```

### 3. `backend/.env`

```
PORT=3000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=password
DB_NAME=sportanet_db
JWT_SECRET=mi-clave-secreta-muy-larga-con-caracteres-especiales-!@#$%
JWT_EXPIRE=24h
CORS_ORIGIN=http://localhost:8000
NODE_ENV=development
```

### 4. `backend/.gitignore`

```
node_modules/
.env
.env.local
logs/
*.log
npm-debug.log*
.DS_Store
```

### 5. `backend/db/connection.js`

```javascript
const mysql = require('mysql2/promise');
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool;
```

### 6. `backend/db/init.sql`

```sql
CREATE DATABASE IF NOT EXISTS sportanet_db;
USE sportanet_db;

CREATE TABLE usuarios (
  id INT PRIMARY KEY AUTO_INCREMENT,
  nombre VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  rol VARCHAR(20) DEFAULT 'usuario',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email)
);

CREATE TABLE eventos (
  id INT PRIMARY KEY AUTO_INCREMENT,
  nombre VARCHAR(200) NOT NULL,
  descripcion TEXT,
  fecha DATE NOT NULL,
  lugar VARCHAR(200),
  capacidad INT,
  inscripciones INT DEFAULT 0,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES usuarios(id)
);

CREATE TABLE inscripciones (
  id INT PRIMARY KEY AUTO_INCREMENT,
  usuario_id INT NOT NULL,
  evento_id INT NOT NULL,
  fecha_inscripcion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  FOREIGN KEY (evento_id) REFERENCES eventos(id),
  UNIQUE KEY unique_inscripcion (usuario_id, evento_id)
);
```

### 7. `backend/routes/auth.js` (Principal)

```javascript
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db/connection');

const SECRET_KEY = process.env.JWT_SECRET;

// LOGIN
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email y contraseña requeridos'
      });
    }

    const connection = await pool.getConnection();
    const [results] = await connection.query(
      'SELECT * FROM usuarios WHERE email = ?',
      [email]
    );
    connection.release();

    if (results.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Email o contraseña incorrectos'
      });
    }

    const user = results[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({
        success: false,
        message: 'Email o contraseña incorrectos'
      });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      SECRET_KEY,
      { expiresIn: process.env.JWT_EXPIRE }
    );

    res.json({
      success: true,
      message: 'Login exitoso',
      token: token,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol
      }
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({
      success: false,
      message: 'Error en servidor'
    });
  }
});

// REGISTRO
router.post('/register', async (req, res) => {
  try {
    const { nombre, email, password } = req.body;

    if (!nombre || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Todos los campos son requeridos'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Contraseña muy corta'
      });
    }

    const connection = await pool.getConnection();
    
    // Verificar si email existe
    const [existing] = await connection.query(
      'SELECT email FROM usuarios WHERE email = ?',
      [email]
    );

    if (existing.length > 0) {
      connection.release();
      return res.status(400).json({
        success: false,
        message: 'Email ya registrado'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insertar usuario
    const [result] = await connection.query(
      'INSERT INTO usuarios (nombre, email, password) VALUES (?, ?, ?)',
      [nombre, email, hashedPassword]
    );

    connection.release();

    const userId = result.insertId;
    const token = jwt.sign(
      { id: userId, email: email },
      SECRET_KEY,
      { expiresIn: process.env.JWT_EXPIRE }
    );

    res.status(201).json({
      success: true,
      message: 'Cuenta creada',
      token: token,
      user: {
        id: userId,
        nombre: nombre,
        email: email,
        rol: 'usuario'
      }
    });
  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({
      success: false,
      message: 'Error en servidor'
    });
  }
});

module.exports = router;
```

---

## 🚀 Instalación Rápida

```bash
# Crear carpeta backend
mkdir backend
cd backend

# Crear package.json
npm init -y

# Instalar dependencias
npm install express mysql2 cors bcrypt jsonwebtoken dotenv

# Instalar nodemon (desarrollo)
npm install --save-dev nodemon

# Copiar .env.example a .env
cp .env.example .env

# EDITAR .env con tus datos
nano .env

# Inicializar base de datos
mysql -u root -p < db/init.sql

# Iniciar servidor
npm run dev
```

---

## ✅ Verificación Rápida

```bash
# Test de conexión
curl http://localhost:3000

# Test de login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"123456"}'
```

---

## 📝 Próximos Archivos a Crear

Después de app.js, crea:

1. `db/connection.js` - Conexión a BD
2. `routes/auth.js` - Rutas de autenticación
3. `middleware/auth.js` - Verificación de token
4. `routes/users.js` - Rutas de usuarios
5. Demás archivos según necesidad

---

¡Con esta estructura, tu backend estará profesional y escalable! 🚀

// backend/app.js
// Archivo principal del servidor Express
// - Configura middlewares (CORS, JSON)
// - Registra rutas de la API (/api/users, /api/auth)
// - Inicia el servidor en el puerto configurado
const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

// Cargar variables de entorno desde el archivo .env en la raíz del proyecto
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const port = process.env.PORT || 5000;

// Middlewares
app.use(cors());
app.use(express.json());

// Servir archivos estáticos del frontend desde la raíz del proyecto
app.use(express.static(path.join(__dirname, '..')));

// Rutas principales de la API
// /api/users -> CRUD de usuarios
// /api/auth  -> Registro y login (emisión de JWT)
app.use('/api/users', require('./routes/users'));
app.use('/api/auth', require('./routes/auth'));

// Server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

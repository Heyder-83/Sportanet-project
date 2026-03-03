// backend/app.js
// Archivo principal del servidor Express
// - Configura middlewares (CORS, JSON)
// - Registra rutas de la API (/api/users, /api/auth)
// - Inicia el servidor en el puerto configurado
const express = require('express');
const cors = require('cors');
const app = express();
const port = 5000;

// Middlewares
app.use(cors());
app.use(express.json());

// Rutas principales de la API
// /api/users -> CRUD de usuarios
// /api/auth  -> Registro y login (emisión de JWT)
app.use('/api/users', require('./routes/users'));
app.use('/api/auth', require('./routes/auth'));

app.get('/users', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM users');
  res.json(rows);
});

require('dotenv').config();

// Server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

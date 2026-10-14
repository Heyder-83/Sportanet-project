// backend/db/connection.js
// Configuración del pool de conexiones a MySQL
// - Lee credenciales desde variables de entorno (usa .env si está presente)
require('dotenv').config();
const mysql = require('mysql2');

const pool = mysql.createPool({
    connectionLimit: 10,
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'sportanet_v1'
});

module.exports = pool;

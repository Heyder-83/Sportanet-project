// backend/db/connection.js
// Configuración del pool de conexiones a MySQL
// - Exporta `pool` para usar en las rutas (consultas SQL)
const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const pool = mysql.createPool({
    connectionLimit: 10,
    waitForConnections: true,
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'sportanet_v1'
});

module.exports = pool;

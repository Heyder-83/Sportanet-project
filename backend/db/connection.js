// backend/db/connection.js
// Configuración del pool de conexiones a MySQL
// - Exporta `pool` para usar en las rutas (consultas SQL)
const mysql = require('mysql2');

const pool = mysql.createPool({
    connectionLimit: 10,
    host: 'localhost',
    user: 'root',
    password: 'password',
    database: 'sportanet_v1',
});

module.exports = pool;

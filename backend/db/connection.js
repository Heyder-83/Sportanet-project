// backend/db/connection.js
const mysql = require('mysql2');

const pool = mysql.createPool({
    connectionLimit: 10,
    host: 'localhost',
    user: 'root',
    password: 'root',
    database: 'sportanet_v1'
});

module.exports = pool;

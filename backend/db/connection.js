// backend/db/connection.js
// Configuración del pool de conexiones a MySQL
// - Lee credenciales desde variables de entorno (usa backend/.env si está presente)
// - TLS opcional con DB_SSL=true y DB_SSL_CA (ver utils/dbSsl.js). Con DB_SSL=false o sin definir
//   no se añade ninguna opción ssl (comportamiento local/Docker de siempre). Si DB_SSL=true y el
//   certificado es inválido, falla al cargarse: nunca se cae a una conexión sin TLS.
const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2');
const { sslOption } = require('../utils/dbSsl');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const pool = mysql.createPool({
    connectionLimit: 10,
    waitForConnections: true,
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'sportanet_v1',
    ...sslOption(process.env)
});

module.exports = pool;

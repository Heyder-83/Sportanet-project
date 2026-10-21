// backend/db/connectionAd.js
// Pool de conexiones a SPN_AD (la base aparte de administradores). Es independiente de db/connection.js:
//   - usa su propio usuario de MySQL (DB_AD_USER) con permisos solo sobre esa base;
//   - NO tiene valores por defecto para nombre, usuario ni contraseña: si faltan, falla al cargarse (fail-safe),
//     para no acabar conectando por descuido con las credenciales de la base principal.
// Solo lo cargan las rutas de administración (Fase 1F.2 en adelante); la app sin esas rutas no lo necesita.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const mysql = require('mysql2');

const env = process.env;
const missing = ['DB_AD_NAME', 'DB_AD_USER', 'DB_AD_PASSWORD'].filter((k) => typeof env[k] !== 'string' || env[k] === '');
if (missing.length) {
    throw new Error(`Faltan variables de entorno para SPN_AD: ${missing.join(', ')}. Configúralas en backend/.env.`);
}
if (env.DB_AD_NAME === (env.DB_NAME || 'sportanet_v1')) {
    throw new Error('DB_AD_NAME no puede ser la base principal: SPN_AD debe ser una base aparte.');
}
if (env.DB_AD_USER === env.DB_USER) {
    const msg = 'DB_AD_USER es el mismo usuario que DB_USER: SPN_AD no queda aislada de la base principal.';
    if (env.NODE_ENV === 'production') throw new Error(msg);
    console.warn(`[seguridad] ${msg}`);
}

const pool = mysql.createPool({
    connectionLimit: 5,
    waitForConnections: true,
    host: env.DB_AD_HOST || env.DB_HOST || 'localhost',
    port: parseInt(env.DB_AD_PORT || env.DB_PORT || '3306', 10),
    user: env.DB_AD_USER,
    password: env.DB_AD_PASSWORD,
    database: env.DB_AD_NAME
});

module.exports = pool;

// backend/config/jwt.js
// Configuración centralizada del secreto JWT.
// - Carga .env (si existe) y exige JWT_SECRET.
// - NO hay valor por defecto: si falta, el proceso falla al arrancar (fail-safe).
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const JWT_SECRET = process.env.JWT_SECRET;

if (typeof JWT_SECRET !== 'string' || JWT_SECRET.trim() === '') {
    throw new Error(
        'JWT_SECRET no está definido. Configúralo en backend/.env o como variable de entorno antes de iniciar el servidor.'
    );
}

if (JWT_SECRET.length < 32) {
    console.warn('[seguridad] JWT_SECRET tiene menos de 32 caracteres; usa un valor largo y aleatorio.');
}

module.exports = { JWT_SECRET };

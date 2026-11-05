// backend/config/tsu.js
// Clave del servidor con la que se calcula el hash (HMAC-SHA-256) de los TSU.
// - Carga .env (si existe) y exige TSU_HMAC_KEY.
// - NO hay valor por defecto: si falta o es corta, el proceso falla al cargarse (fail-safe), igual que JWT_SECRET.
// - Debe ser distinta de JWT_SECRET, larga y aleatoria. Si se cambia, los hash guardados dejan de coincidir.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const TSU_HMAC_KEY = process.env.TSU_HMAC_KEY;

if (typeof TSU_HMAC_KEY !== 'string' || TSU_HMAC_KEY.trim() === '') {
    throw new Error('TSU_HMAC_KEY no está definido. Configúralo en backend/.env antes de usar las rutas de administración.');
}
if (TSU_HMAC_KEY.length < 32) {
    throw new Error('TSU_HMAC_KEY debe tener al menos 32 caracteres (usa un valor largo y aleatorio).');
}
if (TSU_HMAC_KEY === process.env.JWT_SECRET) {
    throw new Error('TSU_HMAC_KEY no puede ser igual a JWT_SECRET.');
}

module.exports = { TSU_HMAC_KEY };

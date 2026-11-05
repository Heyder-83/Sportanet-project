// backend/config/adminJwt.js
// Secreto con el que se firman los JWT de los ADMINISTRADORES. Es independiente de JWT_SECRET a propósito:
// los tokens de usuario y de administrador no se pueden intercambiar. Si compartieran secreto, un token de
// administrador (cuyo id es un admin_id) pasaría la verificación del middleware de usuarios y se leería como el
// usuario con ese mismo número.
// - Carga .env (si existe) y exige ADMIN_JWT_SECRET. Sin valor por defecto: si falta, es corta o coincide con
//   JWT_SECRET o TSU_HMAC_KEY, el proceso falla al cargarse (fail-safe).
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;

if (typeof ADMIN_JWT_SECRET !== 'string' || ADMIN_JWT_SECRET.trim() === '') {
    throw new Error('ADMIN_JWT_SECRET no está definido. Configúralo en backend/.env antes de usar las rutas de administración.');
}
if (ADMIN_JWT_SECRET.length < 32) {
    throw new Error('ADMIN_JWT_SECRET debe tener al menos 32 caracteres (usa un valor largo y aleatorio).');
}
if (ADMIN_JWT_SECRET === process.env.JWT_SECRET) {
    throw new Error('ADMIN_JWT_SECRET no puede ser igual a JWT_SECRET: los tokens de usuario y de administrador deben ser distintos.');
}
if (ADMIN_JWT_SECRET === process.env.TSU_HMAC_KEY) {
    throw new Error('ADMIN_JWT_SECRET no puede ser igual a TSU_HMAC_KEY.');
}

module.exports = { ADMIN_JWT_SECRET };

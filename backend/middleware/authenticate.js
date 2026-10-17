// backend/middleware/authenticate.js
// Middleware de autenticación JWT con verificación del estado de la cuenta.
//
// Se exporta una FACTORY: createAuthenticate({ findUserById }).
// - findUserById(id) -> Promise<{ user_id, email, role, is_active, deleted_at } | null>
//   Se inyecta para poder probar el middleware sin MySQL (ver test/authenticate.test.js).
//   La instancia real, conectada al pool, está en middleware/requireAuth.js.
//
// Flujo:
//   1. Lee el token solo del header "Authorization: Bearer <token>".
//   2. Verifica firma y expiración con jwt.verify (algoritmo fijado a HS256).
//   3. Consulta la cuenta en la BD: un JWT firmado y vigente NO basta si la cuenta
//      fue desactivada (is_active = 0) o eliminada (deleted_at / fila inexistente).
//   4. La identidad sale ÚNICAMENTE del token validado + la fila de la BD, y queda en req.auth.
//      Nunca se debe usar un user_id enviado en body, query o params como identidad.
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/jwt');

function reject(res, code, message) {
    res.set('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ error: message, code });
}

function createAuthenticate({ findUserById } = {}) {
    if (typeof findUserById !== 'function') {
        // Falla al construir (arranque), no en la primera petición.
        throw new TypeError('createAuthenticate requiere { findUserById: function }');
    }

    return async function authenticate(req, res, next) {
        const header = req.headers.authorization;

        if (!header) {
            return reject(res, 'TOKEN_MISSING', 'Authentication token required');
        }

        const parts = header.split(' ');
        if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer' || !parts[1]) {
            return reject(res, 'TOKEN_MALFORMED', 'Authorization header must be: Bearer <token>');
        }

        let payload;
        try {
            payload = jwt.verify(parts[1], JWT_SECRET, { algorithms: ['HS256'] });
        } catch (err) {
            if (err.name === 'TokenExpiredError') {
                return reject(res, 'TOKEN_EXPIRED', 'Token expired');
            }
            return reject(res, 'TOKEN_INVALID', 'Invalid token');
        }

        // El payload emitido por auth.js es { id, email }, donde id = users.user_id.
        const userId = Number(payload.id);
        if (!Number.isInteger(userId) || userId <= 0) {
            return reject(res, 'TOKEN_INVALID', 'Invalid token');
        }

        // Estado real de la cuenta. Solo se llega aquí con un token ya válido.
        let user;
        try {
            user = await findUserById(userId);
        } catch (err) {
            // Se registra en el servidor; al cliente no se le devuelve el detalle.
            console.error('[authenticate] error consultando la cuenta:', err && err.code ? err.code : err);
            return res.status(500).json({ error: 'Internal error', code: 'DB_ERROR' });
        }

        // Fila inexistente = cuenta eliminada (el DELETE actual de /api/users es físico).
        if (!user || user.deleted_at) {
            return reject(res, 'ACCOUNT_DELETED', 'Account no longer exists');
        }
        if (Number(user.is_active) !== 1) {
            return reject(res, 'ACCOUNT_DISABLED', 'Account is disabled');
        }

        // Email y rol vienen de la BD (valor actual), no del token (valor al momento de emitirlo).
        req.auth = { userId, email: user.email, role: user.role };
        next();
    };
}

module.exports = createAuthenticate;
module.exports.createAuthenticate = createAuthenticate;

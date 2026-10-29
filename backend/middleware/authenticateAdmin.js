// backend/middleware/authenticateAdmin.js
// Middleware de autenticación de ADMINISTRADORES (SPN_AD). Gemelo de middleware/authenticate.js, pero:
//   - verifica con ADMIN_JWT_SECRET (un token de usuario no pasa y uno de administrador no pasa en /api/users);
//   - exige el claim typ = 'admin' y lee la identidad de aid (admins.admin_id);
//   - consulta SPN_AD en cada petición: un JWT vigente no basta si la cuenta se suspendió o ya no existe.
// Se exporta una FACTORY: createAuthenticateAdmin({ findAdminById }), inyectable para probarlo sin MySQL.
// La identidad queda en req.adminAuth (distinto de req.auth, que es la de los usuarios de la plataforma).
const jwt = require('jsonwebtoken');
const { ADMIN_JWT_SECRET } = require('../config/adminJwt');

function reject(res, code, message) {
    res.set('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ error: message, code });
}

function createAuthenticateAdmin({ findAdminById } = {}) {
    if (typeof findAdminById !== 'function') {
        throw new TypeError('createAuthenticateAdmin requiere { findAdminById: function }');
    }

    return async function authenticateAdmin(req, res, next) {
        const header = req.headers.authorization;
        if (!header) return reject(res, 'TOKEN_MISSING', 'Authentication token required');

        const parts = header.split(' ');
        if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer' || !parts[1]) {
            return reject(res, 'TOKEN_MALFORMED', 'Authorization header must be: Bearer <token>');
        }

        let payload;
        try {
            payload = jwt.verify(parts[1], ADMIN_JWT_SECRET, { algorithms: ['HS256'] });
        } catch (err) {
            if (err.name === 'TokenExpiredError') return reject(res, 'TOKEN_EXPIRED', 'Token expired');
            return reject(res, 'TOKEN_INVALID', 'Invalid token');
        }

        const adminId = Number(payload.aid);
        if (payload.typ !== 'admin' || !Number.isInteger(adminId) || adminId <= 0) {
            return reject(res, 'TOKEN_INVALID', 'Invalid token');
        }

        let admin;
        try {
            admin = await findAdminById(adminId);
        } catch (err) {
            console.error('[authenticateAdmin] error consultando la cuenta:', err && err.code ? err.code : 'sin código');
            return res.status(500).json({ error: 'Internal error', code: 'DB_ERROR' });
        }

        if (!admin) return reject(res, 'ADMIN_NOT_FOUND', 'Admin account no longer exists');
        if (admin.status !== 'active') return reject(res, 'ADMIN_SUSPENDED', 'Admin account is not active');

        // El nombre viene de la BD (valor actual), no del token.
        req.adminAuth = { adminId, fullName: admin.full_name };
        next();
    };
}

module.exports = createAuthenticateAdmin;
module.exports.createAuthenticateAdmin = createAuthenticateAdmin;

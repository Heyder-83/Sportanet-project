// backend/middleware/authenticate.js
// Middleware de autenticación JWT.
// - Lee el token solo del header "Authorization: Bearer <token>".
// - Verifica firma y expiración con jwt.verify (algoritmo fijado a HS256).
// - La identidad sale ÚNICAMENTE del token validado y queda en req.auth.
//   Nunca se debe usar un user_id enviado en body, query o params como identidad.
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/jwt');

function reject(res, code, message) {
    res.set('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ error: message, code });
}

function authenticate(req, res, next) {
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

    req.auth = { userId, email: payload.email };
    next();
}

module.exports = authenticate;

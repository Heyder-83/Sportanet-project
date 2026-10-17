// backend/middleware/authorize.js
// Autorización por rol y por propiedad. Se usa SIEMPRE después de authenticate (middleware/requireAuth),
// que deja { userId, email, role } en req.auth leído de la BD. Nada de esto se decide en el frontend.
//
//   router.use(authenticate);
//   router.get('/',    requireRole('Admin'), ...);
//   router.get('/:id', parseIdParam, requireSelfOrAdmin, ...);

const ROLES = Object.freeze({ PARTICIPANT: 'Participant', ORGANIZER: 'Organizer', ADMIN: 'Admin' });
const MAX_INT = 2147483647; // columnas `int` de MySQL

function unauthenticated(res) {
    res.set('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ error: 'Authentication required', code: 'TOKEN_MISSING' });
}

function forbidden(res) {
    return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
}

// Permite el paso solo a los roles indicados.
function requireRole(...allowed) {
    return function requireRoleMiddleware(req, res, next) {
        if (!req.auth) return unauthenticated(res); // se montó sin authenticate: falla cerrado
        if (!allowed.includes(req.auth.role)) return forbidden(res);
        next();
    };
}

// Valida :id (entero positivo) y lo deja en req.targetId como número.
function parseIdParam(req, res, next) {
    const raw = req.params.id;
    const id = typeof raw === 'string' && /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(id) || id > MAX_INT) {
        return res.status(400).json({ error: 'Invalid user id', code: 'INVALID_ID' });
    }
    req.targetId = id;
    next();
}

// El propio usuario (req.auth.userId === :id) o un Admin. Requiere parseIdParam antes.
function requireSelfOrAdmin(req, res, next) {
    if (!req.auth) return unauthenticated(res);
    if (!Number.isInteger(req.targetId)) {
        // Error de programación (falta parseIdParam): fallo ruidoso en lugar de autorizar sin comprobar.
        throw new Error('requireSelfOrAdmin requiere parseIdParam antes en la cadena de middlewares');
    }
    if (req.auth.role === ROLES.ADMIN || req.auth.userId === req.targetId) return next();
    return forbidden(res);
}

module.exports = { ROLES, requireRole, parseIdParam, requireSelfOrAdmin };

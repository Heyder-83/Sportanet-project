// backend/routes/users.js
// Gestión de cuentas. TODAS las rutas exigen sesión (JWT + cuenta activa); los permisos se comprueban aquí,
// no en el frontend.
//
//   GET    /api/users       Admin            lista de usuarios no eliminados
//   GET    /api/users/:id   propio o Admin   un usuario
//   POST   /api/users       Admin            crea un usuario (rol Participant; la contraseña se hashea)
//   PUT    /api/users/:id   propio o Admin   full_name, email, phone, pwd (el resto del body se ignora)
//   DELETE /api/users/:id   propio o Admin   borrado lógico (is_active = 0, deleted_at = NOW())
//
// role e is_active nunca se leen del body. Nunca se devuelve pwd.
const express = require('express');
const bcrypt = require('bcrypt');

const router = express.Router();
const authenticate = require('../middleware/requireAuth');
const { ROLES, requireRole, parseIdParam, requireSelfOrAdmin } = require('../middleware/authorize');
const users = require('../db/users');

router.use(authenticate);

// ---------------------------------------------------------------------------
// Validación (mismas reglas de formato de email que el frontend)
// ---------------------------------------------------------------------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isString = (v) => typeof v === 'string';

const validators = {
    full_name: (v) => isString(v) && v.trim().length >= 1 && v.trim().length <= 100,
    email: (v) => isString(v) && v.trim().length <= 100 && EMAIL_RE.test(v.trim()),
    phone: (v) => isString(v) && v.trim().length >= 1 && v.trim().length <= 20,
    // bcrypt ignora en silencio todo lo que pase de 72 bytes: se rechaza en lugar de truncar.
    pwd: (v) => isString(v) && v.length >= 1 && Buffer.byteLength(v, 'utf8') <= 72
};

// Devuelve { data, invalid }. Con requireAll todos los campos son obligatorios (creación);
// si no, solo se validan los presentes. Compatibilidad con la versión anterior: en una
// actualización, pwd vacío o null significa "no cambiar la contraseña".
function validateBody(body, { requireAll }) {
    const src = body && typeof body === 'object' ? body : {};
    const data = {};
    const invalid = [];

    for (const field of ['full_name', 'email', 'phone', 'pwd']) {
        let value = src[field];
        if (field === 'pwd' && !requireAll && (value === '' || value === null)) value = undefined;
        if (value === undefined) {
            if (requireAll) invalid.push(field);
            continue;
        }
        if (!validators[field](value)) {
            invalid.push(field);
            continue;
        }
        data[field] = field === 'pwd' ? value : value.trim();
    }
    return { data, invalid };
}

function badRequest(res, invalid) {
    return res.status(400).json({
        error: `Invalid or missing fields: ${invalid.join(', ')}`,
        code: 'VALIDATION_ERROR',
        fields: invalid
    });
}

// Errores de BD: duplicados con mensaje claro; el resto se registra SIN el SQL (el objeto de error de
// mysql2 incluye la consulta con los valores, p. ej. el hash) y al cliente le llega un mensaje genérico.
function dbFail(err, res) {
    if (err && err.code === 'ER_DUP_ENTRY') {
        // Se mira el NOMBRE de la clave, no el texto: un email como "phone@x.com" también contiene "phone".
        const key = ((String(err.sqlMessage || '').match(/for key '([^']+)'/) || [])[1]) || '';
        if (/(^|\.)email$/.test(key)) return res.status(409).json({ error: 'Email already registered', code: 'EMAIL_TAKEN' });
        if (/(^|\.)phone$/.test(key)) return res.status(409).json({ error: 'Phone already registered', code: 'PHONE_TAKEN' });
        return res.status(409).json({ error: 'Duplicate value', code: 'DUPLICATE' });
    }
    console.error('[users] error de BD:', err && err.code ? err.code : 'sin código');
    return res.status(500).json({ error: 'Internal error', code: 'DB_ERROR' });
}

const notFound = (res) => res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

// Listar usuarios (GET /api/users) — solo Admin
router.get('/', requireRole(ROLES.ADMIN), async (req, res) => {
    try {
        res.json(await users.listActiveUsers());
    } catch (err) {
        dbFail(err, res);
    }
});

// Obtener un usuario (GET /api/users/:id) — propio o Admin
// Devuelve un objeto (antes devolvía un array de una fila); el frontend no usa esta ruta.
router.get('/:id', parseIdParam, requireSelfOrAdmin, async (req, res) => {
    try {
        const user = await users.findPublicUserById(req.targetId);
        if (!user) return notFound(res);
        res.json(user);
    } catch (err) {
        dbFail(err, res);
    }
});

// Crear usuario (POST /api/users) — solo Admin
// Para el registro público usa POST /api/auth/register. Aquí la contraseña también se hashea.
router.post('/', requireRole(ROLES.ADMIN), async (req, res) => {
    const { data, invalid } = validateBody(req.body, { requireAll: true });
    if (invalid.length) return badRequest(res, invalid);

    try {
        const pwdHash = await bcrypt.hash(data.pwd, 10);
        const userId = await users.createUser({
            full_name: data.full_name,
            email: data.email,
            phone: data.phone,
            pwdHash
        });
        res.status(201).json({ message: 'User created', user_id: userId });
    } catch (err) {
        dbFail(err, res);
    }
});

// Actualizar usuario (PUT /api/users/:id) — propio o Admin
// Solo full_name, email, phone y pwd. Cualquier otra clave del body (role, is_active...) se ignora.
router.put('/:id', parseIdParam, requireSelfOrAdmin, async (req, res) => {
    const { data, invalid } = validateBody(req.body, { requireAll: false });
    if (invalid.length) return badRequest(res, invalid);
    if (Object.keys(data).length === 0) {
        return res.status(400).json({ error: 'No fields provided to update', code: 'NO_FIELDS' });
    }

    try {
        if (!(await users.findPublicUserById(req.targetId))) return notFound(res);
        if (data.pwd !== undefined) data.pwd = await bcrypt.hash(data.pwd, 10);
        await users.updateUser(req.targetId, data);
        res.json({ message: 'User updated', user: await users.findPublicUserById(req.targetId) });
    } catch (err) {
        dbFail(err, res);
    }
});

// Eliminar usuario (DELETE /api/users/:id) — propio o Admin
// Borrado lógico: se conservan la fila, su perfil y sus inscripciones (historial). Tras esto el token del
// usuario deja de valer (ACCOUNT_DELETED) y no puede iniciar sesión. Su email y teléfono siguen reservados.
router.delete('/:id', parseIdParam, requireSelfOrAdmin, async (req, res) => {
    try {
        const affected = await users.softDeleteUser(req.targetId);
        if (affected === 0) return notFound(res);
        res.json({ message: 'User deleted' });
    } catch (err) {
        dbFail(err, res);
    }
});

module.exports = router;

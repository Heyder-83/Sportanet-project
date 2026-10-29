// backend/routes/adminAuth.js
// Cuentas de administración (SPN_AD, base aparte). SPNdev.1-2: sin 2FA todavía.
//
//   POST /api/admin/register   full_name, pwd, tsu   -> crea la cuenta con un TSU de la lista de reserva
//   POST /api/admin/login      admin_id, pwd         -> JWT de administrador (30 min) si las credenciales son válidas
//   GET  /api/admin/me         (requiere token admin) -> identidad leída de SPN_AD
//
// - Los administradores NO existen en `users` ni tienen rol en la plataforma: viven solo en SPN_AD.
// - El TSU se valida (formato) y se comprueba que esté en la lista ANTES de gastar bcrypt; si no está, o ya se
//   usó, la respuesta es la misma (403 TSU_INVALID): no se revela cuál de los dos casos es.
// - Solo se leen los 3 campos conocidos: status, admin_id, tsu_hash, etc. del body se ignoran.
// - register no emite token: la sesión se obtiene con login.
// - login: identifica por admin_id (el nombre no es único). Máximo 5 intentos fallidos por cuenta; al quinto la
//   cuenta se bloquea 15 minutos y se escribe una alerta en el log del sistema. Cada intento se anota en
//   admin_logins (fecha y hora y resultado; sin IP). Credenciales inexistentes, incorrectas o de una cuenta aún
//   no activada dan la misma respuesta 401.
// - El token se firma con ADMIN_JWT_SECRET (distinto de JWT_SECRET): no sirve en /api/users ni /api/auth.
const express = require('express');
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const router = express.Router();
const admins = require('../db/admins');
const { validators, badRequest } = require('../utils/userInput');
const { isValidTsuFormat, hashTsu } = require('../utils/tsu');
const dbFail = require('../utils/dbFail');
const alerts = require('../utils/adminAlerts');
const authenticateAdmin = require('../middleware/requireAdminAuth');
const { ADMIN_JWT_SECRET } = require('../config/adminJwt');

const BCRYPT_ROUNDS = 10;
const MAX_ATTEMPTS = 5;      // intentos fallidos por cuenta antes de bloquear
const LOCK_MINUTES = 15;     // duración del bloqueo
const TOKEN_TTL = '30m';     // sesión corta: los administradores tienen privilegios

// Hash de una contraseña que nadie conoce: se compara contra él cuando el id no existe o la cuenta aún no está
// activa, para que la respuesta tarde lo mismo y el tiempo no revele qué ids tienen cuenta.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), BCRYPT_ROUNDS);

const issueAdminToken = (adminId) => jwt.sign({ aid: adminId, typ: 'admin' }, ADMIN_JWT_SECRET, { algorithm: 'HS256', expiresIn: TOKEN_TTL });

// admin_id: entero positivo, como número o como texto de dígitos (un formulario lo envía como texto).
const parseAdminId = (v) => {
    if (typeof v === 'number') return Number.isSafeInteger(v) && v > 0 && v <= 2147483647 ? v : null;
    if (typeof v === 'string' && /^[1-9]\d{0,9}$/.test(v) && Number(v) <= 2147483647) return Number(v);
    return null;
};

const tsuInvalid = (res) => res.status(403).json({ error: 'Invalid or already used TSU', code: 'TSU_INVALID' });

router.post('/register', async (req, res) => {
    const src = req.body && typeof req.body === 'object' ? req.body : {};
    const invalid = [];
    if (!validators.full_name(src.full_name)) invalid.push('full_name');
    if (!validators.pwd(src.pwd)) invalid.push('pwd');
    if (!isValidTsuFormat(src.tsu)) invalid.push('tsu');
    if (invalid.length) return badRequest(res, invalid);

    const full_name = src.full_name.trim();
    const tsu = src.tsu;

    try {
        if (!(await admins.tsuIsAvailable(tsu))) return tsuInvalid(res);

        const pwdHash = await bcrypt.hash(src.pwd, BCRYPT_ROUNDS);
        const adminId = await admins.createAdminWithTsu({ tsu, tsuHash: hashTsu(tsu), full_name, pwdHash });
        if (adminId === null) return tsuInvalid(res); // otra petición lo usó entre la comprobación y la asignación

        res.status(201).json({
            message: 'Admin account created',
            admin: { id: adminId, full_name }
        });
    } catch (err) {
        dbFail(err, res, 'admin');
    }
});

router.post('/login', async (req, res) => {
    const src = req.body && typeof req.body === 'object' ? req.body : {};
    const adminId = parseAdminId(src.admin_id);
    const invalid = [];
    if (adminId === null) invalid.push('admin_id');
    if (!validators.pwd(src.pwd)) invalid.push('pwd');
    if (invalid.length) return badRequest(res, invalid);

    try {
        const attempt = await admins.reserveLoginAttempt(adminId, { maxAttempts: MAX_ATTEMPTS, lockMinutes: LOCK_MINUTES });

        if (attempt.state === 'locked') {
            await admins.recordLoginBlocked(adminId);
            res.set('Retry-After', String(attempt.retryAfterSeconds));
            return res.status(429).json({
                error: 'Admin account temporarily locked',
                code: 'ADMIN_LOCKED',
                retry_after_seconds: attempt.retryAfterSeconds
            });
        }

        // Siempre se ejecuta una comparación (contra un hash falso si no hay cuenta que comparar).
        const hash = attempt.state === 'ok' && attempt.admin.pwd ? attempt.admin.pwd : DUMMY_HASH;
        const match = await bcrypt.compare(src.pwd, hash);

        if (attempt.state !== 'ok' || !match) {
            if (attempt.state === 'ok') {
                await admins.recordLoginFailure(adminId, { locking: attempt.locking });
                alerts.loginFailed(adminId, attempt.attempts, MAX_ATTEMPTS);
                if (attempt.locking) alerts.accountLocked(adminId, LOCK_MINUTES);
            }
            return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
        }

        // Contraseña correcta pero cuenta suspendida: se comprueba DESPUÉS de bcrypt para no revelar el estado de
        // cuentas ajenas, y no se emite token.
        if (attempt.admin.status !== 'active') {
            await admins.recordLoginBlocked(adminId);
            return res.status(403).json({ error: 'Admin account is suspended', code: 'ADMIN_SUSPENDED' });
        }

        await admins.recordLoginSuccess(adminId);
        alerts.loginOk(adminId);
        res.json({
            message: 'Login successful',
            token: issueAdminToken(adminId),
            admin: { id: adminId, full_name: attempt.admin.full_name }
        });
    } catch (err) {
        dbFail(err, res, 'admin');
    }
});

router.get('/me', authenticateAdmin, (req, res) => {
    res.json({ id: req.adminAuth.adminId, full_name: req.adminAuth.fullName });
});

module.exports = router;

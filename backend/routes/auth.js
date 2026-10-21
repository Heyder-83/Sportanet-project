// backend/routes/auth.js
// Registro, inicio de sesión y verificación de sesión.
//
//   POST /api/auth/register  full_name, email, phone, pwd, account_type? -> crea una cuenta Atleta u Organizador y emite un JWT
//   POST /api/auth/login     email, pwd                    -> emite un JWT si las credenciales y la cuenta son válidas
//   GET  /api/auth/me        (requiere sesión)             -> identidad leída de la BD
//
// - Todo lo que llega en el body se valida (tipo, longitud y formato) ANTES de tocar bcrypt o la BD.
// - Solo se leen los campos conocidos; role e is_active nunca salen del body (los privilegios no se
//   conceden desde el formulario público: PROJECT_LOGIC §3.3).
// - Los errores de BD no llegan al cliente (utils/dbFail.js): duplicados 409 con código; el resto, 500 genérico.
const express = require('express');
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const router = express.Router();
const { JWT_SECRET } = require('../config/jwt'); // sin secreto por defecto: falla si falta JWT_SECRET
const authenticate = require('../middleware/requireAuth'); // authenticate ya conectado a la BD (verifica is_active/deleted_at)
const users = require('../db/users');
const accounts = require('../db/accounts');
const { validateBody, validateLogin, resolveAccountType, badRequest } = require('../utils/userInput');
const dbFail = require('../utils/dbFail');

const BCRYPT_ROUNDS = 10;

// Hash de una contraseña aleatoria que nadie conoce. Cuando el correo del login no existe se compara contra
// él para que la respuesta tarde lo mismo que con un correo registrado: si no, el tiempo de respuesta
// revelaría qué correos tienen cuenta. Debe usar el mismo coste (BCRYPT_ROUNDS) que los hashes reales.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), BCRYPT_ROUNDS);

const issueToken = (userId, email) => jwt.sign({ id: userId, email }, JWT_SECRET, { expiresIn: '7d' });

// Creacion de usuario (REGISTER):
// - Recibe full_name, email, phone, pwd (los cuatro obligatorios y válidos; ver utils/userInput.js)
// - Hashea la contraseña con bcrypt
// - account_type: 'Atleta' (por defecto) -> Participant; 'Organizador' -> Organizer, y en la misma transacción se
//   crea su fila en event_organizers con el nombre del usuario. Cualquier otro valor (incluido 'Admin') es 400.
// - Genera y devuelve un JWT junto al objeto usuario
// - Email o teléfono ya registrados: 409 EMAIL_TAKEN / PHONE_TAKEN (la restricción UNIQUE de la BD decide,
//   también cuando dos registros idénticos llegan a la vez)
router.post('/register', async (req, res) => {
    const { data, invalid } = validateBody(req.body, { requireAll: true });
    const role = resolveAccountType(req.body && typeof req.body === 'object' ? req.body.account_type : undefined);
    if (!role) invalid.push('account_type');
    if (invalid.length) return badRequest(res, invalid);

    try {
        const pwdHash = await bcrypt.hash(data.pwd, BCRYPT_ROUNDS);
        const userId = await accounts.createAccount({
            full_name: data.full_name,
            email: data.email,
            phone: data.phone,
            pwdHash,
            role
        });

        res.json({
            message: 'User registered successfully',
            // Payload mínimo: id y email. El token permite que el cliente se autentique en peticiones posteriores.
            token: issueToken(userId, data.email),
            user: {
                id: userId,
                full_name: data.full_name,
                email: data.email,
                phone: data.phone,
                role
            }
        });
    } catch (err) {
        dbFail(err, res, 'auth');
    }
});

// Inicio de sesión (LOGIN):
// - Recibe email y pwd (texto no vacío; cualquier otro tipo es 400)
// - Busca usuario por email y compara el hash con bcrypt (siempre se ejecuta una comparación)
// - Si coincide y la cuenta está habilitada, genera y devuelve JWT y datos públicos del usuario
router.post('/login', async (req, res) => {
    const creds = validateLogin(req.body);
    if (!creds) {
        return res.status(400).json({ error: 'Missing email or password', code: 'VALIDATION_ERROR' });
    }

    try {
        const user = await users.findAuthUserByEmail(creds.email);

        // Comparar contraseñas usando bcrypt (contra un hash falso si el correo no existe)
        const match = await bcrypt.compare(creds.pwd, user ? user.pwd : DUMMY_HASH);
        if (!user || !match) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Credenciales correctas pero cuenta no habilitada: no se emite token.
        // Se comprueba DESPUÉS de bcrypt para no revelar el estado de cuentas ajenas.
        if (user.deleted_at) {
            return res.status(403).json({ error: 'Account no longer exists', code: 'ACCOUNT_DELETED' });
        }
        if (Number(user.is_active) !== 1) {
            return res.status(403).json({ error: 'Account is disabled', code: 'ACCOUNT_DISABLED' });
        }

        // Generar token JWT (emisión tras autenticación correcta)
        res.json({
            message: 'Login successful',
            token: issueToken(user.user_id, user.email),
            user: {
                id: user.user_id,
                full_name: user.full_name,
                email: user.email,
                phone: user.phone,
                role: user.role
            }
        });
    } catch (err) {
        dbFail(err, res, 'auth');
    }
});

// Verificación de sesión (GET /api/auth/me):
// - Ruta protegida mínima para probar el middleware.
// - El middleware ya consultó la cuenta en la BD (activa y no eliminada); aquí solo se devuelve su identidad.
router.get('/me', authenticate, (req, res) => {
    res.json({ id: req.auth.userId, email: req.auth.email, role: req.auth.role });
});

module.exports = router;

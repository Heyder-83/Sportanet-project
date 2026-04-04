// backend/routes/users.js
const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const router = express.Router();
const pool = require('../db/connection');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'Token no proporcionado' });

    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Formato de autorización inválido' });

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ error: 'Token inválido o expirado' });
        req.user = decoded;
        next();
    });
}

// Obtener todos los usuarios (GET /api/users)
// No expone contraseñas hashed
router.get('/', (req, res) => {
    pool.query('SELECT user_id, full_name, email, phone FROM users', (err, rows) => {
        if (err) return res.status(500).json({ error: err });
        res.json(rows);
    });
});

// Obtener usuario por ID (GET /api/users/:id)
// Devuelve los datos públicos del usuario sin contraseña
router.get('/:id', authenticateToken, (req, res) => {
    if (req.user.id !== parseInt(req.params.id, 10)) {
        return res.status(403).json({ error: 'No autorizado para acceder a este usuario' });
    }

    pool.query(
        'SELECT user_id, full_name, email, phone FROM users WHERE user_id = ?',
        [req.params.id],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err });
            res.json(rows);
        }
    );
});

// Creacion de usuario (POST /api/users)
<<<<<<< HEAD
// Hashea la contraseña y valida campos antes de insertar
router.post('/', async (req, res) => {
    const { full_name, email, phone, pwd } = req.body;

    if (!full_name || !email || !phone || !pwd) {
        return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }
=======
// Nota: este endpoint inserta directamente los datos recibidos. Usar preferentemente /api/auth/register para hashing de pwd.
router.post('/', (req, res) => {
    const { userType, full_name, email, phone, pwd } = req.body;

    const data = { userType, full_name, email, phone, pwd };
>>>>>>> 6a9504fad6c9d99c08a9782717a4a63b074794de

    try {
        const hashedPwd = await bcrypt.hash(pwd, 10);
        const data = { full_name, email, phone, pwd: hashedPwd };

        pool.query('INSERT INTO users SET ?', data, (err, result) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(400).json({ error: 'El correo ya está registrado' });
                }
                return res.status(500).json({ error: err.message || err });
            }
            res.json({ message: 'User created', user_id: result.insertId });
        });
    } catch (error) {
        res.status(500).json({ error: 'Error hashing password' });
    }
});

// Actualizar usuario (PUT /api/users/:id)
// - Solo incluye en el UPDATE los campos enviados en el body
// - Si viene pwd no vacío, se hashea antes de guardar
router.put('/:id', authenticateToken, (req, res) => {
    if (req.user.id !== parseInt(req.params.id, 10)) {
        return res.status(403).json({ error: 'No autorizado para modificar este usuario' });
    }

    (async () => {
        try {
<<<<<<< HEAD
            const { full_name, email, phone, pwd } = req.body;
=======
            const { userType, full_name, email, phone, pwd } = req.body;

            // Build update object only with provided fields
>>>>>>> 6a9504fad6c9d99c08a9782717a4a63b074794de
            const data = {};
            if (typeof userType !== 'undefined') data.userType = userType;
            if (typeof full_name !== 'undefined') data.full_name = full_name;
            if (typeof email !== 'undefined') data.email = email;
            if (typeof phone !== 'undefined') data.phone = phone;

            if (typeof pwd !== 'undefined' && pwd !== null && pwd !== '') {
                data.pwd = await bcrypt.hash(pwd, 10);
            }

            if (Object.keys(data).length === 0) {
                return res.status(400).json({ error: 'No fields provided to update' });
            }

            pool.query(
                'UPDATE users SET ? WHERE user_id = ?',
                [data, req.params.id],
                (err) => {
                    if (err) return res.status(500).json({ error: err });
                    res.json({ message: 'User updated' });
                }
            );
        } catch (error) {
            res.status(500).json({ error: error.message || error });
        }
    })();
});

// Eliminar usuario (DELETE /api/users/:id)
// - Para evitar violaciones de FK, se eliminan primero filas en user_profile relacionadas
router.delete('/:id', authenticateToken, (req, res) => {
    const userId = req.params.id;

    if (req.user.id !== parseInt(userId, 10)) {
        return res.status(403).json({ error: 'No autorizado para eliminar este usuario' });
    }

    const deleteUser = () => {
        pool.query('DELETE FROM users WHERE user_id = ?', [userId], (err2) => {
            if (err2) return res.status(500).json({ error: err2 });
            res.json({ message: 'User deleted' });
        });
    };

    pool.query('DELETE FROM user_profile WHERE user_id = ?', [userId], (err1) => {
        if (err1 && err1.code !== 'ER_NO_SUCH_TABLE') {
            return res.status(500).json({ error: err1 });
        }

        deleteUser();
    });
});

module.exports = router;

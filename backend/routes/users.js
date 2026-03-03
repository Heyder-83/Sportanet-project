// backend/routes/users.js
const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const bcrypt = require('bcrypt');

// Obtener todos los usuarios (GET /api/users)
// Nota: ruta pública actualmente; añadir middleware de autenticación si debe ser protegida
router.get('/', (req, res) => {
    pool.query('SELECT * FROM users', (err, rows) => {
        if (err) return res.status(500).json({ error: err });
        res.json(rows);
    });
});

// Obtener usuario por ID (GET /api/users/:id)
// Devuelve la fila completa del usuario (incluye campo pwd hashed en DB)
router.get('/:id', (req, res) => {
    pool.query('SELECT * FROM users WHERE user_id = ?', [req.params.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err });
        res.json(rows);
    });
});

// Creacion de usuario (POST /api/users)
// Nota: este endpoint inserta directamente los datos recibidos. Usar preferentemente /api/auth/register para hashing de pwd.
router.post('/', (req, res) => {
    const { userType, full_name, email, phone, pwd } = req.body;

    const data = { userType, full_name, email, phone, pwd };

    pool.query('INSERT INTO users SET ?', data, (err, result) => {
        if (err) return res.status(500).json({ error: err });
        res.json({ message: 'User created', user_id: result.insertId });
    });
});

// Actualizar usuario (PUT /api/users/:id)
// - Solo incluye en el UPDATE los campos enviados en el body
// - Si viene pwd no vacío, se hashea antes de guardar
router.put('/:id', (req, res) => {
    (async () => {
        try {
            const { userType, full_name, email, phone, pwd } = req.body;

            // Build update object only with provided fields
            const data = {};
            if (typeof userType !== 'undefined') data.userType = userType;
            if (typeof full_name !== 'undefined') data.full_name = full_name;
            if (typeof email !== 'undefined') data.email = email;
            if (typeof phone !== 'undefined') data.phone = phone;

            // If password provided and not empty, hash it and include
            if (typeof pwd !== 'undefined' && pwd !== null && pwd !== '') {
                const hashed = await bcrypt.hash(pwd, 10);
                data.pwd = hashed;
            }

            // Si no se envían campos, responder Bad Request
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
router.delete('/:id', (req, res) => {
    const userId = req.params.id;

    // Eliminar registros dependientes en user_profile
    pool.query(
        'DELETE FROM user_profile WHERE user_id = ?',
        [userId],
        (err1) => {
            if (err1) {
                console.error('Error deleting user_profile:', err1);
                // Continuar para intentar eliminar el usuario
            }

            // Luego eliminar el usuario
            pool.query(
                'DELETE FROM users WHERE user_id = ?',
                [userId],
                (err2) => {
                    if (err2) return res.status(500).json({ error: err2 });
                    res.json({ message: 'User deleted' });
                }
            );
        }
    );
});

module.exports = router;

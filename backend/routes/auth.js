// backend/routes/auth.js
const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Creacion de usuario (REGISTER):
// - Recibe full_name, email, phone, pwd
// - Hashea la contraseña con bcrypt
// - Inserta el usuario en la base de datos
// - Genera y devuelve un JWT junto al objeto usuario
router.post('/register', async (req, res) => {
    const { userType, full_name, email, phone, pwd } = req.body;

    if (!userType || !full_name || !email || !phone || !pwd) {
        return res.status(400).json({ error: 'Missing fields' });
    }

    try {
        const hashedPwd = await bcrypt.hash(pwd, 10);

        const userData = {
            userType,
            full_name,
            email,
            phone,
            pwd: hashedPwd
        };

        pool.query('INSERT INTO users SET ?', userData, (err, result) => {
            if (err) {
                // Manejar error de email duplicado
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(400).json({ error: 'Email already registered' });
                }
                return res.status(500).json({ error: err.message });
            }

            // Generar token JWT (emisión)
            // Payload mínimo: id y email. El token permite que el cliente se autentique en peticiones posteriores.
            const token = jwt.sign(
                { id: result.insertId, email },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            res.json({
                message: 'User registered successfully',
                token,
                user: {
                    id: result.insertId,
                    userType,
                    full_name,
                    email,
                    phone
                }
            });
        });

    } catch (error) {
        res.status(500).json({ error: 'Error encrypting password' });
    }
});

// Inicio de sesión (LOGIN):
// - Recibe email y pwd
// - Busca usuario por email, compara hash con bcrypt
// - Si coincide, genera y devuelve JWT y datos públicos del usuario
router.post('/login', (req, res) => {
    const { email, pwd } = req.body;

    if (!email || !pwd) {
        return res.status(400).json({ error: 'Missing email or password' });
    }

    pool.query(
        'SELECT * FROM users WHERE email = ?',
        [email],
        async (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });

            if (rows.length === 0) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const user = rows[0];

            // Comparar contraseñas usando bcrypt
            const match = await bcrypt.compare(pwd, user.pwd);
            if (!match) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            // Generar token JWT (emisión tras autenticación correcta)
            const token = jwt.sign(
                { id: user.user_id, email: user.email },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            res.json({
                message: 'Login successful',
                token,
                user: {
                    id: user.user_id,
                    userType: user.userType,
                    full_name: user.full_name,
                    email: user.email,
                    phone: user.phone
                }
            });
        }
    );
});

module.exports = router;

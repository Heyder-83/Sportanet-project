// backend/routes/auth.js
const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const bcrypt = require('bcrypt');

// REGISTER (con contraseña encriptada)
router.post('/register', async (req, res) => {
    const { full_name, email, phone, pwd } = req.body;

    if (!full_name || !email || !phone || !pwd) {
        return res.status(400).json({ error: 'Missing fields' });
    }

    try {
        const hashedPwd = await bcrypt.hash(pwd, 10);

        const userData = {
            full_name,
            email,
            phone,
            pwd: hashedPwd
        };

        pool.query('INSERT INTO users SET ?', userData, (err, result) => {
            if (err) return res.status(500).json({ error: err });

            res.json({
                message: 'User registered',
                user_id: result.insertId
            });
        });

    } catch (error) {
        res.status(500).json({ error: 'Error encrypting password' });
    }
});

// LOGIN (comparando hash con bcrypt)
router.post('/login', (req, res) => {
    const { email, pwd } = req.body;

    if (!email || !pwd) {
        return res.status(400).json({ error: 'Missing email or password' });
    }

    pool.query(
        'SELECT * FROM users WHERE email = ?',
        [email],
        async (err, rows) => {
            if (err) return res.status(500).json({ error: err });

            if (rows.length === 0) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const user = rows[0];

            // Compare passwords
            const match = await bcrypt.compare(pwd, user.pwd);
            if (!match) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            res.json({
                message: 'Login successful',
                user: {
                    id: user.user_id,
                    full_name: user.full_name,
                    email: user.email
                }
            });
        }
    );
});

module.exports = router;

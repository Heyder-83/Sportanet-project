// backend/routes/users.js
const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const bcrypt = require('bcrypt');

// GET all users
router.get('/', (req, res) => {
    pool.query('SELECT * FROM users', (err, rows) => {
        if (err) return res.status(500).json({ error: err });
        res.json(rows);
    });
});

// GET user by ID
router.get('/:id', (req, res) => {
    pool.query('SELECT * FROM users WHERE user_id = ?', [req.params.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err });
        res.json(rows);
    });
});

// POST create user
router.post('/', (req, res) => {
    const { full_name, email, phone, pwd } = req.body;

    const data = { full_name, email, phone, pwd };

    pool.query('INSERT INTO users SET ?', data, (err, result) => {
        if (err) return res.status(500).json({ error: err });
        res.json({ message: 'User created', user_id: result.insertId });
    });
});

// PUT update user
router.put('/:id', (req, res) => {
    (async () => {
        try {
            const { full_name, email, phone, pwd } = req.body;

            // Build update object only with provided fields
            const data = {};
            if (typeof full_name !== 'undefined') data.full_name = full_name;
            if (typeof email !== 'undefined') data.email = email;
            if (typeof phone !== 'undefined') data.phone = phone;

            // If password provided and not empty, hash it and include
            if (typeof pwd !== 'undefined' && pwd !== null && pwd !== '') {
                const hashed = await bcrypt.hash(pwd, 10);
                data.pwd = hashed;
            }

            // If no fields to update, return bad request
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

// DELETE user
router.delete('/:id', (req, res) => {
    const userId = req.params.id;

    // First delete user_profile records that reference this user
    pool.query(
        'DELETE FROM user_profile WHERE user_id = ?',
        [userId],
        (err1) => {
            if (err1) {
                console.error('Error deleting user_profile:', err1);
                // Continue anyway - user_profile might not exist
            }

            // Then delete the user
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

// backend/routes/users.js
const express = require('express');
const router = express.Router();
const pool = require('../db/connection');

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
    const data = req.body;
    pool.query('INSERT INTO users SET ?', data, (err, result) => {
        if (err) return res.status(500).json({ error: err });
        res.json({ message: 'User created', user_id: result.insertId });
    });
});

// PUT update user
router.put('/:id', (req, res) => {
    const data = req.body;
    pool.query(
        'UPDATE users SET ? WHERE user_id = ?',
        [data, req.params.id],
        (err) => {
            if (err) return res.status(500).json({ error: err });
            res.json({ message: 'User updated' });
        }
    );
});

// DELETE user
router.delete('/:id', (req, res) => {
    pool.query(
        'DELETE FROM users WHERE user_id = ?',
        [req.params.id],
        (err) => {
            if (err) return res.status(500).json({ error: err });
            res.json({ message: 'User deleted' });
        }
    );
});

module.exports = router;

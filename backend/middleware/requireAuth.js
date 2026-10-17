// backend/middleware/requireAuth.js
// Instancia lista para usar de authenticate, conectada a MySQL.
// Las rutas importan ESTE archivo; los tests importan la factory de ./authenticate con un findUserById falso.
const createAuthenticate = require('./authenticate');
const { findUserById } = require('../db/users');

module.exports = createAuthenticate({ findUserById });

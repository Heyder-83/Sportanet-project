// backend/middleware/requireAdminAuth.js
// Instancia lista para usar de authenticateAdmin, conectada a SPN_AD.
// Las rutas importan ESTE archivo; los tests importan la factory de ./authenticateAdmin con un findAdminById falso.
const createAuthenticateAdmin = require('./authenticateAdmin');
const { findAdminById } = require('../db/admins');

module.exports = createAuthenticateAdmin({ findAdminById });

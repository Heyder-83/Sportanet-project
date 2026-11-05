// backend/routes/events.js
// Consulta y publicación de eventos. Los permisos se comprueban aquí, no en el frontend.
//
//   GET  /api/events      público         eventos Published y Public, por fecha de inicio (?limit=1..100&offset=0)
//   GET  /api/events/:id  público         un evento Published y Public (cualquier otro caso: 404)
//   POST /api/events      solo Organizer  crea un evento y lo publica (con recinto nuevo o existente)
//
// Admin NO puede crear eventos todavía: las cuentas de administración (SPN_AD, Fase 1F) aún no tienen
// middleware de autorización en la aplicación principal, y users.role = 'Admin' no tiene un organizador asociado
// al que atribuir el evento. No hay atajo: se resolverá cuando el mecanismo de administración esté integrado.
//
// La lógica está en routes/eventHandlers.js; este archivo solo monta middlewares y rutas.
const express = require('express');

const router = express.Router();
const authenticate = require('../middleware/requireAuth');
const { ROLES, requireRole } = require('../middleware/authorize');
const events = require('../db/events');
const { createEventHandlers } = require('./eventHandlers');

const handlers = createEventHandlers({ events });

router.get('/', handlers.list);
router.get('/:id', handlers.get);
// Orden: 1) sesión válida y cuenta activa (401), 2) rol Organizer (403), 3) validación y creación.
router.post('/', authenticate, requireRole(ROLES.ORGANIZER), handlers.create);

module.exports = router;

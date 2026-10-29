// backend/routes/events.js
// API PÚBLICA de eventos: no exige sesión (cualquiera puede navegar el portal). Solo lectura.
//
//   GET /api/events         ?q=&sort=&when=&page=&limit=   listado paginado
//   GET /api/events/:id                                    detalle de un evento
//
// Respuesta del listado: { data: [...], page, limit, total, total_pages }.
// Qué se ve y qué no (borradores, enlaces de acceso, datos de inscritos) se decide en db/events.js.
// Las respuestas llevan Cache-Control público corto: un navegador o CDN puede servirlas sin llegar a la BD.
const express = require('express');
const eventsDb = require('../db/events');
const { parseListQuery, nowLocal } = require('../utils/eventsQuery');
const { badRequest } = require('../utils/userInput');
const dbFail = require('../utils/dbFail');

const CACHE = 'public, max-age=30';

// Fábrica para inyectar la BD y el reloj en las pruebas.
function createEventsRouter({ db = eventsDb, clock = () => new Date() } = {}) {
    const router = express.Router();

    router.get('/', async (req, res) => {
        const { value, invalid } = parseListQuery(req.query);
        if (invalid.length) return badRequest(res, invalid);

        try {
            const { total, items } = await db.listPublicEvents(value, nowLocal(clock()));
            res.set('Cache-Control', CACHE);
            res.json({
                data: items,
                page: value.page,
                limit: value.limit,
                total,
                total_pages: Math.ceil(total / value.limit)
            });
        } catch (err) {
            dbFail(err, res, 'events');
        }
    });

    router.get('/:id', async (req, res) => {
        if (!/^[1-9]\d{0,9}$/.test(req.params.id) || Number(req.params.id) > 2147483647) {
            return res.status(404).json({ error: 'Event not found', code: 'NOT_FOUND' });
        }
        try {
            const event = await db.findPublicEventById(Number(req.params.id), nowLocal(clock()));
            if (!event) return res.status(404).json({ error: 'Event not found', code: 'NOT_FOUND' });
            res.set('Cache-Control', CACHE);
            res.json(event);
        } catch (err) {
            dbFail(err, res, 'events');
        }
    });

    return router;
}

module.exports = createEventsRouter();
module.exports.createEventsRouter = createEventsRouter;

// backend/routes/eventHandlers.js
// Lógica de los endpoints de eventos, separada del router para poder probarla sin Express ni MySQL:
// createEventHandlers({ events }) recibe el acceso a datos (db/events.js en producción, un doble en las pruebas),
// igual que createAuthenticate recibe findUserById.
//
// Las respuestas siguen las convenciones del proyecto: éxito con el objeto o { message, ... }; error con
// { error, code } (los errores de validación llevan además `fields`), y errores de BD genéricos (utils/dbFail.js).
const { validateEventBody, validateListQuery } = require('../utils/eventInput');
const { badRequest } = require('../utils/userInput');
const sharedDbFail = require('../utils/dbFail');

const MAX_INT = 2147483647; // columnas `int` de MySQL

function createEventHandlers({ events }) {
    if (!events || typeof events.listPublishedEvents !== 'function'
        || typeof events.findPublishedEventById !== 'function' || typeof events.createEvent !== 'function') {
        // Falla al construir (arranque), no en la primera petición.
        throw new TypeError('createEventHandlers requiere { events: { listPublishedEvents, findPublishedEventById, createEvent } }');
    }

    const dbFail = (err, res) => sharedDbFail(err, res, 'events');

    // GET /api/events — público. Solo eventos Published y Public.
    async function list(req, res) {
        const { data, invalid } = validateListQuery(req.query);
        if (invalid.length) return badRequest(res, invalid);
        try {
            res.json(await events.listPublishedEvents(data));
        } catch (err) {
            dbFail(err, res);
        }
    }

    // GET /api/events/:id — público. Un borrador, un evento privado o un id inexistente dan el MISMO 404,
    // para no revelar que existe un evento que no es público.
    async function get(req, res) {
        const raw = req.params.id;
        const id = typeof raw === 'string' && /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : NaN;
        if (!Number.isInteger(id) || id > MAX_INT) {
            return res.status(400).json({ error: 'Invalid event id', code: 'INVALID_ID' });
        }
        try {
            const event = await events.findPublishedEventById(id);
            if (!event) return res.status(404).json({ error: 'Event not found', code: 'NOT_FOUND' });
            res.json(event);
        } catch (err) {
            dbFail(err, res);
        }
    }

    // POST /api/events — solo Organizer (el router monta authenticate y requireRole antes que este handler).
    // El organizador sale de req.auth.userId (JWT validado + BD). Ningún id ni rol del body se usa para decidir permisos.
    async function create(req, res) {
        const { data, invalid } = validateEventBody(req.body);
        if (invalid.length) return badRequest(res, invalid);

        try {
            const eventId = await events.createEvent({
                userId: req.auth.userId,
                event: data.event,
                venueId: data.venueId,
                venue: data.venue
            });
            // Se responde con lo que quedó en la BD; el evento recién creado siempre es Published y Public.
            const event = await events.findPublishedEventById(eventId);
            res.status(201).json({ message: 'Event created', event });
        } catch (err) {
            if (err && err.name === 'EventDomainError') {
                if (err.domainCode === 'ORGANIZER_PROFILE_MISSING') {
                    return res.status(403).json({ error: 'Organizer profile not found', code: 'ORGANIZER_PROFILE_MISSING' });
                }
                if (err.domainCode === 'VENUE_NOT_FOUND') {
                    return res.status(400).json({
                        error: 'Invalid or missing fields: venue_id',
                        code: 'VALIDATION_ERROR',
                        fields: ['venue_id']
                    });
                }
            }
            dbFail(err, res);
        }
    }

    return { list, get, create };
}

module.exports = { createEventHandlers };

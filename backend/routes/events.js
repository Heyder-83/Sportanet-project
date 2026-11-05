// backend/routes/events.js
// API de eventos: lectura pública, gestión de organizador e inscripciones protegidas.
//
//   GET /api/events                         listado público paginado
//   GET /api/events/:id                     detalle público
//   GET /api/events/mine                    eventos del organizador autenticado
//   POST /api/events                        crear evento (Organizer)
//   PUT /api/events/:id                     editar evento propio (Organizer)
//   POST /api/events/:id/registrations      inscribirse (Participant)
//   GET /api/events/registrations/mine      inscripciones propias (Participant)
//
// Respuesta del listado: { data: [...], page, limit, total, total_pages }.
// Qué se ve y qué no (borradores, enlaces de acceso, datos de inscritos) se decide en db/events.js.
// Las respuestas llevan Cache-Control público corto: un navegador o CDN puede servirlas sin llegar a la BD.
const express = require('express');
const eventsDb = require('../db/events');
const { parseListQuery, nowLocal } = require('../utils/eventsQuery');
const { badRequest } = require('../utils/userInput');
const dbFail = require('../utils/dbFail');
const { parseEventInput } = require('../utils/eventInput');

const CACHE = 'public, max-age=30';

// Fábrica para inyectar la BD y el reloj en las pruebas.
function createEventsRouter({ db = eventsDb, managementDb = null, includePublic = true, clock = () => new Date() } = {}) {
    const router = express.Router();

    if (managementDb) {
    const authenticate = require('../middleware/requireAuth');
    const { ROLES, requireRole } = require('../middleware/authorize');

    const eventId = (value) => /^[1-9]\d{0,9}$/.test(value) && Number(value) <= 2147483647 ? Number(value) : null;
    const failDb = (err, res, scope = 'events') => dbFail(err, res, scope);

    router.get('/mine', authenticate, requireRole(ROLES.ORGANIZER), async (req, res) => {
        try { res.json(await managementDb.listOrganizerEvents(req.auth.userId)); }
        catch (err) { failDb(err, res, 'events'); }
    });

    router.post('/', authenticate, requireRole(ROLES.ORGANIZER), async (req, res) => {
        const { data, invalid } = parseEventInput(req.body);
        if (invalid.length) return badRequest(res, invalid);
        try {
            const id = await managementDb.createEvent(req.auth.userId, data);
            if (id && id.kind === 'club_forbidden') return res.status(403).json({ error: 'Club is not associated with this organizer', code: 'CLUB_FORBIDDEN' });
            if (!id) return res.status(403).json({ error: 'Organizer profile not found', code: 'ORGANIZER_PROFILE_MISSING' });
            res.status(201).json({ id, status: data.event_status });
        } catch (err) { failDb(err, res, 'events'); }
    });

    router.put('/:id', authenticate, requireRole(ROLES.ORGANIZER), async (req, res) => {
        const id = eventId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid event id', code: 'INVALID_ID' });
        const allowed = ['title', 'sport', 'event_description', 'start_at', 'end_at', 'max_capacity', 'price', 'registration_deadline', 'event_status', 'approval_mode', 'cover_image', 'online_url'];
        const body = {};
        for (const key of allowed) if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) body[key] = req.body[key];
        const { data, invalid } = parseEventInput(body, { partial: true });
        if (invalid.length) return badRequest(res, invalid);
        if (!Object.keys(data).length) return res.status(400).json({ error: 'No fields provided to update', code: 'NO_FIELDS' });
        try {
            const result = await managementDb.updateOrganizerEvent(req.auth.userId, id, data);
            if (result.kind === 'not_found') return res.status(404).json({ error: 'Event not found', code: 'NOT_FOUND' });
            if (result.kind === 'closed') return res.status(409).json({ error: 'This event can no longer be edited', code: 'EVENT_CLOSED' });
            if (result.kind === 'capacity_conflict') return res.status(409).json({ error: 'Capacity cannot be lower than confirmed registrations', code: 'CAPACITY_CONFLICT' });
            if (result.kind === 'date_conflict') return res.status(400).json({ error: 'Event dates are inconsistent', code: 'VALIDATION_ERROR', fields: ['start_at', 'end_at', 'registration_deadline'] });
            if (result.kind === 'online_url_required') return res.status(400).json({ error: 'Virtual events require an access URL', code: 'VALIDATION_ERROR', fields: ['online_url'] });
            res.json({ id, updated: true });
        } catch (err) { failDb(err, res, 'events'); }
    });

    router.post('/:id/cancel', authenticate, requireRole(ROLES.ORGANIZER), async (req, res) => {
        const id = eventId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid event id', code: 'INVALID_ID' });
        const reason = req.body && req.body.reason;
        if (reason != null && (typeof reason !== 'string' || reason.trim().length > 500)) return badRequest(res, ['reason']);
        try {
            const changed = await managementDb.cancelOrganizerEvent(req.auth.userId, id, typeof reason === 'string' ? reason.trim() : null);
            if (!changed) return res.status(404).json({ error: 'Event not found or already closed', code: 'NOT_FOUND' });
            res.json({ id, status: 'Canceled' });
        } catch (err) { failDb(err, res, 'events'); }
    });

    router.post('/:id/complete', authenticate, requireRole(ROLES.ORGANIZER), async (req, res) => {
        const id = eventId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid event id', code: 'INVALID_ID' });
        try {
            const result = await managementDb.completeOrganizerEvent(req.auth.userId, id, nowLocal(clock()));
            if (result === 'not_found') return res.status(404).json({ error: 'Event not found', code: 'NOT_FOUND' });
            if (result === 'closed') return res.status(409).json({ error: 'Event cannot be completed from its current status', code: 'EVENT_CLOSED' });
            if (result === 'not_ended') return res.status(409).json({ error: 'Event has not ended yet', code: 'EVENT_NOT_ENDED' });
            res.json({ id, status: 'Completed' });
        } catch (err) { failDb(err, res, 'events'); }
    });

    router.get('/registrations/mine', authenticate, requireRole(ROLES.PARTICIPANT), async (req, res) => {
        try { res.json(await managementDb.listParticipantRegistrations(req.auth.userId)); }
        catch (err) { failDb(err, res, 'events'); }
    });

    router.get('/:id/registrations', authenticate, requireRole(ROLES.ORGANIZER), async (req, res) => {
        const id = eventId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid event id', code: 'INVALID_ID' });
        try {
            const rows = await managementDb.listEventRegistrationsForOrganizer(req.auth.userId, id);
            if (!rows) return res.status(404).json({ error: 'Event not found', code: 'NOT_FOUND' });
            res.json(rows);
        } catch (err) { failDb(err, res, 'events'); }
    });

    router.patch('/:id/registrations/:registrationId', authenticate, requireRole(ROLES.ORGANIZER), async (req, res) => {
        const id = eventId(req.params.id);
        const registrationId = eventId(req.params.registrationId);
        if (!id || !registrationId) return res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' });
        const { status } = req.body || {};
        if (!['Confirmed', 'Canceled'].includes(status)) return badRequest(res, ['status']);
        try {
            const result = await managementDb.updateEventRegistration(req.auth.userId, id, registrationId, status);
            if (result === 'not_found') return res.status(404).json({ error: 'Registration not found', code: 'NOT_FOUND' });
            if (result === 'payment_required') return res.status(409).json({ error: 'Payment must be verified before confirmation', code: 'PAYMENT_REQUIRED' });
            if (result === 'full') return res.status(409).json({ error: 'Event has no available capacity', code: 'EVENT_FULL' });
            if (result === 'event_closed') return res.status(409).json({ error: 'Canceled or completed events cannot accept confirmations', code: 'EVENT_CLOSED' });
            res.json({ id: registrationId, status });
        } catch (err) { failDb(err, res, 'events'); }
    });

    router.post('/:id/registrations', authenticate, requireRole(ROLES.PARTICIPANT), async (req, res) => {
        const id = eventId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid event id', code: 'INVALID_ID' });
        try {
            const result = await managementDb.registerParticipant(req.auth.userId, id, nowLocal(clock()));
            if (result.kind === 'not_open') return res.status(404).json({ error: 'Event is not available for registration', code: 'EVENT_NOT_FOUND' });
            if (result.kind === 'closed') return res.status(409).json({ error: 'Registration is closed', code: 'REGISTRATION_CLOSED' });
            if (result.kind === 'duplicate') return res.status(409).json({ error: 'Already registered', code: 'ALREADY_REGISTERED', status: result.status });
            res.status(201).json(result);
        } catch (err) { failDb(err, res, 'events'); }
    });

    router.delete('/:id/registrations/mine', authenticate, requireRole(ROLES.PARTICIPANT), async (req, res) => {
        const id = eventId(req.params.id);
        if (!id) return res.status(400).json({ error: 'Invalid event id', code: 'INVALID_ID' });
        try {
            const result = await managementDb.cancelParticipantRegistration(req.auth.userId, id, nowLocal(clock()));
            if (result === 'closed') return res.status(409).json({ error: 'Registration can no longer be canceled', code: 'EVENT_CLOSED' });
            if (result === 'not_found') return res.status(404).json({ error: 'Registration not found', code: 'NOT_FOUND' });
            res.json({ event_id: id, status: 'Canceled' });
        } catch (err) { failDb(err, res, 'events'); }
    });

    }

    if (includePublic) {
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
    }

    return router;
}

module.exports = createEventsRouter();
module.exports.createEventsRouter = createEventsRouter;
module.exports.createManagedEventsRouter = (options = {}) => createEventsRouter({
    ...options,
    managementDb: require('../db/eventManagement'),
    includePublic: false
});

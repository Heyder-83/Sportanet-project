// backend/test/eventHandlers.test.js
// Pruebas unitarias de routes/eventHandlers.js con el acceso a datos simulado. No requieren MySQL ni Express:
// se llaman los handlers con objetos req / res mínimos. Ejecutar: npm test
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createEventHandlers } = require('../routes/eventHandlers');

// res mínimo con la misma interfaz que usan los handlers (status().json(), json()).
const makeRes = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
};

let log;
let originalError;
beforeEach(() => {
    log = [];
    originalError = console.error;
    console.error = (...args) => log.push(args.join(' '));
});
afterEach(() => { console.error = originalError; });

const VALID_BODY = () => ({
    title: 'Torneo de prueba', sport: 'Golf', max_capacity: 32,
    start_at: '2026-12-15T08:00', end_at: '2026-12-15T17:00',
    venue: { name: 'Club', address: 'Calle 1', city: 'Bogotá' }
});
const PUBLIC_EVENT = { sport_event_id: 11, title: 'Torneo de prueba', event_status: 'Published' };

// Doble del acceso a datos: registra las llamadas y permite cambiar el comportamiento por prueba.
function fakeEvents(over = {}) {
    const calls = { list: [], find: [], create: [] };
    return {
        calls,
        listPublishedEvents: async (args) => { calls.list.push(args); return [PUBLIC_EVENT]; },
        findPublishedEventById: async (id) => { calls.find.push(id); return PUBLIC_EVENT; },
        createEvent: async (args) => { calls.create.push(args); return 11; },
        ...over
    };
}

// Misma forma que EventDomainError de db/events.js (que no se importa aquí: cargaría el pool de MySQL).
const domainError = (domainCode) => Object.assign(new Error(domainCode), { name: 'EventDomainError', domainCode });

const mysqlError = (code, sqlMessage) => Object.assign(new Error(sqlMessage), {
    code,
    sqlMessage,
    sql: "INSERT INTO sport_events (title) VALUES ('SECRETO-EN-EL-SQL')"
});

// ---------------------------------------------------------------------------
// Construcción
// ---------------------------------------------------------------------------

test('createEventHandlers exige un acceso a datos completo (falla al construir, no en la primera petición)', () => {
    assert.throws(() => createEventHandlers({}), TypeError);
    assert.throws(() => createEventHandlers(), TypeError);
    assert.throws(() => createEventHandlers({ events: { listPublishedEvents() {} } }), TypeError);
    assert.doesNotThrow(() => createEventHandlers({ events: fakeEvents() }));
});

// ---------------------------------------------------------------------------
// POST /api/events (create)
// ---------------------------------------------------------------------------

test('create: organizador válido -> 201, el organizador sale de req.auth y no del body', async () => {
    const events = fakeEvents();
    const { create } = createEventHandlers({ events });
    const res = makeRes();
    const req = {
        auth: { userId: 77, email: 'o@t.co', role: 'Organizer' },
        // Un cliente malicioso intenta atribuir el evento a otro organizador, publicarlo como borrador y subir de rol:
        body: { ...VALID_BODY(), user_id: 1, organizer_id: 1, event_organizers_id: 1, role: 'Admin', event_status: 'Draft', visibility: 'Private' }
    };
    await create(req, res);

    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.body, { message: 'Event created', event: PUBLIC_EVENT });
    assert.equal(events.calls.create.length, 1);
    const arg = events.calls.create[0];
    assert.equal(arg.userId, 77);
    assert.deepEqual(Object.keys(arg.event).sort(), ['end_at', 'max_capacity', 'sport', 'start_at', 'title']);
    assert.deepEqual(arg.venue, { name: 'Club', address: 'Calle 1', city: 'Bogotá' });
    assert.deepEqual(events.calls.find, [11]); // responde con lo que quedó guardado
});

test('create: datos inválidos -> 400 VALIDATION_ERROR con la lista de campos y sin tocar la BD', async () => {
    const events = fakeEvents();
    const { create } = createEventHandlers({ events });
    const res = makeRes();
    await create({ auth: { userId: 77, role: 'Organizer' }, body: { title: '', max_capacity: -3 } }, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'VALIDATION_ERROR');
    assert.deepEqual(res.body.fields, ['title', 'sport', 'max_capacity', 'start_at', 'end_at', 'venue']);
    assert.match(res.body.error, /title/);
    assert.equal(events.calls.create.length, 0);
});

test('create: sin body (Express 5 deja req.body indefinido) -> 400, no se rompe', async () => {
    const { create } = createEventHandlers({ events: fakeEvents() });
    const res = makeRes();
    await create({ auth: { userId: 77, role: 'Organizer' }, body: undefined }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'VALIDATION_ERROR');
});

test('create: cuenta Organizer sin fila de organizador -> 403 ORGANIZER_PROFILE_MISSING', async () => {
    const events = fakeEvents({ createEvent: async () => { throw domainError('ORGANIZER_PROFILE_MISSING'); } });
    const { create } = createEventHandlers({ events });
    const res = makeRes();
    await create({ auth: { userId: 77, role: 'Organizer' }, body: VALID_BODY() }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'ORGANIZER_PROFILE_MISSING');
});

test('create: venue_id inexistente -> 400 VALIDATION_ERROR sobre venue_id', async () => {
    const events = fakeEvents({ createEvent: async () => { throw domainError('VENUE_NOT_FOUND'); } });
    const { create } = createEventHandlers({ events });
    const res = makeRes();
    const body = VALID_BODY();
    delete body.venue;
    await create({ auth: { userId: 77, role: 'Organizer' }, body: { ...body, venue_id: 99999 } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'VALIDATION_ERROR');
    assert.deepEqual(res.body.fields, ['venue_id']);
});

test('create: error de MySQL -> 500 genérico; ni la respuesta ni el log contienen SQL, tablas o valores', async () => {
    const events = fakeEvents({
        createEvent: async () => { throw mysqlError('ER_BAD_FIELD_ERROR', "Unknown column 'sport' in 'field list'"); }
    });
    const { create } = createEventHandlers({ events });
    const res = makeRes();
    await create({ auth: { userId: 77, role: 'Organizer' }, body: VALID_BODY() }, res);

    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: 'Internal error', code: 'DB_ERROR' });
    const everything = JSON.stringify(res.body) + log.join('\n');
    assert.doesNotMatch(everything, /SECRETO-EN-EL-SQL|Unknown column|INSERT INTO|sport_events/);
    assert.match(log.join('\n'), /ER_BAD_FIELD_ERROR/); // solo el código llega al log
});

test('create: error que no es de MySQL tampoco se filtra', async () => {
    const events = fakeEvents({ createEvent: async () => { throw new Error('contraseña de la BD: hunter2'); } });
    const { create } = createEventHandlers({ events });
    const res = makeRes();
    await create({ auth: { userId: 77, role: 'Organizer' }, body: VALID_BODY() }, res);
    assert.equal(res.statusCode, 500);
    assert.doesNotMatch(JSON.stringify(res.body) + log.join('\n'), /hunter2/);
});

// ---------------------------------------------------------------------------
// GET /api/events (list)
// ---------------------------------------------------------------------------

test('list: sin parámetros usa limit 50 y offset 0 y devuelve la lista tal cual', async () => {
    const events = fakeEvents();
    const { list } = createEventHandlers({ events });
    const res = makeRes();
    await list({ query: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, [PUBLIC_EVENT]);
    assert.deepEqual(events.calls.list, [{ limit: 50, offset: 0 }]);
});

test('list: limit y offset válidos se pasan como números', async () => {
    const events = fakeEvents();
    const { list } = createEventHandlers({ events });
    await list({ query: { limit: '5', offset: '10' } }, makeRes());
    assert.deepEqual(events.calls.list, [{ limit: 5, offset: 10 }]);
});

test('list: parámetros inválidos -> 400 sin consultar la BD', async () => {
    const events = fakeEvents();
    const { list } = createEventHandlers({ events });
    const res = makeRes();
    await list({ query: { limit: '1000' } }, res);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body.fields, ['limit']);
    assert.equal(events.calls.list.length, 0);
});

test('list: lista vacía -> 200 con []', async () => {
    const { list } = createEventHandlers({ events: fakeEvents({ listPublishedEvents: async () => [] }) });
    const res = makeRes();
    await list({ query: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, []);
});

test('list: error de BD -> 500 genérico', async () => {
    const { list } = createEventHandlers({
        events: fakeEvents({ listPublishedEvents: async () => { throw mysqlError('ECONNREFUSED', 'connect ECONNREFUSED 10.0.0.5:3306'); } })
    });
    const res = makeRes();
    await list({ query: {} }, res);
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: 'Internal error', code: 'DB_ERROR' });
    assert.doesNotMatch(JSON.stringify(res.body) + log.join('\n'), /10\.0\.0\.5/);
});

// ---------------------------------------------------------------------------
// GET /api/events/:id (get)
// ---------------------------------------------------------------------------

test('get: id válido y evento público -> 200 con el objeto', async () => {
    const events = fakeEvents();
    const { get } = createEventHandlers({ events });
    const res = makeRes();
    await get({ params: { id: '11' } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, PUBLIC_EVENT);
    assert.deepEqual(events.calls.find, [11]);
});

test('get: borrador, privado o inexistente (la BD no lo devuelve) -> 404 NOT_FOUND', async () => {
    const { get } = createEventHandlers({ events: fakeEvents({ findPublishedEventById: async () => null }) });
    const res = makeRes();
    await get({ params: { id: '5' } }, res);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { error: 'Event not found', code: 'NOT_FOUND' });
});

test('get: id mal formado -> 400 INVALID_ID sin consultar la BD', async () => {
    const events = fakeEvents();
    const { get } = createEventHandlers({ events });
    for (const id of ['0', '-1', 'abc', '1e3', '1.5', '', '01', '2147483648', '99999999999', undefined, ['1']]) {
        const res = makeRes();
        await get({ params: { id } }, res);
        assert.equal(res.statusCode, 400, String(id));
        assert.equal(res.body.code, 'INVALID_ID');
    }
    assert.equal(events.calls.find.length, 0);
});

test('get: error de BD -> 500 genérico', async () => {
    const { get } = createEventHandlers({
        events: fakeEvents({ findPublishedEventById: async () => { throw mysqlError('ER_LOCK_DEADLOCK', 'Deadlock en sport_events'); } })
    });
    const res = makeRes();
    await get({ params: { id: '1' } }, res);
    assert.equal(res.statusCode, 500);
    assert.doesNotMatch(JSON.stringify(res.body), /Deadlock|sport_events/);
});

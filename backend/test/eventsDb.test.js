// backend/test/eventsDb.test.js
// Pruebas unitarias de db/events.js. No requieren MySQL: db/connection se sustituye por un pool simulado que
// registra las consultas y los eventos de transacción (mismo patrón que test/auth.test.js).
// Comprueban la FORMA de las consultas (parametrizadas, columnas fijas, filtros de visibilidad) y el orden
// begin / commit / rollback; que el SQL funcione contra el esquema real lo comprueba test/integration/events.test.js.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let calls = [];
let tx = [];
let handler;
const conn = {
    query: async (sql, params) => {
        calls.push({ sql, params });
        return handler(sql, params);
    },
    beginTransaction: async () => { tx.push('begin'); },
    commit: async () => { tx.push('commit'); },
    rollback: async () => { tx.push('rollback'); },
    release: () => { tx.push('release'); }
};
const fakePool = {
    promise: () => ({
        query: async (sql, params) => {
            calls.push({ sql, params });
            return handler(sql, params);
        },
        getConnection: async () => conn
    })
};
const connPath = require.resolve('../db/connection');
require.cache[connPath] = { id: connPath, filename: connPath, loaded: true, exports: fakePool };

const events = require('../db/events');

const sqlOf = (n) => calls[n].sql.replace(/\s+/g, ' ').trim();
const normalized = (s) => s.replace(/\s+/g, ' ');

// Fila como la devuelve mysql2: DECIMAL como texto, fechas ya formateadas por DATE_FORMAT.
const row = (over = {}) => ({
    sport_event_id: 11, title: 'Torneo', event_description: 'Desc', sport: 'Golf', max_capacity: 32, cover_image: null,
    event_status: 'Published', start_at: '2026-12-15T08:00:00', end_at: '2026-12-15T17:00:00', timezone: 'America/Bogota',
    modality: 'InPerson', online_url: null, price: '50000.00', currency: 'COP', registration_deadline: null,
    published_at: '2026-10-24T01:00:00', organizer_id: 4, organizer_name: 'Ana Org',
    venue_id: 9, venue_name: 'Club', venue_address: 'Calle 1', venue_city: 'Bogotá', venue_region: null,
    venue_country_code: 'CO', venue_latitude: '4.711000', venue_longitude: '-74.072100',
    ...over
});

// Handler de un alta correcta: organizador 4, recinto nuevo 9, evento nuevo 11.
const happy = async (sql) => {
    if (/FROM event_organizers WHERE user_id/.test(sql)) return [[{ event_organizers_id: 4 }], undefined];
    if (/^INSERT INTO venues/.test(sql)) return [{ insertId: 9 }, undefined];
    if (/^INSERT INTO sport_events/.test(sql)) return [{ insertId: 11 }, undefined];
    if (/FROM venues WHERE venue_id/.test(sql)) return [[{ venue_id: 7 }], undefined];
    throw new Error(`SQL inesperada en la prueba: ${sql}`);
};

const NEW_EVENT = {
    title: 'Torneo', sport: 'Golf', max_capacity: 32, start_at: '2026-12-15 08:00:00', end_at: '2026-12-15 17:00:00'
};
const NEW_VENUE = { name: 'Club', address: 'Calle 1', city: 'Bogotá', latitude: 4.711, longitude: -74.0721 };

beforeEach(() => {
    calls = [];
    tx = [];
    handler = happy;
});

// ---------------------------------------------------------------------------
// Consultas públicas
// ---------------------------------------------------------------------------

test('listPublishedEvents: solo Published y Public, parametrizada, ordenada, sin SELECT * ni datos sensibles', async () => {
    handler = async () => [[row()], undefined];
    await events.listPublishedEvents({ limit: 20, offset: 40 });

    const sql = sqlOf(0);
    assert.match(sql, /WHERE e\.event_status = 'Published' AND e\.visibility = 'Public'/);
    assert.match(sql, /ORDER BY e\.start_at ASC, e\.sport_event_id ASC LIMIT \? OFFSET \?$/);
    assert.deepEqual(calls[0].params, [20, 40]);
    assert.doesNotMatch(sql, /SELECT \*/i);
    assert.doesNotMatch(sql, /share_token|\bpwd\b|u\.email/i);
    assert.match(sql, /DATE_FORMAT\(e\.start_at/); // fechas como texto: sin desplazamiento por zona
});

test('listPublishedEvents: convierte DECIMAL a número y arma organizador y recinto', async () => {
    handler = async () => [[row(), row({ sport_event_id: 12, venue_id: null, venue_name: null, venue_latitude: null, venue_longitude: null, price: '0.00' })], undefined];
    const [first, second] = await events.listPublishedEvents({ limit: 50, offset: 0 });

    assert.equal(first.price, 50000);
    assert.equal(typeof first.price, 'number');
    assert.deepEqual(first.organizer, { event_organizers_id: 4, display_name: 'Ana Org' });
    assert.deepEqual(first.venue, {
        venue_id: 9, name: 'Club', address: 'Calle 1', city: 'Bogotá', region: null, country_code: 'CO', latitude: 4.711, longitude: -74.0721
    });
    assert.equal(first.start_at, '2026-12-15T08:00:00'); // texto, tal como está en la BD
    assert.equal(second.venue, null); // evento virtual: sin recinto
    assert.equal(second.price, 0);
    assert.deepEqual(Object.keys(first).includes('share_token'), false);
});

test('listPublishedEvents: lista vacía -> []', async () => {
    handler = async () => [[], undefined];
    assert.deepEqual(await events.listPublishedEvents({ limit: 50, offset: 0 }), []);
});

test('findPublishedEventById: mismo filtro de visibilidad, id como parámetro; sin fila -> null', async () => {
    handler = async () => [[], undefined];
    assert.equal(await events.findPublishedEventById(5), null);
    const sql = sqlOf(0);
    assert.match(sql, /WHERE e\.event_status = 'Published' AND e\.visibility = 'Public' AND e\.sport_event_id = \?$/);
    assert.deepEqual(calls[0].params, [5]);

    handler = async () => [[row()], undefined];
    assert.equal((await events.findPublishedEventById(11)).sport_event_id, 11);
});

// ---------------------------------------------------------------------------
// createEvent
// ---------------------------------------------------------------------------

test('createEvent con recinto nuevo: organizador desde la cuenta, recinto y evento en una transacción', async () => {
    const id = await events.createEvent({ userId: 77, event: { ...NEW_EVENT, price: 1500 }, venue: NEW_VENUE });
    assert.equal(id, 11);
    assert.deepEqual(tx, ['begin', 'commit', 'release']);
    assert.equal(calls.length, 3);

    // 1) el organizador sale de la cuenta autenticada
    assert.match(sqlOf(0), /^SELECT event_organizers_id FROM event_organizers WHERE user_id = \?$/);
    assert.deepEqual(calls[0].params, [77]);

    // 2) recinto nuevo atribuido a ese organizador
    assert.equal(sqlOf(1), 'INSERT INTO venues (created_by_organizer_id, name, address, city, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?)');
    assert.deepEqual(calls[1].params, [4, 'Club', 'Calle 1', 'Bogotá', 4.711, -74.0721]);

    // 3) evento con el organizador y el recinto recién creados, publicado y público
    assert.equal(
        sqlOf(2),
        'INSERT INTO sport_events (event_organizers_id, venue_id, title, sport, max_capacity, event_status, start_at, end_at, price, visibility, published_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())'
    );
    assert.deepEqual(calls[2].params, [4, 9, 'Torneo', 'Golf', 32, 'Published', '2026-12-15 08:00:00', '2026-12-15 17:00:00', 1500, 'Public']);
});

test('createEvent: aunque `event` traiga organizador, estado o visibilidad, prevalecen la sesión y Published/Public', async () => {
    await events.createEvent({
        userId: 77,
        event: { ...NEW_EVENT, event_organizers_id: 999, event_status: 'Draft', visibility: 'Private', venue_id: 123 },
        venue: NEW_VENUE
    });
    const [sql, params] = [sqlOf(2), calls[2].params];
    const col = (name) => params[sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(', ').indexOf(name)];
    assert.equal(col('event_organizers_id'), 4);
    assert.equal(col('event_status'), 'Published');
    assert.equal(col('visibility'), 'Public');
    assert.equal(col('venue_id'), 9);
});

test('createEvent: los valores del cliente van como parámetros, nunca dentro del SQL', async () => {
    const evil = "x'); DROP TABLE users; --";
    await events.createEvent({ userId: 1, event: { ...NEW_EVENT, title: evil }, venue: { ...NEW_VENUE, name: evil } });
    for (const c of calls) assert.ok(!c.sql.includes('DROP TABLE'), c.sql);
    assert.ok(calls[1].params.includes(evil));
    assert.ok(calls[2].params.includes(evil));
});

test('createEvent con recinto existente: solo comprueba que exista, no crea otro', async () => {
    const id = await events.createEvent({ userId: 77, event: NEW_EVENT, venueId: 7 });
    assert.equal(id, 11);
    assert.deepEqual(tx, ['begin', 'commit', 'release']);
    assert.ok(calls.every((c) => !/^INSERT INTO venues/.test(c.sql)));
    assert.match(sqlOf(1), /^SELECT venue_id FROM venues WHERE venue_id = \?$/);
    assert.deepEqual(calls[1].params, [7]);
    assert.equal(calls[2].params[1], 7); // venue_id del evento
});

test('createEvent virtual (sin recinto): venue_id queda en NULL y no se toca la tabla venues', async () => {
    await events.createEvent({ userId: 77, event: { ...NEW_EVENT, modality: 'Virtual', online_url: 'https://meet.example.com/x' } });
    assert.ok(calls.every((c) => !/venues/.test(c.sql)));
    assert.equal(calls[1].params[1], null);
    assert.deepEqual(tx, ['begin', 'commit', 'release']);
});

test('createEvent: recinto inexistente -> VENUE_NOT_FOUND, se revierte y no se inserta el evento', async () => {
    handler = async (sql) => {
        if (/FROM event_organizers/.test(sql)) return [[{ event_organizers_id: 4 }], undefined];
        if (/FROM venues WHERE venue_id/.test(sql)) return [[], undefined];
        throw new Error(`SQL inesperada: ${sql}`);
    };
    await assert.rejects(
        events.createEvent({ userId: 1, event: NEW_EVENT, venueId: 12345 }),
        (err) => err instanceof events.EventDomainError && err.domainCode === events.VENUE_NOT_FOUND
    );
    assert.deepEqual(tx, ['begin', 'rollback', 'release']);
    assert.ok(calls.every((c) => !/^INSERT/.test(c.sql)));
});

test('createEvent: cuenta sin fila de organizador -> ORGANIZER_PROFILE_MISSING, sin inserts', async () => {
    handler = async () => [[], undefined];
    await assert.rejects(
        events.createEvent({ userId: 1, event: NEW_EVENT, venue: NEW_VENUE }),
        (err) => err instanceof events.EventDomainError && err.domainCode === events.ORGANIZER_PROFILE_MISSING
    );
    assert.deepEqual(tx, ['begin', 'rollback', 'release']);
    assert.equal(calls.length, 1);
});

test('createEvent: si falla el INSERT del evento tras crear el recinto, se revierte todo (nada de commit)', async () => {
    const boom = Object.assign(new Error('Unknown column'), { code: 'ER_BAD_FIELD_ERROR' });
    handler = async (sql, params) => {
        if (/^INSERT INTO sport_events/.test(sql)) throw boom;
        return happy(sql, params);
    };
    await assert.rejects(events.createEvent({ userId: 1, event: NEW_EVENT, venue: NEW_VENUE }), (err) => err === boom);
    assert.ok(calls.some((c) => /^INSERT INTO venues/.test(c.sql)), 'el recinto sí se llegó a insertar dentro de la transacción');
    assert.deepEqual(tx, ['begin', 'rollback', 'release']);
    assert.ok(!tx.includes('commit'));
});

test('createEvent: si falla el INSERT del recinto, no se intenta crear el evento y se revierte', async () => {
    const boom = Object.assign(new Error('Data too long'), { code: 'ER_DATA_TOO_LONG' });
    handler = async (sql, params) => {
        if (/^INSERT INTO venues/.test(sql)) throw boom;
        return happy(sql, params);
    };
    await assert.rejects(events.createEvent({ userId: 1, event: NEW_EVENT, venue: NEW_VENUE }), (err) => err === boom);
    assert.ok(calls.every((c) => !/^INSERT INTO sport_events/.test(c.sql)));
    assert.deepEqual(tx, ['begin', 'rollback', 'release']);
});

test('createEvent: un fallo del propio rollback no oculta el error original y la conexión se libera', async () => {
    const boom = Object.assign(new Error('fallo real'), { code: 'ER_X' });
    handler = async (sql, params) => {
        if (/^INSERT INTO sport_events/.test(sql)) throw boom;
        return happy(sql, params);
    };
    const original = conn.rollback;
    conn.rollback = async () => { tx.push('rollback'); throw new Error('rollback falló'); };
    try {
        await assert.rejects(events.createEvent({ userId: 1, event: NEW_EVENT, venue: NEW_VENUE }), (err) => err === boom);
    } finally {
        conn.rollback = original;
    }
    assert.deepEqual(tx, ['begin', 'rollback', 'release']);
});

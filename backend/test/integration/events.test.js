// backend/test/integration/events.test.js
// Pruebas contra MySQL REAL (sportanet_test) de /api/events: HTTP + JWT + bcrypt + transacciones reales.
// No se ejecutan con `npm test`.
//   Desde backend/:  npm run db:reset:test      (una vez, o cuando cambie el esquema)
//                    npm run testevents         (si añadiste el script) o:
//                    node --env-file=.env.test --test test/integration/events.test.js
// Cubren lo que los tests unitarios no pueden: que el SQL de db/events.js coincide con el esquema real,
// que las filas quedan persistidas con los valores correctos, la visibilidad (Published + Public), los permisos
// con sesiones reales y que el recinto nuevo NO queda si falla el INSERT del evento (rollback real).
// Usa su propio prefijo ("evtest-") para no chocar con los datos de sql.test.js.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

// GUARD: db/connection.js usa 'sportanet_v1' si DB_NAME no está definido. Estas pruebas insertan y borran
// filas, así que se niegan a correr salvo contra una BD *_test.
const DB_NAME = process.env.DB_NAME || '';
if (!/^[A-Za-z0-9_]+_test$/.test(DB_NAME)) {
    throw new Error(
        `events.test.js solo puede correr contra una BD *_test (DB_NAME="${DB_NAME}"). ` +
        'Usa: node --env-file=.env.test --test test/integration/events.test.js'
    );
}

const SECRET = 'test-secret-only-for-events-tests-0123456789abcdef';
process.env.JWT_SECRET = SECRET; // debe fijarse antes de cargar config/jwt.js

const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../../db/connection');

const q = (sql, params) => pool.promise().query(sql, params);
const EMAIL_LIKE = 'evtest-%@example.test';
const PREFIX = 'evtest-';

// Orden por las claves foráneas: eventos -> recintos -> organizadores -> usuarios.
async function cleanup() {
    await q("DELETE FROM sport_events WHERE title LIKE 'evtest-%'");
    await q("DELETE FROM venues WHERE name LIKE 'evtest-%'");
    await q('DELETE o FROM event_organizers o JOIN users u ON u.user_id = o.user_id WHERE u.email LIKE ?', [EMAIL_LIKE]);
    await q('DELETE FROM users WHERE email LIKE ?', [EMAIL_LIKE]);
}

let seq = 0;
const unique = () => `${Date.now()}${++seq}`;

// Inserta un usuario directamente (sin pasar por la API). Devuelve { id, email, token }.
async function createUser(over = {}) {
    const n = unique();
    const email = `evtest-${n}@example.test`;
    const [r] = await q(
        'INSERT INTO users (full_name, email, phone, pwd, role, is_active) VALUES (?,?,?,?,?,?)',
        ['Test User', email, `6${n}`.slice(0, 20), 'hash-no-usado', over.role ?? 'Participant', over.is_active ?? 1]
    );
    return { id: r.insertId, email, token: jwt.sign({ id: r.insertId, email }, SECRET, { expiresIn: '1h' }) };
}

// Organizador completo: usuario con rol Organizer + su fila en event_organizers.
async function createOrganizer(over = {}) {
    const user = await createUser({ role: 'Organizer', ...over });
    const [r] = await q('INSERT INTO event_organizers (user_id, display_name) VALUES (?, ?)', [user.id, `evtest-org-${user.id}`]);
    return { ...user, organizerId: r.insertId };
}

// Inserta un evento directamente (para probar la visibilidad con estados que la API no permite crear).
async function insertEvent(organizerId, { title, status = 'Published', visibility = 'Public', start = '2027-01-10 10:00:00', end = '2027-01-10 12:00:00' }) {
    const [r] = await q(
        `INSERT INTO sport_events (event_organizers_id, title, sport, max_capacity, event_status, visibility, start_at, end_at, published_at)
         VALUES (?, ?, 'Golf', 10, ?, ?, ?, ?, NOW())`,
        [organizerId, title, status, visibility, start, end]
    );
    return r.insertId;
}

const validBody = (over = {}) => ({
    title: `${PREFIX}torneo ${unique()}`,
    event_description: 'Un día de golf',
    sport: 'Golf',
    max_capacity: 32,
    start_at: '2026-12-15T08:00',
    end_at: '2026-12-15T17:00',
    price: 50000,
    venue: { name: `${PREFIX}club ${unique()}`, address: 'Vía Macanal km 3', city: 'Bogotá', latitude: 4.711, longitude: -74.0721 },
    ...over
});

let server, base;

before(async () => {
    try {
        const [[row]] = await q('SELECT DATABASE() AS db');
        assert.match(row.db, /_test$/, `conectado a "${row.db}", que no es una BD *_test`);
        await q('SELECT 1 FROM sport_events LIMIT 1');
        await q('SELECT 1 FROM venues LIMIT 1');
    } catch (err) {
        if (err.name === 'AssertionError') throw err;
        throw new Error(
            `No se pudo usar la BD de pruebas (${err.code || err.message}). ` +
            '¿MySQL está arriba y la BD existe? Prueba: npm run db:reset:test'
        );
    }

    const app = express();
    app.use(express.json());
    app.use('/api/auth', require('../../routes/auth'));
    app.use('/api/events', require('../../routes/events'));
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(cleanup);

after(async () => {
    if (server) server.close();
    try { await cleanup(); } finally { await pool.promise().end(); } // sin esto node --test no termina
});

const call = (method, url, body, token) =>
    fetch(`${base}${url}`, {
        method,
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
const post = (url, body, token) => call('POST', url, body ?? {}, token);
const get = (url, token) => call('GET', url, undefined, token);

const count = async (sql, params) => Number((await q(sql, params))[0][0].n); // COUNT(*) puede llegar como texto o BigInt
const countEvents = () => count("SELECT COUNT(*) AS n FROM sport_events WHERE title LIKE 'evtest-%'");
const countVenues = () => count("SELECT COUNT(*) AS n FROM venues WHERE name LIKE 'evtest-%'");

// ---------------------------------------------------------------------------
// Crear un evento (organizador autenticado)
// ---------------------------------------------------------------------------

test('un organizador crea un evento con recinto nuevo: 201 y la fila queda en MySQL (Published, Public)', async () => {
    const org = await createOrganizer();
    const body = validBody();
    const res = await post('/api/events', body, org.token);
    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.message, 'Event created');

    const ev = json.event;
    assert.equal(ev.title, body.title);
    assert.equal(ev.event_status, 'Published');
    assert.equal(ev.start_at, '2026-12-15T08:00:00'); // hora local del evento, sin desplazamiento
    assert.equal(ev.end_at, '2026-12-15T17:00:00');
    assert.equal(ev.timezone, 'America/Bogota'); // default del esquema
    assert.equal(ev.modality, 'InPerson'); // default del esquema
    assert.equal(ev.price, 50000);
    assert.equal(typeof ev.price, 'number');
    assert.equal(ev.currency, 'COP');
    assert.equal(ev.organizer.event_organizers_id, org.organizerId);
    assert.equal(ev.venue.city, 'Bogotá');
    assert.equal(ev.venue.latitude, 4.711);
    assert.equal(ev.venue.longitude, -74.0721);
    assert.equal(ev.share_token, undefined);

    // Persistido de verdad, no solo devuelto en la respuesta:
    const [[row]] = await q(
        `SELECT event_organizers_id, venue_id, event_status, visibility, max_capacity, published_at, share_token,
                DATE_FORMAT(start_at, '%Y-%m-%d %H:%i:%s') AS start_at
         FROM sport_events WHERE sport_event_id = ?`,
        [ev.sport_event_id]
    );
    assert.equal(row.event_organizers_id, org.organizerId);
    assert.equal(row.event_status, 'Published');
    assert.equal(row.visibility, 'Public');
    assert.equal(row.max_capacity, 32);
    assert.equal(row.start_at, '2026-12-15 08:00:00');
    assert.ok(row.published_at, 'published_at debe estar fijado');
    assert.equal(row.share_token, null);

    const [[venue]] = await q('SELECT created_by_organizer_id, city, country_code FROM venues WHERE venue_id = ?', [row.venue_id]);
    assert.equal(venue.created_by_organizer_id, org.organizerId);
    assert.equal(venue.city, 'Bogotá');
    assert.equal(venue.country_code, 'CO'); // default del esquema
});

test('el cliente no puede elegir organizador, estado ni visibilidad: se ignoran', async () => {
    const orgA = await createOrganizer();
    const orgB = await createOrganizer();
    const res = await post('/api/events', validBody({
        event_organizers_id: orgB.organizerId, organizer_id: orgB.organizerId, user_id: orgB.id,
        role: 'Admin', event_status: 'Draft', visibility: 'Private', share_token: 'a'.repeat(32)
    }), orgA.token);
    assert.equal(res.status, 201);
    const { event } = await res.json();

    const [[row]] = await q('SELECT event_organizers_id, event_status, visibility, share_token FROM sport_events WHERE sport_event_id = ?', [event.sport_event_id]);
    assert.equal(row.event_organizers_id, orgA.organizerId); // el de la sesión, no el del body
    assert.equal(row.event_status, 'Published');
    assert.equal(row.visibility, 'Public');
    assert.equal(row.share_token, null);
});

test('un evento virtual se crea sin recinto (venue_id NULL) y con su enlace', async () => {
    const org = await createOrganizer();
    const body = validBody({ modality: 'Virtual', online_url: 'https://meet.example.com/abc' });
    delete body.venue;
    const res = await post('/api/events', body, org.token);
    assert.equal(res.status, 201);
    const { event } = await res.json();
    assert.equal(event.venue, null);
    assert.equal(event.modality, 'Virtual');
    assert.equal(event.online_url, 'https://meet.example.com/abc');
    const [[row]] = await q('SELECT venue_id FROM sport_events WHERE sport_event_id = ?', [event.sport_event_id]);
    assert.equal(row.venue_id, null);
    assert.equal(await countVenues(), 0);
});

test('con un recinto existente (venue_id) se reutiliza y no se crea otro; uno inexistente es 400', async () => {
    const org = await createOrganizer();
    const first = await post('/api/events', validBody(), org.token);
    const { event: ev1 } = await first.json();
    const venueId = ev1.venue.venue_id;
    assert.equal(await countVenues(), 1);

    const body = validBody();
    delete body.venue;
    const second = await post('/api/events', { ...body, venue_id: venueId }, org.token);
    assert.equal(second.status, 201);
    assert.equal((await second.json()).event.venue.venue_id, venueId);
    assert.equal(await countVenues(), 1); // sigue siendo uno

    const missing = await post('/api/events', { ...body, venue_id: 2147483000 }, org.token);
    assert.equal(missing.status, 400);
    const err = await missing.json();
    assert.equal(err.code, 'VALIDATION_ERROR');
    assert.deepEqual(err.fields, ['venue_id']);
    assert.equal(await countEvents(), 2); // el fallido no dejó nada
});

// ---------------------------------------------------------------------------
// Permisos
// ---------------------------------------------------------------------------

test('sin sesión, con token inválido o de una cuenta desactivada: 401 y no se crea nada', async () => {
    const disabled = await createOrganizer({ is_active: 0 });
    const cases = [
        [undefined, 'TOKEN_MISSING'],
        ['esto.no.es.un.jwt', 'TOKEN_INVALID'],
        [disabled.token, 'ACCOUNT_DISABLED']
    ];
    for (const [token, code] of cases) {
        const res = await post('/api/events', validBody(), token);
        assert.equal(res.status, 401, code);
        assert.equal((await res.json()).code, code);
    }
    assert.equal(await countEvents(), 0);
    assert.equal(await countVenues(), 0);
});

test('un participante no puede crear eventos: 403 y no se crea nada', async () => {
    const participant = await createUser({ role: 'Participant' });
    const res = await post('/api/events', validBody(), participant.token);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'FORBIDDEN');
    assert.equal(await countEvents(), 0);
    assert.equal(await countVenues(), 0);
});

test('un Admin de users tampoco crea eventos todavía (sin atajo): 403', async () => {
    const admin = await createUser({ role: 'Admin' });
    const res = await post('/api/events', validBody(), admin.token);
    assert.equal(res.status, 403);
    assert.equal(await countEvents(), 0);
});

test('cuenta con rol Organizer pero sin fila en event_organizers: 403 ORGANIZER_PROFILE_MISSING y sin datos parciales', async () => {
    const orphan = await createUser({ role: 'Organizer' }); // asignado a mano por SQL, sin organizador
    const res = await post('/api/events', validBody(), orphan.token);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'ORGANIZER_PROFILE_MISSING');
    assert.equal(await countEvents(), 0);
    assert.equal(await countVenues(), 0);
});

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

test('datos inválidos: 400 VALIDATION_ERROR con los campos, y no queda ni evento ni recinto', async () => {
    const org = await createOrganizer();
    const bad = [
        [{ title: '' }, ['title']],
        [{ max_capacity: 0 }, ['max_capacity']],
        [{ max_capacity: 'muchos' }, ['max_capacity']],
        [{ start_at: '2026-02-30T10:00' }, ['start_at']],
        [{ end_at: '2026-12-15T08:00' }, ['end_at']], // fin == inicio
        [{ start_at: '2026-12-15T08:00:00Z' }, ['start_at']],
        [{ price: -5 }, ['price']],
        [{ registration_deadline: '2026-12-16T00:00' }, ['registration_deadline']], // posterior al fin
        [{ modality: 'Online' }, ['modality']],
        [{ cover_image: 'javascript:alert(1)' }, ['cover_image']],
        [{ venue: { name: `${PREFIX}x`, city: 'Bogotá' } }, ['venue.address']],
        [{ venue: { name: `${PREFIX}x`, address: 'a', city: 'Bogotá', latitude: 95, longitude: 0 } }, ['venue.latitude']]
    ];
    for (const [over, fields] of bad) {
        const res = await post('/api/events', validBody(over), org.token);
        assert.equal(res.status, 400, JSON.stringify(over));
        const json = await res.json();
        assert.equal(json.code, 'VALIDATION_ERROR');
        assert.deepEqual(json.fields, fields, JSON.stringify(over));
    }
    // Sin ubicación en un evento presencial, y body vacío:
    const noVenue = validBody();
    delete noVenue.venue;
    assert.deepEqual((await (await post('/api/events', noVenue, org.token)).json()).fields, ['venue']);
    assert.equal((await post('/api/events', {}, org.token)).status, 400);

    assert.equal(await countEvents(), 0);
    assert.equal(await countVenues(), 0); // ni siquiera un recinto huérfano
});

test('JSON malformado en el body no deja datos (lo rechaza el parser de Express)', async () => {
    const org = await createOrganizer();
    const res = await fetch(`${base}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${org.token}` },
        body: '{"title": '
    });
    assert.ok(res.status >= 400 && res.status < 500, `status ${res.status}`);
    assert.equal(await countEvents(), 0);
});

// ---------------------------------------------------------------------------
// Atomicidad: recinto + evento
// ---------------------------------------------------------------------------

test('si falla el INSERT del evento, el recinto recién creado también se revierte (error REAL de MySQL, renombrando una columna)', async () => {
    const org = await createOrganizer();
    const body = validBody();
    await q('ALTER TABLE sport_events RENAME COLUMN sport TO sport_x');
    let res;
    try {
        res = await post('/api/events', body, org.token);
    } finally {
        await q('ALTER TABLE sport_events RENAME COLUMN sport_x TO sport'); // siempre se restaura el esquema
    }
    assert.equal(res.status, 500);
    const json = await res.json();
    assert.deepEqual(json, { error: 'Internal error', code: 'DB_ERROR' }); // sin SQL ni nombres de columnas
    assert.equal(await countVenues(), 0, 'el recinto no debe quedar si el evento falló');
    assert.equal(await countEvents(), 0);
});

// ---------------------------------------------------------------------------
// Consulta pública
// ---------------------------------------------------------------------------

test('el listado público incluye los publicados y públicos y excluye borradores, privados, cancelados y completados', async () => {
    const org = await createOrganizer();
    const ok = await insertEvent(org.organizerId, { title: `${PREFIX}visible` });
    const hidden = {
        draft: await insertEvent(org.organizerId, { title: `${PREFIX}borrador`, status: 'Draft' }),
        priv: await insertEvent(org.organizerId, { title: `${PREFIX}privado`, visibility: 'Private' }),
        canceled: await insertEvent(org.organizerId, { title: `${PREFIX}cancelado`, status: 'Canceled' }),
        completed: await insertEvent(org.organizerId, { title: `${PREFIX}completado`, status: 'Completed' }),
        draftPrivate: await insertEvent(org.organizerId, { title: `${PREFIX}borrador-privado`, status: 'Draft', visibility: 'Private' })
    };

    const res = await get('/api/events?limit=100'); // público: sin token
    assert.equal(res.status, 200);
    const list = await res.json();
    assert.ok(Array.isArray(list));
    const mine = list.filter((e) => e.title.startsWith(PREFIX));
    assert.deepEqual(mine.map((e) => e.sport_event_id), [ok]);
    assert.ok(mine.every((e) => e.event_status === 'Published'));
    assert.ok(mine.every((e) => e.share_token === undefined));

    // El detalle: el publicado responde; el resto es 404 (indistinguible de un id inexistente).
    assert.equal((await get(`/api/events/${ok}`)).status, 200);
    for (const [name, id] of Object.entries(hidden)) {
        const r = await get(`/api/events/${id}`);
        assert.equal(r.status, 404, name);
        assert.equal((await r.json()).code, 'NOT_FOUND');
    }
});

test('un evento publicado desde la API aparece en el listado y en su detalle, sin necesidad de sesión', async () => {
    const org = await createOrganizer();
    const created = await (await post('/api/events', validBody({ title: `${PREFIX}recien-creado` }), org.token)).json();
    const id = created.event.sport_event_id;

    const list = await (await get('/api/events?limit=100')).json();
    assert.ok(list.some((e) => e.sport_event_id === id));

    const detail = await get(`/api/events/${id}`);
    assert.equal(detail.status, 200);
    const d = await detail.json();
    assert.equal(d.title, `${PREFIX}recien-creado`);
    assert.equal(d.organizer.event_organizers_id, org.organizerId);
    assert.equal(d.venue.address, 'Vía Macanal km 3');
});

test('el listado va ordenado por fecha de inicio y respeta limit', async () => {
    const org = await createOrganizer();
    await insertEvent(org.organizerId, { title: `${PREFIX}c-tercero`, start: '2027-03-01 10:00:00', end: '2027-03-01 11:00:00' });
    await insertEvent(org.organizerId, { title: `${PREFIX}a-primero`, start: '2027-01-01 10:00:00', end: '2027-01-01 11:00:00' });
    await insertEvent(org.organizerId, { title: `${PREFIX}b-segundo`, start: '2027-02-01 10:00:00', end: '2027-02-01 11:00:00' });

    const list = await (await get('/api/events?limit=100')).json();
    const mine = list.filter((e) => e.title.startsWith(PREFIX)).map((e) => e.title);
    assert.deepEqual(mine, [`${PREFIX}a-primero`, `${PREFIX}b-segundo`, `${PREFIX}c-tercero`]);

    const one = await (await get('/api/events?limit=1')).json();
    assert.equal(one.length, 1);
});

test('parámetros y ids inválidos en la consulta: 400 controlado; un id que no existe: 404', async () => {
    for (const url of ['/api/events?limit=0', '/api/events?limit=101', '/api/events?limit=abc', '/api/events?offset=-1']) {
        const res = await get(url);
        assert.equal(res.status, 400, url);
        assert.equal((await res.json()).code, 'VALIDATION_ERROR');
    }
    for (const id of ['0', 'abc', '1e3', '-1']) {
        const res = await get(`/api/events/${id}`);
        assert.equal(res.status, 400, id);
        assert.equal((await res.json()).code, 'INVALID_ID');
    }
    assert.equal((await get('/api/events/2147483000')).status, 404);
});

// ---------------------------------------------------------------------------
// Recorrido con la autenticación real (registro -> token -> evento)
// ---------------------------------------------------------------------------

test('registro real de un Organizador -> crea un evento; el registro de un Atleta no puede', async () => {
    const n = unique();
    const reg = async (account_type, tag) => {
        const res = await post('/api/auth/register', {
            full_name: `Evtest ${tag}`, email: `evtest-${n}-${tag}@example.test`, phone: `7${n}${tag === 'org' ? 1 : 2}`.slice(0, 20),
            pwd: 'Clave-123', account_type
        });
        assert.equal(res.status, 200, `register ${tag}`);
        return res.json();
    };
    const org = await reg('Organizador', 'org');
    const ath = await reg('Atleta', 'ath');
    assert.equal(org.user.role, 'Organizer');
    assert.equal(ath.user.role, 'Participant');

    const created = await post('/api/events', validBody({ title: `${PREFIX}flujo-real` }), org.token);
    assert.equal(created.status, 201);
    assert.equal((await created.json()).event.organizer.display_name, 'Evtest org'); // display_name = nombre del usuario

    const denied = await post('/api/events', validBody({ title: `${PREFIX}no-debe-existir` }), ath.token);
    assert.equal(denied.status, 403);
    assert.equal(await count("SELECT COUNT(*) AS n FROM sport_events WHERE title = ?", [`${PREFIX}no-debe-existir`]), 0);

    // El login existente sigue emitiendo un token válido para este endpoint:
    const login = await post('/api/auth/login', { email: `evtest-${n}-org@example.test`, pwd: 'Clave-123' });
    assert.equal(login.status, 200);
    const again = await post('/api/events', validBody({ title: `${PREFIX}tras-login` }), (await login.json()).token);
    assert.equal(again.status, 201);
});

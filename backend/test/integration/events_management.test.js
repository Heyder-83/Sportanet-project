// Flujo real organizador -> eventos -> atleta contra sportanet_test.
// Ejecutar con: npm run testevents (usa backend/.env.test y solo una BD *_test).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const DB_NAME = process.env.DB_NAME || '';
if (!/^[A-Za-z0-9_]+_test$/.test(DB_NAME)) {
    throw new Error(`events_management.test.js solo puede correr contra una BD *_test (DB_NAME="${DB_NAME}"). Usa: npm run testevents`);
}

const express = require('express');
const pool = require('../../db/connection');
const authRoutes = require('../../routes/auth');
const eventRoutes = require('../../routes/events');
const q = (sql, params = []) => pool.promise().query(sql, params);

const TAG = `flowtest-${Date.now()}`;
const EMAIL_LIKE = `${TAG}-%@example.test`;
const VENUE_NAME = 'Estadio El Campín';
const VENUE_ADDRESS = 'Carrera 30 con Calle 57';
const VENUE_CITY = 'Bogotá D.C.';
const EVENTS = [
    { suffix: 'enero-03', title: '3 de Enero 2027', start_at: '2027-01-03T10:00', end_at: '2027-01-03T12:00' },
    { suffix: 'noviembre-11', title: '11 de Noviembre 2027', start_at: '2027-11-11T10:00', end_at: '2027-11-11T12:00' },
    { suffix: 'agosto-07', title: '7 de Agosto 2027', start_at: '2027-08-07T10:00', end_at: '2027-08-07T12:00' }
];

async function cleanup() {
    await q('DELETE r FROM event_registrations r JOIN users u ON u.user_id = r.user_id WHERE u.email LIKE ?', [EMAIL_LIKE]);
    await q('DELETE FROM sport_events WHERE title LIKE ?', [`${TAG}-%`]);
    await q('DELETE FROM venues WHERE created_by_organizer_id IN (SELECT event_organizers_id FROM event_organizers o JOIN users u ON u.user_id = o.user_id WHERE u.email LIKE ?) AND name = ? AND address = ? AND city = ?', [EMAIL_LIKE, VENUE_NAME, VENUE_ADDRESS, VENUE_CITY]);
    await q('DELETE FROM clubs WHERE club_name = ?', [`${TAG}-SportaClub`]);
    await q('DELETE o FROM event_organizers o JOIN users u ON u.user_id = o.user_id WHERE u.email LIKE ?', [EMAIL_LIKE]);
    await q('DELETE FROM users WHERE email LIKE ?', [EMAIL_LIKE]);
}

let server;
let api;
before(async () => {
    await cleanup();
    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);
    app.use('/api/events', eventRoutes.createManagedEventsRouter());
    app.use('/api/events', eventRoutes);
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    api = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    try { await cleanup(); } finally { await new Promise((resolve, reject) => pool.end((err) => err ? reject(err) : resolve())); }
});

async function post(path, body, token) {
    return fetch(`${api}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(body)
    });
}

test('SportaClub: el organizador crea tres eventos 2027 en El Campín y un atleta se inscribe desde el portal', async () => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const organizerEmail = `${TAG}-organizer-${unique}@example.test`;
    const athleteEmail = `${TAG}-athlete-${unique}@example.test`;
    const organizerPhone = `57${unique.replace(/\D/g, '')}`.slice(0, 20);
    const athletePhone = `58${unique.replace(/\D/g, '')}`.slice(0, 20);

    const organizerResponse = await post('/auth/register', {
        full_name: 'Organizador SportaClub', email: organizerEmail, phone: organizerPhone,
        pwd: 'test-pass-2027', account_type: 'Organizador'
    });
    assert.equal(organizerResponse.status, 200, await organizerResponse.clone().text());
    const organizerPayload = await organizerResponse.json();
    assert.equal(organizerPayload.user.role, 'Organizer');
    const organizerToken = organizerPayload.token;
    const organizerUserId = organizerPayload.user.id;

    const [[organizerProfile]] = await q('SELECT event_organizers_id, display_name FROM event_organizers WHERE user_id = ?', [organizerUserId]);
    assert.ok(organizerProfile, 'el registro de Organizador debe crear su perfil relacionado');
    assert.equal(organizerProfile.display_name, 'Organizador SportaClub');

    const [clubInsert] = await q(
        'INSERT INTO clubs (club_name, address, event_organizers_id) VALUES (?, ?, ?)',
        [`${TAG}-SportaClub`, 'Bogotá D.C.', organizerProfile.event_organizers_id]
    );
    const clubId = clubInsert.insertId;

    const createdEvents = [];
    for (const spec of EVENTS) {
        const response = await post('/events', {
            title: `${TAG}-${spec.suffix}`,
            sport: 'Fútbol',
            event_description: `Evento de prueba SportaClub: ${spec.title}`,
            start_at: spec.start_at,
            end_at: spec.end_at,
            modality: 'InPerson',
            max_capacity: 30,
            price: 0,
            currency: 'COP',
            approval_mode: 'Automatic',
            event_status: 'Published',
            venue_name: VENUE_NAME,
            venue_address: VENUE_ADDRESS,
            venue_city: VENUE_CITY,
            club_id: clubId
        }, organizerToken);
        assert.equal(response.status, 201, await response.clone().text());
        createdEvents.push({ ...spec, id: (await response.json()).id });
    }

    const [eventRows] = await q(
        `SELECT e.sport_event_id, e.title, e.start_at, e.end_at, e.club_id, e.venue_id,
                c.club_name, v.name AS venue_name, v.city
           FROM sport_events e JOIN clubs c ON c.club_id = e.club_id
           JOIN venues v ON v.venue_id = e.venue_id
          WHERE e.sport_event_id IN (?, ?, ?) ORDER BY e.start_at`, createdEvents.map((event) => event.id)
    );
    assert.equal(eventRows.length, 3);
    assert.deepEqual(eventRows.map((row) => row.start_at.toISOString().slice(0, 10)), ['2027-01-03', '2027-08-07', '2027-11-11']);
    assert.ok(eventRows.every((row) => row.club_id === clubId && row.club_name === `${TAG}-SportaClub`));
    assert.ok(eventRows.every((row) => row.venue_id === eventRows[0].venue_id), 'los eventos deben reutilizar el mismo recinto');
    assert.ok(eventRows.every((row) => row.venue_name === VENUE_NAME && row.city === VENUE_CITY));

    const portalResponse = await fetch(`${api}/events?q=${encodeURIComponent(TAG)}&when=all&sort=oldest`);
    assert.equal(portalResponse.status, 200);
    const portalPayload = await portalResponse.json();
    assert.equal(portalPayload.data.length, 3);
    assert.deepEqual(portalPayload.data.map((event) => event.title), eventRows.map((row) => row.title));

    const athleteResponse = await post('/auth/register', {
        full_name: 'Atleta de prueba', email: athleteEmail, phone: athletePhone,
        pwd: 'test-pass-2027', account_type: 'Atleta'
    });
    assert.equal(athleteResponse.status, 200, await athleteResponse.clone().text());
    const athletePayload = await athleteResponse.json();
    assert.equal(athletePayload.user.role, 'Participant');

    for (const event of createdEvents) {
        const signup = await post(`/events/${event.id}/registrations`, {}, athletePayload.token);
        assert.equal(signup.status, 201, await signup.clone().text());
        assert.equal((await signup.json()).status, 'Confirmed');
    }

    const myRegistrations = await fetch(`${api}/events/registrations/mine`, {
        headers: { Authorization: `Bearer ${athletePayload.token}` }
    });
    assert.equal(myRegistrations.status, 200);
    const registrations = await myRegistrations.json();
    assert.equal(registrations.length, 3);
    assert.ok(registrations.every((row) => row.status === 'Confirmed'));

    const duplicate = await post(`/events/${createdEvents[0].id}/registrations`, {}, athletePayload.token);
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).code, 'ALREADY_REGISTERED');
});

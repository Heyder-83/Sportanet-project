// backend/test/integration/events_api.test.js
// API pública de eventos (GET /api/events y /api/events/:id) contra MySQL/MariaDB REAL (sportanet_test), con el
// reloj fijado. Requiere las migraciones de eventos: npm run db:reset:test  y luego  npm run testsql
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

// GUARD: estas pruebas insertan y borran filas; solo corren contra una BD *_test.
const DB_NAME = process.env.DB_NAME || '';
if (!/^[A-Za-z0-9_]+_test$/.test(DB_NAME)) {
    throw new Error(`events_api.test.js solo puede correr contra una BD *_test (DB_NAME="${DB_NAME}"). Usa: npm run testsql`);
}

const express = require('express');
const pool = require('../../db/connection');
const { createEventsRouter } = require('../../routes/events');
const q = (sql, params) => pool.promise().query(sql, params);

const TAG = 'evapi';
const EMAIL_LIKE = `${TAG}-%@example.test`;
// 2026-06-15 12:00 en Colombia. Lo "futuro" va en 2030 y lo "pasado" en 2020, lejos de cualquier reloj.
const CLOCK = new Date('2026-06-15T17:00:00Z');
const FUT = (day = 1, hour = 10) => `2030-01-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:00:00`;
const PAST = (day = 1) => `2020-01-${String(day).padStart(2, '0')} 10:00:00`;
const plus2h = (dt) => dt.replace(/ (\d\d):/, (_, h) => ` ${String(Number(h) + 2).padStart(2, '0')}:`);

async function cleanup() {
    await q('DELETE r FROM event_registrations r JOIN users u ON u.user_id = r.user_id WHERE u.email LIKE ?', [EMAIL_LIKE]);
    await q(`DELETE FROM sport_events WHERE title LIKE '${TAG}-%'`); // event_staff y event_images caen en cascada
    await q(`DELETE FROM venues WHERE name LIKE '${TAG}-%'`);
    await q(`DELETE FROM clubs WHERE club_name LIKE '${TAG}-%'`);
    await q('DELETE o FROM event_organizers o JOIN users u ON u.user_id = o.user_id WHERE u.email LIKE ?', [EMAIL_LIKE]);
    await q('DELETE FROM users WHERE email LIKE ?', [EMAIL_LIKE]);
}

let seq = 0;
const unique = () => `${Date.now()}${++seq}`;
async function createUser() {
    const n = unique();
    const [r] = await q('INSERT INTO users (full_name, email, phone, pwd) VALUES (?,?,?,?)',
        ['Usuario Prueba', `${TAG}-${n}@example.test`, `8${n}`.slice(0, 20), 'hash-no-usado']);
    return r.insertId;
}
let organizerId;
async function createEvent(title, over = {}) {
    const start = over.start_at ?? FUT();
    const cols = { event_organizers_id: organizerId, title: `${TAG}-${title}`, sport: 'Golf', max_capacity: 10,
        event_status: 'Published', start_at: start, end_at: plus2h(start), ...over };
    const keys = Object.keys(cols);
    const [r] = await q(`INSERT INTO sport_events (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, keys.map((k) => cols[k]));
    return r.insertId;
}

let server, base;
before(async () => {
    try {
        await q('SELECT staff_mode FROM sport_events LIMIT 1');
        await q('SELECT 1 FROM event_images LIMIT 1');
    } catch (err) {
        throw new Error(`Faltan las migraciones de eventos en la BD de pruebas (${err.code || err.message}). Prueba: npm run db:reset:test`);
    }
    const app = express();
    app.use('/api/events', createEventsRouter({ clock: () => CLOCK }));
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}/api/events`;
});
beforeEach(async () => {
    await cleanup();
    const userId = await createUser();
    const [r] = await q("INSERT INTO event_organizers (user_id, display_name) VALUES (?, 'Organizador Público')", [userId]);
    organizerId = r.insertId;
});
after(async () => {
    server.close();
    try { await cleanup(); } finally { await new Promise((r) => pool.end(r)); }
});

const list = async (params = {}) => {
    const qs = new URLSearchParams({ q: TAG, ...params }).toString();
    const res = await fetch(`${base}?${qs}`);
    assert.equal(res.status, 200, await res.clone().text());
    return res.json();
};
const titles = (body) => body.data.map((e) => e.title.replace(`${TAG}-`, ''));

test('próximos: solo Published que aún no terminan; fuera borradores, cancelados, completados y ya terminados', async () => {
    await createEvent('futuro');
    await createEvent('borrador', { event_status: 'Draft' });
    await createEvent('cancelado', { event_status: 'Canceled' });
    await createEvent('completado-futuro', { event_status: 'Completed' });
    await createEvent('terminado', { start_at: PAST() });
    assert.deepEqual(titles(await list()), ['futuro']);
});

test('próximos: un evento en curso (empezó pero no terminó) todavía es próximo; uno que terminó hace un minuto ya no', async () => {
    // Reloj: 2026-06-15 12:00 Colombia
    await createEvent('en-curso', { start_at: '2026-06-15 11:00:00', end_at: '2026-06-15 13:00:00' });
    await createEvent('recien-terminado', { start_at: '2026-06-15 10:00:00', end_at: '2026-06-15 11:59:00' });
    await createEvent('termina-ahora', { start_at: '2026-06-15 10:00:00', end_at: '2026-06-15 12:00:00' });
    assert.deepEqual(titles(await list()), ['en-curso']);
    assert.deepEqual(titles(await list({ when: 'past', sort: 'name_asc' })), ['recien-terminado', 'termina-ahora']);
});

test('pasados: Completed (aunque su fecha sea futura) y Published que ya terminaron; fuera borradores, cancelados y próximos', async () => {
    await createEvent('terminado', { start_at: PAST() });
    await createEvent('completado', { event_status: 'Completed', start_at: PAST(2) });
    await createEvent('completado-futuro', { event_status: 'Completed' });
    await createEvent('futuro');
    await createEvent('borrador-viejo', { event_status: 'Draft', start_at: PAST(3) });
    await createEvent('cancelado-viejo', { event_status: 'Canceled', start_at: PAST(4) });
    const body = await list({ when: 'past', sort: 'name_asc' });
    assert.deepEqual(titles(body), ['completado', 'completado-futuro', 'terminado']);
    assert.ok(body.data.every((e) => e.is_past));
});

test('todos: próximos y pasados juntos, nunca borradores ni cancelados', async () => {
    await createEvent('futuro');
    await createEvent('terminado', { start_at: PAST() });
    await createEvent('borrador', { event_status: 'Draft' });
    await createEvent('cancelado', { event_status: 'Canceled' });
    assert.deepEqual(titles(await list({ when: 'all', sort: 'name_asc' })), ['futuro', 'terminado']);
});

test('orden por nombre: A-Z y Z-A', async () => {
    for (const t of ['mango', 'banana', 'cereza', 'Aguacate']) await createEvent(t);
    assert.deepEqual(titles(await list({ sort: 'name_asc' })), ['Aguacate', 'banana', 'cereza', 'mango']);
    assert.deepEqual(titles(await list({ sort: 'name_desc' })), ['mango', 'cereza', 'banana', 'Aguacate']);
});

test('orden por fecha: más nuevos primero (newest) y más antiguos primero (oldest)', async () => {
    await createEvent('dia-10', { start_at: FUT(10) });
    await createEvent('dia-02', { start_at: FUT(2) });
    await createEvent('dia-20', { start_at: FUT(20) });
    assert.deepEqual(titles(await list({ sort: 'newest' })), ['dia-20', 'dia-10', 'dia-02']);
    assert.deepEqual(titles(await list({ sort: 'oldest' })), ['dia-02', 'dia-10', 'dia-20']);
});

test('sin sort: próximos por fecha ascendente (el más cercano primero) y pasados con el más reciente primero', async () => {
    await createEvent('f10', { start_at: FUT(10) });
    await createEvent('f02', { start_at: FUT(2) });
    await createEvent('p2019', { start_at: '2019-05-05 10:00:00' });
    await createEvent('p2020', { start_at: PAST() });
    assert.deepEqual(titles(await list()), ['f02', 'f10']);
    assert.deepEqual(titles(await list({ when: 'past' })), ['p2020', 'p2019']);
});

test('empates en el orden se resuelven por id: la paginación no repite ni se salta eventos', async () => {
    for (let i = 0; i < 7; i++) await createEvent(`igual-${i}`, { start_at: FUT(5) });
    const seen = [];
    for (let page = 1; page <= 4; page++) seen.push(...(await list({ sort: 'newest', limit: 2, page })).data.map((e) => e.id));
    assert.equal(seen.length, 7);
    assert.equal(new Set(seen).size, 7);
});

test('empates en fecha: los más nuevos primero desempatan por id descendente y los más antiguos por id ascendente', async () => {
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(await createEvent(`mismo-dia-${i}`, { start_at: FUT(7) }));
    assert.deepEqual((await list({ sort: 'newest' })).data.map((e) => e.id), [...ids].reverse());
    assert.deepEqual((await list({ sort: 'oldest' })).data.map((e) => e.id), ids);
});

test('búsqueda por nombre: sin importar mayúsculas ni acentos, en cualquier parte del título', async () => {
    await createEvent('Torneo Golf Macanal');
    await createEvent('Copa Árbol de Navidad');
    await createEvent('Maratón Nocturna');
    const found = async (text) => titles(await list({ q: text, sort: 'name_asc' }));
    assert.deepEqual(await found(`${TAG}-torneo`), ['Torneo Golf Macanal']);
    assert.deepEqual(await found('GOLF MACANAL'), ['Torneo Golf Macanal']);
    assert.deepEqual(await found('arbol'), ['Copa Árbol de Navidad']);
    assert.deepEqual(await found('maraton'), ['Maratón Nocturna']);
    assert.deepEqual(await found('nada-que-coincida'), []);
});

test('búsqueda: % _ | son texto literal, no comodines', async () => {
    await createEvent('Carrera 100% fun');
    await createEvent('Carrera 1000 fun');
    await createEvent('Copa a_b');
    await createEvent('Copa axb');
    await createEvent('Reto a|b');
    const found = async (text) => titles(await list({ q: text, sort: 'name_asc' }));
    assert.deepEqual(await found('100%'), ['Carrera 100% fun']);
    assert.deepEqual(await found('a_b'), ['Copa a_b']);
    assert.deepEqual(await found('a|b'), ['Reto a|b']);
    assert.deepEqual((await list({ q: '%' })).total, 1);
});

test('búsqueda: intentos de inyección SQL no devuelven nada raro ni rompen la consulta', async () => {
    await createEvent('Torneo');
    for (const evil of ["' OR '1'='1", "'; DROP TABLE sport_events; --", "\\' OR 1=1 -- ", '") OR ("1"="1']) {
        const res = await fetch(`${base}?q=${encodeURIComponent(evil)}`);
        assert.equal(res.status, 200, evil);
        assert.equal((await res.json()).total, 0, evil);
    }
    assert.equal((await q('SELECT COUNT(*) AS n FROM sport_events'))[0][0].n >= 1, true);
    assert.equal((await fetch(`${base}?sort=${encodeURIComponent('name_asc; DROP TABLE x')}`)).status, 400);
});

test('paginación: total, total_pages y páginas; una página fuera de rango devuelve lista vacía con el total', async () => {
    for (let i = 1; i <= 5; i++) await createEvent(`p${i}`, { start_at: FUT(i) });
    const p1 = await list({ limit: 2, page: 1, sort: 'oldest' });
    assert.equal(p1.total, 5);
    assert.equal(p1.total_pages, 3);
    assert.deepEqual(titles(p1), ['p1', 'p2']);
    assert.deepEqual(titles(await list({ limit: 2, page: 3, sort: 'oldest' })), ['p5']);
    const out = await list({ limit: 2, page: 9, sort: 'oldest' });
    assert.deepEqual(out.data, []);
    assert.equal(out.total, 5);
});

test('listado: club, sede, precio numérico, fechas en hora de pared y cupos (solo cuentan las inscripciones Confirmed)', async () => {
    const [club] = await q("INSERT INTO clubs (club_name, address) VALUES ('evapi-Club Macanal', 'Km 5 vía La Calera')");
    const [venue] = await q("INSERT INTO venues (name, address, city) VALUES ('evapi-Campo Norte', 'Calle 1 # 2-3', 'Bogotá')");
    const id = await createEvent('Con todo', {
        club_id: club.insertId, venue_id: venue.insertId, price: 45000.5, max_capacity: 5, modality: 'Hybrid',
        event_description: 'x'.repeat(500), cover_image: 'img/golf.jpg', online_url: 'https://secreto.example/sala',
        start_at: '2030-03-04 09:30:00', end_at: '2030-03-04 18:00:00'
    });
    const [u1, u2, u3, u4] = [await createUser(), await createUser(), await createUser(), await createUser()];
    await q("INSERT INTO event_registrations (sport_event_id, user_id, registration_status) VALUES (?,?, 'Confirmed'), (?,?, 'Confirmed'), (?,?, 'Pending'), (?,?, 'Canceled')", [id, u1, id, u2, id, u3, id, u4]);
    const raw = await (await fetch(`${base}?q=${TAG}`)).text();
    const e = JSON.parse(raw).data[0];
    assert.deepEqual(e.club, { id: club.insertId, name: 'evapi-Club Macanal' });
    assert.deepEqual(e.venue, { name: 'evapi-Campo Norte', city: 'Bogotá' });
    assert.equal(e.price, 45000.5);
    assert.equal(e.currency, 'COP');
    assert.equal(e.start_at, '2030-03-04T09:30:00');
    assert.equal(e.end_at, '2030-03-04T18:00:00');
    assert.equal(e.timezone, 'America/Bogota');
    assert.equal(e.modality, 'Hybrid');
    assert.equal(e.capacity, 5);
    assert.equal(e.confirmed_count, 2);
    assert.equal(e.spots_left, 3);
    assert.equal(e.status, 'Published');
    assert.equal(e.is_past, false);
    assert.equal(e.excerpt.length, 240); // el listado no manda la descripción completa
    assert.equal(e.cover_image, 'img/golf.jpg');
    // Datos que NUNCA salen en el listado
    assert.ok(!/secreto\.example|online_url|user_id|email|pwd/i.test(raw));
});

test('listado: sin club ni sede -> null; cupos nunca negativos', async () => {
    const id = await createEvent('Solo', { max_capacity: 1 });
    const [u1, u2] = [await createUser(), await createUser()];
    await q("INSERT INTO event_registrations (sport_event_id, user_id, registration_status) VALUES (?,?, 'Confirmed'), (?,?, 'Confirmed')", [id, u1, id, u2]);
    const e = (await list()).data[0];
    assert.equal(e.club, null);
    assert.equal(e.venue, null);
    assert.equal(e.confirmed_count, 2);
    assert.equal(e.spots_left, 0);
});

test('detalle: evento completo con sede, club, organizador, galería ordenada y cupos', async () => {
    const [club] = await q("INSERT INTO clubs (club_name, address) VALUES ('evapi-Club', 'Dirección del club')");
    const [venue] = await q("INSERT INTO venues (name, address, city, region, latitude, longitude) VALUES ('evapi-Sede', 'Calle 9', 'Medellín', 'Antioquia', 6.244203, -75.581211)");
    const id = await createEvent('Detalle', {
        club_id: club.insertId, venue_id: venue.insertId, event_description: 'Descripción completa '.repeat(30),
        registration_deadline: '2029-12-30 23:00:00', online_url: 'https://secreto.example/sala'
    });
    await q("INSERT INTO event_images (sport_event_id, url, alt_text, position) VALUES (?, 'img/2.jpg', 'Segunda', 2), (?, 'img/1.jpg', NULL, 1)", [id, id]);
    const res = await fetch(`${base}/${id}`);
    const raw = await res.text();
    assert.equal(res.status, 200);
    const e = JSON.parse(raw);
    assert.equal(e.id, id);
    assert.equal(e.description.length, 'Descripción completa '.length * 30);
    assert.deepEqual(e.organizer, { name: 'Organizador Público' });
    assert.deepEqual(e.club, { id: club.insertId, name: 'evapi-Club', address: 'Dirección del club' });
    assert.deepEqual(e.venue, { name: 'evapi-Sede', address: 'Calle 9', city: 'Medellín', region: 'Antioquia', country_code: 'CO', latitude: 6.244203, longitude: -75.581211 });
    assert.equal(e.registration_deadline, '2029-12-30T23:00:00');
    assert.deepEqual(e.images, [{ url: 'img/1.jpg', alt: null }, { url: 'img/2.jpg', alt: 'Segunda' }]);
    assert.equal(e.spots_left, 10);
    assert.ok(!/secreto\.example|online_url|user_id|pwd/i.test(raw));
});

test('detalle: personal organizador — "Club" = sin delegados (aunque queden filas); "Specific" = las personas listadas, sin user_id', async () => {
    const id = await createEvent('Personal');
    const user = await createUser();
    await q("INSERT INTO event_staff (sport_event_id, user_id, display_name, role_title) VALUES (?, ?, 'Ana Gómez', 'Coordinadora')", [id, user]);
    await q("INSERT INTO event_staff (sport_event_id, display_name) VALUES (?, 'Pedro Pérez')", [id]);
    let e = await (await fetch(`${base}/${id}`)).json();
    assert.equal(e.staff_mode, 'Club');
    assert.deepEqual(e.staff, []);
    await q("UPDATE sport_events SET staff_mode = 'Specific' WHERE sport_event_id = ?", [id]);
    const raw = await (await fetch(`${base}/${id}`)).text();
    e = JSON.parse(raw);
    assert.equal(e.staff_mode, 'Specific');
    assert.deepEqual(e.staff, [{ name: 'Ana Gómez', role: 'Coordinadora' }, { name: 'Pedro Pérez', role: 'Organizador' }]);
    assert.ok(!/user_id/.test(raw));
});

test('detalle: borrador y evento inexistente -> 404; cancelado -> se ve con su motivo; completado -> is_past', async () => {
    const draft = await createEvent('Borrador', { event_status: 'Draft' });
    const canceled = await createEvent('Cancelado', { event_status: 'Canceled', cancel_reason: 'Lluvia fuerte' });
    const done = await createEvent('Completado', { event_status: 'Completed', start_at: PAST() });
    assert.equal((await fetch(`${base}/${draft}`)).status, 404);
    assert.equal((await fetch(`${base}/987654321`)).status, 404);
    const c = await (await fetch(`${base}/${canceled}`)).json();
    assert.equal(c.status, 'Canceled');
    assert.equal(c.cancel_reason, 'Lluvia fuerte');
    const d = await (await fetch(`${base}/${done}`)).json();
    assert.equal(d.is_past, true);
    assert.equal(d.cancel_reason, null);
});

test('detalle: un evento Completed con fecha futura es pasado; un motivo de cancelación guardado en un evento no cancelado no se publica', async () => {
    const done = await createEvent('Completado-futuro', { event_status: 'Completed' });
    const odd = await createEvent('Con-motivo-viejo', { cancel_reason: 'Motivo de una cancelación anterior' });
    assert.equal((await (await fetch(`${base}/${done}`)).json()).is_past, true);
    const raw = await (await fetch(`${base}/${odd}`)).text();
    assert.equal(JSON.parse(raw).cancel_reason, null);
    assert.ok(!raw.includes('Motivo de una cancelación'));
});

test('el listado es de solo lectura: tras consultarlo no cambia ninguna fila', async () => {
    await createEvent('Intacto');
    const snap = async () => JSON.stringify((await q(`SELECT * FROM sport_events WHERE title LIKE '${TAG}-%' ORDER BY sport_event_id`))[0]);
    const before = await snap();
    await list(); await list({ when: 'past' }); await list({ when: 'all', sort: 'name_desc' });
    assert.equal(await snap(), before);
});

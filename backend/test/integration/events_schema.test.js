// backend/test/integration/events_schema.test.js
// Pruebas del esquema de eventos (migraciones 001-004) contra MySQL/MariaDB REAL (sportanet_test).
// No se ejecutan con `npm test`.  Desde backend/:  npm run db:reset:test  y luego  npm run testsql
// Comprueban: personal organizador del evento (staff_mode + event_staff), galería (event_images), que ya no existen
// visibility ni share_token, y las reglas de borrado en cascada.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

// GUARD: estas pruebas insertan y borran filas; solo corren contra una BD *_test.
const DB_NAME = process.env.DB_NAME || '';
if (!/^[A-Za-z0-9_]+_test$/.test(DB_NAME)) {
    throw new Error(`events_schema.test.js solo puede correr contra una BD *_test (DB_NAME="${DB_NAME}"). Usa: npm run testsql`);
}

const pool = require('../../db/connection');
const q = (sql, params) => pool.promise().query(sql, params);
const errorOf = async (p) => { try { await p; } catch (e) { return e; } return null; };
// MariaDB usa errno 4025 y MySQL 8 usa 3819 para un CHECK que falla.
const CHECK_ERRNOS = [4025, 3819];

const EMAIL_LIKE = 'evtest-%@example.test';
async function cleanup() {
    // Las inscripciones no caen en cascada: primero ellas; event_staff y event_images sí caen con el evento.
    await q('DELETE r FROM event_registrations r JOIN users u ON u.user_id = r.user_id WHERE u.email LIKE ?', [EMAIL_LIKE]);
    await q("DELETE FROM sport_events WHERE title LIKE 'evtest-%'");
    await q('DELETE o FROM event_organizers o JOIN users u ON u.user_id = o.user_id WHERE u.email LIKE ?', [EMAIL_LIKE]);
    await q('DELETE FROM users WHERE email LIKE ?', [EMAIL_LIKE]);
}

let seq = 0;
const unique = () => `${Date.now()}${++seq}`;
async function createUser() {
    const n = unique();
    const [r] = await q('INSERT INTO users (full_name, email, phone, pwd) VALUES (?,?,?,?)',
        ['Test Staff', `evtest-${n}@example.test`, `7${n}`.slice(0, 20), 'hash-no-usado']);
    return r.insertId;
}
async function createOrganizer() {
    const userId = await createUser();
    const [r] = await q("INSERT INTO event_organizers (user_id, display_name) VALUES (?, 'Org Prueba')", [userId]);
    return r.insertId;
}
async function createEvent(over = {}) {
    const orgId = over.organizerId ?? await createOrganizer();
    const cols = { event_organizers_id: orgId, title: `evtest-${unique()}`, sport: 'Futbol', max_capacity: 10,
        start_at: '2030-01-01 10:00:00', end_at: '2030-01-01 12:00:00', ...over.fields };
    const keys = Object.keys(cols);
    const [r] = await q(`INSERT INTO sport_events (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, keys.map((k) => cols[k]));
    return r.insertId;
}
const count = async (table, eventId) => (await q(`SELECT COUNT(*) AS n FROM ${table} WHERE sport_event_id = ?`, [eventId]))[0][0].n;

before(async () => {
    try {
        const [[row]] = await q('SELECT DATABASE() AS db');
        assert.match(row.db, /_test$/);
        await q('SELECT 1 FROM event_staff LIMIT 1');
    } catch (err) {
        if (err.name === 'AssertionError') throw err;
        throw new Error(`No se pudo usar la BD de pruebas o faltan las migraciones de eventos (${err.code || err.message}). Prueba: npm run db:reset:test`);
    }
});
beforeEach(cleanup);
after(async () => {
    try { await cleanup(); } finally { await new Promise((r) => pool.end(r)); } // sin esto, un fallo de limpieza deja el proceso colgado
});

test('las migraciones 001-004 quedaron registradas en schema_migrations', async () => {
    const [rows] = await q("SELECT version FROM schema_migrations WHERE version IN ('001','002','003','004') ORDER BY version");
    assert.deepEqual(rows.map((r) => r.version), ['001', '002', '003', '004']);
});

test('sport_events ya no tiene visibility ni share_token, y sí staff_mode', async () => {
    const [cols] = await q('SHOW COLUMNS FROM sport_events');
    const names = cols.map((c) => c.Field);
    assert.ok(!names.includes('visibility'));
    assert.ok(!names.includes('share_token'));
    assert.ok(names.includes('staff_mode'));
    const [idx] = await q('SHOW INDEX FROM sport_events');
    assert.ok(!idx.some((i) => i.Key_name === 'uq_events_share_token'));
    const listing = idx.filter((i) => i.Key_name === 'idx_events_listing').sort((a, b) => a.Seq_in_index - b.Seq_in_index);
    assert.deepEqual(listing.map((i) => i.Column_name), ['event_status', 'start_at']);
});

test('staff_mode: por defecto el club organiza en general ("Club"); solo admite Club o Specific', async () => {
    const id = await createEvent();
    assert.equal((await q('SELECT staff_mode FROM sport_events WHERE sport_event_id = ?', [id]))[0][0].staff_mode, 'Club');
    await q("UPDATE sport_events SET staff_mode = 'Specific' WHERE sport_event_id = ?", [id]);
    assert.ok(await errorOf(q("UPDATE sport_events SET staff_mode = 'Otro' WHERE sport_event_id = ?", [id])));
    assert.ok(await errorOf(createEvent({ fields: { staff_mode: 'Nadie' } })));
});

test('event_staff: una persona con cuenta y otra solo con nombre conviven en el mismo evento', async () => {
    const ev = await createEvent({ fields: { staff_mode: 'Specific' } });
    const user = await createUser();
    await q("INSERT INTO event_staff (sport_event_id, user_id, display_name, role_title) VALUES (?, ?, 'Ana Gómez', 'Coordinadora')", [ev, user]);
    await q("INSERT INTO event_staff (sport_event_id, display_name) VALUES (?, 'Pedro sin cuenta')", [ev]);
    await q("INSERT INTO event_staff (sport_event_id, display_name) VALUES (?, 'Luisa sin cuenta')", [ev]); // varios NULL en user_id: permitido
    const [rows] = await q('SELECT display_name, role_title, user_id FROM event_staff WHERE sport_event_id = ? ORDER BY event_staff_id', [ev]);
    assert.deepEqual(rows.map((r) => r.display_name), ['Ana Gómez', 'Pedro sin cuenta', 'Luisa sin cuenta']);
    assert.equal(rows[0].role_title, 'Coordinadora');
    assert.equal(rows[1].role_title, 'Organizador'); // valor por defecto
    assert.equal(rows[1].user_id, null);
});

test('event_staff: el mismo usuario no puede figurar dos veces en el mismo evento, pero sí en eventos distintos', async () => {
    const [e1, e2] = [await createEvent(), await createEvent()];
    const user = await createUser();
    await q("INSERT INTO event_staff (sport_event_id, user_id, display_name) VALUES (?, ?, 'Ana')", [e1, user]);
    const dup = await errorOf(q("INSERT INTO event_staff (sport_event_id, user_id, display_name) VALUES (?, ?, 'Ana')", [e1, user]));
    assert.equal(dup && dup.code, 'ER_DUP_ENTRY');
    await q("INSERT INTO event_staff (sport_event_id, user_id, display_name) VALUES (?, ?, 'Ana')", [e2, user]);
});

test('event_staff: exige evento existente, usuario existente y un nombre no vacío', async () => {
    const ev = await createEvent();
    const noEvent = await errorOf(q("INSERT INTO event_staff (sport_event_id, display_name) VALUES (999999999, 'X')"));
    assert.equal(noEvent && noEvent.code, 'ER_NO_REFERENCED_ROW_2');
    const noUser = await errorOf(q("INSERT INTO event_staff (sport_event_id, user_id, display_name) VALUES (?, 999999999, 'X')", [ev]));
    assert.equal(noUser && noUser.code, 'ER_NO_REFERENCED_ROW_2');
    for (const name of ['', '   ']) {
        const err = await errorOf(q('INSERT INTO event_staff (sport_event_id, display_name) VALUES (?, ?)', [ev, name]));
        assert.ok(err && CHECK_ERRNOS.includes(err.errno), `nombre "${name}": ${err && err.errno}`);
    }
    assert.ok(await errorOf(q('INSERT INTO event_staff (sport_event_id, display_name) VALUES (?, ?)', [ev, null])));
    assert.ok(await errorOf(q('INSERT INTO event_staff (sport_event_id, display_name) VALUES (?, ?)', [ev, 'x'.repeat(101)])));
    assert.equal(await count('event_staff', ev), 0);
});

test('event_staff: al borrar el evento se borra su personal; al borrar al usuario la fila queda con su nombre', async () => {
    const ev = await createEvent();
    const user = await createUser();
    await q("INSERT INTO event_staff (sport_event_id, user_id, display_name) VALUES (?, ?, 'Ana Gómez')", [ev, user]);
    await q('DELETE FROM users WHERE user_id = ?', [user]);
    const [[row]] = await q('SELECT display_name, user_id FROM event_staff WHERE sport_event_id = ?', [ev]);
    assert.equal(row.display_name, 'Ana Gómez');
    assert.equal(row.user_id, null);
    await q('DELETE FROM sport_events WHERE sport_event_id = ?', [ev]);
    assert.equal(await count('event_staff', ev), 0);
});

test('event_images: varias imágenes por evento, ordenadas por position; no admiten url vacía ni evento inexistente', async () => {
    const ev = await createEvent();
    await q("INSERT INTO event_images (sport_event_id, url, alt_text, position) VALUES (?, 'img/b.jpg', 'Segunda', 2), (?, 'img/a.jpg', 'Primera', 1)", [ev, ev]);
    await q("INSERT INTO event_images (sport_event_id, url) VALUES (?, 'img/c.jpg')", [ev]); // position 0 por defecto
    const [rows] = await q('SELECT url, alt_text FROM event_images WHERE sport_event_id = ? ORDER BY position, event_image_id', [ev]);
    assert.deepEqual(rows.map((r) => r.url), ['img/c.jpg', 'img/a.jpg', 'img/b.jpg']);
    assert.equal(rows[0].alt_text, null);
    for (const bad of ['', '  ']) {
        const err = await errorOf(q('INSERT INTO event_images (sport_event_id, url) VALUES (?, ?)', [ev, bad]));
        assert.ok(err && CHECK_ERRNOS.includes(err.errno), `url "${bad}": ${err && err.errno}`);
    }
    const noEvent = await errorOf(q("INSERT INTO event_images (sport_event_id, url) VALUES (999999999, 'x.jpg')"));
    assert.equal(noEvent && noEvent.code, 'ER_NO_REFERENCED_ROW_2');
    assert.ok(await errorOf(q('INSERT INTO event_images (sport_event_id, url) VALUES (?, ?)', [ev, 'u'.repeat(501)])));
});

test('event_images: al borrar el evento se borra su galería', async () => {
    const ev = await createEvent();
    await q("INSERT INTO event_images (sport_event_id, url) VALUES (?, 'img/a.jpg')", [ev]);
    await q('DELETE FROM sport_events WHERE sport_event_id = ?', [ev]);
    assert.equal(await count('event_images', ev), 0);
});

test('participantes: la inscripción es única por usuario y evento, y se cuentan solo las confirmadas', async () => {
    const ev = await createEvent();
    const [u1, u2, u3] = [await createUser(), await createUser(), await createUser()];
    await q("INSERT INTO event_registrations (sport_event_id, user_id, registration_status) VALUES (?, ?, 'Confirmed'), (?, ?, 'Confirmed'), (?, ?, 'Canceled')", [ev, u1, ev, u2, ev, u3]);
    const dup = await errorOf(q('INSERT INTO event_registrations (sport_event_id, user_id) VALUES (?, ?)', [ev, u1]));
    assert.equal(dup && dup.code, 'ER_DUP_ENTRY');
    const [[{ n }]] = await q("SELECT COUNT(*) AS n FROM event_registrations WHERE sport_event_id = ? AND registration_status = 'Confirmed'", [ev]);
    assert.equal(n, 2);
});

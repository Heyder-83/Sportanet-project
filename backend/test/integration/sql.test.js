// backend/test/integration/sql.test.js
// Pruebas contra MySQL REAL (sportanet_test). No se ejecutan con `npm test`.
//   Desde backend/:  npm run db:reset:test   (una vez, o cuando cambie el esquema)
//                    npm run testsql
// Cubren lo que los tests unitarios no pueden: que la consulta de db/users.js coincide con el
// esquema real, los tipos que devuelve el driver, el flujo register -> login -> /me con bcrypt real,
// y las rutas /api/users (permisos, validación, borrado lógico) contra filas reales.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

// GUARD: db/connection.js usa 'sportanet_v1' si DB_NAME no está definido. Estas pruebas insertan y
// borran filas, así que se niegan a correr salvo contra una BD *_test (p. ej. `npm run testsql`).
const DB_NAME = process.env.DB_NAME || '';
if (!/^[A-Za-z0-9_]+_test$/.test(DB_NAME)) {
    throw new Error(
        `sql.test.js solo puede correr contra una BD *_test (DB_NAME="${DB_NAME}"). Usa: npm run testsql`
    );
}

const SECRET = 'test-secret-only-for-sql-tests-0123456789abcdefg';
process.env.JWT_SECRET = SECRET; // debe fijarse antes de cargar config/jwt.js

const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../../db/connection');
const { findUserById } = require('../../db/users'); // la consulta REAL, no un doble
const createAuthenticate = require('../../middleware/authenticate');

const q = (sql, params) => pool.promise().query(sql, params);
const EMAIL_LIKE = 'sqltest-%@example.test';
// Orden por las claves foráneas: inscripciones -> eventos -> organizadores -> usuarios (user_profile cae en cascada).
async function cleanup() {
    await q('DELETE r FROM event_registrations r JOIN users u ON u.user_id = r.user_id WHERE u.email LIKE ?', [EMAIL_LIKE]);
    await q("DELETE FROM sport_events WHERE title LIKE 'sqltest-%'");
    await q('DELETE o FROM event_organizers o JOIN users u ON u.user_id = o.user_id WHERE u.email LIKE ?', [EMAIL_LIKE]);
    await q('DELETE FROM users WHERE email LIKE ?', [EMAIL_LIKE]);
}

let seq = 0;
const unique = () => `${Date.now()}${++seq}`;

// Inserta un usuario directamente (sin pasar por la API). Devuelve { id, email }.
async function createUser(over = {}) {
    const n = unique();
    const email = `sqltest-${n}@example.test`;
    const [r] = await q(
        'INSERT INTO users (full_name, email, phone, pwd, role, is_active, deleted_at) VALUES (?,?,?,?,?,?,?)',
        ['Test User', email, `5${n}`.slice(0, 20), 'hash-no-usado', over.role ?? 'Participant', over.is_active ?? 1, over.deleted_at ?? null]
    );
    return { id: r.insertId, email };
}

const tokenFor = (payload) => jwt.sign(payload, SECRET, { expiresIn: '1h' });

let server, base;

before(async () => {
    try {
        const [[row]] = await q('SELECT DATABASE() AS db');
        assert.match(row.db, /_test$/, `conectado a "${row.db}", que no es una BD *_test`);
        await q('SELECT 1 FROM users LIMIT 1');
    } catch (err) {
        if (err.name === 'AssertionError') throw err;
        throw new Error(
            `No se pudo usar la BD de pruebas (${err.code || err.message}). ` +
            '¿MySQL está arriba y la BD existe? Prueba: npm run db:reset:test'
        );
    }

    const app = express();
    app.use(express.json());
    app.post('/protected', createAuthenticate({ findUserById }), (req, res) => res.json({ auth: req.auth }));
    app.use('/api/auth', require('../../routes/auth')); // routes/auth usa requireAuth + pool reales
    app.use('/api/users', require('../../routes/users'));
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(cleanup);

after(async () => {
    if (server) server.close();
    try { await cleanup(); } finally { await pool.promise().end(); } // sin esto node --test no termina
});

const post = (url, body, token) =>
    fetch(`${base}${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body ?? {})
    });
const get = (url, token) => fetch(`${base}${url}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

// ---------------------------------------------------------------------------
// db/users.js + middleware/authenticate.js contra filas reales
// ---------------------------------------------------------------------------

test('findUserById: columnas y tipos reales, y nunca devuelve pwd', async () => {
    const { id, email } = await createUser();
    const user = await findUserById(id);
    assert.deepEqual(Object.keys(user).sort(), ['deleted_at', 'email', 'is_active', 'role', 'user_id']);
    assert.equal(user.user_id, id);
    assert.equal(user.email, email);
    assert.equal(user.role, 'Participant'); // default del esquema
    assert.equal(typeof user.is_active, 'number'); // tinyint(1) llega como número
    assert.equal(user.is_active, 1);
    assert.equal(user.deleted_at, null);
    assert.equal(user.pwd, undefined);
});

test('findUserById: id inexistente -> null', async () => {
    assert.equal(await findUserById(2147483000), null);
});

test('cuenta activa real -> 200 con id, email y rol de la BD', async () => {
    const { id, email } = await createUser();
    const res = await post('/protected', {}, tokenFor({ id, email }));
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).auth, { userId: id, email, role: 'Participant' });
});

test('UPDATE is_active = 0 -> 401 ACCOUNT_DISABLED; al reactivar vuelve a 200 (sin caché)', async () => {
    const { id, email } = await createUser();
    const token = tokenFor({ id, email });
    assert.equal((await post('/protected', {}, token)).status, 200);

    await q('UPDATE users SET is_active = 0 WHERE user_id = ?', [id]);
    const off = await post('/protected', {}, token);
    assert.equal(off.status, 401);
    assert.equal((await off.json()).code, 'ACCOUNT_DISABLED');

    await q('UPDATE users SET is_active = 1 WHERE user_id = ?', [id]);
    assert.equal((await post('/protected', {}, token)).status, 200);
});

test('UPDATE deleted_at = NOW() (aunque is_active = 1) -> 401 ACCOUNT_DELETED', async () => {
    const { id, email } = await createUser();
    await q('UPDATE users SET deleted_at = NOW() WHERE user_id = ?', [id]);
    const res = await post('/protected', {}, tokenFor({ id, email }));
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'ACCOUNT_DELETED');
});

test('DELETE físico de la fila con token aún vigente -> 401 ACCOUNT_DELETED', async () => {
    const { id, email } = await createUser();
    const token = tokenFor({ id, email });
    await q('DELETE FROM users WHERE user_id = ?', [id]);
    const res = await post('/protected', {}, token);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'ACCOUNT_DELETED');
});

test('email y rol salen de la BD (enum real Organizer); el "role: Admin" del token se ignora', async () => {
    const { id, email } = await createUser({ role: 'Organizer' });
    const res = await post('/protected', {}, tokenFor({ id, email: 'viejo@example.test', role: 'Admin' }));
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).auth, { userId: id, email, role: 'Organizer' });
});

// ---------------------------------------------------------------------------
// Flujo real: register -> login -> /me (bcrypt real, pool real)
// ---------------------------------------------------------------------------

async function registerUser() {
    const n = unique();
    const creds = { full_name: 'Flujo Real', email: `sqltest-${n}@example.test`, phone: `6${n}`.slice(0, 20), pwd: 'Clave-de-prueba-123' };
    const res = await post('/api/auth/register', creds);
    return { creds, res, body: await res.json() };
}

test('register guarda el hash bcrypt (no la contraseña) con role y estado por defecto', async () => {
    const { creds, res, body } = await registerUser();
    assert.equal(res.status, 200);
    assert.equal(typeof body.token, 'string');
    const [[row]] = await q('SELECT pwd, role, is_active, deleted_at FROM users WHERE email = ?', [creds.email]);
    assert.notEqual(row.pwd, creds.pwd);
    assert.match(row.pwd, /^\$2[aby]\$/);
    assert.equal(row.role, 'Participant');
    assert.equal(row.is_active, 1);
    assert.equal(row.deleted_at, null);
});

test('register con email repetido -> 409 EMAIL_TAKEN (UNIQUE real de users.email)', async () => {
    const { creds } = await registerUser();
    const again = await post('/api/auth/register', { ...creds, phone: `7${unique()}`.slice(0, 20) });
    assert.equal(again.status, 409); // antes 400 (Fase 1D: mismo criterio que /api/users)
    const body = await again.json();
    assert.equal(body.error, 'Email already registered');
    assert.equal(body.code, 'EMAIL_TAKEN');
});

test('login correcto -> token que /me acepta con id, email y role', async () => {
    const { creds } = await registerUser();
    const login = await post('/api/auth/login', { email: creds.email, pwd: creds.pwd });
    assert.equal(login.status, 200);
    const { token, user } = await login.json();
    const me = await get('/api/auth/me', token);
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), { id: user.id, email: creds.email, role: 'Participant' });
});

test('login con contraseña incorrecta -> 401 genérico', async () => {
    const { creds } = await registerUser();
    const res = await post('/api/auth/login', { email: creds.email, pwd: 'incorrecta' });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, 'Invalid credentials');
});

test('cuenta desactivada: login -> 403 ACCOUNT_DISABLED sin token, y el token previo falla en /me', async () => {
    const { creds } = await registerUser();
    const { token } = await (await post('/api/auth/login', { email: creds.email, pwd: creds.pwd })).json();
    assert.equal((await get('/api/auth/me', token)).status, 200);

    await q('UPDATE users SET is_active = 0 WHERE email = ?', [creds.email]);

    const login = await post('/api/auth/login', { email: creds.email, pwd: creds.pwd });
    const body = await login.json();
    assert.equal(login.status, 403);
    assert.equal(body.code, 'ACCOUNT_DISABLED');
    assert.equal(body.token, undefined);

    const me = await get('/api/auth/me', token);
    assert.equal(me.status, 401);
    assert.equal((await me.json()).code, 'ACCOUNT_DISABLED');
});

test('cuenta con deleted_at: login -> 403 ACCOUNT_DELETED sin token', async () => {
    const { creds } = await registerUser();
    await q('UPDATE users SET deleted_at = NOW() WHERE email = ?', [creds.email]);
    const login = await post('/api/auth/login', { email: creds.email, pwd: creds.pwd });
    const body = await login.json();
    assert.equal(login.status, 403);
    assert.equal(body.code, 'ACCOUNT_DELETED');
    assert.equal(body.token, undefined);
});

test('cuenta desactivada + contraseña incorrecta -> 401 genérico (no revela el estado)', async () => {
    const { creds } = await registerUser();
    await q('UPDATE users SET is_active = 0 WHERE email = ?', [creds.email]);
    const res = await post('/api/auth/login', { email: creds.email, pwd: 'incorrecta' });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, undefined);
});

// ---------------------------------------------------------------------------
// Fase 1C: /api/users — autenticación, autorización, validación y borrado lógico
// ---------------------------------------------------------------------------

const send = (method, url, body, token) =>
    fetch(`${base}${url}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body)
    });

const dbUser = async (id) => (await q('SELECT * FROM users WHERE user_id = ?', [id]))[0][0];
const PUBLIC_KEYS = ['created_at', 'email', 'full_name', 'is_active', 'phone', 'role', 'updated_at', 'user_id'];

// Usuario insertado directo en la BD + token válido para él.
async function actor(role = 'Participant') {
    const u = await createUser({ role });
    return { ...u, token: tokenFor({ id: u.id, email: u.email }) };
}

const newUserBody = (over = {}) => {
    const n = unique();
    return { full_name: 'Nuevo Usuario', email: `sqltest-${n}@example.test`, phone: `8${n}`.slice(0, 20), pwd: 'Clave-de-prueba-123', ...over };
};

test('sin token: las 5 rutas de /api/users responden 401 TOKEN_MISSING', async () => {
    for (const [method, url] of [['GET', '/api/users'], ['GET', '/api/users/1'], ['POST', '/api/users'], ['PUT', '/api/users/1'], ['DELETE', '/api/users/1']]) {
        const res = await send(method, url, method === 'GET' || method === 'DELETE' ? undefined : {});
        assert.equal(res.status, 401, `${method} ${url}`);
        assert.equal((await res.json()).code, 'TOKEN_MISSING');
    }
});

test('GET /api/users: Participant -> 403; Admin -> 200 sin pwd, y sin cuentas eliminadas', async () => {
    const admin = await actor('Admin');
    const user = await actor();
    const gone = await actor();
    await q('UPDATE users SET deleted_at = NOW(), is_active = 0 WHERE user_id = ?', [gone.id]);

    const denied = await send('GET', '/api/users', undefined, user.token);
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).code, 'FORBIDDEN');

    const res = await send('GET', '/api/users', undefined, admin.token);
    assert.equal(res.status, 200);
    const rows = await res.json();
    assert.ok(Array.isArray(rows));
    for (const row of rows) assert.deepEqual(Object.keys(row).sort(), PUBLIC_KEYS); // nunca pwd
    const ids = rows.map((r) => r.user_id);
    assert.ok(ids.includes(admin.id) && ids.includes(user.id));
    assert.ok(!ids.includes(gone.id));
});

test('GET /api/users/:id: propio -> 200 objeto sin pwd; ajeno -> 403; Admin -> 200; 404; 400', async () => {
    const admin = await actor('Admin');
    const a = await actor();
    const b = await actor();

    const own = await send('GET', `/api/users/${a.id}`, undefined, a.token);
    assert.equal(own.status, 200);
    const body = await own.json();
    assert.deepEqual(Object.keys(body).sort(), PUBLIC_KEYS);
    assert.equal(body.email, a.email);

    const other = await send('GET', `/api/users/${b.id}`, undefined, a.token);
    assert.equal(other.status, 403);

    assert.equal((await send('GET', `/api/users/${b.id}`, undefined, admin.token)).status, 200);
    assert.equal((await send('GET', '/api/users/2147483000', undefined, admin.token)).status, 404);
    assert.equal((await send('GET', '/api/users/abc', undefined, admin.token)).status, 400);

    await q('UPDATE users SET deleted_at = NOW(), is_active = 0 WHERE user_id = ?', [b.id]);
    assert.equal((await send('GET', `/api/users/${b.id}`, undefined, admin.token)).status, 404);
});

test('POST /api/users: Participant -> 403 sin crear nada; Admin -> 201 con hash y rol Participant', async () => {
    const admin = await actor('Admin');
    const user = await actor();
    const denied = newUserBody();
    assert.equal((await send('POST', '/api/users', denied, user.token)).status, 403);
    const [none] = await q('SELECT COUNT(*) AS n FROM users WHERE email = ?', [denied.email]);
    assert.equal(none[0].n, 0);

    // role / is_active del body no se leen
    const payload = newUserBody({ role: 'Admin', is_active: 0 });
    const res = await send('POST', '/api/users', payload, admin.token);
    assert.equal(res.status, 201);
    const { user_id } = await res.json();
    const row = await dbUser(user_id);
    assert.equal(row.email, payload.email);
    assert.notEqual(row.pwd, payload.pwd);
    assert.match(row.pwd, /^\$2[aby]\$/);
    assert.equal(row.role, 'Participant');
    assert.equal(row.is_active, 1);
});

test('POST /api/users: validación 400 y duplicados 409 (se distingue email de teléfono por el nombre de la clave)', async () => {
    const admin = await actor('Admin');

    const missing = await send('POST', '/api/users', { full_name: 'Solo nombre' }, admin.token);
    assert.equal(missing.status, 400);
    const m = await missing.json();
    assert.equal(m.code, 'VALIDATION_ERROR');
    assert.deepEqual(m.fields.sort(), ['email', 'phone', 'pwd']);

    const badEmail = await send('POST', '/api/users', newUserBody({ email: 'no-es-un-correo' }), admin.token);
    assert.equal(badEmail.status, 400);
    assert.deepEqual((await badEmail.json()).fields, ['email']);

    // Un email que contiene la palabra "phone" debe seguir dando EMAIL_TAKEN, no PHONE_TAKEN.
    const first = newUserBody({ email: `sqltest-phone-${unique()}@example.test` });
    assert.equal((await send('POST', '/api/users', first, admin.token)).status, 201);
    const dupEmail = await send('POST', '/api/users', newUserBody({ email: first.email }), admin.token);
    assert.equal(dupEmail.status, 409);
    assert.equal((await dupEmail.json()).code, 'EMAIL_TAKEN');

    const dupPhone = await send('POST', '/api/users', newUserBody({ phone: first.phone }), admin.token);
    assert.equal(dupPhone.status, 409);
    assert.equal((await dupPhone.json()).code, 'PHONE_TAKEN');
});

test('PUT /api/users/:id: el propio usuario edita nombre y teléfono; role/is_active/deleted_at del body se ignoran', async () => {
    const u = await actor();
    const phone = `9${unique()}`.slice(0, 20);
    const res = await send('PUT', `/api/users/${u.id}`, { full_name: '  Nombre Nuevo ', phone, role: 'Admin', is_active: 0, deleted_at: '2020-01-01 00:00:00' }, u.token);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.message, 'User updated');
    assert.deepEqual(Object.keys(body.user).sort(), PUBLIC_KEYS);
    const row = await dbUser(u.id);
    assert.equal(row.full_name, 'Nombre Nuevo'); // recortado
    assert.equal(row.phone, phone);
    assert.equal(row.role, 'Participant');
    assert.equal(row.is_active, 1);
    assert.equal(row.deleted_at, null);
});

test('PUT /api/users/:id: cambia la contraseña (hash nuevo, login con la nueva); pwd vacío no la cambia', async () => {
    const { creds, body } = await registerUser();
    const id = body.user.id;
    const token = body.token;
    const before = (await dbUser(id)).pwd;

    assert.equal((await send('PUT', `/api/users/${id}`, { full_name: 'Solo nombre', pwd: '' }, token)).status, 200);
    assert.equal((await dbUser(id)).pwd, before); // pwd '' = no cambiar

    assert.equal((await send('PUT', `/api/users/${id}`, { pwd: 'Otra-clave-nueva-456' }, token)).status, 200);
    const after = (await dbUser(id)).pwd;
    assert.notEqual(after, before);
    assert.match(after, /^\$2[aby]\$/);
    assert.equal((await post('/api/auth/login', { email: creds.email, pwd: 'Otra-clave-nueva-456' })).status, 200);
    assert.equal((await post('/api/auth/login', { email: creds.email, pwd: creds.pwd })).status, 401);
});

test('PUT /api/users/:id: ajeno -> 403 sin cambios; Admin sí; inexistente o eliminado -> 404', async () => {
    const admin = await actor('Admin');
    const a = await actor();
    const b = await actor();
    const nameBefore = (await dbUser(b.id)).full_name;

    const denied = await send('PUT', `/api/users/${b.id}`, { full_name: 'Hackeado' }, a.token);
    assert.equal(denied.status, 403);
    assert.equal((await dbUser(b.id)).full_name, nameBefore);

    assert.equal((await send('PUT', `/api/users/${b.id}`, { full_name: 'Por Admin' }, admin.token)).status, 200);
    assert.equal((await dbUser(b.id)).full_name, 'Por Admin');

    assert.equal((await send('PUT', '/api/users/2147483000', { full_name: 'X' }, admin.token)).status, 404);
    await q('UPDATE users SET deleted_at = NOW(), is_active = 0 WHERE user_id = ?', [b.id]);
    assert.equal((await send('PUT', `/api/users/${b.id}`, { full_name: 'X' }, admin.token)).status, 404);
});

test('PUT /api/users/:id: validación 400 y duplicados 409', async () => {
    const a = await actor();
    const b = await actor();
    const put = (body) => send('PUT', `/api/users/${a.id}`, body, a.token);

    for (const empty of [{}, { pwd: '' }, { pwd: null }, { nada: 1 }]) {
        const res = await put(empty);
        assert.equal(res.status, 400);
        assert.equal((await res.json()).code, 'NO_FIELDS');
    }
    for (const [body, field] of [
        [{ email: 'sin-arroba' }, 'email'],
        [{ full_name: '' }, 'full_name'],
        [{ full_name: 'x'.repeat(101) }, 'full_name'],
        [{ phone: 12345678 }, 'phone'],
        [{ phone: 'x'.repeat(21) }, 'phone'],
        [{ pwd: 12345678 }, 'pwd'],
        [{ pwd: 'é'.repeat(37) }, 'pwd'] // 74 bytes: bcrypt truncaría a 72
    ]) {
        const res = await put(body);
        assert.equal(res.status, 400, JSON.stringify(body).slice(0, 40));
        assert.deepEqual((await res.json()).fields, [field]);
    }

    const dupEmail = await put({ email: b.email });
    assert.equal(dupEmail.status, 409);
    assert.equal((await dupEmail.json()).code, 'EMAIL_TAKEN');
    const dupPhone = await put({ phone: (await dbUser(b.id)).phone });
    assert.equal(dupPhone.status, 409);
    assert.equal((await dupPhone.json()).code, 'PHONE_TAKEN');
});

test('DELETE /api/users/:id propio: borrado lógico; el token y el login dejan de valer; el perfil se conserva', async () => {
    const { creds, body } = await registerUser();
    const id = body.user.id;
    await q('INSERT INTO user_profile (user_id, first_name) VALUES (?, ?)', [id, 'Conservar']);

    const res = await send('DELETE', `/api/users/${id}`, undefined, body.token);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).message, 'User deleted');

    const row = await dbUser(id); // la fila sigue ahí
    assert.equal(row.is_active, 0);
    assert.notEqual(row.deleted_at, null);
    const [profile] = await q('SELECT first_name FROM user_profile WHERE user_id = ?', [id]);
    assert.equal(profile.length, 1); // antes se borraba

    const me = await get('/api/auth/me', body.token);
    assert.equal(me.status, 401);
    assert.equal((await me.json()).code, 'ACCOUNT_DELETED');
    const login = await post('/api/auth/login', { email: creds.email, pwd: creds.pwd });
    assert.equal(login.status, 403);
    assert.equal((await login.json()).code, 'ACCOUNT_DELETED');

    // Consecuencia conocida: el email sigue reservado por el UNIQUE.
    const again = await post('/api/auth/register', { ...creds, phone: `4${unique()}`.slice(0, 20) });
    assert.equal(again.status, 409);
    assert.equal((await again.json()).code, 'EMAIL_TAKEN');
});

test('DELETE /api/users/:id ajeno -> 403 sin efecto; Admin sí; ya eliminado -> 404', async () => {
    const admin = await actor('Admin');
    const a = await actor();
    const b = await actor();

    assert.equal((await send('DELETE', `/api/users/${b.id}`, undefined, a.token)).status, 403);
    assert.equal((await dbUser(b.id)).deleted_at, null);

    assert.equal((await send('DELETE', `/api/users/${b.id}`, undefined, admin.token)).status, 200);
    assert.notEqual((await dbUser(b.id)).deleted_at, null);
    assert.equal((await send('DELETE', `/api/users/${b.id}`, undefined, admin.token)).status, 404);
});

test('DELETE de un usuario con inscripciones funciona y conserva la inscripción (el borrado físico fallaba por la FK)', async () => {
    const organizer = await actor('Organizer');
    const participant = await actor();
    const [org] = await q('INSERT INTO event_organizers (user_id, display_name) VALUES (?, ?)', [organizer.id, 'sqltest-org']);
    const [ev] = await q(
        "INSERT INTO sport_events (event_organizers_id, title, sport, max_capacity, start_at, end_at) VALUES (?, 'sqltest-evento', 'Futbol', 10, '2030-01-01 10:00:00', '2030-01-01 12:00:00')",
        [org.insertId]
    );
    await q('INSERT INTO event_registrations (sport_event_id, user_id) VALUES (?, ?)', [ev.insertId, participant.id]);

    // Comprobación de la premisa: el DELETE físico sí choca con la clave foránea.
    await assert.rejects(q('DELETE FROM users WHERE user_id = ?', [participant.id]), (e) => e.code === 'ER_ROW_IS_REFERENCED_2');

    const res = await send('DELETE', `/api/users/${participant.id}`, undefined, participant.token);
    assert.equal(res.status, 200);
    const [regs] = await q('SELECT registration_status FROM event_registrations WHERE user_id = ?', [participant.id]);
    assert.equal(regs.length, 1);
});

// ---------------------------------------------------------------------------
// Fase 1D: seguridad de /api/auth (register / login) contra la BD real
// ---------------------------------------------------------------------------

const countUsers = async (email) => (await q('SELECT COUNT(*) AS n FROM users WHERE email = ?', [email]))[0][0].n;

test('register con teléfono repetido -> 409 PHONE_TAKEN (antes respondía "Email already registered")', async () => {
    const { creds } = await registerUser();
    const again = await post('/api/auth/register', { ...creds, email: `sqltest-${unique()}@example.test` }); // mismo phone
    assert.equal(again.status, 409);
    assert.deepEqual(await again.json(), { error: 'Phone already registered', code: 'PHONE_TAKEN' });
});

test('register: un correo que contiene la palabra "phone" repetido sigue siendo EMAIL_TAKEN', async () => {
    const email = `sqltest-phone-${unique()}@example.test`;
    const n = unique();
    const first = await post('/api/auth/register', { full_name: 'Uno', email, phone: `5${n}`.slice(0, 20), pwd: 'Clave-de-prueba-123' });
    assert.equal(first.status, 200);
    const again = await post('/api/auth/register', { full_name: 'Dos', email, phone: `6${unique()}`.slice(0, 20), pwd: 'Clave-de-prueba-123' });
    assert.equal(again.status, 409);
    assert.equal((await again.json()).code, 'EMAIL_TAKEN');
});

test('register: dos solicitudes idénticas simultáneas -> una crea la cuenta y la otra recibe 409 (decide el UNIQUE de la BD)', async () => {
    const n = unique();
    const email = `sqltest-${n}@example.test`;
    const body = (phone) => ({ full_name: 'Carrera', email, phone, pwd: 'Clave-de-prueba-123' });
    const [a, b] = await Promise.all([
        post('/api/auth/register', body(`5${n}`.slice(0, 20))),
        post('/api/auth/register', body(`6${n}`.slice(0, 20)))
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.equal(await countUsers(email), 1);
});

test('register ignora role, is_active, user_id y deleted_at del body: la cuenta queda Participant y activa', async () => {
    const n = unique();
    const email = `sqltest-${n}@example.test`;
    const res = await post('/api/auth/register', {
        full_name: 'Intento', email, phone: `5${n}`.slice(0, 20), pwd: 'Clave-de-prueba-123',
        role: 'Admin', is_active: 0, user_id: 1, deleted_at: '2020-01-01 00:00:00'
    });
    assert.equal(res.status, 200);
    const { user } = await res.json();
    assert.notEqual(user.id, 1);
    const row = (await q('SELECT user_id, role, is_active, deleted_at FROM users WHERE email = ?', [email]))[0][0];
    assert.equal(row.user_id, user.id);
    assert.equal(row.role, 'Participant');
    assert.equal(row.is_active, 1);
    assert.equal(row.deleted_at, null);
});

test('register con valores fuera de los límites de las columnas -> 400 de validación, no un 500 de MySQL con el nombre de la columna', async () => {
    const n = unique();
    const email = `sqltest-${n}@example.test`;
    for (const over of [{ full_name: 'x'.repeat(101) }, { phone: '1'.repeat(21) }, { pwd: 'é'.repeat(37) }]) {
        const res = await post('/api/auth/register', { full_name: 'Ana', email, phone: `5${n}`.slice(0, 20), pwd: 'Clave-de-prueba-123', ...over });
        const text = await res.text();
        assert.equal(res.status, 400, JSON.stringify(over).slice(0, 40));
        assert.equal(JSON.parse(text).code, 'VALIDATION_ERROR');
        assert.ok(!/Data too long|column/i.test(text));
    }
    assert.equal(await countUsers(email), 0);
});

test('register con tipos inesperados (número, objeto, arreglo) -> 400 y no se crea la cuenta', async () => {
    const n = unique();
    const email = `sqltest-${n}@example.test`;
    for (const over of [{ pwd: 12345678 }, { phone: 3001112233 }, { full_name: ['Ana'] }, { email: { email } }]) {
        const res = await post('/api/auth/register', { full_name: 'Ana', email, phone: `5${n}`.slice(0, 20), pwd: 'Clave-de-prueba-123', ...over });
        assert.equal(res.status, 400, JSON.stringify(over));
    }
    assert.equal(await countUsers(email), 0);
});

test('login con tipos inesperados -> 400 y el servidor sigue respondiendo (con pwd numérico antes colgaba la petición y tumbaba el proceso)', async () => {
    const { creds } = await registerUser(); // el correo EXISTE: es el caso que llegaba a bcrypt.compare
    for (const body of [
        { email: creds.email, pwd: 12345678 },
        { email: creds.email, pwd: ['x'] },
        { email: creds.email, pwd: { a: 1 } },
        { email: { email: 1 }, pwd: creds.pwd }
    ]) {
        const res = await post('/api/auth/login', body);
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.equal((await res.json()).code, 'VALIDATION_ERROR');
    }
    assert.equal((await post('/api/auth/login', { email: creds.email, pwd: creds.pwd })).status, 200);
});

test('login sin cuerpo JSON -> 400', async () => {
    const res = await fetch(`${base}/api/auth/login`, { method: 'POST' });
    assert.equal(res.status, 400);
});

test('login con espacios alrededor del correo -> 200 (se recorta igual que en el registro)', async () => {
    const { creds } = await registerUser();
    const res = await post('/api/auth/login', { email: `  ${creds.email} `, pwd: creds.pwd });
    assert.equal(res.status, 200);
});

test('login: correo inexistente y contraseña incorrecta dan exactamente la misma respuesta', async () => {
    const { creds } = await registerUser();
    const wrong = await post('/api/auth/login', { email: creds.email, pwd: 'incorrecta' });
    const unknown = await post('/api/auth/login', { email: `sqltest-nadie-${unique()}@example.test`, pwd: creds.pwd });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(await wrong.json(), await unknown.json());
});

test('un error REAL de MySQL en register y login no llega al cliente ni al log (se provoca renombrando una columna de la BD de pruebas)', async (t) => {
    const [cols] = await q("SHOW COLUMNS FROM users LIKE 'phone'");
    assert.equal(cols.length, 1, 'la columna users.phone no existe: ejecuta npm run db:reset:test');

    const spy = t.mock.method(console, 'error', () => {});
    const { creds } = await registerUser(); // cuenta creada ANTES de romper el esquema
    let registerRes, registerText, loginRes, loginText;
    await q('ALTER TABLE users RENAME COLUMN phone TO phone_x');
    try {
        const n = unique();
        registerRes = await post('/api/auth/register', { full_name: 'Falla', email: `sqltest-${n}@example.test`, phone: `5${n}`.slice(0, 20), pwd: 'Clave-de-prueba-123' });
        registerText = await registerRes.text();
        loginRes = await post('/api/auth/login', { email: creds.email, pwd: creds.pwd });
        loginText = await loginRes.text();
    } finally {
        await q('ALTER TABLE users RENAME COLUMN phone_x TO phone'); // siempre se restaura el esquema
    }

    for (const [status, text] of [[registerRes.status, registerText], [loginRes.status, loginText]]) {
        assert.equal(status, 500);
        assert.deepEqual(JSON.parse(text), { error: 'Internal error', code: 'DB_ERROR' });
        assert.ok(!/phone|INSERT|SELECT|users|sportanet|Unknown column/i.test(text), `la respuesta filtró: ${text}`);
    }
    const log = spy.mock.calls.map((c) => c.arguments.map(String).join(' ')).join('\n');
    assert.match(log, /ER_BAD_FIELD_ERROR/);
    assert.ok(!/phone|INSERT|SELECT|Clave-de-prueba|\$2[aby]\$/i.test(log), `el log filtró: ${log}`);
    assert.equal((await q("SHOW COLUMNS FROM users LIKE 'phone'"))[0].length, 1); // esquema restaurado
});

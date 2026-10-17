// backend/test/authenticate.test.js
// Pruebas del middleware JWT + verificación de cuenta. No requieren MySQL:
// findUserById se inyecta con un doble en memoria. Ejecutar: npm test
const { test, before, beforeEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SECRET = 'test-secret-only-for-unit-tests-0123456789abcdef';
process.env.JWT_SECRET = SECRET;

const express = require('express');
const jwt = require('jsonwebtoken');
const createAuthenticate = require('../middleware/authenticate');

// ---- Doble en memoria de la BD (tabla users) ----
const users = new Map();
let lookups = [];   // ids con los que se consultó la "BD"
let dbError = null; // si es un Error, findUserById lo lanza

const findUserById = async (id) => {
    lookups.push(id);
    if (dbError) throw dbError;
    return users.get(id) ?? null;
};

const activeUser = (over = {}) => ({
    user_id: 7,
    email: 'a@b.co',
    role: 'Participant',
    is_active: 1,
    deleted_at: null,
    ...over
});

let server, base;

before(async () => {
    const app = express();
    app.use(express.json());
    const authenticate = createAuthenticate({ findUserById });
    // Devuelve la identidad según el middleware, ignorando cualquier user_id del cliente
    app.post('/protected', authenticate, (req, res) => res.json({ auth: req.auth, claimed: req.body.user_id }));
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
    users.clear();
    users.set(7, activeUser());
    lookups = [];
    dbError = null;
});

after(() => server.close());

const call = (token, rawHeader, body = {}) =>
    fetch(`${base}/protected`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(rawHeader ? { Authorization: rawHeader } : token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(body)
    });

const sign = (payload = { id: 7, email: 'a@b.co' }, opts = { expiresIn: '1h' }) => jwt.sign(payload, SECRET, opts);

// Un token rechazado por sí mismo no debe llegar a consultar la BD.
const assertNoLookup = () => assert.deepEqual(lookups, []);

// ---------------------------------------------------------------------------
// Validación del token (comportamiento de Fase 1A, sin cambios)
// ---------------------------------------------------------------------------

test('token válido y cuenta activa -> 200 e identidad tomada del token/BD, no del body', async () => {
    const res = await call(sign(), null, { user_id: 999 });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.deepEqual(json.auth, { userId: 7, email: 'a@b.co', role: 'Participant' });
    assert.equal(json.claimed, 999); // el cliente lo envió, pero no se usa como identidad
    assert.deepEqual(lookups, [7]);  // la cuenta se consultó con el id del token, no con el del body
});

test('token ausente -> 401 TOKEN_MISSING', async () => {
    const res = await call();
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'TOKEN_MISSING');
    assertNoLookup();
});

test('header mal formado -> 401 TOKEN_MALFORMED', async () => {
    const res = await call(null, 'Token abc');
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'TOKEN_MALFORMED');
    assertNoLookup();
});

test('token inválido (basura) -> 401 TOKEN_INVALID', async () => {
    const res = await call('no.es.un-jwt');
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'TOKEN_INVALID');
    assertNoLookup();
});

test('token firmado con otro secreto -> 401 TOKEN_INVALID', async () => {
    const res = await call(jwt.sign({ id: 7, email: 'a@b.co' }, 'otro-secreto', { expiresIn: '1h' }));
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'TOKEN_INVALID');
    assertNoLookup();
});

test('token alg=none -> 401 TOKEN_INVALID', async () => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const forged = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ id: 1, email: 'x@y.z' })}.`;
    const res = await call(forged);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'TOKEN_INVALID');
    assertNoLookup();
});

test('token expirado -> 401 TOKEN_EXPIRED', async () => {
    const res = await call(sign({ id: 7, email: 'a@b.co' }, { expiresIn: -60 }));
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'TOKEN_EXPIRED');
    assertNoLookup();
});

test('token válido sin id utilizable -> 401 TOKEN_INVALID', async () => {
    const res = await call(sign({ email: 'a@b.co' }));
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'TOKEN_INVALID');
    assertNoLookup();
});

// ---------------------------------------------------------------------------
// Estado de la cuenta (Fase 1B)
// ---------------------------------------------------------------------------

test('cuenta desactivada (is_active = 0) con token válido -> 401 ACCOUNT_DISABLED', async () => {
    users.set(7, activeUser({ is_active: 0 }));
    const res = await call(sign());
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('www-authenticate'), 'Bearer');
    assert.equal((await res.json()).code, 'ACCOUNT_DISABLED');
});

test('cuenta con deleted_at (aunque is_active = 1) -> 401 ACCOUNT_DELETED', async () => {
    users.set(7, activeUser({ is_active: 1, deleted_at: new Date('2026-10-01T00:00:00Z') }));
    const res = await call(sign());
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'ACCOUNT_DELETED');
});

test('usuario inexistente en BD (borrado físico) con token válido -> 401 ACCOUNT_DELETED', async () => {
    users.delete(7);
    const res = await call(sign());
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'ACCOUNT_DELETED');
});

test('fallo de BD -> 500 DB_ERROR sin filtrar el detalle del error', async (t) => {
    const logged = t.mock.method(console, 'error', () => {}); // evita ruido en la salida del test
    dbError = Object.assign(new Error('ER_ACCESS_DENIED: password=hunter2'), { code: 'ER_ACCESS_DENIED_ERROR' });
    const res = await call(sign());
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.equal(JSON.parse(text).code, 'DB_ERROR');
    assert.ok(!text.includes('hunter2') && !text.includes('ER_ACCESS_DENIED'));
    assert.equal(logged.mock.callCount(), 1); // sí queda registrado en el servidor
});

test('email y rol salen de la BD; un "role" dentro del token se ignora', async () => {
    users.set(7, activeUser({ email: 'nuevo@b.co', role: 'Participant' }));
    // Token con email viejo y que intenta autoasignarse Admin
    const res = await call(sign({ id: 7, email: 'viejo@b.co', role: 'Admin' }));
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).auth, { userId: 7, email: 'nuevo@b.co', role: 'Participant' });
});

test('createAuthenticate sin findUserById lanza TypeError al construir', () => {
    assert.throws(() => createAuthenticate(), TypeError);
    assert.throws(() => createAuthenticate({}), TypeError);
    assert.throws(() => createAuthenticate({ findUserById: 'no-es-funcion' }), TypeError);
});

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

test('JWT_SECRET vacío -> config/jwt.js lanza error (sin depender del filesystem ni de .env)', () => {
    // dotenv no sobrescribe variables ya presentes en process.env (ni vacías),
    // así que JWT_SECRET='' se mantiene aunque backend/.env tenga un valor.
    const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.resolve(__dirname, '../config/jwt'))})`], {
        env: { ...process.env, JWT_SECRET: '' },
        encoding: 'utf8'
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /JWT_SECRET no está definido/);
});

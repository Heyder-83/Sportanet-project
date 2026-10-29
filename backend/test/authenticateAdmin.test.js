// backend/test/authenticateAdmin.test.js
// Pruebas del middleware JWT de administradores (SPNdev.2). No requieren MySQL: findAdminById se inyecta con un
// doble en memoria. Ejecutar: npm test
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const USER_SECRET = 'test-user-secret-for-admin-middleware-0123456789abcdef';
const ADMIN_SECRET = 'test-admin-secret-for-admin-middleware-0123456789abcdef';
process.env.JWT_SECRET = USER_SECRET;
process.env.ADMIN_JWT_SECRET = ADMIN_SECRET;

const express = require('express');
const jwt = require('jsonwebtoken');
const createAuthenticateAdmin = require('../middleware/authenticateAdmin');
const createAuthenticate = require('../middleware/authenticate');

// ---- Doble en memoria de SPN_AD ----
const adminsTable = new Map();
let lookups = [];
let dbError = null;
const findAdminById = async (id) => {
    lookups.push(id);
    if (dbError) throw dbError;
    return adminsTable.get(id) ?? null;
};
const admin = (over = {}) => ({ admin_id: 7, full_name: 'Ana Admin', status: 'active', ...over });
const sign = (payload, secret = ADMIN_SECRET, opts = { expiresIn: '5m' }) => jwt.sign(payload, secret, opts);
const goodToken = (over = {}) => sign({ aid: 7, typ: 'admin', ...over });

let server, base;
before(async () => {
    const app = express();
    app.use(express.json());
    app.post('/admin-protected', createAuthenticateAdmin({ findAdminById }), (req, res) =>
        res.json({ adminAuth: req.adminAuth, claimed: req.body.admin_id, userAuth: req.auth ?? null }));
    // Una ruta de USUARIOS con el middleware real de usuarios, para comprobar que no acepta tokens de administrador.
    app.post('/user-protected', createAuthenticate({ findUserById: async (id) => ({ user_id: id, email: 'u@x.co', role: 'Participant', is_active: 1, deleted_at: null }) }),
        (req, res) => res.json({ auth: req.auth }));
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {
    adminsTable.clear();
    adminsTable.set(7, admin());
    lookups = [];
    dbError = null;
});
after(() => server.close());

const callAdmin = (token, rawHeader, body = {}) => fetch(`${base}/admin-protected`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(rawHeader ? { Authorization: rawHeader } : token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
});

test('token de administrador válido y cuenta activa -> 200; identidad desde el token y la BD, nunca del body', async () => {
    const res = await callAdmin(goodToken(), undefined, { admin_id: 999 });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.adminAuth, { adminId: 7, fullName: 'Ana Admin' });
    assert.equal(body.claimed, 999); // el body llega, pero no se usa como identidad
    assert.equal(body.userAuth, null); // no se mezcla con la identidad de los usuarios
    assert.deepEqual(lookups, [7]);
});

test('sin token, mal formado o con firma inválida -> 401 con su código y sin consultar la BD', async () => {
    const cases = [
        [callAdmin(), 'TOKEN_MISSING'],
        [callAdmin(undefined, 'Token abc'), 'TOKEN_MALFORMED'],
        [callAdmin(undefined, 'Bearer'), 'TOKEN_MALFORMED'],
        [callAdmin('no.es.un.jwt'), 'TOKEN_INVALID'],
        [callAdmin(sign({ aid: 7, typ: 'admin' }, 'otro-secreto-distinto-de-32-caracteres-o-mas-0123')), 'TOKEN_INVALID']
    ];
    for (const [pending, code] of cases) {
        const res = await pending;
        assert.equal(res.status, 401);
        assert.equal(res.headers.get('www-authenticate'), 'Bearer');
        assert.equal((await res.json()).code, code);
    }
    assert.deepEqual(lookups, []);
});

test('token caducado -> 401 TOKEN_EXPIRED', async () => {
    const res = await callAdmin(sign({ aid: 7, typ: 'admin' }, ADMIN_SECRET, { expiresIn: -10 }));
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'TOKEN_EXPIRED');
});

test('un token de USUARIO (firmado con JWT_SECRET) no sirve como token de administrador', async () => {
    const res = await callAdmin(sign({ id: 7, email: 'a@b.co' }, USER_SECRET));
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'TOKEN_INVALID');
    assert.deepEqual(lookups, []);
});

test('un token de ADMINISTRADOR no sirve en las rutas de usuarios (secretos distintos): no hay confusión admin_id / user_id', async () => {
    const res = await fetch(`${base}/user-protected`, { method: 'POST', headers: { Authorization: `Bearer ${goodToken()}` } });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'TOKEN_INVALID');
});

test('claims inválidos con firma correcta -> 401 TOKEN_INVALID: sin typ admin, typ distinto, aid ausente, no entero, cero o negativo', async () => {
    const bad = [{ aid: 7 }, { aid: 7, typ: 'user' }, { typ: 'admin' }, { aid: 'abc', typ: 'admin' }, { aid: 1.5, typ: 'admin' },
        { aid: 0, typ: 'admin' }, { aid: -3, typ: 'admin' }, { aid: null, typ: 'admin' }, { id: 7, typ: 'admin' }];
    for (const payload of bad) {
        const res = await callAdmin(sign(payload));
        assert.equal(res.status, 401, JSON.stringify(payload));
        assert.equal((await res.json()).code, 'TOKEN_INVALID', JSON.stringify(payload));
    }
    assert.deepEqual(lookups, []);
});

test('token con algoritmo "none" o HS512 -> 401 (el algoritmo está fijado a HS256)', async () => {
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"aid":7,"typ":"admin"}').toString('base64url')}.`;
    assert.equal((await callAdmin(none)).status, 401);
    assert.equal((await callAdmin(jwt.sign({ aid: 7, typ: 'admin' }, ADMIN_SECRET, { algorithm: 'HS512' }))).status, 401);
});

test('cuenta inexistente -> 401 ADMIN_NOT_FOUND; suspendida o pendiente -> 401 ADMIN_SUSPENDED (un JWT vigente no basta)', async () => {
    adminsTable.delete(7);
    let res = await callAdmin(goodToken());
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'ADMIN_NOT_FOUND');
    for (const status of ['suspended', 'pending']) {
        adminsTable.set(7, admin({ status }));
        res = await callAdmin(goodToken());
        assert.equal(res.status, 401, status);
        assert.equal((await res.json()).code, 'ADMIN_SUSPENDED', status);
    }
});

test('el estado se consulta en cada petición: suspender a un admin con sesión abierta corta el acceso', async () => {
    const token = goodToken();
    assert.equal((await callAdmin(token)).status, 200);
    adminsTable.set(7, admin({ status: 'suspended' }));
    assert.equal((await callAdmin(token)).status, 401);
    adminsTable.set(7, admin({ status: 'active' }));
    assert.equal((await callAdmin(token)).status, 200); // reactivarlo restablece el acceso con el mismo token vigente
});

test('error de BD al consultar la cuenta -> 500 genérico, sin detalles ni SQL', async (t) => {
    const spy = t.mock.method(console, 'error', () => {});
    dbError = Object.assign(new Error("Unknown column 'status'"), { code: 'ER_BAD_FIELD_ERROR', sql: 'SELECT secret FROM admins' });
    const res = await callAdmin(goodToken());
    const text = await res.text();
    assert.equal(res.status, 500);
    assert.deepEqual(JSON.parse(text), { error: 'Internal error', code: 'DB_ERROR' });
    assert.ok(!/status|SELECT|admins/.test(text));
    const log = spy.mock.calls.map((c) => c.arguments.map(String).join(' ')).join('\n');
    assert.match(log, /ER_BAD_FIELD_ERROR/);
    assert.ok(!/Unknown column|SELECT/.test(log));
});

test('createAuthenticateAdmin exige findAdminById (falla al construir, no en la primera petición)', () => {
    assert.throws(() => createAuthenticateAdmin(), TypeError);
    assert.throws(() => createAuthenticateAdmin({}), TypeError);
    assert.throws(() => createAuthenticateAdmin({ findAdminById: 'no soy una función' }), TypeError);
});

// ---- config/adminJwt.js: falla cerrado (cada caso en un proceso aparte) ----
const BACKEND = path.resolve(__dirname, '..');
function loadConfig(env) {
    const r = spawnSync(process.execPath, ['-e', "require('./config/adminJwt'); process.exit(0)"], {
        cwd: BACKEND, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8'
    });
    return { ok: r.status === 0, stderr: r.stderr };
}

test('config/adminJwt falla al cargarse si ADMIN_JWT_SECRET falta, está vacío, es corto o coincide con JWT_SECRET o TSU_HMAC_KEY', () => {
    // Cadena vacía (no ausente): dotenv no pisa variables ya definidas, así que un backend/.env real no interfiere.
    const ok = { ADMIN_JWT_SECRET: ADMIN_SECRET, JWT_SECRET: USER_SECRET, TSU_HMAC_KEY: 'otra-clave-distinta-0123456789abcdef-xyz' };
    assert.equal(loadConfig(ok).ok, true);
    assert.match(loadConfig({ ...ok, ADMIN_JWT_SECRET: '' }).stderr, /ADMIN_JWT_SECRET no está definido/);
    assert.match(loadConfig({ ...ok, ADMIN_JWT_SECRET: '   ' }).stderr, /ADMIN_JWT_SECRET no está definido/);
    assert.match(loadConfig({ ...ok, ADMIN_JWT_SECRET: 'corto' }).stderr, /al menos 32/);
    assert.match(loadConfig({ ...ok, ADMIN_JWT_SECRET: USER_SECRET }).stderr, /JWT_SECRET/);
    assert.match(loadConfig({ ...ok, ADMIN_JWT_SECRET: ok.TSU_HMAC_KEY }).stderr, /TSU_HMAC_KEY/);
});

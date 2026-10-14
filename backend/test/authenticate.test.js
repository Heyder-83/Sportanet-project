// backend/test/authenticate.test.js
// Pruebas del middleware JWT. No requieren MySQL. Ejecutar: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const SECRET = 'test-secret-only-for-unit-tests-0123456789abcdef';
process.env.JWT_SECRET = SECRET;

const express = require('express');
const jwt = require('jsonwebtoken');
const authenticate = require('../middleware/authenticate');

let server, base;

before(async () => {
    const app = express();
    app.use(express.json());
    // Devuelve la identidad según el middleware, ignorando cualquier user_id del cliente
    app.post('/protected', authenticate, (req, res) => res.json({ auth: req.auth, claimed: req.body.user_id }));
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
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

test('token válido -> 200 e identidad tomada del token, no del body', async () => {
    const token = jwt.sign({ id: 7, email: 'a@b.co' }, SECRET, { expiresIn: '1h' });
    const res = await call(token, null, { user_id: 999 });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.deepEqual(json.auth, { userId: 7, email: 'a@b.co' });
    assert.equal(json.claimed, 999); // el cliente lo envió, pero no se usa como identidad
});

test('token ausente -> 401 TOKEN_MISSING', async () => {
    const res = await call();
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'TOKEN_MISSING');
});

test('header mal formado -> 401 TOKEN_MALFORMED', async () => {
    const res = await call(null, 'Token abc');
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'TOKEN_MALFORMED');
});

test('token inválido (basura) -> 401 TOKEN_INVALID', async () => {
    const res = await call('no.es.un-jwt');
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'TOKEN_INVALID');
});

test('token firmado con otro secreto -> 401 TOKEN_INVALID', async () => {
    const res = await call(jwt.sign({ id: 7, email: 'a@b.co' }, 'otro-secreto', { expiresIn: '1h' }));
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'TOKEN_INVALID');
});

test('token alg=none -> 401 TOKEN_INVALID', async () => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const forged = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ id: 1, email: 'x@y.z' })}.`;
    const res = await call(forged);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'TOKEN_INVALID');
});

test('token expirado -> 401 TOKEN_EXPIRED', async () => {
    const token = jwt.sign({ id: 7, email: 'a@b.co' }, SECRET, { expiresIn: -60 });
    const res = await call(token);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'TOKEN_EXPIRED');
});

test('token válido sin id utilizable -> 401 TOKEN_INVALID', async () => {
    const res = await call(jwt.sign({ email: 'a@b.co' }, SECRET, { expiresIn: '1h' }));
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'TOKEN_INVALID');
});

test('sin JWT_SECRET el módulo de configuración falla al cargarse', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sportanet-nodotenv-'));
    const env = { ...process.env };
    delete env.JWT_SECRET;
    const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.resolve(__dirname, '../config/jwt'))})`], {
        cwd: emptyDir, // sin .env aquí
        env,
        encoding: 'utf8'
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /JWT_SECRET no está definido/);
});

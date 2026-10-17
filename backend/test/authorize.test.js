// backend/test/authorize.test.js
// Pruebas unitarias de middleware/authorize.js. No requieren MySQL. Ejecutar: npm test
// (si "test" en package.json lista los archivos uno a uno, añade este archivo a la lista).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { requireRole, parseIdParam, requireSelfOrAdmin, ROLES } = require('../middleware/authorize');

let server, base;

// Simula lo que deja authenticate: la identidad viene del encabezado de prueba x-test-auth (JSON).
// Sin encabezado = ruta montada sin authenticate (req.auth indefinido).
before(async () => {
    const app = express();
    app.use((req, res, next) => {
        if (req.headers['x-test-auth']) req.auth = JSON.parse(req.headers['x-test-auth']);
        next();
    });
    app.get('/admin-only', requireRole(ROLES.ADMIN), (req, res) => res.json({ ok: true }));
    app.get('/staff', requireRole(ROLES.ADMIN, ROLES.ORGANIZER), (req, res) => res.json({ ok: true }));
    app.get('/u/:id', parseIdParam, requireSelfOrAdmin, (req, res) => res.json({ ok: true, targetId: req.targetId }));
    app.get('/misuse/:id', requireSelfOrAdmin, (req, res) => res.json({ ok: true })); // falta parseIdParam
    app.use((err, req, res, next) => res.status(500).json({ error: 'Error interno' }));
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const as = (auth) => ({ headers: auth ? { 'x-test-auth': JSON.stringify(auth) } : {} });
const participant = (userId = 7) => ({ userId, email: 'p@t.co', role: 'Participant' });
const admin = { userId: 1, email: 'a@t.co', role: 'Admin' };
const organizer = { userId: 3, email: 'o@t.co', role: 'Organizer' };

test('requireRole: Admin pasa a una ruta solo-Admin', async () => {
    const res = await fetch(`${base}/admin-only`, as(admin));
    assert.equal(res.status, 200);
});

test('requireRole: Participant y Organizer reciben 403 FORBIDDEN en una ruta solo-Admin', async () => {
    for (const who of [participant(), organizer]) {
        const res = await fetch(`${base}/admin-only`, as(who));
        assert.equal(res.status, 403);
        assert.equal((await res.json()).code, 'FORBIDDEN');
    }
});

test('requireRole con varios roles: Organizer y Admin pasan, Participant no', async () => {
    assert.equal((await fetch(`${base}/staff`, as(organizer))).status, 200);
    assert.equal((await fetch(`${base}/staff`, as(admin))).status, 200);
    assert.equal((await fetch(`${base}/staff`, as(participant()))).status, 403);
});

test('requireRole sin req.auth (montado sin authenticate) -> 401, falla cerrado', async () => {
    const res = await fetch(`${base}/admin-only`);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'TOKEN_MISSING');
});

test('requireRole con un rol desconocido en req.auth -> 403', async () => {
    const res = await fetch(`${base}/admin-only`, as({ userId: 9, email: 'x@t.co', role: 'admin' })); // minúscula
    assert.equal(res.status, 403);
});

test('parseIdParam rechaza ids no válidos con 400 INVALID_ID', async () => {
    for (const bad of ['abc', '0', '-1', '1.5', '007', '1e3', '2147483648', '99999999999', '%20']) {
        const res = await fetch(`${base}/u/${bad}`, as(admin));
        assert.equal(res.status, 400, `id "${bad}" debería dar 400`);
        assert.equal((await res.json()).code, 'INVALID_ID');
    }
});

test('parseIdParam acepta enteros positivos hasta el máximo de int', async () => {
    for (const ok of ['1', '42', '2147483647']) {
        const res = await fetch(`${base}/u/${ok}`, as(admin));
        assert.equal(res.status, 200, `id "${ok}" debería pasar`);
        assert.equal((await res.json()).targetId, Number(ok));
    }
});

test('requireSelfOrAdmin: un usuario accede a su propio id', async () => {
    const res = await fetch(`${base}/u/7`, as(participant(7)));
    assert.equal(res.status, 200);
});

test('requireSelfOrAdmin: un usuario NO accede al id de otro (403)', async () => {
    const res = await fetch(`${base}/u/8`, as(participant(7)));
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'FORBIDDEN');
});

test('requireSelfOrAdmin: Admin accede a cualquier id', async () => {
    assert.equal((await fetch(`${base}/u/8`, as(admin))).status, 200);
});

test('requireSelfOrAdmin: un Organizer no gana acceso a cuentas ajenas por serlo', async () => {
    assert.equal((await fetch(`${base}/u/8`, as(organizer))).status, 403);
    assert.equal((await fetch(`${base}/u/3`, as(organizer))).status, 200); // el suyo sí
});

test('requireSelfOrAdmin sin req.auth -> 401', async () => {
    const res = await fetch(`${base}/u/7`);
    assert.equal(res.status, 401);
});

test('requireSelfOrAdmin sin parseIdParam antes -> falla ruidosa (500), no autoriza en silencio', async () => {
    const res = await fetch(`${base}/misuse/7`, as(participant(7)));
    assert.equal(res.status, 500);
});

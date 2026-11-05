// backend/test/adminLogin.test.js
// Pruebas unitarias de POST /api/admin/login y GET /api/admin/me (SPNdev.2). Sin MySQL: db/connectionAd se
// sustituye por un pool simulado con estado (tabla admins + admin_logins en memoria) y se ejecutan el router,
// db/admins.js, el middleware, jsonwebtoken y bcrypt REALES. Contra BD real: test/integration/spn_ad.test.js.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.TSU_HMAC_KEY = 'test-hmac-key-only-for-admin-login-tests-0123456789abcdef';
process.env.JWT_SECRET = 'test-user-secret-for-admin-login-tests-0123456789abcdef';
const ADMIN_SECRET = 'test-admin-secret-for-admin-login-tests-0123456789abcdef';
process.env.ADMIN_JWT_SECRET = ADMIN_SECRET;

// ---- Pool simulado con estado ----
let table;      // Map admin_id -> fila
let logins;     // [{admin_id, outcome}]
let calls;
let tx;
let now;        // reloj simulado (ms)
let failOn = null;
const fakeQuery = async (sql, params = []) => {
    calls.push({ sql, params });
    if (failOn && failOn.test(sql)) throw Object.assign(new Error('boom'), { code: 'ER_LOCK_DEADLOCK', sql });
    if (sql.includes('FROM admins WHERE admin_id = ? FOR UPDATE')) {
        const r = table.get(params[0]);
        if (!r) return [[], undefined];
        const locked = r.locked_until !== null && r.locked_until > now;
        return [[{ ...r, is_locked: locked ? 1 : 0, retry_after: locked ? Math.ceil((r.locked_until - now) / 1000) : null }], undefined];
    }
    if (sql.startsWith('SELECT admin_id, full_name, status FROM admins')) {
        const r = table.get(params[0]);
        return [r ? [{ admin_id: r.admin_id, full_name: r.full_name, status: r.status }] : [], undefined];
    }
    if (sql.startsWith('UPDATE admins SET failed_attempts = ?, locked_until = IF')) {
        const [attempts, lock, minutes, id] = params;
        const r = table.get(id);
        r.failed_attempts = attempts;
        r.locked_until = lock ? now + minutes * 60000 : null;
        return [{ affectedRows: 1 }, undefined];
    }
    if (sql.startsWith('UPDATE admins SET failed_attempts = 0, locked_until = NULL')) {
        const r = table.get(params[0]);
        r.failed_attempts = 0; r.locked_until = null;
        return [{ affectedRows: 1 }, undefined];
    }
    if (sql.startsWith('INSERT INTO admin_logins')) {
        if (sql.includes("'bad_password'), (?, 'locked'")) {
            logins.push({ admin_id: params[0], outcome: 'bad_password' }, { admin_id: params[1], outcome: 'locked' });
        } else {
            const outcome = /'(success|bad_password|locked)'/.exec(sql)[1];
            logins.push({ admin_id: params[0], outcome });
        }
        return [{ affectedRows: 1 }, undefined];
    }
    throw new Error(`SQL inesperada en la prueba: ${sql}`);
};
const fakePool = {
    promise: () => ({
        query: fakeQuery,
        getConnection: async () => ({
            query: fakeQuery,
            beginTransaction: async () => { tx.push('begin'); },
            commit: async () => { tx.push('commit'); },
            rollback: async () => { tx.push('rollback'); },
            release: () => { tx.push('release'); }
        })
    })
};
const connPath = require.resolve('../db/connectionAd');
require.cache[connPath] = { id: connPath, filename: connPath, loaded: true, exports: fakePool };
// El reloj de MySQL (NOW()) lo gobierna la prueba, no Date.now().

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const adminRouter = require('../routes/adminAuth');

const PWD = 'Clave-admin-1';
let HASH;
let server, base;
before(async () => {
    HASH = await bcrypt.hash(PWD, 4); // coste bajo: solo en pruebas
    const app = express();
    app.use(express.json());
    app.use('/api/admin', adminRouter);
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}/api/admin`;
});
const row = (over = {}) => ({ admin_id: 7, full_name: 'Ana Admin', pwd: HASH, status: 'active', failed_attempts: 0, locked_until: null, ...over });
beforeEach(() => {
    table = new Map([[7, row()]]);
    logins = []; calls = []; tx = []; now = 1_000_000_000; failOn = null;
});
after(() => server.close());

const login = (body) => fetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const outcomes = () => logins.map((l) => l.outcome);
const capture = (t) => {
    const spies = ['log', 'warn', 'error'].map((m) => t.mock.method(console, m, () => {}));
    return () => spies.flatMap((s) => s.mock.calls.map((c) => c.arguments.map(String).join(' '))).join('\n');
};

test('login correcto -> 200 con token de admin (aid, typ, HS256, 30 min), contador a cero y fila success', async (t) => {
    const logs = capture(t);
    table.get(7).failed_attempts = 3;
    const res = await login({ admin_id: 7, pwd: PWD });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.message, 'Login successful');
    assert.deepEqual(body.admin, { id: 7, full_name: 'Ana Admin' });
    assert.deepEqual(Object.keys(body).sort(), ['admin', 'message', 'token']);
    const p = jwt.verify(body.token, ADMIN_SECRET, { algorithms: ['HS256'] });
    assert.equal(p.aid, 7);
    assert.equal(p.typ, 'admin');
    assert.equal(p.exp - p.iat, 1800);
    assert.throws(() => jwt.verify(body.token, process.env.JWT_SECRET), /invalid signature/);
    assert.equal(table.get(7).failed_attempts, 0);
    assert.equal(table.get(7).locked_until, null);
    assert.deepEqual(outcomes(), ['success']);
    assert.ok(!logs().includes(PWD) && !logs().includes(body.token) && !logs().includes(HASH));
});

test('admin_id como texto de dígitos también vale (formulario)', async () => {
    assert.equal((await login({ admin_id: '7', pwd: PWD })).status, 200);
});

test('el token emitido abre /me y /me devuelve solo id y nombre', async () => {
    const { token } = await (await login({ admin_id: 7, pwd: PWD })).json();
    const res = await fetch(`${base}/me`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { id: 7, full_name: 'Ana Admin' });
    assert.equal((await fetch(`${base}/me`)).status, 401);
});

test('validación: admin_id y pwd inválidos -> 400 VALIDATION_ERROR sin tocar la BD', async () => {
    const bad = [{}, { admin_id: 'abc', pwd: PWD }, { admin_id: 0, pwd: PWD }, { admin_id: -1, pwd: PWD }, { admin_id: 1.5, pwd: PWD },
        { admin_id: '007', pwd: PWD }, { admin_id: 2147483648, pwd: PWD }, { admin_id: '1; DROP', pwd: PWD }, { admin_id: [7], pwd: PWD },
        { admin_id: 7 }, { admin_id: 7, pwd: '' }, { admin_id: 7, pwd: 123 }, { admin_id: 7, pwd: 'x'.repeat(73) }];
    for (const b of bad) {
        const res = await login(b);
        assert.equal(res.status, 400, JSON.stringify(b));
        assert.equal((await res.json()).code, 'VALIDATION_ERROR');
    }
    assert.equal(calls.length, 0);
    const res = await fetch(`${base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'null' });
    assert.equal(res.status, 400);
});

test('contraseña incorrecta -> 401 genérico, contador +1 y fila bad_password', async (t) => {
    const logs = capture(t);
    const res = await login({ admin_id: 7, pwd: 'incorrecta' });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
    assert.equal(table.get(7).failed_attempts, 1);
    assert.deepEqual(outcomes(), ['bad_password']);
    assert.ok(!logs().includes('incorrecta') && !logs().includes('Ana Admin') && !logs().includes(HASH));
    assert.match(logs(), /\b7\b/); // el log identifica la cuenta por su id
});

test('id inexistente y cuenta pending -> exactamente la misma respuesta 401, sin filas de login ni contador', async () => {
    table.set(8, row({ admin_id: 8, status: 'pending', pwd: null, full_name: null }));
    const a = await login({ admin_id: 7, pwd: 'incorrecta' });
    const unknown = await login({ admin_id: 999, pwd: PWD });
    const pending = await login({ admin_id: 8, pwd: PWD });
    for (const r of [unknown, pending]) {
        assert.equal(r.status, 401);
        assert.deepEqual(await r.json(), await a.clone().json());
    }
    assert.deepEqual(outcomes(), ['bad_password']); // solo el de la cuenta real
    assert.equal(table.get(8).failed_attempts, 0);
});

test('id inexistente: aun así se ejecuta bcrypt (mismo coste que una cuenta real)', async (t) => {
    const spy = t.mock.method(bcrypt, 'compare');
    await login({ admin_id: 999, pwd: PWD });
    await login({ admin_id: 7, pwd: 'incorrecta' });
    assert.equal(spy.mock.calls.length, 2);
    assert.notEqual(spy.mock.calls[0].arguments[1], HASH); // contra el hash falso
});

test('5 intentos fallidos bloquean la cuenta 15 min: el 5.º da 401 y deja alerta; el 6.º da 429 aunque la clave sea la correcta', async (t) => {
    const logs = capture(t);
    for (let i = 1; i <= 5; i++) {
        const res = await login({ admin_id: 7, pwd: `mala${i}` });
        assert.equal(res.status, 401, `intento ${i}`);
    }
    assert.equal(table.get(7).locked_until, now + 15 * 60000);
    assert.equal(table.get(7).failed_attempts, 0); // contador reiniciado al bloquear
    assert.deepEqual(outcomes(), ['bad_password', 'bad_password', 'bad_password', 'bad_password', 'bad_password', 'locked']);
    assert.match(logs(), /\[ALERTA-ADMIN\]/);
    assert.equal((logs().match(/\[ALERTA-ADMIN\]/g) || []).length, 1);

    const res = await login({ admin_id: 7, pwd: PWD });
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.equal(body.code, 'ADMIN_LOCKED');
    assert.equal(body.retry_after_seconds, 900);
    assert.equal(res.headers.get('retry-after'), '900');
    assert.equal(outcomes().at(-1), 'locked');
    assert.ok(!('token' in body));
});

test('durante el bloqueo no se evalúa la contraseña (bcrypt no se llama) y el contador no crece', async (t) => {
    table.get(7).locked_until = now + 60000;
    const spy = t.mock.method(bcrypt, 'compare');
    const res = await login({ admin_id: 7, pwd: PWD });
    assert.equal(res.status, 429);
    assert.equal(spy.mock.calls.length, 0);
    assert.equal(table.get(7).failed_attempts, 0);
});

test('al vencer el bloqueo se puede entrar de nuevo', async () => {
    table.get(7).locked_until = now + 60000;
    assert.equal((await login({ admin_id: 7, pwd: PWD })).status, 429);
    now += 61000;
    assert.equal((await login({ admin_id: 7, pwd: PWD })).status, 200);
    assert.equal(table.get(7).locked_until, null);
});

test('un acierto a mitad de camino reinicia la cuenta de fallos', async () => {
    for (let i = 0; i < 4; i++) await login({ admin_id: 7, pwd: 'mala' });
    assert.equal(table.get(7).failed_attempts, 4);
    assert.equal((await login({ admin_id: 7, pwd: PWD })).status, 200);
    assert.equal(table.get(7).failed_attempts, 0);
    for (let i = 0; i < 4; i++) assert.equal((await login({ admin_id: 7, pwd: 'mala' })).status, 401);
    assert.equal(table.get(7).locked_until, null); // 4 fallos nuevos no bloquean
});

test('los fallos de una cuenta no afectan a otra', async () => {
    table.set(9, row({ admin_id: 9, full_name: 'Beto' }));
    for (let i = 0; i < 5; i++) await login({ admin_id: 7, pwd: 'mala' });
    assert.equal((await login({ admin_id: 9, pwd: PWD })).status, 200);
});

test('cuenta suspendida: clave correcta -> 403 ADMIN_SUSPENDED sin token; clave mala -> 401 genérico', async () => {
    table.get(7).status = 'suspended';
    const ok = await login({ admin_id: 7, pwd: PWD });
    assert.equal(ok.status, 403);
    const body = await ok.json();
    assert.equal(body.code, 'ADMIN_SUSPENDED');
    assert.ok(!('token' in body));
    assert.deepEqual(outcomes(), ['locked']);
    const bad = await login({ admin_id: 7, pwd: 'mala' });
    assert.equal(bad.status, 401);
});

test('el reserva del intento es una transacción que siempre se cierra (commit y release)', async () => {
    await login({ admin_id: 7, pwd: PWD });
    assert.deepEqual(tx, ['begin', 'commit', 'release']);
    tx = [];
    await login({ admin_id: 999, pwd: PWD });
    assert.deepEqual(tx, ['begin', 'commit', 'release']);
});

test('error de BD en la reserva -> rollback, release y 500 sin detalles', async (t) => {
    const logs = capture(t);
    failOn = /FOR UPDATE/;
    const res = await login({ admin_id: 7, pwd: PWD });
    const text = await res.text();
    assert.equal(res.status, 500);
    assert.ok(!/boom|FOR UPDATE|admins|deadlock/i.test(text));
    assert.deepEqual(tx, ['begin', 'rollback', 'release']);
    assert.ok(logs().length > 0);
});

test('error de BD al anotar un fallo -> 500 (no se responde 401 como si nada)', async (t) => {
    capture(t);
    failOn = /INSERT INTO admin_logins/;
    const res = await login({ admin_id: 7, pwd: 'mala' });
    assert.equal(res.status, 500);
});

test('campos extra del body (status, failed_attempts, tsu...) no tienen efecto', async () => {
    table.get(7).status = 'suspended';
    const res = await login({ admin_id: 7, pwd: PWD, status: 'active', failed_attempts: 0, tsu: 'x'.repeat(16) });
    assert.equal(res.status, 403);
});

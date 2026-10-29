// backend/test/adminAuth.test.js
// Pruebas unitarias de routes/adminAuth.js (alta de administradores, SPNdev.1). No requieren MySQL:
// db/connectionAd se sustituye por un pool simulado y se ejecutan el router, db/admins.js, utils/ y bcrypt REALES.
// Las pruebas contra una BD real están en test/integration/spn_ad.test.js.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

const KEY = 'test-hmac-key-only-for-admin-unit-tests-0123456789abcdef';
process.env.TSU_HMAC_KEY = KEY; // antes de cargar config/tsu.js
process.env.ADMIN_JWT_SECRET = 'test-admin-jwt-secret-for-register-tests-0123456789abcdef'; // routes/adminAuth.js también carga config/adminJwt.js

// ---- Pool simulado: se registra en la caché de módulos ANTES de cargar el router ----
let calls = [];
let tx = [];
let handler;
const record = async (sql, params) => { calls.push({ sql, params }); return handler(sql, params); };
const fakePool = {
    promise: () => ({
        query: record,
        getConnection: async () => ({
            query: record,
            beginTransaction: async () => { tx.push('begin'); },
            commit: async () => { tx.push('commit'); },
            rollback: async () => { tx.push('rollback'); },
            release: () => { tx.push('release'); }
        })
    })
};
const connPath = require.resolve('../db/connectionAd');
require.cache[connPath] = { id: connPath, filename: connPath, loaded: true, exports: fakePool };

const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('node:crypto');
const adminRouter = require('../routes/adminAuth');
const { hashTsu } = require('../utils/tsu');

const TSU = 'Ab12Cd34Ef56Gh78';
const mysqlError = (code, sqlMessage) => Object.assign(new Error(sqlMessage), {
    code, sqlMessage, sql: "INSERT INTO admins (pwd) VALUES ('$2b$10$HASH-SECRETO-QUE-NO-DEBE-SALIR')"
});

// Lista de reserva en memoria: el DELETE la consume, igual que la BD.
let reserve;
const defaultHandler = async (sql, params) => {
    if (sql.startsWith('SELECT 1 FROM tsu_reserve')) return [reserve.has(params[0]) ? [{ 1: 1 }] : [], undefined];
    if (sql.startsWith('DELETE FROM tsu_reserve')) return [{ affectedRows: reserve.delete(params[0]) ? 1 : 0 }, undefined];
    if (sql.startsWith('INSERT INTO admins')) return [{ insertId: 11 }, undefined];
    throw new Error(`SQL inesperada en la prueba: ${sql}`);
};

let server, base;
before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/admin', adminRouter);
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}/api/admin`;
});
beforeEach(() => {
    calls = []; tx = [];
    handler = defaultHandler;
    reserve = new Set([TSU]);
});
after(() => server.close());

const post = (body) => fetch(`${base}/register`, {
    method: 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
});
const valid = (over = {}) => ({ full_name: 'Ana Admin', pwd: 'Clave-admin-1', tsu: TSU, ...over });
const captureErrors = (t) => {
    const spy = t.mock.method(console, 'error', () => {});
    return () => spy.mock.calls.map((c) => c.arguments.map(String).join(' ')).join('\n');
};

test('alta válida -> 201 con id y nombre recortado; sin token, sin hash, sin TSU en la respuesta', async () => {
    const res = await post(valid({ full_name: '  Ana Admin ' }));
    assert.equal(res.status, 201);
    const text = await res.text();
    const body = JSON.parse(text);
    assert.deepEqual(body, { message: 'Admin account created', admin: { id: 11, full_name: 'Ana Admin' } });
    assert.ok(!text.includes('$2') && !text.includes(TSU) && !/token/i.test(text));
});

test('alta: el TSU se consume de la lista y en la BD solo queda su HMAC; la contraseña, como hash bcrypt', async () => {
    await post(valid());
    assert.equal(reserve.has(TSU), false);
    assert.equal(calls.length, 3); // comprobación, DELETE, INSERT
    assert.deepEqual(calls[1], { sql: 'DELETE FROM tsu_reserve WHERE tsu_plain = ?', params: [TSU] });
    assert.match(calls[2].sql, /^INSERT INTO admins \(full_name, pwd, tsu_hash, tsu_used_at, status, activated_at\) VALUES \(\?, \?, \?, NOW\(\), 'active', NOW\(\)\)$/);
    const [name, pwdHash, tsuHash] = calls[2].params;
    assert.equal(name, 'Ana Admin');
    assert.match(pwdHash, /^\$2[aby]\$10\$/);
    assert.equal(await bcrypt.compare('Clave-admin-1', pwdHash), true);
    assert.equal(tsuHash, hashTsu(TSU));
    assert.ok(!JSON.stringify(calls[2].params).includes(TSU), 'el TSU en claro no debe llegar a la tabla admins');
    assert.deepEqual(tx, ['begin', 'commit', 'release']);
});

test('alta ignora status, admin_id, tsu_hash, role y demás campos del body', async () => {
    const res = await post(valid({ status: 'suspended', admin_id: 1, tsu_hash: 'x'.repeat(64), role: 'Admin', failed_attempts: 9 }));
    assert.equal(res.status, 201);
    const params = calls[2].params;
    assert.equal(params.length, 3);
    assert.equal(params[2], hashTsu(TSU)); // el hash lo calcula el servidor, no el cliente
    assert.ok(!/failed_attempts|locked_until|admin_id/.test(calls[2].sql));
});

test('alta con datos inválidos -> 400 VALIDATION_ERROR con la lista de campos y SIN tocar la BD ni bcrypt', async (t) => {
    const hashSpy = t.mock.method(bcrypt, 'hash');
    const cases = [
        [{ full_name: undefined }, ['full_name']], [{ full_name: '   ' }, ['full_name']], [{ full_name: 'x'.repeat(101) }, ['full_name']],
        [{ full_name: 123 }, ['full_name']], [{ full_name: { a: 1 } }, ['full_name']],
        [{ pwd: undefined }, ['pwd']], [{ pwd: '' }, ['pwd']], [{ pwd: 12345678 }, ['pwd']], [{ pwd: ['a'] }, ['pwd']],
        [{ pwd: 'a'.repeat(73) }, ['pwd']],
        [{ tsu: undefined }, ['tsu']], [{ tsu: '' }, ['tsu']], [{ tsu: 'corto' }, ['tsu']], [{ tsu: 'AB-CD-EF-GH-IJ-KL-MN' }, ['tsu']],
        [{ tsu: 1234567890123456 }, ['tsu']], [{ tsu: [TSU] }, ['tsu']], [{ tsu: null }, ['tsu']],
        [{ full_name: '', pwd: '', tsu: '' }, ['full_name', 'pwd', 'tsu']]
    ];
    for (const [over, fields] of cases) {
        const res = await post(valid(over));
        const body = await res.json();
        assert.equal(res.status, 400, JSON.stringify(over));
        assert.equal(body.code, 'VALIDATION_ERROR');
        assert.deepEqual(body.fields, fields, JSON.stringify(over));
    }
    assert.equal(calls.length, 0);
    assert.equal(hashSpy.mock.calls.length, 0);
    assert.deepEqual(tx, []);
});

test('alta sin cuerpo JSON -> 400', async () => {
    const res = await post(undefined);
    assert.equal(res.status, 400);
    assert.deepEqual((await res.json()).fields, ['full_name', 'pwd', 'tsu']);
});

test('TSU con formato válido pero que no está en la lista -> 403 TSU_INVALID, sin gastar bcrypt', async (t) => {
    const hashSpy = t.mock.method(bcrypt, 'hash');
    const res = await post(valid({ tsu: 'Zz99Yy88Xx77Ww66' }));
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'Invalid or already used TSU', code: 'TSU_INVALID' });
    assert.equal(hashSpy.mock.calls.length, 0);
    assert.equal(calls.length, 1); // solo la comprobación
    assert.equal(tx.length, 0);
});

test('un TSU ya usado da exactamente la misma respuesta que uno que nunca existió (no se distingue)', async () => {
    const first = await post(valid());
    assert.equal(first.status, 201);
    const reused = await post(valid({ full_name: 'Otra Persona' }));
    const never = await post(valid({ tsu: 'Zz99Yy88Xx77Ww66' }));
    assert.equal(reused.status, 403);
    assert.equal(never.status, 403);
    assert.deepEqual(await reused.json(), await never.json());
});

test('carrera: la comprobación pasa pero otra petición ya consumió el TSU -> 403 con rollback y sin INSERT', async () => {
    handler = async (sql, params) => {
        if (sql.startsWith('DELETE FROM tsu_reserve')) return [{ affectedRows: 0 }, undefined]; // lo ganó otro
        return defaultHandler(sql, params);
    };
    const res = await post(valid());
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'TSU_INVALID');
    assert.ok(!calls.some((c) => c.sql.startsWith('INSERT INTO admins')));
    assert.deepEqual(tx, ['begin', 'rollback', 'release']);
});

test('si falla el INSERT se revierte (el TSU no se pierde), se libera la conexión y no se filtra nada', async (t) => {
    const logged = captureErrors(t);
    handler = async (sql, params) => {
        if (sql.startsWith('INSERT INTO admins')) throw mysqlError('ER_DATA_TOO_LONG', "Data too long for column 'full_name' at row 1");
        return defaultHandler(sql, params);
    };
    const res = await post(valid());
    const text = await res.text();
    assert.equal(res.status, 500);
    assert.deepEqual(JSON.parse(text), { error: 'Internal error', code: 'DB_ERROR' });
    assert.ok(!/full_name|INSERT|admins|\$2|tsu/i.test(text), 'la respuesta filtró un detalle interno');
    assert.deepEqual(tx, ['begin', 'rollback', 'release']);
    const log = logged();
    assert.match(log, /ER_DATA_TOO_LONG/);
    assert.ok(!/full_name|INSERT|HASH-SECRETO|\$2|Ab12Cd34/.test(log), 'el log contiene SQL, hash o el TSU');
});

test('un error de BD al comprobar el TSU -> 500 genérico', async (t) => {
    captureErrors(t);
    handler = async () => { throw mysqlError('ECONNREFUSED', 'connect ECONNREFUSED'); };
    const res = await post(valid());
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'Internal error', code: 'DB_ERROR' });
});

test('un fallo inesperado en bcrypt -> 500 genérico y el TSU no se consume', async (t) => {
    const logged = captureErrors(t);
    t.mock.method(bcrypt, 'hash', async () => { throw new Error('fallo interno de bcrypt'); });
    const res = await post(valid());
    assert.equal(res.status, 500);
    assert.equal(reserve.has(TSU), true);
    assert.ok(!logged().includes('fallo interno de bcrypt'));
});

test('el nombre no es único en el servidor: dos altas con el mismo nombre y distinto TSU funcionan', async () => {
    const t2 = crypto.randomBytes(12).toString('hex');
    reserve.add(t2);
    assert.equal((await post(valid({ full_name: 'Carlos' }))).status, 201);
    assert.equal((await post(valid({ full_name: 'Carlos', tsu: t2 }))).status, 201);
});

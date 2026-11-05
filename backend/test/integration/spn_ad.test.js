// backend/test/integration/spn_ad.test.js
// Pruebas del esquema de SPN_AD (la base aparte de administradores) contra MySQL/MariaDB REAL (spn_ad_test).
// No se ejecutan con `npm test`.
//   Desde backend/:  npm run db:reset:ad-test   (una vez, o cuando cambie el esquema)
//                    npm run testad
// Comprueban lo que el esquema promete: el TSU solo existe como hash único, el nombre se puede repetir,
// una cuenta activa siempre está completa, el historial de logins no guarda IP, y el pool de SPN_AD solo
// arranca con sus propias credenciales y nunca contra la base principal. SPNdev.1: además, el alta real de
// administradores (POST /api/admin/register) con la lista de TSU, sin 2FA.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// GUARD: estas pruebas insertan y borran filas; solo corren contra una BD *_test.
const DB_AD_NAME = process.env.DB_AD_NAME || '';
if (!/^[A-Za-z0-9_]+_test$/.test(DB_AD_NAME)) {
    throw new Error(`spn_ad.test.js solo puede correr contra una BD *_test (DB_AD_NAME="${DB_AD_NAME}"). Usa: npm run testad`);
}

// Clave de la prueba si .env.test no define TSU_HMAC_KEY (debe fijarse antes de cargar config/tsu.js).
process.env.TSU_HMAC_KEY = process.env.TSU_HMAC_KEY || 'test-hmac-key-only-for-spn-ad-sql-tests-0123456789abcdef';
process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'test-admin-jwt-secret-only-for-spn-ad-sql-tests-0123456789abcdef';

const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../../db/connectionAd');
const adminRouter = require('../../routes/adminAuth');
const { hashTsu } = require('../../utils/tsu');
const q = (sql, params) => pool.promise().query(sql, params);

const tsuHash = () => crypto.randomBytes(32).toString('hex'); // 64 caracteres hex, como un HMAC-SHA-256
const newTsu = () => crypto.randomBytes(16).toString('hex'); // 32 caracteres alfanuméricos, formato válido
const ACTIVE = (over = {}) => ({
    full_name: 'Admin Prueba', pwd: '$2b$10$hash-de-prueba', tsu_hash: tsuHash(),
    totp_secret_enc: 'iv.tag.cifrado', status: 'active', activated_at: new Date(), ...over
});

async function insertAdmin(fields) {
    const cols = Object.keys(fields);
    const [r] = await q(`INSERT INTO admins (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => fields[c]));
    return r.insertId;
}
const errorOf = async (p) => { try { await p; } catch (e) { return e; } return null; };

// SPN_AD_test es una base dedicada: se vacía antes y después (primero el historial por la FK).
async function wipe() {
    await q('DELETE FROM admin_logins');
    await q('DELETE FROM admins');
    await q('DELETE FROM tsu_reserve');
}
let server, base;
before(async () => {
    await wipe();
    const app = express();
    app.use(express.json());
    app.use('/api/admin', adminRouter);
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}/api/admin`;
});
after(async () => { server.close(); await wipe(); await new Promise((r) => pool.end(r)); });

test('el pool apunta a SPN_AD de pruebas y la base solo contiene las tablas de administración', async () => {
    const [[{ db }]] = await q('SELECT DATABASE() AS db');
    assert.equal(db, DB_AD_NAME);
    const [tables] = await q('SHOW TABLES');
    assert.deepEqual(tables.map((t) => Object.values(t)[0]).sort(), ['admin_logins', 'admins', 'schema_migrations', 'tsu_reserve']);
    // Nada de la plataforma vive aquí: los administradores no están en `users`.
    assert.equal((await q("SHOW TABLES LIKE 'users'"))[0].length, 0);
});

test('admin_logins NO guarda IP ni ubicación: solo fecha y hora y resultado', async () => {
    const [cols] = await q('SHOW COLUMNS FROM admin_logins');
    assert.deepEqual(cols.map((c) => c.Field), ['login_id', 'admin_id', 'attempted_at', 'outcome']);
    const [admCols] = await q('SHOW COLUMNS FROM admins');
    assert.ok(!admCols.some((c) => /ip|ubic|location|city|country/i.test(c.Field)), 'admins no debe tener columnas de IP o ubicación');
});

test('una cuenta nueva solo necesita el hash del TSU: nace pending, sin nombre ni contraseña, con contadores en cero', async () => {
    const id = await insertAdmin({ tsu_hash: tsuHash() });
    const [[row]] = await q('SELECT * FROM admins WHERE admin_id = ?', [id]);
    assert.equal(row.status, 'pending');
    assert.equal(row.full_name, null);
    assert.equal(row.pwd, null);
    assert.equal(row.totp_secret_enc, null);
    assert.equal(row.tsu_used_at, null);
    assert.equal(row.failed_attempts, 0);
    assert.equal(row.locked_until, null);
    assert.ok(row.created_at instanceof Date);
});

test('el TSU es único: el mismo hash dos veces -> ER_DUP_ENTRY; y es obligatorio (NOT NULL)', async () => {
    const h = tsuHash();
    await insertAdmin({ tsu_hash: h });
    const dup = await errorOf(insertAdmin({ tsu_hash: h }));
    assert.equal(dup && dup.code, 'ER_DUP_ENTRY');
    assert.ok(await errorOf(insertAdmin({ full_name: 'Sin TSU' })), 'una cuenta sin tsu_hash debe rechazarse');
});

test('tsu_hash mide exactamente 64 caracteres como máximo: un valor más largo se rechaza, no se trunca', async () => {
    const err = await errorOf(insertAdmin({ tsu_hash: 'a'.repeat(65) }));
    assert.ok(err, 'debía rechazar un tsu_hash de 65 caracteres');
    assert.equal(err.code, 'ER_DATA_TOO_LONG');
});

test('el nombre NO es único: dos administradores con el mismo nombre conviven y se distinguen por admin_id', async () => {
    const a = await insertAdmin(ACTIVE({ full_name: 'Carlos Gómez' }));
    const b = await insertAdmin(ACTIVE({ full_name: 'Carlos Gómez' }));
    assert.notEqual(a, b);
    const [rows] = await q("SELECT admin_id FROM admins WHERE full_name = 'Carlos Gómez' ORDER BY admin_id");
    assert.deepEqual(rows.map((r) => r.admin_id), [a, b]);
});

test('una cuenta activa o suspendida debe estar completa (CHECK): sin nombre, contraseña o fecha de activación se rechaza; el 2FA es opcional (SPNdev.1)', async () => {
    // Se compara el errno: MariaDB usa 4025 y MySQL 8 usa 3819, y mysql2 pone a 4025 un nombre que no corresponde.
    const CHECK_ERRNOS = [4025, 3819];
    for (const status of ['active', 'suspended']) {
        for (const missing of ['full_name', 'pwd', 'activated_at']) {
            const err = await errorOf(insertAdmin(ACTIVE({ status, [missing]: null })));
            assert.ok(err && CHECK_ERRNOS.includes(err.errno), `status=${status} sin ${missing}: ${err && err.errno}`);
        }
        await insertAdmin(ACTIVE({ status })); // completa: sí entra
        await insertAdmin(ACTIVE({ status, totp_secret_enc: null })); // sin 2FA: también entra
    }
    // Y no se puede "completar" a medias después: pasar una cuenta pending a active sin datos falla.
    const id = await insertAdmin({ tsu_hash: tsuHash() });
    const err = await errorOf(q("UPDATE admins SET status = 'active' WHERE admin_id = ?", [id]));
    assert.ok(err && CHECK_ERRNOS.includes(err.errno));
});

test('status y outcome solo admiten sus valores (enum, modo estricto)', async () => {
    assert.ok(await errorOf(insertAdmin({ tsu_hash: tsuHash(), status: 'admin' })));
    const id = await insertAdmin(ACTIVE());
    assert.ok(await errorOf(q("INSERT INTO admin_logins (admin_id, outcome) VALUES (?, 'inventado')", [id])));
});

test('admin_logins: fecha y hora automática, FK obligatoria y el historial protege la cuenta (no se borra con historial)', async () => {
    const id = await insertAdmin(ACTIVE());
    const noAdmin = await errorOf(q("INSERT INTO admin_logins (admin_id, outcome) VALUES (999999999, 'success')"));
    assert.equal(noAdmin && noAdmin.code, 'ER_NO_REFERENCED_ROW_2');

    await q("INSERT INTO admin_logins (admin_id, outcome) VALUES (?, 'bad_password')", [id]);
    await q("INSERT INTO admin_logins (admin_id, outcome) VALUES (?, 'success')", [id]);
    const [rows] = await q('SELECT outcome, attempted_at FROM admin_logins WHERE admin_id = ? ORDER BY login_id', [id]);
    assert.deepEqual(rows.map((r) => r.outcome), ['bad_password', 'success']);
    assert.ok(rows.every((r) => r.attempted_at instanceof Date && Math.abs(Date.now() - r.attempted_at.getTime()) < 24 * 3600e3));

    const del = await errorOf(q('DELETE FROM admins WHERE admin_id = ?', [id]));
    assert.equal(del && del.code, 'ER_ROW_IS_REFERENCED_2'); // ON DELETE RESTRICT
});

test('el contador de intentos solo admite 0-255 y no baja de cero (TINYINT UNSIGNED)', async () => {
    const id = await insertAdmin(ACTIVE());
    assert.ok(await errorOf(q('UPDATE admins SET failed_attempts = -1 WHERE admin_id = ?', [id])));
    assert.ok(await errorOf(q('UPDATE admins SET failed_attempts = 256 WHERE admin_id = ?', [id])));
    await q('UPDATE admins SET failed_attempts = 5 WHERE admin_id = ?', [id]);
    assert.equal((await q('SELECT failed_attempts FROM admins WHERE admin_id = ?', [id]))[0][0].failed_attempts, 5);
});

// ---- connectionAd.js: aislamiento de credenciales (cada caso en un proceso aparte) ----
const BACKEND = path.resolve(__dirname, '../..');
function loadPool(env) {
    try {
        execFileSync(process.execPath, ['-e', "require('./db/connectionAd'); process.exit(0)"], {
            cwd: BACKEND, env: { PATH: process.env.PATH, ...env }, stdio: 'pipe'
        });
        return { ok: true, stderr: '' };
    } catch (e) {
        return { ok: false, stderr: String(e.stderr) };
    }
}
// Cadena vacía (no ausente): dotenv no pisa variables ya definidas, así que un backend/.env real no interfiere.
const OFF = { DB_AD_NAME: '', DB_AD_USER: '', DB_AD_PASSWORD: '', DB_NAME: '', DB_USER: '' };
const GOOD = { DB_AD_NAME: 'spn_ad_x', DB_AD_USER: 'ad_user', DB_AD_PASSWORD: 'pw', DB_NAME: 'sportanet_x', DB_USER: 'main_user' };

test('connectionAd falla al cargarse sin DB_AD_NAME, DB_AD_USER o DB_AD_PASSWORD (no hay valores por defecto)', () => {
    assert.equal(loadPool(GOOD).ok, true);
    for (const k of ['DB_AD_NAME', 'DB_AD_USER', 'DB_AD_PASSWORD']) {
        const r = loadPool({ ...GOOD, [k]: '' });
        assert.equal(r.ok, false, `sin ${k} debía fallar`);
        assert.match(r.stderr, new RegExp(k));
    }
    assert.equal(loadPool(OFF).ok, false);
});

test('connectionAd rechaza usar la base principal como SPN_AD', () => {
    const r = loadPool({ ...GOOD, DB_AD_NAME: 'sportanet_x' });
    assert.equal(r.ok, false);
    assert.match(r.stderr, /base aparte/);
});

test('connectionAd en producción exige un usuario de MySQL distinto del de la base principal', () => {
    const same = { ...GOOD, DB_AD_USER: 'main_user' };
    assert.equal(loadPool({ ...same, NODE_ENV: 'production' }).ok, false);
    assert.equal(loadPool(same).ok, true); // en desarrollo solo avisa
});

// ---------------------------------------------------------------------------
// SPNdev.1: lista de TSU (tsu_reserve) y alta de administradores sin 2FA
// ---------------------------------------------------------------------------

const post = (body) => fetch(`${base}/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});
const addToReserve = async (tsu = newTsu()) => { await q('INSERT INTO tsu_reserve (tsu_plain) VALUES (?)', [tsu]); return tsu; };
const reserveHas = async (tsu) => (await q('SELECT 1 FROM tsu_reserve WHERE tsu_plain = ?', [tsu]))[0].length === 1;
const adminBy = async (hash) => (await q('SELECT * FROM admins WHERE tsu_hash = ?', [hash]))[0][0];

test('tsu_reserve: solo acepta TSU de 16 a 64 caracteres alfanuméricos (CHECK) y no admite repetidos', async () => {
    const CHECK_ERRNOS = [4025, 3819];
    for (const bad of ['corto', 'a'.repeat(15), 'a'.repeat(65), 'ABCD-EFGH-IJKL-MNOP', 'abcdefghijklmnó1', 'abcdefghijklmnop ']) {
        const err = await errorOf(q('INSERT INTO tsu_reserve (tsu_plain) VALUES (?)', [bad]));
        assert.ok(err && [...CHECK_ERRNOS, 1406, 1366].includes(err.errno), `"${bad}" debía rechazarse (${err && err.errno})`);
    }
    const t = await addToReserve();
    assert.equal((await errorOf(addToReserve(t))).code, 'ER_DUP_ENTRY');
    // La comparación distingue mayúsculas (ascii_bin): ABC... y abc... son TSU distintos.
    const upper = 'QWERTYUIOPASDFGH';
    await addToReserve(upper);
    assert.equal(await reserveHas(upper.toLowerCase()), false);
    assert.equal(await reserveHas(upper), true);
});

test('alta real: crea la cuenta activa SIN 2FA, consume el TSU de la lista y en admins solo queda su HMAC', async () => {
    const tsu = await addToReserve();
    // status, admin_id, tsu_hash y failed_attempts del body se ignoran: los decide el servidor.
    const res = await post({ full_name: '  Ana Admin ', pwd: 'Clave-admin-1', tsu, status: 'suspended', admin_id: 1, tsu_hash: 'x'.repeat(64), failed_attempts: 9 });
    assert.equal(res.status, 201);
    const { admin } = await res.json();
    assert.equal(admin.full_name, 'Ana Admin');

    assert.equal(await reserveHas(tsu), false, 'el TSU en claro debía salir de la lista');
    const row = await adminBy(hashTsu(tsu));
    assert.equal(row.admin_id, admin.id);
    assert.equal(row.full_name, 'Ana Admin');
    assert.equal(row.status, 'active');
    assert.equal(row.totp_secret_enc, null); // sin 2FA por ahora
    assert.equal(row.failed_attempts, 0);
    assert.ok(row.tsu_used_at instanceof Date && row.activated_at instanceof Date);
    assert.match(row.pwd, /^\$2[aby]\$/);
    assert.equal(await bcrypt.compare('Clave-admin-1', row.pwd), true);
    // En ninguna columna de admins aparece el TSU en claro.
    assert.ok(!Object.values(row).some((v) => String(v).includes(tsu)));
});

test('alta real: un TSU ya usado, o que nunca estuvo en la lista, da 403 TSU_INVALID y no crea nada', async () => {
    const tsu = await addToReserve();
    assert.equal((await post({ full_name: 'Primero', pwd: 'Clave-admin-1', tsu })).status, 201);
    const before = (await q('SELECT COUNT(*) AS n FROM admins'))[0][0].n;
    for (const t of [tsu, newTsu()]) {
        const res = await post({ full_name: 'Intruso', pwd: 'Clave-admin-1', tsu: t });
        assert.equal(res.status, 403);
        assert.deepEqual(await res.json(), { error: 'Invalid or already used TSU', code: 'TSU_INVALID' });
    }
    assert.equal((await q('SELECT COUNT(*) AS n FROM admins'))[0][0].n, before);
});

test('alta real: el TSU distingue mayúsculas de minúsculas', async () => {
    const tsu = await addToReserve('MixedCaseTsu12345');
    const res = await post({ full_name: 'Caso', pwd: 'Clave-admin-1', tsu: tsu.toLowerCase() });
    assert.equal(res.status, 403);
    assert.equal(await reserveHas(tsu), true);
});

test('alta real: dos solicitudes simultáneas con el mismo TSU -> una crea la cuenta y la otra recibe 403', async () => {
    const tsu = await addToReserve();
    const [a, b] = await Promise.all([
        post({ full_name: 'Carrera A', pwd: 'Clave-admin-1', tsu }),
        post({ full_name: 'Carrera B', pwd: 'Clave-admin-1', tsu })
    ]);
    assert.deepEqual([a.status, b.status].sort(), [201, 403]);
    assert.equal((await q('SELECT COUNT(*) AS n FROM admins WHERE tsu_hash = ?', [hashTsu(tsu)]))[0][0].n, 1);
    assert.equal(await reserveHas(tsu), false);
});

test('alta real: si falla el INSERT en admins se revierte TODO y el TSU sigue en la lista (se provoca renombrando una columna que no está en un CHECK)', async (t) => {
    const spy = t.mock.method(console, 'error', () => {});
    const tsu = await addToReserve();
    let res, text;
    // tsu_used_at: MySQL 8 no deja renombrar activated_at porque chk_admins_complete la usa.
    await q('ALTER TABLE admins RENAME COLUMN tsu_used_at TO tsu_used_at_x');
    try {
        res = await post({ full_name: 'Falla', pwd: 'Clave-admin-1', tsu });
        text = await res.text();
    } finally {
        await q('ALTER TABLE admins RENAME COLUMN tsu_used_at_x TO tsu_used_at'); // siempre se restaura
    }
    assert.equal(res.status, 500);
    assert.deepEqual(JSON.parse(text), { error: 'Internal error', code: 'DB_ERROR' });
    assert.ok(!/tsu_used_at|INSERT|admins|tsu_reserve|\$2/i.test(text));
    assert.equal(await reserveHas(tsu), true, 'el DELETE del TSU debía haberse revertido');
    assert.equal((await q('SELECT COUNT(*) AS n FROM admins WHERE tsu_hash = ?', [hashTsu(tsu)]))[0][0].n, 0);
    assert.match(spy.mock.calls.map((c) => c.arguments.map(String).join(' ')).join('\n'), /ER_BAD_FIELD_ERROR/);
    // El pool sigue sano y el mismo TSU todavía se puede usar.
    assert.equal((await post({ full_name: 'Reintento', pwd: 'Clave-admin-1', tsu })).status, 201);
});

test('alta real: varios administradores con el mismo nombre conviven (cada uno con su TSU)', async () => {
    const [t1, t2] = [await addToReserve(), await addToReserve()];
    const [a, b] = [
        await (await post({ full_name: 'Mismo Nombre', pwd: 'Clave-admin-1', tsu: t1 })).json(),
        await (await post({ full_name: 'Mismo Nombre', pwd: 'Clave-admin-2', tsu: t2 })).json()
    ];
    assert.notEqual(a.admin.id, b.admin.id);
});

test('alta real: los datos inválidos no consumen el TSU', async () => {
    const tsu = await addToReserve();
    for (const body of [{ full_name: '', pwd: 'Clave-admin-1', tsu }, { full_name: 'X', pwd: 'a'.repeat(73), tsu }, { full_name: 'X', pwd: 'Clave-admin-1', tsu: tsu + '!' }]) {
        assert.equal((await post(body)).status, 400);
    }
    assert.equal(await reserveHas(tsu), true);
});

// ---------------------------------------------------------------------------------------------------------
// SPNdev.2: login de administradores contra la BD real (bloqueo, historial, concurrencia, suspensión).
// ---------------------------------------------------------------------------------------------------------
const LOGIN_PWD = 'Clave-admin-1';
const loginReq = (admin_id, pwd) => fetch(`${base}/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ admin_id, pwd })
});
let loginHash;
async function activeAdmin(over = {}) {
    loginHash = loginHash || await bcrypt.hash(LOGIN_PWD, 4);
    return insertAdmin(ACTIVE({ pwd: loginHash, totp_secret_enc: null, ...over }));
}
const loginRows = async (id) => (await q('SELECT outcome FROM admin_logins WHERE admin_id = ? ORDER BY login_id', [id]))[0].map((r) => r.outcome);
const adminRow = async (id) => (await q('SELECT failed_attempts, locked_until, status FROM admins WHERE admin_id = ?', [id]))[0][0];

test('login real: clave correcta -> 200 y token que abre /me; queda una fila success y el contador en cero', async () => {
    const id = await activeAdmin({ failed_attempts: 2 });
    const res = await loginReq(id, LOGIN_PWD);
    assert.equal(res.status, 200);
    const { token, admin } = await res.json();
    assert.equal(admin.id, id);
    const me = await fetch(`${base}/me`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), { id, full_name: 'Admin Prueba' });
    assert.deepEqual(await loginRows(id), ['success']);
    const r = await adminRow(id);
    assert.equal(r.failed_attempts, 0);
    assert.equal(r.locked_until, null);
});

test('login real: 5 fallos bloquean (locked_until ~15 min en el futuro según el reloj de la BD); el 6.º da 429 aunque la clave sea correcta', async () => {
    const id = await activeAdmin();
    for (let i = 0; i < 5; i++) assert.equal((await loginReq(id, 'mala')).status, 401);
    const [[chk]] = await q('SELECT TIMESTAMPDIFF(SECOND, NOW(), locked_until) AS s, failed_attempts AS f FROM admins WHERE admin_id = ?', [id]);
    assert.ok(chk.s > 880 && chk.s <= 900, `segundos de bloqueo: ${chk.s}`);
    assert.equal(chk.f, 0);
    const res = await loginReq(id, LOGIN_PWD);
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.equal(body.code, 'ADMIN_LOCKED');
    assert.ok(body.retry_after_seconds > 880 && body.retry_after_seconds <= 900);
    assert.equal(res.headers.get('retry-after'), String(body.retry_after_seconds));
    assert.deepEqual(await loginRows(id), ['bad_password', 'bad_password', 'bad_password', 'bad_password', 'bad_password', 'locked', 'locked']);
});

test('login real: bloqueo vencido (locked_until en el pasado) -> se puede entrar y se limpia', async () => {
    const id = await activeAdmin();
    await q('UPDATE admins SET locked_until = NOW() - INTERVAL 1 SECOND WHERE admin_id = ?', [id]);
    assert.equal((await loginReq(id, LOGIN_PWD)).status, 200);
    assert.equal((await adminRow(id)).locked_until, null);
});

test('login real: 12 intentos erróneos SIMULTÁNEOS evalúan como máximo 5 contraseñas y dejan la cuenta bloqueada', async () => {
    const id = await activeAdmin();
    const results = await Promise.all(Array.from({ length: 12 }, () => loginReq(id, 'mala')));
    const codes = results.map((r) => r.status).sort();
    assert.equal(codes.filter((c) => c === 401).length, 5);
    assert.equal(codes.filter((c) => c === 429).length, 7);
    assert.ok((await adminRow(id)).locked_until);
    const rows = await loginRows(id);
    assert.equal(rows.filter((o) => o === 'bad_password').length, 5);
});

test('login real: intentos simultáneos con la clave CORRECTA tras el bloqueo no entran', async () => {
    const id = await activeAdmin();
    for (let i = 0; i < 5; i++) await loginReq(id, 'mala');
    const results = await Promise.all(Array.from({ length: 6 }, () => loginReq(id, LOGIN_PWD)));
    assert.ok(results.every((r) => r.status === 429));
});

test('login real: id inexistente o cuenta pending -> 401 genérico y sin filas en admin_logins', async () => {
    const pendingId = await insertAdmin({ tsu_hash: tsuHash() });
    for (const id of [987654, pendingId]) {
        const res = await loginReq(id, LOGIN_PWD);
        assert.equal(res.status, 401);
        assert.equal((await res.json()).code, 'INVALID_CREDENTIALS');
    }
    assert.deepEqual(await loginRows(pendingId), []);
    assert.equal((await adminRow(pendingId)).failed_attempts, 0);
});

test('login real: cuenta suspendida -> 403 sin token; /me con un token anterior deja de funcionar al suspenderla', async () => {
    const id = await activeAdmin();
    const { token } = await (await loginReq(id, LOGIN_PWD)).json();
    assert.equal((await fetch(`${base}/me`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
    await q("UPDATE admins SET status = 'suspended' WHERE admin_id = ?", [id]);
    const res = await loginReq(id, LOGIN_PWD);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'ADMIN_SUSPENDED');
    assert.equal((await fetch(`${base}/me`, { headers: { Authorization: `Bearer ${token}` } })).status, 401);
});

test('login real: los fallos de una cuenta no bloquean a otra con el mismo nombre', async () => {
    const a = await activeAdmin();
    const b = await activeAdmin();
    for (let i = 0; i < 5; i++) await loginReq(a, 'mala');
    assert.equal((await loginReq(b, LOGIN_PWD)).status, 200);
    assert.equal((await loginReq(a, LOGIN_PWD)).status, 429);
});

test('flujo completo: register con un TSU de la lista y luego login con el id devuelto', async () => {
    const tsu = newTsu();
    await q('INSERT INTO tsu_reserve (tsu_plain) VALUES (?)', [tsu]);
    const reg = await fetch(`${base}/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: 'Flujo Completo', pwd: LOGIN_PWD, tsu })
    });
    assert.equal(reg.status, 201);
    const { admin } = await reg.json();
    const res = await loginReq(admin.id, LOGIN_PWD);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).admin.full_name, 'Flujo Completo');
});

// backend/test/integration/spn_ad.test.js
// Pruebas del esquema de SPN_AD (la base aparte de administradores) contra MySQL/MariaDB REAL (spn_ad_test).
// No se ejecutan con `npm test`.
//   Desde backend/:  npm run db:reset:ad-test   (una vez, o cuando cambie el esquema)
//                    npm run testad
// Comprueban lo que el esquema promete: el TSU solo existe como hash único, el nombre se puede repetir,
// una cuenta activa siempre está completa, el historial de logins no guarda IP, y el pool de SPN_AD solo
// arranca con sus propias credenciales y nunca contra la base principal.
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

const pool = require('../../db/connectionAd');
const q = (sql, params) => pool.promise().query(sql, params);

const tsuHash = () => crypto.randomBytes(32).toString('hex'); // 64 caracteres hex, como un HMAC-SHA-256
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
}
before(wipe);
after(async () => { await wipe(); await new Promise((r) => pool.end(r)); });

test('el pool apunta a SPN_AD de pruebas y la base solo contiene las tablas de administración', async () => {
    const [[{ db }]] = await q('SELECT DATABASE() AS db');
    assert.equal(db, DB_AD_NAME);
    const [tables] = await q('SHOW TABLES');
    assert.deepEqual(tables.map((t) => Object.values(t)[0]).sort(), ['admin_logins', 'admins', 'schema_migrations']);
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

test('una cuenta activa o suspendida debe estar completa (CHECK): sin contraseña, 2FA, nombre o fecha de activación se rechaza', async () => {
    // Se compara el errno: MariaDB usa 4025 y MySQL 8 usa 3819, y mysql2 pone a 4025 un nombre que no corresponde.
    const CHECK_ERRNOS = [4025, 3819];
    for (const status of ['active', 'suspended']) {
        for (const missing of ['full_name', 'pwd', 'totp_secret_enc', 'activated_at']) {
            const err = await errorOf(insertAdmin(ACTIVE({ status, [missing]: null })));
            assert.ok(err && CHECK_ERRNOS.includes(err.errno), `status=${status} sin ${missing}: ${err && err.errno}`);
        }
        await insertAdmin(ACTIVE({ status })); // completa: sí entra
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

// backend/test/tsu.test.js
// Pruebas unitarias de config/tsu.js y utils/tsu.js (formato y hash del TSU). No requieren BD.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const KEY = 'test-hmac-key-only-for-tsu-unit-tests-0123456789abcdef';
process.env.TSU_HMAC_KEY = KEY; // antes de cargar utils/tsu.js
const { isValidTsuFormat, hashTsu } = require('../utils/tsu');

test('formato del TSU: 16 a 64 caracteres alfanuméricos y nada más', () => {
    const ok = ['A'.repeat(16), 'a1B2c3D4e5F6g7H8', '9'.repeat(64), crypto.randomBytes(24).toString('hex')];
    for (const v of ok) assert.equal(isValidTsuFormat(v), true, v);

    const bad = [
        'A'.repeat(15), 'A'.repeat(65), '', ' ',
        'ABCD-EFGH-IJKL-MNOP', 'abcdefghijklmnop ', ' abcdefghijklmnop', 'abcdefgh\nijklmnop', 'abcdefghijklmnó1',
        'abcdefghijklmnop\n', // el $ de una regex sin anclar aceptaría un salto de línea final
        null, undefined, 12345678901234567890, ['abcdefghijklmnop'], { tsu: 'abcdefghijklmnop' }, true
    ];
    for (const v of bad) assert.equal(isValidTsuFormat(v), false, JSON.stringify(v));
});

test('hashTsu: HMAC-SHA-256 hexadecimal de 64 caracteres, determinista y distinto para cada TSU', () => {
    const a = 'A1b2C3d4E5f6G7h8';
    const h = hashTsu(a);
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(hashTsu(a), h);
    assert.notEqual(hashTsu('A1b2C3d4E5f6G7h9'), h);
    assert.notEqual(hashTsu(a.toLowerCase()), h); // distingue mayúsculas
    assert.equal(h, crypto.createHmac('sha256', KEY).update(a).digest('hex')); // es exactamente HMAC con la clave del servidor
    assert.notEqual(h, crypto.createHash('sha256').update(a).digest('hex')); // y no un SHA-256 simple sin clave
    assert.ok(!h.includes(a));
});

// ---- config/tsu.js: falla cerrado (cada caso en un proceso aparte) ----
const BACKEND = path.resolve(__dirname, '..');
function loadConfig(env) {
    try {
        execFileSync(process.execPath, ['-e', "require('./config/tsu'); process.exit(0)"], {
            cwd: BACKEND, env: { PATH: process.env.PATH, ...env }, stdio: 'pipe'
        });
        return { ok: true, stderr: '' };
    } catch (e) {
        return { ok: false, stderr: String(e.stderr) };
    }
}

test('config/tsu falla al cargarse si TSU_HMAC_KEY falta, está vacía, es corta o es igual a JWT_SECRET', () => {
    // Cadena vacía (no ausente): dotenv no pisa variables ya definidas, así que un backend/.env real no interfiere.
    assert.equal(loadConfig({ TSU_HMAC_KEY: KEY, JWT_SECRET: 'otro-secreto-distinto-0123456789abcdef' }).ok, true);
    assert.match(loadConfig({ TSU_HMAC_KEY: '' }).stderr, /TSU_HMAC_KEY no está definido/);
    assert.match(loadConfig({ TSU_HMAC_KEY: '   ' }).stderr, /TSU_HMAC_KEY no está definido/);
    assert.match(loadConfig({ TSU_HMAC_KEY: 'corta' }).stderr, /al menos 32/);
    assert.match(loadConfig({ TSU_HMAC_KEY: KEY, JWT_SECRET: KEY }).stderr, /JWT_SECRET/);
});

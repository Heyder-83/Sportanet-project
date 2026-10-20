// backend/test/userInput.test.js
// Pruebas unitarias de utils/userInput.js y utils/dbFail.js (funciones puras; sin servidor ni MySQL).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateBody, validateLogin, badRequest } = require('../utils/userInput');
const dbFail = require('../utils/dbFail');

const full = { full_name: 'Ana', email: 'ana@test.co', phone: '300', pwd: 'Clave-123' };

// res simulado que registra estado y cuerpo
const fakeRes = () => {
    const res = { statusCode: undefined, body: undefined };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
};

test('validateBody: solo copia los 4 campos conocidos; role, is_active y demás claves se descartan', () => {
    const { data, invalid } = validateBody({ ...full, role: 'Admin', is_active: 0, user_id: 1, deleted_at: 'x', __proto__x: 1 }, { requireAll: true });
    assert.deepEqual(invalid, []);
    assert.deepEqual(Object.keys(data).sort(), ['email', 'full_name', 'phone', 'pwd']);
});

test('validateBody: recorta full_name, email y phone, pero NO la contraseña', () => {
    const { data } = validateBody({ full_name: ' Ana ', email: ' ana@test.co ', phone: ' 300 ', pwd: ' clave ' }, { requireAll: true });
    assert.deepEqual(data, { full_name: 'Ana', email: 'ana@test.co', phone: '300', pwd: ' clave ' });
});

test('validateBody con requireAll: lo que falta es inválido; sin requireAll solo se validan los presentes', () => {
    assert.deepEqual(validateBody({}, { requireAll: true }).invalid, ['full_name', 'email', 'phone', 'pwd']);
    assert.deepEqual(validateBody({}, { requireAll: false }), { data: {}, invalid: [] });
    assert.deepEqual(validateBody({ phone: 5 }, { requireAll: false }).invalid, ['phone']);
});

test('validateBody sin requireAll: pwd vacío o null significa "no cambiar" (compatibilidad); con requireAll es inválido', () => {
    for (const pwd of ['', null]) {
        assert.deepEqual(validateBody({ full_name: 'Ana', pwd }, { requireAll: false }), { data: { full_name: 'Ana' }, invalid: [] });
        assert.deepEqual(validateBody({ ...full, pwd }, { requireAll: true }).invalid, ['pwd']);
    }
});

test('validateBody: contraseña medida en BYTES (límite 72 de bcrypt), no en caracteres', () => {
    assert.deepEqual(validateBody({ ...full, pwd: 'a'.repeat(72) }, { requireAll: true }).invalid, []);
    assert.deepEqual(validateBody({ ...full, pwd: 'a'.repeat(73) }, { requireAll: true }).invalid, ['pwd']);
    assert.deepEqual(validateBody({ ...full, pwd: 'é'.repeat(36) }, { requireAll: true }).invalid, []);   // 72 bytes
    assert.deepEqual(validateBody({ ...full, pwd: 'é'.repeat(37) }, { requireAll: true }).invalid, ['pwd']); // 74 bytes
});

test('validateBody tolera cuerpos que no son objeto (undefined, null, texto, número)', () => {
    for (const body of [undefined, null, 'texto', 42]) {
        assert.deepEqual(validateBody(body, { requireAll: true }).invalid, ['full_name', 'email', 'phone', 'pwd']);
    }
});

test('validateLogin: acepta solo texto no vacío y recorta el email; la contraseña no se recorta ni se limita a 72 bytes', () => {
    assert.deepEqual(validateLogin({ email: ' a@b.co ', pwd: ' clave ' }), { email: 'a@b.co', pwd: ' clave ' });
    assert.deepEqual(validateLogin({ email: 'a@b.co', pwd: 'x'.repeat(200) }), { email: 'a@b.co', pwd: 'x'.repeat(200) });
    for (const bad of [undefined, null, 'x', 5, [], {}, { email: 'a@b.co' }, { pwd: 'x' }, { email: '', pwd: 'x' },
        { email: 'a@b.co', pwd: '' }, { email: 'a@b.co', pwd: 123 }, { email: { a: 1 }, pwd: 'x' }, { email: 'a'.repeat(101), pwd: 'x' }]) {
        assert.equal(validateLogin(bad), null, JSON.stringify(bad));
    }
});

test('badRequest: 400 VALIDATION_ERROR con la lista de campos', () => {
    const res = fakeRes();
    badRequest(res, ['email', 'pwd']);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { error: 'Invalid or missing fields: email, pwd', code: 'VALIDATION_ERROR', fields: ['email', 'pwd'] });
});

test('dbFail: ER_DUP_ENTRY se clasifica por el nombre de la clave (MySQL 8, MariaDB y 5.7)', () => {
    const cases = [
        ["for key 'users.email'", 409, 'EMAIL_TAKEN'],
        ["for key 'email'", 409, 'EMAIL_TAKEN'],
        ["for key 'users.phone'", 409, 'PHONE_TAKEN'],
        ["for key 'phone'", 409, 'PHONE_TAKEN'],
        ["for key 'users.PRIMARY'", 409, 'DUPLICATE'],
        ['', 409, 'DUPLICATE'] // mensaje sin clave reconocible
    ];
    for (const [keyText, status, code] of cases) {
        const res = fakeRes();
        dbFail({ code: 'ER_DUP_ENTRY', sqlMessage: `Duplicate entry 'phone@email.co' ${keyText}` }, res, 'test');
        assert.equal(res.statusCode, status, keyText);
        assert.equal(res.body.code, code, keyText);
    }
    const noMsg = fakeRes();
    dbFail({ code: 'ER_DUP_ENTRY' }, noMsg); // sin sqlMessage
    assert.equal(noMsg.body.code, 'DUPLICATE');
});

test('dbFail: cualquier otro error -> 500 genérico y el log solo lleva la etiqueta y el código', (t) => {
    const spy = t.mock.method(console, 'error', () => {});
    const res = fakeRes();
    dbFail(Object.assign(new Error("Unknown column 'phone'"), { code: 'ER_BAD_FIELD_ERROR', sql: 'SELECT phone FROM users', sqlMessage: "Unknown column 'phone'" }), res, 'auth');
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: 'Internal error', code: 'DB_ERROR' });
    assert.deepEqual(spy.mock.calls[0].arguments, ['[auth] error de BD:', 'ER_BAD_FIELD_ERROR']);
});

test('dbFail: error sin código (o que no es un objeto) -> 500 genérico, "sin código" en el log', (t) => {
    const spy = t.mock.method(console, 'error', () => {});
    for (const err of [new Error('x'), undefined, null, 'texto']) {
        const res = fakeRes();
        dbFail(err, res);
        assert.equal(res.statusCode, 500);
        assert.equal(res.body.code, 'DB_ERROR');
    }
    assert.ok(spy.mock.calls.every((c) => c.arguments[1] === 'sin código'));
});

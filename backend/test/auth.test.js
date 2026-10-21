// backend/test/auth.test.js
// Pruebas unitarias de routes/auth.js (register / login). No requieren MySQL: db/connection se sustituye
// por un pool simulado, y se ejecutan el router, db/users.js, utils/ y bcrypt REALES. Ejecutar: npm test
// (con el glob test/*.test.js se recoge solo; si "test" lista archivos uno a uno, añade este).
// Las pruebas contra MySQL real están en test/integration/sql.test.js.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

const SECRET = 'test-secret-only-for-auth-unit-tests-0123456789abcdef';
process.env.JWT_SECRET = SECRET; // antes de cargar config/jwt.js

// ---- Pool simulado: se registra en la caché de módulos ANTES de cargar el router ----
let calls = [];
let tx = []; // eventos de transacción: begin / commit / rollback / release
let handler;
const fakePool = {
    promise: () => ({
        query: async (sql, params) => {
            calls.push({ sql, params });
            return handler(sql, params);
        },
        // Conexión para transacciones (db/accounts.js): sus query() pasan por el mismo handler.
        getConnection: async () => ({
            query: async (sql, params) => {
                calls.push({ sql, params });
                return handler(sql, params);
            },
            beginTransaction: async () => { tx.push('begin'); },
            commit: async () => { tx.push('commit'); },
            rollback: async () => { tx.push('rollback'); },
            release: () => { tx.push('release'); }
        })
    })
};
const connPath = require.resolve('../db/connection');
require.cache[connPath] = { id: connPath, filename: connPath, loaded: true, exports: fakePool };

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const authRouter = require('../routes/auth');

// ---- "Tabla users" en memoria ----
const store = new Map(); // email -> fila
const HASH = bcrypt.hashSync('Clave-123', 4);
const row = (over = {}) => ({
    user_id: 7, full_name: 'Ana Test', email: 'ana@test.co', phone: '3000000000',
    role: 'Participant', pwd: HASH, is_active: 1, deleted_at: null, ...over
});

const defaultHandler = async (sql, params) => {
    if (sql.startsWith('INSERT INTO users')) return [{ insertId: 42 }, undefined];
    if (sql.startsWith('INSERT INTO event_organizers')) return [{ insertId: 5 }, undefined];
    if (/FROM users WHERE email = \?/.test(sql)) return [store.has(params[0]) ? [store.get(params[0])] : [], undefined];
    throw new Error(`SQL inesperada en la prueba: ${sql}`);
};

// Error con la forma real de uno de mysql2: trae el SQL con los valores (incluido el hash) y nombra columnas.
const mysqlError = (code, sqlMessage) => Object.assign(new Error(sqlMessage), {
    code,
    sqlMessage,
    sql: "INSERT INTO users (full_name, email, phone, pwd) VALUES ('Ana', 'ana@test.co', '300', '$2b$10$HASH-SECRETO-QUE-NO-DEBE-SALIR')"
});

let server, base;

before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRouter);
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}/api/auth`;
});

beforeEach(() => {
    calls = [];
    tx = [];
    handler = defaultHandler;
    store.clear();
    store.set('ana@test.co', row());
});

after(() => server.close());

const post = (url, body) =>
    fetch(`${base}${url}`, {
        method: 'POST',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });

const validRegister = (over = {}) => ({ full_name: 'Nuevo Usuario', email: 'nuevo@test.co', phone: '3001112233', pwd: 'Clave-segura-1', ...over });

// Silencia console.error durante la prueba y devuelve todo lo que se habría registrado como un solo texto.
const captureErrors = (t) => {
    const spy = t.mock.method(console, 'error', () => {});
    return () => spy.mock.calls.map((c) => c.arguments.map(String).join(' ')).join('\n');
};

// ---------------------------------------------------------------------------
// register
// ---------------------------------------------------------------------------

test('register válido -> 200 con token, usuario sin pwd y valores recortados', async () => {
    const res = await post('/register', validRegister({ full_name: '  Nuevo Usuario ', email: ' nuevo@test.co ', phone: ' 3001112233 ' }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.message, 'User registered successfully');
    assert.deepEqual(body.user, { id: 42, full_name: 'Nuevo Usuario', email: 'nuevo@test.co', phone: '3001112233', role: 'Participant' });
    assert.equal(JSON.stringify(body).includes('$2'), false); // ningún hash en la respuesta
    const payload = jwt.verify(body.token, SECRET, { algorithms: ['HS256'] });
    assert.equal(payload.id, 42);
    assert.equal(payload.email, 'nuevo@test.co');
});

test('register: INSERT con columnas fijas y la contraseña SOLO como hash bcrypt', async () => {
    await post('/register', validRegister());
    assert.equal(calls.length, 1);
    assert.equal(calls[0].sql, 'INSERT INTO users (full_name, email, phone, pwd, role) VALUES (?, ?, ?, ?, ?)');
    const [name, email, phone, stored, role] = calls[0].params;
    assert.deepEqual([name, email, phone, role], ['Nuevo Usuario', 'nuevo@test.co', '3001112233', 'Participant']);
    assert.notEqual(stored, 'Clave-segura-1');
    assert.match(stored, /^\$2[aby]\$10\$/);
    assert.equal(await bcrypt.compare('Clave-segura-1', stored), true);
});

test('register ignora role, is_active, user_id y deleted_at del body (no hay asignación de privilegios)', async () => {
    const res = await post('/register', validRegister({ role: 'Admin', is_active: 0, user_id: 1, deleted_at: '2020-01-01' }));
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params.length, 5); // los 4 campos conocidos + el rol que decide el servidor
    assert.equal(calls[0].params[4], 'Participant'); // role:'Admin' del body no llega a la BD
    assert.ok(!calls[0].params.includes('Admin'));
    assert.ok(!/is_active|user_id|deleted_at/.test(calls[0].sql));
    const body = await res.json();
    assert.equal(body.user.id, 42); // el id lo asigna la BD, no el cliente
    assert.equal(body.user.role, 'Participant');
});

test('register con datos inválidos -> 400 VALIDATION_ERROR con la lista de campos y SIN tocar la BD', async () => {
    const cases = [
        [{}, ['full_name', 'email', 'phone', 'pwd']],
        [[], ['full_name', 'email', 'phone', 'pwd']],
        [validRegister({ full_name: undefined }), ['full_name']],
        [validRegister({ full_name: '   ' }), ['full_name']],
        [validRegister({ full_name: 'x'.repeat(101) }), ['full_name']],
        [validRegister({ full_name: ['Ana'] }), ['full_name']],
        [validRegister({ email: 'sin-arroba' }), ['email']],
        [validRegister({ email: `${'a'.repeat(96)}@x.co` }), ['email']], // 101 caracteres
        [validRegister({ email: { email: 1 } }), ['email']],
        [validRegister({ phone: 3001112233 }), ['phone']],
        [validRegister({ phone: '1'.repeat(21) }), ['phone']],
        [validRegister({ phone: '' }), ['phone']],
        [validRegister({ pwd: 12345678 }), ['pwd']],
        [validRegister({ pwd: null }), ['pwd']],
        [validRegister({ pwd: '' }), ['pwd']],
        [validRegister({ pwd: 'é'.repeat(37) }), ['pwd']], // 74 bytes: bcrypt truncaría a 72
        [validRegister({ email: 'mal', phone: '', pwd: true }), ['email', 'phone', 'pwd']]
    ];
    for (const [body, fields] of cases) {
        const res = await post('/register', body);
        const json = await res.json();
        assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
        assert.equal(json.code, 'VALIDATION_ERROR');
        assert.deepEqual(json.fields, fields);
    }
    assert.deepEqual(calls, []); // ninguna validación llegó a la BD
});

test('register sin cuerpo JSON -> 400 (antes: 500 con una traza en el log)', async () => {
    const res = await post('/register'); // sin Content-Type ni body
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, 'VALIDATION_ERROR');
    assert.deepEqual(calls, []);
});

test('register con contraseña de exactamente 72 bytes -> aceptada', async () => {
    const res = await post('/register', validRegister({ pwd: 'a'.repeat(72) }));
    assert.equal(res.status, 200);
});

test('register: duplicados -> 409 con el código del campo, distinguido por el NOMBRE de la clave', async () => {
    const cases = [
        ["Duplicate entry 'x@y.co' for key 'users.email'", 'EMAIL_TAKEN', 'Email already registered'], // MySQL 8
        ["Duplicate entry 'x@y.co' for key 'email'", 'EMAIL_TAKEN', 'Email already registered'],       // MariaDB / 5.7
        ["Duplicate entry '300' for key 'users.phone'", 'PHONE_TAKEN', 'Phone already registered'],
        ["Duplicate entry '300' for key 'phone'", 'PHONE_TAKEN', 'Phone already registered'],
        // Un correo que contiene la palabra "phone": sigue siendo el email el duplicado.
        ["Duplicate entry 'phone@x.co' for key 'users.email'", 'EMAIL_TAKEN', 'Email already registered'],
        ["Duplicate entry '300' for key 'users.PRIMARY'", 'DUPLICATE', 'Duplicate value']
    ];
    for (const [sqlMessage, code, message] of cases) {
        handler = async () => { throw mysqlError('ER_DUP_ENTRY', sqlMessage); };
        const res = await post('/register', validRegister());
        assert.equal(res.status, 409, sqlMessage);
        assert.deepEqual(await res.json(), { error: message, code });
    }
});

test('register: un error de BD no filtra SQL, hash, tablas ni columnas, ni a la respuesta ni al log', async (t) => {
    const logged = captureErrors(t);
    handler = async () => { throw mysqlError('ER_DATA_TOO_LONG', "Data too long for column 'full_name' at row 1"); };
    const res = await post('/register', validRegister());
    const text = await res.text();
    assert.equal(res.status, 500);
    assert.deepEqual(JSON.parse(text), { error: 'Internal error', code: 'DB_ERROR' });
    assert.ok(!/full_name|INSERT|users|\$2/.test(text), 'la respuesta filtró un detalle interno');
    const log = logged();
    assert.match(log, /ER_DATA_TOO_LONG/);
    assert.ok(!/full_name|INSERT|HASH-SECRETO|\$2/.test(log), 'el log contiene SQL, hash o columnas');
});

test('register: un fallo inesperado en bcrypt -> 500 genérico (no cuelga ni tumba el proceso)', async (t) => {
    const logged = captureErrors(t);
    t.mock.method(bcrypt, 'hash', async () => { throw new Error('fallo interno de bcrypt'); });
    const res = await post('/register', validRegister());
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'Internal error', code: 'DB_ERROR' });
    assert.ok(!logged().includes('fallo interno de bcrypt'));
});

// ---------------------------------------------------------------------------
// register: tipo de cuenta (Fase 1E)
// ---------------------------------------------------------------------------

test('register Atleta explícito -> Participant, UN solo INSERT y sin fila de organizador', async () => {
    const res = await post('/register', validRegister({ account_type: 'Atleta' }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).user.role, 'Participant');
    assert.equal(calls.length, 1);
    assert.ok(!calls.some((c) => c.sql.includes('event_organizers')));
    assert.deepEqual(tx, ['begin', 'commit', 'release']);
});

test('register Organizador -> Organizer y fila en event_organizers con el nombre del usuario, en una transacción', async () => {
    const res = await post('/register', validRegister({ account_type: 'Organizador', full_name: ' Club Los Andes ' }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.user.role, 'Organizer');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].params[4], 'Organizer');
    assert.equal(calls[1].sql, 'INSERT INTO event_organizers (user_id, display_name) VALUES (?, ?)');
    assert.deepEqual(calls[1].params, [42, 'Club Los Andes']); // id recién creado + nombre recortado
    assert.deepEqual(tx, ['begin', 'commit', 'release']);
});

test('register Organizador: si falla el INSERT del organizador se hace rollback, no hay commit y se libera la conexión', async (t) => {
    const logged = captureErrors(t);
    handler = async (sql) => {
        if (sql.startsWith('INSERT INTO users')) return [{ insertId: 42 }, undefined];
        throw mysqlError('ER_NO_REFERENCED_ROW_2', 'Cannot add or update a child row');
    };
    const res = await post('/register', validRegister({ account_type: 'Organizador' }));
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'Internal error', code: 'DB_ERROR' });
    assert.deepEqual(tx, ['begin', 'rollback', 'release']);
    assert.match(logged(), /ER_NO_REFERENCED_ROW_2/);
});

test('register: duplicado dentro de la transacción -> 409 con rollback', async () => {
    handler = async () => { throw mysqlError('ER_DUP_ENTRY', "Duplicate entry 'x@y.co' for key 'users.email'"); };
    const res = await post('/register', validRegister({ account_type: 'Organizador' }));
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, 'EMAIL_TAKEN');
    assert.deepEqual(tx, ['begin', 'rollback', 'release']);
});

test('register: account_type fuera de la lista blanca -> 400 sin tocar la BD (Admin, minúsculas, prototipo, tipos raros)', async () => {
    const bad = ['Admin', 'Administrador', 'Participant', 'Organizer', 'atleta', 'ORGANIZADOR', ' Atleta', '',
        'constructor', '__proto__', 'toString', null, 0, 1, true, ['Atleta'], { a: 1 }];
    for (const account_type of bad) {
        const res = await post('/register', validRegister({ account_type }));
        const body = await res.json();
        assert.equal(res.status, 400, JSON.stringify(account_type));
        assert.equal(body.code, 'VALIDATION_ERROR');
        assert.deepEqual(body.fields, ['account_type']);
    }
    assert.equal(calls.length, 0);
    assert.deepEqual(tx, []);
});

test('register: account_type inválido se suma a los demás campos inválidos en la misma respuesta', async () => {
    const res = await post('/register', validRegister({ email: 'mal', account_type: 'Admin' }));
    assert.equal(res.status, 400);
    assert.deepEqual((await res.json()).fields, ['email', 'account_type']);
});

test('db/accounts.createAccount rechaza el rol Admin aunque otro código lo pidiera (defensa en profundidad)', async () => {
    const { createAccount } = require('../db/accounts');
    for (const role of ['Admin', undefined, 'constructor']) {
        await assert.rejects(createAccount({ full_name: 'X', email: 'x@y.co', phone: '1', pwdHash: 'h', role }));
    }
    assert.equal(calls.length, 0);
    assert.deepEqual(tx, []); // ni siquiera abre una conexión
});

test('login de un Organizador devuelve su rol', async () => {
    store.set('org@test.co', row({ user_id: 9, email: 'org@test.co', role: 'Organizer' }));
    const res = await post('/login', { email: 'org@test.co', pwd: 'Clave-123' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).user.role, 'Organizer');
});

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------

test('login válido -> 200 con token y usuario sin pwd; email recortado; SELECT sin * ', async () => {
    const res = await post('/login', { email: '  ana@test.co ', pwd: 'Clave-123' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.message, 'Login successful');
    assert.deepEqual(body.user, { id: 7, full_name: 'Ana Test', email: 'ana@test.co', phone: '3000000000', role: 'Participant' });
    assert.equal(JSON.stringify(body).includes('$2'), false);
    const payload = jwt.verify(body.token, SECRET, { algorithms: ['HS256'] });
    assert.deepEqual([payload.id, payload.email], [7, 'ana@test.co']);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].params, ['ana@test.co']);
    assert.ok(!/\*/.test(calls[0].sql), 'el login no debe usar SELECT *');
});

test('login con tipos inesperados -> 400 y NO tumba el servidor (antes: unhandledRejection con pwd numérico)', async () => {
    const bad = [
        { email: 'ana@test.co', pwd: 12345678 },   // bcrypt.compare lanzaba "data and hash must be strings"
        { email: 'ana@test.co', pwd: ['Clave-123'] },
        { email: 'ana@test.co', pwd: { a: 1 } },
        { email: 'ana@test.co', pwd: true },
        { email: { email: 1 }, pwd: 'Clave-123' },  // un objeto como valor del WHERE
        { email: ['ana@test.co'], pwd: 'Clave-123' },
        { email: 'ana@test.co' },
        { pwd: 'Clave-123' },
        {},
        { email: '', pwd: 'Clave-123' },
        { email: '   ', pwd: 'Clave-123' },
        { email: 'ana@test.co', pwd: '' },
        { email: 'a'.repeat(101), pwd: 'Clave-123' }
    ];
    for (const body of bad) {
        const res = await post('/login', body);
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.deepEqual(await res.json(), { error: 'Missing email or password', code: 'VALIDATION_ERROR' });
    }
    assert.deepEqual(calls, []); // ni siquiera se consultó la BD
    assert.equal((await post('/login', { email: 'ana@test.co', pwd: 'Clave-123' })).status, 200); // el servidor sigue vivo
});

test('login sin cuerpo JSON -> 400 (antes: 500 con una traza en el log)', async () => {
    const res = await post('/login');
    assert.equal(res.status, 400);
    assert.deepEqual(calls, []);
});

test('login: contraseña incorrecta y correo inexistente dan la MISMA respuesta (401 genérico)', async () => {
    const wrongPwd = await post('/login', { email: 'ana@test.co', pwd: 'incorrecta' });
    const unknown = await post('/login', { email: 'nadie@test.co', pwd: 'Clave-123' });
    assert.equal(wrongPwd.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(await wrongPwd.json(), { error: 'Invalid credentials' });
    assert.deepEqual(await unknown.json(), { error: 'Invalid credentials' });
});

test('login con correo inexistente también ejecuta bcrypt.compare (contra un hash falso): el tiempo no revela qué correos existen', async (t) => {
    const compare = t.mock.method(bcrypt, 'compare');
    await post('/login', { email: 'nadie@test.co', pwd: 'Clave-123' });
    assert.equal(compare.mock.callCount(), 1);
    const [pwdArg, hashArg] = compare.mock.calls[0].arguments;
    assert.equal(pwdArg, 'Clave-123');
    assert.match(hashArg, /^\$2[aby]\$10\$/); // hash válido y con el mismo coste (10) que los reales
    assert.notEqual(hashArg, HASH);

    await post('/login', { email: 'ana@test.co', pwd: 'Clave-123' });
    assert.equal(compare.mock.callCount(), 2);
    assert.equal(compare.mock.calls[1].arguments[1], HASH); // con un correo existente se usa su hash
});

test('login con cuenta desactivada o eliminada -> 403 SOLO si la contraseña es correcta', async () => {
    store.set('off@test.co', row({ email: 'off@test.co', is_active: 0 }));
    store.set('del@test.co', row({ email: 'del@test.co', deleted_at: new Date() }));
    store.set('both@test.co', row({ email: 'both@test.co', is_active: 0, deleted_at: new Date() }));

    for (const [email, code] of [['off@test.co', 'ACCOUNT_DISABLED'], ['del@test.co', 'ACCOUNT_DELETED'], ['both@test.co', 'ACCOUNT_DELETED']]) {
        const ok = await post('/login', { email, pwd: 'Clave-123' });
        const body = await ok.json();
        assert.equal(ok.status, 403, email);
        assert.equal(body.code, code);
        assert.equal(body.token, undefined);

        const wrong = await post('/login', { email, pwd: 'incorrecta' });
        assert.equal(wrong.status, 401); // no se revela el estado a quien no conoce la contraseña
        assert.equal((await wrong.json()).code, undefined);
    }
});

test('login: un error de BD no filtra detalles internos', async (t) => {
    const logged = captureErrors(t);
    handler = async () => { throw mysqlError('ER_ACCESS_DENIED_ERROR', "Access denied for user 'root'@'localhost' (using password: YES)"); };
    const res = await post('/login', { email: 'ana@test.co', pwd: 'Clave-123' });
    const text = await res.text();
    assert.equal(res.status, 500);
    assert.deepEqual(JSON.parse(text), { error: 'Internal error', code: 'DB_ERROR' });
    assert.ok(!/root|localhost|Access denied/.test(text));
    const log = logged();
    assert.match(log, /ER_ACCESS_DENIED_ERROR/);
    assert.ok(!/root|localhost|INSERT|\$2/.test(log));
});

test('login: un fallo inesperado en bcrypt.compare -> 500 genérico y la petición recibe respuesta', async (t) => {
    captureErrors(t);
    t.mock.method(bcrypt, 'compare', async () => { throw new Error('fallo interno de bcrypt'); });
    const res = await post('/login', { email: 'ana@test.co', pwd: 'Clave-123' });
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'Internal error', code: 'DB_ERROR' });
});

// backend/test/eventsRouter.test.js
// Comprueba el CABLEADO de routes/events.js: qué rutas expone y qué middlewares tiene cada una, en qué orden.
// No requiere MySQL ni levantar Express: se sustituye `express` por un Router mínimo que solo registra las rutas,
// y requireAuth por una marca (authenticate tiene sus propias pruebas en test/authenticate.test.js).
// Los middlewares reales que se ejercitan aquí son requireRole / ROLES (middleware/authorize.js).
// El recorrido HTTP completo (con JWT y MySQL reales) está en test/integration/events.test.js.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const routes = []; // { method, path, handlers }
const fakeExpress = {
    Router: () => ({
        get: (path, ...handlers) => routes.push({ method: 'GET', path, handlers }),
        post: (path, ...handlers) => routes.push({ method: 'POST', path, handlers })
    })
};
const authenticateMark = async function authenticateMark() {};

const stub = (relative, exports) => {
    const p = require.resolve(relative);
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
};

before(() => {
    stub('../db/connection', { promise: () => { throw new Error('la BD no debe usarse en esta prueba'); } });
    stub('../middleware/requireAuth', authenticateMark);

    const originalLoad = Module._load;
    Module._load = function (request, ...rest) {
        return request === 'express' ? fakeExpress : originalLoad.call(this, request, ...rest);
    };
    try {
        require('../routes/events');
    } finally {
        Module._load = originalLoad;
    }
});

const find = (method, path) => routes.find((r) => r.method === method && r.path === path);
const runMiddleware = (fn, req) => {
    const out = { nextCalled: false, statusCode: undefined, body: undefined };
    const res = {
        set() { return res; },
        status(code) { out.statusCode = code; return res; },
        json(body) { out.body = body; return res; }
    };
    fn(req, res, () => { out.nextCalled = true; });
    return out;
};

test('el router expone exactamente GET /, GET /:id y POST /', () => {
    assert.deepEqual(routes.map((r) => `${r.method} ${r.path}`).sort(), ['GET /', 'GET /:id', 'POST /']);
});

test('las consultas son públicas: GET / y GET /:id tienen un único handler, sin authenticate', () => {
    for (const path of ['/', '/:id']) {
        const { handlers } = find('GET', path);
        assert.equal(handlers.length, 1, `GET ${path}`);
        assert.notEqual(handlers[0], authenticateMark);
    }
});

test('POST / monta, en este orden: authenticate, requireRole(Organizer) y el handler', () => {
    const { handlers } = find('POST', '/');
    assert.equal(handlers.length, 3);
    assert.equal(handlers[0], authenticateMark); // primero la sesión (401)
    assert.equal(handlers[1].name, 'requireRoleMiddleware'); // después el rol (403)
    assert.equal(handlers[2].name, 'create'); // y solo entonces la lógica
});

test('requireRole(Organizer) deja pasar a un Organizer', () => {
    const [, role] = find('POST', '/').handlers;
    const out = runMiddleware(role, { auth: { userId: 1, email: 'o@t.co', role: 'Organizer' } });
    assert.equal(out.nextCalled, true);
});

test('requireRole(Organizer) rechaza con 403 FORBIDDEN a un Participant', () => {
    const [, role] = find('POST', '/').handlers;
    const out = runMiddleware(role, { auth: { userId: 1, email: 'p@t.co', role: 'Participant' } });
    assert.equal(out.nextCalled, false);
    assert.equal(out.statusCode, 403);
    assert.equal(out.body.code, 'FORBIDDEN');
});

test('Admin tampoco puede crear eventos todavía (no hay atajo por rol)', () => {
    const [, role] = find('POST', '/').handlers;
    const out = runMiddleware(role, { auth: { userId: 1, email: 'a@t.co', role: 'Admin' } });
    assert.equal(out.nextCalled, false);
    assert.equal(out.statusCode, 403);
});

test('sin sesión (req.auth indefinido) requireRole falla cerrado con 401', () => {
    const [, role] = find('POST', '/').handlers;
    const out = runMiddleware(role, {});
    assert.equal(out.nextCalled, false);
    assert.equal(out.statusCode, 401);
});

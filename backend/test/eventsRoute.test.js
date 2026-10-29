// backend/test/eventsRoute.test.js
// Pruebas de routes/events.js (API pública de eventos) con una BD simulada: parámetros, códigos de respuesta,
// forma de la respuesta, caché y errores. Las consultas reales se prueban en test/integration/events_api.test.js.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createEventsRouter } = require('../routes/events');

let listCalls, detailCalls, listImpl, detailImpl;
const fakeDb = {
    listPublicEvents: async (...a) => { listCalls.push(a); return listImpl(...a); },
    findPublicEventById: async (...a) => { detailCalls.push(a); return detailImpl(...a); }
};
// 2026-10-28 20:00 UTC = 15:00 en Colombia
const clock = () => new Date('2026-10-28T20:00:00Z');

let server, base;
before(async () => {
    const app = express();
    app.use('/api/events', createEventsRouter({ db: fakeDb, clock }));
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}/api/events`;
});
beforeEach(() => {
    listCalls = []; detailCalls = [];
    listImpl = async () => ({ total: 0, items: [] });
    detailImpl = async () => null;
});
after(() => server.close());

test('listado sin parámetros: pide próximos, página 1 y 12 por página con el "ahora" de Colombia', async () => {
    const res = await fetch(base);
    assert.equal(res.status, 200);
    assert.deepEqual(listCalls[0], [{ q: null, sort: null, when: 'upcoming', page: 1, limit: 12 }, '2026-10-28 15:00:00']);
    assert.deepEqual(await res.json(), { data: [], page: 1, limit: 12, total: 0, total_pages: 0 });
});

test('listado: pasa búsqueda, orden, pestaña y paginación ya validados', async () => {
    await fetch(`${base}?q=%20golf%20%20macanal%20&sort=name_desc&when=past&page=3&limit=5`);
    assert.deepEqual(listCalls[0][0], { q: 'golf macanal', sort: 'name_desc', when: 'past', page: 3, limit: 5 });
});

test('listado: total_pages se calcula con el total y el tamaño de página', async () => {
    listImpl = async () => ({ total: 25, items: [{ id: 1 }] });
    const body = await (await fetch(`${base}?limit=10`)).json();
    assert.equal(body.total, 25);
    assert.equal(body.total_pages, 3);
    assert.deepEqual(body.data, [{ id: 1 }]);
});

test('listado: parámetros inválidos -> 400 VALIDATION_ERROR con la lista de campos, sin consultar la BD', async () => {
    const res = await fetch(`${base}?sort=precio&page=0&limit=500&when=todo`);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, 'VALIDATION_ERROR');
    assert.deepEqual(body.fields, ['sort', 'when', 'page', 'limit']);
    assert.equal(listCalls.length, 0);
    assert.equal((await fetch(`${base}?q=${'a'.repeat(101)}`)).status, 400);
    assert.equal((await fetch(`${base}?q=a&q=b`)).status, 400);
});

test('las respuestas exitosas llevan Cache-Control público corto; los errores no', async () => {
    assert.equal((await fetch(base)).headers.get('cache-control'), 'public, max-age=30');
    detailImpl = async () => ({ id: 1 });
    assert.equal((await fetch(`${base}/1`)).headers.get('cache-control'), 'public, max-age=30');
    assert.equal((await fetch(`${base}?sort=x`)).headers.get('cache-control'), null);
    detailImpl = async () => null;
    assert.equal((await fetch(`${base}/999`)).headers.get('cache-control'), null);
});

test('no exige token: un GET anónimo funciona', async () => {
    const res = await fetch(base, { headers: {} });
    assert.equal(res.status, 200);
});

test('detalle: devuelve el evento; 404 si no existe o es borrador (la BD devuelve null)', async () => {
    detailImpl = async (id) => ({ id });
    const ok = await fetch(`${base}/42`);
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { id: 42 });
    assert.deepEqual(detailCalls[0], [42, '2026-10-28 15:00:00']);
    detailImpl = async () => null;
    const nf = await fetch(`${base}/43`);
    assert.equal(nf.status, 404);
    assert.deepEqual(await nf.json(), { error: 'Event not found', code: 'NOT_FOUND' });
});

test('detalle: ids que no son enteros positivos del rango -> 404 sin consultar la BD', async () => {
    for (const bad of ['0', '-1', 'abc', '1.5', '01', '1e2', '2147483648', '99999999999', '%20', '1%20OR%201=1']) {
        const res = await fetch(`${base}/${bad}`);
        assert.equal(res.status, 404, bad);
    }
    assert.equal(detailCalls.length, 0);
});

test('error de BD -> 500 genérico, sin SQL ni nombres de tablas, y solo el código al log', async (t) => {
    const spy = t.mock.method(console, 'error', () => {});
    const boom = () => { throw Object.assign(new Error("Table 'sportanet_v1.sport_events' doesn't exist"), { code: 'ER_NO_SUCH_TABLE', sql: 'SELECT secreto FROM sport_events' }); };
    listImpl = boom; detailImpl = boom;
    for (const url of [base, `${base}/5`]) {
        const res = await fetch(url);
        const text = await res.text();
        assert.equal(res.status, 500);
        assert.deepEqual(JSON.parse(text), { error: 'Internal error', code: 'DB_ERROR' });
        assert.ok(!/sport_events|SELECT|sportanet/.test(text));
    }
    const log = spy.mock.calls.map((c) => c.arguments.map(String).join(' ')).join('\n');
    assert.match(log, /ER_NO_SUCH_TABLE/);
    assert.ok(!/SELECT|doesn't exist/.test(log));
});

test('solo se exponen GET: otros métodos no existen en la API pública', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
        assert.equal((await fetch(base, { method })).status, 404, method);
        assert.equal((await fetch(`${base}/1`, { method })).status, 404, method);
    }
});

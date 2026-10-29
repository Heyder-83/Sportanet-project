// backend/test/eventsQuery.test.js
// Pruebas de utils/eventsQuery.js: validación de los parámetros del listado público y el "ahora" en hora de Colombia.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseListQuery, escapeLike, nowLocal, SORTS, WHENS } = require('../utils/eventsQuery');

test('sin parámetros: próximos, página 1, 12 por página, sin búsqueda ni orden explícito', () => {
    assert.deepEqual(parseListQuery({}), { value: { q: null, sort: null, when: 'upcoming', page: 1, limit: 12 }, invalid: [] });
    assert.deepEqual(parseListQuery(undefined).invalid, []);
    assert.deepEqual(parseListQuery(null).invalid, []);
    assert.deepEqual(parseListQuery('texto').invalid, []);
});

test('parámetros vacíos se tratan como ausentes', () => {
    const r = parseListQuery({ q: '', sort: '', when: '', page: '', limit: '' });
    assert.deepEqual(r.invalid, []);
    assert.equal(r.value.when, 'upcoming');
});

test('q: se recorta, se colapsan espacios y se acepta hasta 100 caracteres', () => {
    assert.equal(parseListQuery({ q: '  torneo   de  golf ' }).value.q, 'torneo de golf');
    assert.equal(parseListQuery({ q: '   ' }).value.q, null);
    assert.deepEqual(parseListQuery({ q: 'a'.repeat(100) }).invalid, []);
    assert.deepEqual(parseListQuery({ q: 'a'.repeat(101) }).invalid, ['q']);
    assert.deepEqual(parseListQuery({ q: ['a', 'b'] }).invalid, ['q']); // ?q=a&q=b
    assert.deepEqual(parseListQuery({ q: { x: 1 } }).invalid, ['q']);
});

test('sort y when: solo valores de la lista; cualquier otro -> inválido', () => {
    for (const s of SORTS) assert.equal(parseListQuery({ sort: s }).value.sort, s);
    for (const w of WHENS) assert.equal(parseListQuery({ when: w }).value.when, w);
    for (const bad of ['NAME_ASC', 'name_asc;DROP TABLE x', 'title', '1', 'constructor', '__proto__']) {
        assert.deepEqual(parseListQuery({ sort: bad }).invalid, ['sort'], bad);
        assert.deepEqual(parseListQuery({ when: bad }).invalid, ['when'], bad);
    }
    assert.deepEqual(parseListQuery({ sort: ['name_asc', 'newest'] }).invalid, ['sort']);
});

test('page y limit: enteros positivos; limit máximo 50; sin ceros, negativos, decimales ni notación científica', () => {
    assert.equal(parseListQuery({ page: '7' }).value.page, 7);
    assert.equal(parseListQuery({ limit: '50' }).value.limit, 50);
    assert.equal(parseListQuery({ limit: '1' }).value.limit, 1);
    for (const bad of ['0', '-1', '1.5', '1e3', '01', 'abc', ' 2', '2 ', '100000000']) {
        assert.deepEqual(parseListQuery({ page: bad }).invalid, ['page'], `page=${bad}`);
    }
    for (const bad of ['0', '51', '100', '-5', '2.5', 'x']) {
        assert.deepEqual(parseListQuery({ limit: bad }).invalid, ['limit'], `limit=${bad}`);
    }
});

test('se informan todos los parámetros inválidos a la vez', () => {
    assert.deepEqual(parseListQuery({ q: 'a'.repeat(200), sort: 'x', when: 'y', page: '0', limit: '99' }).invalid,
        ['q', 'sort', 'when', 'page', 'limit']);
});

test('escapeLike: % _ y | se vuelven literales', () => {
    assert.equal(escapeLike('100%'), '100|%');
    assert.equal(escapeLike('a_b'), 'a|_b');
    assert.equal(escapeLike('a|b'), 'a||b');
    assert.equal(escapeLike('sin especiales'), 'sin especiales');
});

test('nowLocal: hora de pared de Colombia (UTC-5, sin horario de verano)', () => {
    assert.equal(nowLocal(new Date('2026-10-28T20:00:00Z')), '2026-10-28 15:00:00');
    assert.equal(nowLocal(new Date('2026-01-01T04:59:59Z')), '2025-12-31 23:59:59'); // cruce de año hacia atrás
    assert.equal(nowLocal(new Date('2026-01-01T05:00:00Z')), '2026-01-01 00:00:00'); // medianoche: hora 00, no 24
    assert.equal(nowLocal(new Date('2026-07-15T12:00:00Z')), '2026-07-15 07:00:00'); // mismo desfase en verano
    assert.match(nowLocal(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

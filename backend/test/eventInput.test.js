// backend/test/eventInput.test.js
// Pruebas unitarias de utils/eventInput.js (funciones puras). No requieren MySQL ni Express. Ejecutar: npm test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateEventBody, validateVenue, validateListQuery } = require('../utils/eventInput');

const VENUE = { name: 'Club de Golf Macanal', address: 'Vía Macanal km 3', city: 'Bogotá' };
const base = (over = {}) => ({
    title: 'Torneo de prueba',
    sport: 'Golf',
    max_capacity: 32,
    start_at: '2026-12-15T08:00',
    end_at: '2026-12-15T17:00',
    venue: { ...VENUE },
    ...over
});
const invalidOf = (body) => validateEventBody(body).invalid;

test('evento mínimo válido: datos normalizados y sin errores', () => {
    const { data, invalid } = validateEventBody(base());
    assert.deepEqual(invalid, []);
    assert.deepEqual(data.event, {
        title: 'Torneo de prueba',
        sport: 'Golf',
        max_capacity: 32,
        start_at: '2026-12-15 08:00:00',
        end_at: '2026-12-15 17:00:00'
    });
    assert.deepEqual(data.venue, VENUE);
    assert.equal(data.venueId, undefined);
});

test('evento completo válido: todos los opcionales se normalizan', () => {
    const { data, invalid } = validateEventBody(base({
        event_description: '  Un día de golf  ',
        timezone: 'America/Bogota',
        price: '50000.50',
        currency: 'cop',
        registration_deadline: '2026-12-14 12:00',
        cover_image: 'https://example.com/portada.jpg',
        modality: 'Hybrid',
        online_url: 'https://example.com/en-vivo',
        venue: { ...VENUE, region: 'Cundinamarca', country_code: 'co', latitude: '4.7110', longitude: -74.0721 }
    }));
    assert.deepEqual(invalid, []);
    assert.equal(data.event.event_description, 'Un día de golf');
    assert.equal(data.event.timezone, 'America/Bogota');
    assert.equal(data.event.price, 50000.5);
    assert.equal(data.event.currency, 'COP');
    assert.equal(data.event.registration_deadline, '2026-12-14 12:00:00');
    assert.equal(data.event.modality, 'Hybrid');
    assert.deepEqual(data.venue, { ...VENUE, region: 'Cundinamarca', country_code: 'CO', latitude: 4.711, longitude: -74.0721 });
});

test('un formulario puede mandar números como texto y la fecha con espacio o con segundos', () => {
    const { data, invalid } = validateEventBody(base({ max_capacity: '40', start_at: '2026-12-15 08:00:30', price: '0' }));
    assert.deepEqual(invalid, []);
    assert.equal(data.event.max_capacity, 40);
    assert.equal(data.event.start_at, '2026-12-15 08:00:30');
    assert.equal(data.event.price, 0);
});

test('body vacío, nulo o que no es un objeto: se marcan todos los obligatorios', () => {
    for (const body of [undefined, null, {}, [], 'texto', 42]) {
        assert.deepEqual(invalidOf(body), ['title', 'sport', 'max_capacity', 'start_at', 'end_at', 'venue'], JSON.stringify(body));
    }
});

test('título y deporte: vacíos, solo espacios, de otro tipo o demasiado largos', () => {
    for (const bad of ['', '   ', 5, null, {}, 'x'.repeat(151)]) assert.deepEqual(invalidOf(base({ title: bad })), ['title']);
    for (const bad of ['', '   ', 5, null, 'x'.repeat(51)]) assert.deepEqual(invalidOf(base({ sport: bad })), ['sport']);
    assert.deepEqual(invalidOf(base({ title: 'x'.repeat(150), sport: 'y'.repeat(50) })), []);
});

test('capacidad: debe ser un entero mayor que cero y caber en un int de MySQL', () => {
    for (const bad of [0, -1, 1.5, '1.5', '0', '-3', 'abc', true, null, undefined, NaN, Infinity, 2147483648, '2147483648', '12345678901']) {
        assert.deepEqual(invalidOf(base({ max_capacity: bad })), ['max_capacity'], String(bad));
    }
    assert.deepEqual(invalidOf(base({ max_capacity: 1 })), []);
    assert.deepEqual(invalidOf(base({ max_capacity: 2147483647 })), []);
});

test('fechas: formatos inválidos, inexistentes y con zona horaria se rechazan', () => {
    const bad = [
        '2026-12-15', '15/12/2026 08:00', 'mañana', '', 20261215, null, {},
        '2026-12-15T08:00:00Z', '2026-12-15T08:00:00+05:00', '2026-12-15T08:00:00.000Z',
        '2026-02-30T10:00', '2026-13-01T10:00', '2026-00-10T10:00', '2026-04-31T10:00',
        '2026-12-15T24:00', '2026-12-15T08:60', '2026-12-15T08:00:60', '0999-12-15T08:00'
    ];
    for (const v of bad) {
        assert.ok(invalidOf(base({ start_at: v })).includes('start_at'), `start_at ${JSON.stringify(v)}`);
        assert.ok(invalidOf(base({ end_at: v })).includes('end_at'), `end_at ${JSON.stringify(v)}`);
    }
    assert.deepEqual(invalidOf(base({ start_at: '2028-02-29T10:00', end_at: '2028-02-29T11:00' })), []); // bisiesto
    assert.ok(invalidOf(base({ start_at: '2027-02-29T10:00', end_at: '2027-03-01T10:00' })).includes('start_at')); // no bisiesto
});

test('fechas: el fin debe ser posterior al inicio (chk_events_dates)', () => {
    assert.deepEqual(invalidOf(base({ end_at: '2026-12-15T08:00' })), ['end_at']); // igual
    assert.deepEqual(invalidOf(base({ end_at: '2026-12-15T07:59' })), ['end_at']); // anterior
    assert.deepEqual(invalidOf(base({ end_at: '2026-12-15T08:01' })), []);
    // Si el inicio ya es inválido solo se informa el inicio (no se compara contra una fecha rota).
    assert.deepEqual(invalidOf(base({ start_at: 'x' })), ['start_at']);
});

test('precio: no negativo, hasta 2 decimales y dentro de decimal(10,2); vacío o ausente = gratis', () => {
    for (const bad of [-1, '-5', 'abc', 1.234, '10.999', 100000000, '100000000', true, {}, NaN, Infinity]) {
        assert.deepEqual(invalidOf(base({ price: bad })), ['price'], String(bad));
    }
    for (const ok of [0, '0', 0.5, '12', 99999999.99, '99999999.99']) assert.deepEqual(invalidOf(base({ price: ok })), [], String(ok));
    for (const absent of [undefined, null, '', '  ']) {
        const { data, invalid } = validateEventBody(base({ price: absent }));
        assert.deepEqual(invalid, []);
        assert.equal('price' in data.event, false);
    }
});

test('moneda: tres letras (se pasa a mayúsculas)', () => {
    assert.equal(validateEventBody(base({ currency: 'usd' })).data.event.currency, 'USD');
    for (const bad of ['COPP', 'CO', '12C', 5, {}]) assert.deepEqual(invalidOf(base({ currency: bad })), ['currency'], String(bad));
});

test('zona horaria: solo nombres IANA reales', () => {
    for (const ok of ['America/Bogota', 'UTC', 'America/Argentina/Buenos_Aires', 'Europe/Madrid']) {
        assert.deepEqual(invalidOf(base({ timezone: ok })), [], ok);
    }
    for (const bad of ['Mars/Phobos', '+05:00', 'Bogota', 'America//Bogota', 'a'.repeat(65), 5, {}]) {
        assert.deepEqual(invalidOf(base({ timezone: bad })), ['timezone'], String(bad));
    }
});

test('fecha límite de inscripción: no puede ser posterior al fin (chk_events_deadline)', () => {
    assert.deepEqual(invalidOf(base({ registration_deadline: '2026-12-15T17:01' })), ['registration_deadline']);
    assert.deepEqual(invalidOf(base({ registration_deadline: '2026-12-15T17:00' })), []); // igual al fin: permitido
    assert.deepEqual(invalidOf(base({ registration_deadline: '2026-12-01T00:00' })), []);
    assert.deepEqual(invalidOf(base({ registration_deadline: 'pronto' })), ['registration_deadline']);
});

test('enlaces: solo http y https (se rechazan javascript:, data:, espacios y textos largos)', () => {
    for (const field of ['cover_image', 'online_url']) {
        for (const bad of ['javascript:alert(1)', 'data:text/html;base64,AAAA', 'ftp://example.com/x', 'no es url', 'https://a b.com', `https://example.com/${'x'.repeat(500)}`, 5]) {
            assert.deepEqual(invalidOf(base({ [field]: bad })), [field], `${field} ${String(bad).slice(0, 30)}`);
        }
        assert.deepEqual(invalidOf(base({ [field]: 'http://example.com/a?b=1' })), []);
    }
});

test('descripción: opcional, hasta 5000 caracteres; vacía = no enviada', () => {
    assert.deepEqual(invalidOf(base({ event_description: 'x'.repeat(5000) })), []);
    assert.deepEqual(invalidOf(base({ event_description: 'x'.repeat(5001) })), ['event_description']);
    assert.deepEqual(invalidOf(base({ event_description: 5 })), ['event_description']);
    assert.equal('event_description' in validateEventBody(base({ event_description: '' })).data.event, false);
});

test('modalidad: solo InPerson, Virtual o Hybrid; sin indicar es InPerson y no se envía a la BD', () => {
    assert.deepEqual(invalidOf(base({ modality: 'Online' })), ['modality']);
    assert.deepEqual(invalidOf(base({ modality: 'inperson' })), ['modality']);
    assert.deepEqual(invalidOf(base({ modality: 5 })), ['modality']);
    assert.equal('modality' in validateEventBody(base()).data.event, false); // default de la BD
});

test('ubicación: presencial e híbrido la exigen; virtual la prohíbe y exige enlace', () => {
    const noVenue = base();
    delete noVenue.venue;
    assert.deepEqual(invalidOf(noVenue), ['venue']); // presencial por defecto
    assert.deepEqual(invalidOf({ ...noVenue, modality: 'Hybrid' }), ['venue']);

    // virtual: enlace obligatorio, sin sede
    assert.deepEqual(invalidOf({ ...noVenue, modality: 'Virtual' }), ['online_url']);
    assert.deepEqual(invalidOf({ ...noVenue, modality: 'Virtual', online_url: 'https://meet.example.com/x' }), []);
    assert.deepEqual(invalidOf({ ...noVenue, modality: 'Virtual', online_url: 'https://meet.example.com/x', venue: VENUE }), ['venue']);
    assert.deepEqual(invalidOf({ ...noVenue, modality: 'Virtual', online_url: 'https://meet.example.com/x', venue_id: 3 }), ['venue_id']);

    // híbrido: sede obligatoria, enlace opcional
    assert.deepEqual(invalidOf({ ...noVenue, modality: 'Hybrid', venue: VENUE }), []);
});

test('ubicación: recinto existente (venue_id) o nuevo (venue), nunca los dos', () => {
    const noVenue = base();
    delete noVenue.venue;
    const ok = validateEventBody({ ...noVenue, venue_id: '7' });
    assert.deepEqual(ok.invalid, []);
    assert.equal(ok.data.venueId, 7);
    assert.equal(ok.data.venue, undefined);

    assert.deepEqual(invalidOf({ ...noVenue, venue_id: 7, venue: VENUE }), ['venue_id', 'venue']);
    for (const bad of [0, -1, 1.5, 'x', 2147483648]) assert.deepEqual(invalidOf({ ...noVenue, venue_id: bad }), ['venue_id'], String(bad));
});

test('recinto nuevo: nombre, dirección y ciudad obligatorios, con los límites de la tabla venues', () => {
    assert.deepEqual(validateVenue({}).invalid, ['venue.name', 'venue.address', 'venue.city']);
    assert.deepEqual(validateVenue('texto').invalid, ['venue']);
    assert.deepEqual(validateVenue([]).invalid, ['venue']);
    assert.deepEqual(validateVenue({ ...VENUE, name: 'x'.repeat(121) }).invalid, ['venue.name']);
    assert.deepEqual(validateVenue({ ...VENUE, address: 'x'.repeat(256) }).invalid, ['venue.address']);
    assert.deepEqual(validateVenue({ ...VENUE, city: 'x'.repeat(101) }).invalid, ['venue.city']);
    assert.deepEqual(validateVenue({ ...VENUE, region: 'x'.repeat(101) }).invalid, ['venue.region']);
    assert.deepEqual(validateVenue({ ...VENUE, name: 'x'.repeat(120), address: 'y'.repeat(255), city: 'z'.repeat(100) }).invalid, []);
    // los errores del recinto salen con prefijo en la validación del evento
    assert.deepEqual(invalidOf(base({ venue: { name: 'x' } })), ['venue.address', 'venue.city']);
});

test('recinto nuevo: país, latitud y longitud (rango y par completo)', () => {
    assert.equal(validateVenue({ ...VENUE, country_code: 'co' }).venue.country_code, 'CO');
    for (const bad of ['COL', 'C', '1A', 5]) assert.deepEqual(validateVenue({ ...VENUE, country_code: bad }).invalid, ['venue.country_code'], String(bad));

    assert.deepEqual(validateVenue({ ...VENUE, latitude: 91, longitude: 0 }).invalid, ['venue.latitude']);
    assert.deepEqual(validateVenue({ ...VENUE, latitude: 0, longitude: -180.5 }).invalid, ['venue.longitude']);
    assert.deepEqual(validateVenue({ ...VENUE, latitude: 'norte', longitude: 0 }).invalid, ['venue.latitude']);
    assert.deepEqual(validateVenue({ ...VENUE, latitude: 4.7 }).invalid, ['venue.longitude']); // falta la pareja
    assert.deepEqual(validateVenue({ ...VENUE, longitude: -74 }).invalid, ['venue.latitude']);
    assert.deepEqual(validateVenue({ ...VENUE, latitude: -90, longitude: 180 }).invalid, []); // extremos válidos
    assert.equal(validateVenue({ ...VENUE, latitude: 4.7110001234, longitude: -74 }).venue.latitude, 4.711); // decimal(9,6)
});

test('los campos que no son del cliente se ignoran: organizador, estado, visibilidad, rol, token', () => {
    const { data, invalid } = validateEventBody(base({
        event_organizers_id: 999, user_id: 999, organizer_id: 999, role: 'Admin', event_status: 'Draft',
        visibility: 'Private', share_token: 'abc', club_id: 5, sport_event_id: 1, canceled_at: '2026-01-01', published_at: '2020-01-01'
    }));
    assert.deepEqual(invalid, []);
    assert.deepEqual(Object.keys(data.event).sort(), ['end_at', 'max_capacity', 'sport', 'start_at', 'title']);
});

test('vacíos de formulario en opcionales (cadena vacía o null) = no enviados', () => {
    const { data, invalid } = validateEventBody(base({
        event_description: '', timezone: '', price: '', currency: '', registration_deadline: '', cover_image: '', modality: '', online_url: '', venue_id: ''
    }));
    assert.deepEqual(invalid, []);
    assert.deepEqual(Object.keys(data.event).sort(), ['end_at', 'max_capacity', 'sport', 'start_at', 'title']);
});

test('un valor enviado pero inválido nunca se descarta en silencio', () => {
    assert.deepEqual(invalidOf(base({ price: 'gratis' })), ['price']);
    assert.deepEqual(invalidOf(base({ timezone: 'xx' })), ['timezone']);
});

test('listado: valores por defecto y límites de limit / offset', () => {
    assert.deepEqual(validateListQuery({}), { data: { limit: 50, offset: 0 }, invalid: [] });
    assert.deepEqual(validateListQuery(undefined), { data: { limit: 50, offset: 0 }, invalid: [] });
    assert.deepEqual(validateListQuery({ limit: '10', offset: '20' }), { data: { limit: 10, offset: 20 }, invalid: [] });
    assert.deepEqual(validateListQuery({ limit: '100' }).data.limit, 100);
    for (const bad of ['0', '101', '-1', 'abc', '1.5', '', ['1', '2'], 5]) {
        assert.deepEqual(validateListQuery({ limit: bad }).invalid, ['limit'], JSON.stringify(bad));
    }
    for (const bad of ['-1', 'abc', '1.5', '', ['1'], '2147483648']) {
        assert.deepEqual(validateListQuery({ offset: bad }).invalid, ['offset'], JSON.stringify(bad));
    }
});

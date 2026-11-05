// backend/utils/eventInput.js
// Validación de los datos de un evento (POST /api/events) y de los parámetros del listado público.
// Funciones puras: sin BD ni Express, para poder probarlas solas (test/eventInput.test.js).
//
// Los límites reflejan las columnas y los CHECK reales de `sport_events` y `venues` en Base de Datos/schema.sql:
//   title varchar(150) · sport varchar(50) · max_capacity int > 0 · price decimal(10,2) >= 0 · currency char(3)
//   end_at > start_at · registration_deadline <= end_at · online_url / cover_image varchar(500)
//   venues: name varchar(120) · address varchar(255) · city varchar(100) · region varchar(100)
//           country_code char(2) · latitude decimal(9,6) en [-90, 90] · longitude decimal(9,6) en [-180, 180]
//
// Solo se copian a `data` los campos conocidos. Cualquier otra clave del body (event_organizers_id, user_id, role,
// event_status, visibility, share_token...) se IGNORA: el organizador sale de la sesión, y todo evento creado
// por esta API nace Published y Public (PROJECT_LOGIC §3.4).

const MAX_INT = 2147483647; // columnas `int` de MySQL
const MODALITIES = Object.freeze(['InPerson', 'Virtual', 'Hybrid']);
const MAX_DESCRIPTION = 5000; // límite de la aplicación (la columna es `text`)
const LIST_DEFAULT_LIMIT = 50;
const LIST_MAX_LIMIT = 100;

const isString = (v) => typeof v === 'string';
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// Un formulario manda '' o null para un campo opcional vacío: eso significa "no enviado".
const isAbsent = (v) => v === undefined || v === null || (isString(v) && v.trim() === '');

function text(v, max) {
    if (!isString(v)) return null;
    const t = v.trim();
    return t.length >= 1 && t.length <= max ? t : null;
}

// Entero positivo/cero desde un número JSON o una cadena de dígitos ("30"). null si no lo es.
function integer(v) {
    if (typeof v === 'number') return Number.isSafeInteger(v) ? v : null;
    if (isString(v) && /^\d{1,10}$/.test(v.trim())) return Number(v.trim());
    return null;
}

// Fecha y hora SIN desplazamiento: "2026-12-15T08:00", "2026-12-15T08:00:30" o con espacio en lugar de "T".
// Es la hora local del evento (la zona va en `timezone`), tal como la guarda la columna DATETIME.
// Rechaza "Z" y desplazamientos (+05:00): serían ambiguos con una columna sin zona.
// Devuelve "YYYY-MM-DD HH:mm:ss" (comparable como texto) o null.
function dateTime(v) {
    if (!isString(v)) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v.trim());
    if (!m) return null;
    const [y, mo, d, h, mi] = m.slice(1, 6).map(Number);
    const s = m[6] === undefined ? 0 : Number(m[6]);
    if (y < 1000 || h > 23 || mi > 59 || s > 59) return null;
    const probe = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
    // Detecta fechas inexistentes (2026-02-30, mes 13): Date las "corrige" y el día o el mes cambian.
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
    const p2 = (n) => String(n).padStart(2, '0');
    return `${m[1]}-${m[2]}-${m[3]} ${p2(h)}:${p2(mi)}:${p2(s)}`;
}

// decimal(10,2) >= 0: número JSON o cadena "50000" / "50000.50"; como máximo 2 decimales (no se redondea en silencio).
function price(v) {
    let n;
    if (typeof v === 'number') n = v;
    else if (isString(v) && /^\d{1,8}(\.\d{1,2})?$/.test(v.trim())) n = Number(v.trim());
    else return null;
    if (!Number.isFinite(n) || n < 0 || n > 99999999.99) return null;
    if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return null;
    return Math.round(n * 100) / 100;
}

// Coordenada decimal(9,6) dentro de [-limit, limit]; se redondea a 6 decimales (la precisión de la columna).
function coordinate(v, limit) {
    let n;
    if (typeof v === 'number') n = v;
    else if (isString(v) && /^-?\d{1,3}(\.\d+)?$/.test(v.trim())) n = Number(v.trim());
    else return null;
    if (!Number.isFinite(n) || Math.abs(n) > limit) return null;
    return Number(n.toFixed(6));
}

// Solo http(s): bloquea javascript:, data: y similares, porque el frontend mostrará estas direcciones.
function httpUrl(v) {
    if (!isString(v)) return null;
    const t = v.trim();
    if (t.length > 500 || /\s/.test(t)) return null;
    try {
        const u = new URL(t);
        return u.protocol === 'http:' || u.protocol === 'https:' ? t : null;
    } catch (_) {
        return null;
    }
}

// Zona horaria IANA ("America/Bogota", "UTC"). El patrón evita los desplazamientos numéricos que Intl también acepta.
function timeZone(v) {
    if (!isString(v)) return null;
    const t = v.trim();
    if (t.length > 64 || !/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z][A-Za-z0-9_+-]*)*$/.test(t)) return null;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: t });
        return t;
    } catch (_) {
        return null;
    }
}

// Recinto nuevo (`venue`): name, address y city obligatorios; region, country_code y coordenadas opcionales.
// Se guardan address, city y las coordenadas porque con ellos una fase posterior puede generar enlaces a mapas.
// Devuelve { venue, invalid }; los nombres inválidos llevan el prefijo "venue.".
function validateVenue(src) {
    const invalid = [];
    if (!isPlainObject(src)) return { venue: undefined, invalid: ['venue'] };
    const venue = {};

    for (const [field, max] of [['name', 120], ['address', 255], ['city', 100]]) {
        const v = text(src[field], max);
        if (v === null) invalid.push(`venue.${field}`);
        else venue[field] = v;
    }
    if (!isAbsent(src.region)) {
        const v = text(src.region, 100);
        if (v === null) invalid.push('venue.region');
        else venue.region = v;
    }
    if (!isAbsent(src.country_code)) {
        if (isString(src.country_code) && /^[A-Za-z]{2}$/.test(src.country_code.trim())) {
            venue.country_code = src.country_code.trim().toUpperCase();
        } else {
            invalid.push('venue.country_code');
        }
    }

    const hasLat = !isAbsent(src.latitude);
    const hasLng = !isAbsent(src.longitude);
    if (hasLat) {
        const v = coordinate(src.latitude, 90);
        if (v === null) invalid.push('venue.latitude');
        else venue.latitude = v;
    }
    if (hasLng) {
        const v = coordinate(src.longitude, 180);
        if (v === null) invalid.push('venue.longitude');
        else venue.longitude = v;
    }
    // Un punto sin una de sus dos coordenadas no sirve para un enlace de mapa.
    if (hasLat !== hasLng) invalid.push(hasLat ? 'venue.longitude' : 'venue.latitude');

    return { venue, invalid };
}

// Valida el body de POST /api/events. Devuelve:
//   { data: { event, venueId?, venue? }, invalid: [campos] }
//   event   -> solo columnas de sport_events que la API permite fijar (ya normalizadas)
//   venueId -> id de un recinto existente (XOR con venue)
//   venue   -> datos de un recinto nuevo
function validateEventBody(body) {
    const src = isPlainObject(body) ? body : {};
    const invalid = [];
    const event = {};

    // --- obligatorios ---
    const title = text(src.title, 150);
    if (title === null) invalid.push('title'); else event.title = title;

    const sport = text(src.sport, 50);
    if (sport === null) invalid.push('sport'); else event.sport = sport;

    const capacity = integer(src.max_capacity);
    if (capacity === null || capacity < 1 || capacity > MAX_INT) invalid.push('max_capacity');
    else event.max_capacity = capacity;

    const startAt = dateTime(src.start_at);
    if (startAt === null) invalid.push('start_at'); else event.start_at = startAt;

    const endAt = dateTime(src.end_at);
    if (endAt === null) invalid.push('end_at'); else event.end_at = endAt;

    // chk_events_dates: end_at > start_at (solo se compara si ambas fechas son válidas; si no, ya están marcadas).
    if (startAt !== null && endAt !== null && !(endAt > startAt)) invalid.push('end_at');

    // --- opcionales (ausente o vacío = no enviado; con valor, debe ser válido) ---
    if (!isAbsent(src.event_description)) {
        const v = text(src.event_description, MAX_DESCRIPTION);
        if (v === null) invalid.push('event_description'); else event.event_description = v;
    }
    if (!isAbsent(src.timezone)) {
        const v = timeZone(src.timezone);
        if (v === null) invalid.push('timezone'); else event.timezone = v;
    }
    if (!isAbsent(src.price)) {
        const v = price(src.price);
        if (v === null) invalid.push('price'); else event.price = v;
    }
    if (!isAbsent(src.currency)) {
        if (isString(src.currency) && /^[A-Za-z]{3}$/.test(src.currency.trim())) {
            event.currency = src.currency.trim().toUpperCase();
        } else {
            invalid.push('currency');
        }
    }
    if (!isAbsent(src.registration_deadline)) {
        const v = dateTime(src.registration_deadline);
        if (v === null) invalid.push('registration_deadline');
        // chk_events_deadline: registration_deadline <= end_at
        else if (endAt !== null && v > endAt) invalid.push('registration_deadline');
        else event.registration_deadline = v;
    }
    if (!isAbsent(src.cover_image)) {
        const v = httpUrl(src.cover_image);
        if (v === null) invalid.push('cover_image'); else event.cover_image = v;
    }

    // --- modalidad, enlace en línea y ubicación ---
    let modality = 'InPerson'; // default del esquema
    if (!isAbsent(src.modality)) {
        if (isString(src.modality) && MODALITIES.includes(src.modality)) modality = src.modality;
        else invalid.push('modality');
    }
    const modalityOk = !invalid.includes('modality');
    if (modalityOk && !isAbsent(src.modality)) event.modality = modality;

    if (!isAbsent(src.online_url)) {
        const v = httpUrl(src.online_url);
        if (v === null) invalid.push('online_url'); else event.online_url = v;
    } else if (modalityOk && modality === 'Virtual') {
        invalid.push('online_url'); // un evento virtual sin enlace no se puede seguir
    }

    const hasVenueId = !isAbsent(src.venue_id);
    const hasVenue = src.venue !== undefined && src.venue !== null;
    let venueId;
    let venue;

    if (hasVenueId && hasVenue) {
        invalid.push('venue_id', 'venue'); // o uno existente, o uno nuevo; no los dos
    } else if (hasVenueId) {
        const id = integer(src.venue_id);
        if (id === null || id < 1 || id > MAX_INT) invalid.push('venue_id'); else venueId = id;
    } else if (hasVenue) {
        const r = validateVenue(src.venue);
        invalid.push(...r.invalid);
        venue = r.venue;
    }

    if (modalityOk) {
        const hasLocation = hasVenueId || hasVenue;
        if (modality === 'Virtual' && hasLocation) invalid.push(hasVenueId ? 'venue_id' : 'venue'); // sin sede física
        if (modality !== 'Virtual' && !hasLocation) invalid.push('venue'); // presencial / híbrido: la ubicación es esencial
    }

    const unique = [...new Set(invalid)];
    return { data: { event, venueId, venue }, invalid: unique };
}

// Parámetros del listado público: ?limit=1..100 (por defecto 50) y ?offset>=0 (por defecto 0).
function validateListQuery(query) {
    const src = isPlainObject(query) ? query : {};
    const invalid = [];
    let limit = LIST_DEFAULT_LIMIT;
    let offset = 0;

    if (src.limit !== undefined) {
        const n = isString(src.limit) ? integer(src.limit) : null;
        if (n === null || n < 1 || n > LIST_MAX_LIMIT) invalid.push('limit'); else limit = n;
    }
    if (src.offset !== undefined) {
        const n = isString(src.offset) ? integer(src.offset) : null;
        if (n === null || n > MAX_INT) invalid.push('offset'); else offset = n;
    }
    return { data: { limit, offset }, invalid };
}

module.exports = {
    MODALITIES,
    LIST_DEFAULT_LIMIT,
    LIST_MAX_LIMIT,
    validateEventBody,
    validateVenue,
    validateListQuery
};

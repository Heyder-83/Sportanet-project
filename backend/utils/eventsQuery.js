// backend/utils/eventsQuery.js
// Validación de los parámetros del listado público de eventos (GET /api/events) y el "ahora" con el que se decide
// qué es próximo y qué es pasado. Sin acceso a BD: se prueba por separado.
//
//   q      texto a buscar en el nombre del evento (máx. 100 caracteres; vacío = sin búsqueda)
//   sort   name_asc | name_desc | newest | oldest        (por fecha de inicio; sin valor = según la pestaña)
//   when   upcoming (por defecto) | past | all
//   page   entero >= 1 (por defecto 1)
//   limit  entero 1..50 (por defecto 12)

const SORTS = Object.freeze(['name_asc', 'name_desc', 'newest', 'oldest']);
const WHENS = Object.freeze(['upcoming', 'past', 'all']);
const MAX_Q = 100;
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;
const MAX_PAGE = 100000;

// Devuelve { value, invalid }. `invalid` lista los parámetros mal formados (nunca se ignoran en silencio).
function parseListQuery(query) {
    const src = query && typeof query === 'object' ? query : {};
    const invalid = [];
    const value = { q: null, sort: null, when: 'upcoming', page: 1, limit: DEFAULT_LIMIT };
    const present = (k) => src[k] !== undefined && src[k] !== '';

    if (present('q')) {
        if (typeof src.q !== 'string') invalid.push('q');
        else {
            const q = src.q.trim().replace(/\s+/g, ' ');
            if (q.length > MAX_Q) invalid.push('q');
            else if (q.length) value.q = q;
        }
    }
    if (present('sort')) {
        if (typeof src.sort === 'string' && SORTS.includes(src.sort)) value.sort = src.sort;
        else invalid.push('sort');
    }
    if (present('when')) {
        if (typeof src.when === 'string' && WHENS.includes(src.when)) value.when = src.when;
        else invalid.push('when');
    }
    if (present('page')) {
        if (typeof src.page === 'string' && /^[1-9]\d{0,5}$/.test(src.page) && Number(src.page) <= MAX_PAGE) value.page = Number(src.page);
        else invalid.push('page');
    }
    if (present('limit')) {
        if (typeof src.limit === 'string' && /^[1-9]\d?$/.test(src.limit) && Number(src.limit) <= MAX_LIMIT) value.limit = Number(src.limit);
        else invalid.push('limit');
    }
    return { value, invalid };
}

// Escapa % _ y | para usar el texto dentro de un LIKE ... ESCAPE '|' (el usuario busca texto, no patrones).
const escapeLike = (s) => s.replace(/[|%_]/g, (c) => `|${c}`);

// "Ahora" en la zona horaria de los eventos, como texto 'YYYY-MM-DD HH:MM:SS' (la misma hora de pared que guardan
// start_at y end_at). Así lo próximo y lo pasado no dependen de la zona horaria del servidor de MySQL.
// Zona fija (Colombia, sin horario de verano): un evento en otra zona se compararía con unas horas de desfase.
const EVENTS_TZ = 'America/Bogota';
function nowLocal(date = new Date(), timeZone = EVENTS_TZ) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(date);
    const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

module.exports = { SORTS, WHENS, MAX_Q, DEFAULT_LIMIT, MAX_LIMIT, parseListQuery, escapeLike, nowLocal, EVENTS_TZ };

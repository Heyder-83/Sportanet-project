// backend/db/events.js
// Consultas de eventos. Solo columnas verificadas en Base de Datos/schema.sql (`sport_events`, `venues`,
// `event_organizers`). Todas las consultas son parametrizadas y las listas de columnas son fijas: ningún nombre de
// columna sale de datos del cliente. Nunca se selecciona share_token ni datos de cuenta del organizador.
const pool = require('./connection');

const db = () => pool.promise();

// Error de regla de negocio detectado dentro de la transacción (no es un error de MySQL). Las rutas lo traducen
// a una respuesta 4xx; el código viaja en `domainCode`.
class EventDomainError extends Error {
    constructor(domainCode) {
        super(domainCode);
        this.name = 'EventDomainError';
        this.domainCode = domainCode;
    }
}
const ORGANIZER_PROFILE_MISSING = 'ORGANIZER_PROFILE_MISSING'; // la cuenta no tiene fila en event_organizers
const VENUE_NOT_FOUND = 'VENUE_NOT_FOUND'; // venue_id no existe

// Las fechas salen como texto "YYYY-MM-DDTHH:MM:SS" tal como están en la BD (hora local del evento, ver `timezone`).
// Si salieran como Date, mysql2 las interpretaría en la zona del servidor y el JSON las desplazaría (Z).
const fmt = (col) => `DATE_FORMAT(${col}, '%Y-%m-%dT%H:%i:%s')`;

// Eventos visibles para cualquiera: publicados Y públicos. Es la única condición de visibilidad de esta fase;
// borradores, privados, cancelados y completados no salen en la API pública.
const PUBLIC_EVENT_SELECT = `
    SELECT e.sport_event_id, e.title, e.event_description, e.sport, e.max_capacity, e.cover_image, e.event_status,
           ${fmt('e.start_at')} AS start_at, ${fmt('e.end_at')} AS end_at, e.timezone, e.modality, e.online_url,
           e.price, e.currency, ${fmt('e.registration_deadline')} AS registration_deadline,
           ${fmt('e.published_at')} AS published_at,
           o.event_organizers_id AS organizer_id, o.display_name AS organizer_name,
           v.venue_id, v.name AS venue_name, v.address AS venue_address, v.city AS venue_city,
           v.region AS venue_region, v.country_code AS venue_country_code,
           v.latitude AS venue_latitude, v.longitude AS venue_longitude
    FROM sport_events e
    JOIN event_organizers o ON o.event_organizers_id = e.event_organizers_id
    LEFT JOIN venues v ON v.venue_id = e.venue_id
    WHERE e.event_status = 'Published' AND e.visibility = 'Public'`;

const asNumberOrNull = (v) => (v === null || v === undefined ? null : Number(v));

// Fila SQL -> objeto de la API. DECIMAL llega como texto desde mysql2 ("50000.00"): se convierte a número.
function toPublicEvent(row) {
    return {
        sport_event_id: row.sport_event_id,
        title: row.title,
        event_description: row.event_description,
        sport: row.sport,
        max_capacity: row.max_capacity,
        cover_image: row.cover_image,
        event_status: row.event_status,
        start_at: row.start_at,
        end_at: row.end_at,
        timezone: row.timezone,
        modality: row.modality,
        online_url: row.online_url,
        price: Number(row.price),
        currency: row.currency,
        registration_deadline: row.registration_deadline,
        published_at: row.published_at,
        organizer: { event_organizers_id: row.organizer_id, display_name: row.organizer_name },
        venue: row.venue_id === null || row.venue_id === undefined
            ? null
            : {
                venue_id: row.venue_id,
                name: row.venue_name,
                address: row.venue_address,
                city: row.venue_city,
                region: row.venue_region,
                country_code: row.venue_country_code,
                latitude: asNumberOrNull(row.venue_latitude),
                longitude: asNumberOrNull(row.venue_longitude)
            }
    };
}

// Lista pública, ordenada por fecha de inicio (usa idx_events_listing). limit y offset ya validados como enteros.
async function listPublishedEvents({ limit, offset }) {
    const [rows] = await db().query(
        `${PUBLIC_EVENT_SELECT} ORDER BY e.start_at ASC, e.sport_event_id ASC LIMIT ? OFFSET ?`,
        [limit, offset]
    );
    return rows.map(toPublicEvent);
}

// Un evento publicado y público, o null (un borrador, un privado o un id inexistente son indistinguibles: null).
async function findPublishedEventById(eventId) {
    const [rows] = await db().query(`${PUBLIC_EVENT_SELECT} AND e.sport_event_id = ?`, [eventId]);
    return rows[0] ? toPublicEvent(rows[0]) : null;
}

// INSERT con lista de columnas FIJA (la que pasa el llamador, nunca claves del cliente) y los valores definidos.
function insertSql(table, columns, values, extra = '') {
    const cols = columns.filter((c) => values[c] !== undefined);
    const sql = `INSERT INTO ${table} (${cols.join(', ')}${extra ? `, ${extra.col}` : ''}) ` +
        `VALUES (${cols.map(() => '?').join(', ')}${extra ? `, ${extra.val}` : ''})`;
    return { sql, params: cols.map((c) => values[c]) };
}

const VENUE_COLUMNS = ['created_by_organizer_id', 'name', 'address', 'city', 'region', 'country_code', 'latitude', 'longitude'];
const EVENT_COLUMNS = [
    'event_organizers_id', 'venue_id', 'title', 'event_description', 'sport', 'max_capacity', 'cover_image',
    'event_status', 'start_at', 'end_at', 'timezone', 'modality', 'online_url', 'price', 'currency',
    'registration_deadline', 'visibility'
];

// Crea un evento PUBLICADO y PÚBLICO a nombre del organizador de la cuenta `userId` (leída de la sesión, nunca del body).
// Si trae `venue` (recinto nuevo), el recinto y el evento se crean en UNA transacción: si algo falla, no queda
// ni el uno ni el otro. Si trae `venueId`, solo se comprueba que exista.
// Lanza EventDomainError(ORGANIZER_PROFILE_MISSING | VENUE_NOT_FOUND) o el error de MySQL (tras revertir).
// Devuelve el sport_event_id nuevo.
async function createEvent({ userId, event, venueId, venue }) {
    const conn = await db().getConnection();
    try {
        await conn.beginTransaction();

        const [orgRows] = await conn.query('SELECT event_organizers_id FROM event_organizers WHERE user_id = ?', [userId]);
        if (!orgRows[0]) throw new EventDomainError(ORGANIZER_PROFILE_MISSING);
        const organizerId = orgRows[0].event_organizers_id;

        let resolvedVenueId = null;
        if (venue) {
            const ins = insertSql('venues', VENUE_COLUMNS, { ...venue, created_by_organizer_id: organizerId });
            const [r] = await conn.query(ins.sql, ins.params);
            resolvedVenueId = r.insertId;
        } else if (venueId !== undefined) {
            const [vRows] = await conn.query('SELECT venue_id FROM venues WHERE venue_id = ?', [venueId]);
            if (!vRows[0]) throw new EventDomainError(VENUE_NOT_FOUND);
            resolvedVenueId = venueId;
        }

        const values = {
            ...event,
            event_organizers_id: organizerId,
            venue_id: resolvedVenueId,
            event_status: 'Published',
            visibility: 'Public'
        };
        const ins = insertSql('sport_events', EVENT_COLUMNS, values, { col: 'published_at', val: 'NOW()' });
        const [result] = await conn.query(ins.sql, ins.params);

        await conn.commit();
        return result.insertId;
    } catch (err) {
        try { await conn.rollback(); } catch (_) { /* el error original es el que importa */ }
        throw err;
    } finally {
        conn.release();
    }
}

module.exports = {
    EventDomainError,
    ORGANIZER_PROFILE_MISSING,
    VENUE_NOT_FOUND,
    listPublishedEvents,
    findPublishedEventById,
    createEvent
};

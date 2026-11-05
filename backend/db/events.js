// backend/db/events.js
// Consultas PÚBLICAS de eventos (portal sin login). Solo lectura.
//
// Reglas de visibilidad (las decide esta capa, no el frontend):
//   - Borradores (Draft): nunca se ven.
//   - Listado: solo Published y Completed. Los cancelados no salen en el listado.
//   - Detalle: Published, Completed y Canceled (quien tenga el enlace ve que se canceló). Draft -> no existe.
//   - Próximo = Published y termina después de "ahora"; Pasado = Completed, o Published que ya terminó.
// Las fechas se devuelven como texto 'YYYY-MM-DDTHH:MM:SS' (hora de pared, sin zona) junto con `timezone`.
// Nunca se devuelven: online_url (enlace de acceso), user_id del personal, correos, datos de inscritos.
const pool = require('./connection');
const { escapeLike } = require('../utils/eventsQuery');

const q = (sql, params) => pool.promise().query(sql, params);
const ISO = "'%Y-%m-%dT%H:%i:%s'";

const ORDER = Object.freeze({
    name_asc: 'e.title ASC, e.sport_event_id ASC',
    name_desc: 'e.title DESC, e.sport_event_id ASC',
    newest: 'e.start_at DESC, e.sport_event_id DESC',
    oldest: 'e.start_at ASC, e.sport_event_id ASC'
});
// Sin sort: lo próximo por orden de llegada (el más cercano primero); lo pasado, lo más reciente primero.
const defaultSort = (when) => (when === 'upcoming' ? 'oldest' : 'newest');

const CONFIRMED_COUNT = `(SELECT COUNT(*) FROM event_registrations r
        WHERE r.sport_event_id = e.sport_event_id AND r.registration_status = 'Confirmed')`;

function whereFor({ q: text, when }, now) {
    const where = [];
    const params = [];
    if (when === 'upcoming') {
        where.push("e.event_status = 'Published' AND e.end_at > ?");
        params.push(now);
    } else if (when === 'past') {
        where.push("(e.event_status = 'Completed' OR (e.event_status = 'Published' AND e.end_at <= ?))");
        params.push(now);
    } else {
        where.push("e.event_status IN ('Published', 'Completed')");
    }
    if (text) {
        where.push("e.title LIKE ? ESCAPE '|'");
        params.push(`%${escapeLike(text)}%`);
    }
    return { sql: where.join(' AND '), params };
}

const isoNow = (now) => now.replace(' ', 'T');
const money = (v) => Number(v);
const club = (id, name) => (id == null ? null : { id, name });

// Listado paginado. `now` = 'YYYY-MM-DD HH:MM:SS' (ver utils/eventsQuery.nowLocal).
async function listPublicEvents({ q: text, sort, when, page, limit }, now) {
    const { sql: whereSql, params } = whereFor({ q: text, when }, now);
    const order = ORDER[sort || defaultSort(when)];

    const [[{ total }]] = await q(`SELECT COUNT(*) AS total FROM sport_events e WHERE ${whereSql}`, params);
    const [rows] = await q(
        `SELECT e.sport_event_id AS id, e.title, e.sport, LEFT(e.event_description, 240) AS excerpt, e.cover_image,
                DATE_FORMAT(e.start_at, ${ISO}) AS start_at, DATE_FORMAT(e.end_at, ${ISO}) AS end_at,
                e.timezone, e.modality, e.price, e.currency, e.event_status AS status, e.max_capacity,
                c.club_id, c.club_name, v.name AS venue_name, v.city AS venue_city,
                ${CONFIRMED_COUNT} AS confirmed_count
           FROM sport_events e
           LEFT JOIN clubs c ON c.club_id = e.club_id
           LEFT JOIN venues v ON v.venue_id = e.venue_id
          WHERE ${whereSql}
          ORDER BY ${order}
          LIMIT ? OFFSET ?`,
        [...params, limit, (page - 1) * limit]
    );

    const nowIso = isoNow(now);
    return {
        total: Number(total),
        items: rows.map((r) => ({
            id: r.id,
            title: r.title,
            sport: r.sport,
            excerpt: r.excerpt,
            cover_image: r.cover_image,
            start_at: r.start_at,
            end_at: r.end_at,
            timezone: r.timezone,
            modality: r.modality,
            price: money(r.price),
            currency: r.currency,
            status: r.status,
            is_past: r.status === 'Completed' || r.end_at <= nowIso,
            capacity: r.max_capacity,
            confirmed_count: Number(r.confirmed_count),
            spots_left: Math.max(0, r.max_capacity - Number(r.confirmed_count)),
            club: club(r.club_id, r.club_name),
            venue: r.venue_name == null ? null : { name: r.venue_name, city: r.venue_city }
        }))
    };
}

// Detalle de un evento. Devuelve null si no existe o es un borrador.
async function findPublicEventById(id, now) {
    const [rows] = await q(
        `SELECT e.sport_event_id AS id, e.title, e.sport, e.event_description AS description, e.cover_image,
                DATE_FORMAT(e.start_at, ${ISO}) AS start_at, DATE_FORMAT(e.end_at, ${ISO}) AS end_at,
                DATE_FORMAT(e.registration_deadline, ${ISO}) AS registration_deadline,
                e.timezone, e.modality, e.price, e.currency, e.event_status AS status, e.cancel_reason,
                e.max_capacity, e.staff_mode, o.display_name AS organizer_name,
                c.club_id, c.club_name, c.address AS club_address,
                v.name AS venue_name, v.address AS venue_address, v.city AS venue_city, v.region AS venue_region,
                v.country_code AS venue_country, v.latitude, v.longitude,
                ${CONFIRMED_COUNT} AS confirmed_count
           FROM sport_events e
           JOIN event_organizers o ON o.event_organizers_id = e.event_organizers_id
           LEFT JOIN clubs c ON c.club_id = e.club_id
           LEFT JOIN venues v ON v.venue_id = e.venue_id
          WHERE e.sport_event_id = ? AND e.event_status IN ('Published', 'Completed', 'Canceled')`,
        [id]
    );
    const r = rows[0];
    if (!r) return null;

    const [[staffRows], [imageRows]] = await Promise.all([
        r.staff_mode === 'Specific'
            ? q('SELECT display_name, role_title FROM event_staff WHERE sport_event_id = ? ORDER BY event_staff_id', [id])
            : Promise.resolve([[]]),
        q('SELECT url, alt_text FROM event_images WHERE sport_event_id = ? ORDER BY position, event_image_id', [id])
    ]);

    const confirmed = Number(r.confirmed_count);
    return {
        id: r.id,
        title: r.title,
        sport: r.sport,
        description: r.description,
        cover_image: r.cover_image,
        start_at: r.start_at,
        end_at: r.end_at,
        registration_deadline: r.registration_deadline,
        timezone: r.timezone,
        modality: r.modality,
        price: money(r.price),
        currency: r.currency,
        status: r.status,
        cancel_reason: r.status === 'Canceled' ? r.cancel_reason : null,
        is_past: r.status === 'Completed' || r.end_at <= isoNow(now),
        capacity: r.max_capacity,
        confirmed_count: confirmed,
        spots_left: Math.max(0, r.max_capacity - confirmed),
        organizer: { name: r.organizer_name },
        club: r.club_id == null ? null : { id: r.club_id, name: r.club_name, address: r.club_address },
        venue: r.venue_name == null ? null : {
            name: r.venue_name, address: r.venue_address, city: r.venue_city, region: r.venue_region,
            country_code: r.venue_country,
            latitude: r.latitude == null ? null : Number(r.latitude),
            longitude: r.longitude == null ? null : Number(r.longitude)
        },
        // 'Club' = lo organiza el club en general (sin delegados); 'Specific' = estas personas.
        staff_mode: r.staff_mode,
        staff: staffRows.map((s) => ({ name: s.display_name, role: s.role_title })),
        images: imageRows.map((i) => ({ url: i.url, alt: i.alt_text }))
    };
}

module.exports = { listPublicEvents, findPublicEventById };

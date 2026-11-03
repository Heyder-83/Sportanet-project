const pool = require('./connection');

const asDbDate = (value) => value && typeof value === 'string' ? value.replace('T', ' ') : value;
const q = (conn, sql, params = []) => conn.query(sql, params);

async function withTransaction(work) {
    const conn = await pool.promise().getConnection();
    try {
        await conn.beginTransaction();
        const result = await work(conn);
        await conn.commit();
        return result;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

async function findOrganizerId(conn, userId) {
    const [rows] = await q(conn, 'SELECT event_organizers_id FROM event_organizers WHERE user_id = ?', [userId]);
    return rows[0]?.event_organizers_id ?? null;
}

async function listOrganizerEvents(userId) {
    const [rows] = await pool.promise().query(
        `SELECT e.sport_event_id AS id, e.title, e.sport, e.event_description,
                DATE_FORMAT(e.start_at, '%Y-%m-%dT%H:%i:%s') AS start_at,
                DATE_FORMAT(e.end_at, '%Y-%m-%dT%H:%i:%s') AS end_at,
                DATE_FORMAT(e.registration_deadline, '%Y-%m-%dT%H:%i:%s') AS registration_deadline,
                e.event_status AS status, e.max_capacity AS capacity, e.price, e.currency,
                e.modality, e.approval_mode, e.cover_image, e.online_url,
                v.name AS venue_name, v.address AS venue_address, v.city AS venue_city,
                (SELECT COUNT(*) FROM event_registrations r WHERE r.sport_event_id = e.sport_event_id AND r.registration_status = 'Confirmed') AS confirmed_count,
                (SELECT COUNT(*) FROM event_registrations r WHERE r.sport_event_id = e.sport_event_id AND r.registration_status IN ('Pending','Waitlisted')) AS pending_count
           FROM sport_events e
           JOIN event_organizers o ON o.event_organizers_id = e.event_organizers_id
           LEFT JOIN venues v ON v.venue_id = e.venue_id
          WHERE o.user_id = ?
          ORDER BY e.created_at DESC, e.sport_event_id DESC`, [userId]);
    return rows.map((r) => ({ ...r, price: Number(r.price), confirmed_count: Number(r.confirmed_count), pending_count: Number(r.pending_count) }));
}

async function createEvent(userId, data) {
    return withTransaction(async (conn) => {
        const organizerId = await findOrganizerId(conn, userId);
        if (!organizerId) return null;
        if (data.club_id != null) {
            const [clubs] = await q(conn,
                'SELECT club_id FROM clubs WHERE club_id = ? AND event_organizers_id = ?', [data.club_id, organizerId]);
            if (!clubs.length) return { kind: 'club_forbidden' };
        }
        let venueId = null;
        if (data.modality !== 'Virtual') {
            const [existingVenue] = await q(conn,
                'SELECT venue_id FROM venues WHERE created_by_organizer_id = ? AND name = ? AND address = ? AND city = ? LIMIT 1 FOR UPDATE',
                [organizerId, data.venue_name, data.venue_address, data.venue_city]);
            if (existingVenue[0]) venueId = existingVenue[0].venue_id;
            else {
                const [venue] = await q(conn,
                    'INSERT INTO venues (created_by_organizer_id, name, address, city) VALUES (?, ?, ?, ?)',
                    [organizerId, data.venue_name, data.venue_address, data.venue_city]);
                venueId = venue.insertId;
            }
        }
        const [result] = await q(conn,
            `INSERT INTO sport_events
                (club_id, venue_id, event_organizers_id, title, event_description, sport, max_capacity, cover_image,
                 event_status, start_at, end_at, timezone, modality, online_url, price, currency, registration_deadline,
                 approval_mode, published_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'America/Bogota', ?, ?, ?, ?, ?, ?, IF(? = 'Published', NOW(), NULL))`,
            [data.club_id, venueId, organizerId, data.title, data.event_description, data.sport, data.max_capacity,
             data.cover_image, data.event_status, data.start_at, data.end_at, data.modality, data.online_url, data.price,
             data.currency, data.registration_deadline, data.approval_mode, data.event_status]);
        return result.insertId;
    });
}

async function updateOrganizerEvent(userId, eventId, patch) {
    return withTransaction(async (conn) => {
        const [rows] = await q(conn,
            `SELECT e.*, DATE_FORMAT(e.start_at, '%Y-%m-%d %H:%i:%s') AS start_at_text,
                    DATE_FORMAT(e.end_at, '%Y-%m-%d %H:%i:%s') AS end_at_text,
                    DATE_FORMAT(e.registration_deadline, '%Y-%m-%d %H:%i:%s') AS deadline_text
               FROM sport_events e JOIN event_organizers o ON o.event_organizers_id = e.event_organizers_id
              WHERE e.sport_event_id = ? AND o.user_id = ? FOR UPDATE`, [eventId, userId]);
        const current = rows[0];
        if (!current) return { kind: 'not_found' };
        if (!['Draft', 'Published'].includes(current.event_status)) return { kind: 'closed' };
        const merged = { ...current, ...patch,
            start_at: Object.hasOwn(patch, 'start_at') ? patch.start_at : current.start_at_text,
            end_at: Object.hasOwn(patch, 'end_at') ? patch.end_at : current.end_at_text,
            registration_deadline: Object.hasOwn(patch, 'registration_deadline') ? patch.registration_deadline : current.deadline_text };
        if (merged.end_at <= merged.start_at) return { kind: 'date_conflict' };
        if (merged.registration_deadline && merged.registration_deadline > merged.end_at) return { kind: 'date_conflict' };
        if (merged.modality === 'Virtual' && !merged.online_url) return { kind: 'online_url_required' };
        if (merged.max_capacity < Number(current.max_capacity)) {
            const [[{ n }]] = await q(conn,
                "SELECT COUNT(*) AS n FROM event_registrations WHERE sport_event_id = ? AND registration_status = 'Confirmed'",
                [eventId]);
            if (merged.max_capacity < Number(n)) return { kind: 'capacity_conflict' };
        }
        const columns = ['title', 'event_description', 'sport', 'max_capacity', 'cover_image', 'online_url', 'event_status',
            'start_at', 'end_at', 'modality', 'price', 'currency', 'registration_deadline', 'approval_mode'];
        const values = columns.map((key) => key === 'start_at' || key === 'end_at' || key === 'registration_deadline'
            ? asDbDate(merged[key]) : merged[key]);
        const assignments = columns.map((key) => `${key} = ?`).join(', ');
        await q(conn, `UPDATE sport_events SET ${assignments}, published_at = IF(? = 'Published', COALESCE(published_at, NOW()), NULL) WHERE sport_event_id = ?`,
            [...values, merged.event_status, eventId]);
        return { kind: 'ok' };
    });
}

async function cancelOrganizerEvent(userId, eventId, reason) {
    const [result] = await pool.promise().query(
        `UPDATE sport_events e JOIN event_organizers o ON o.event_organizers_id = e.event_organizers_id
            SET e.event_status = 'Canceled', e.canceled_at = NOW(), e.cancel_reason = ?
          WHERE e.sport_event_id = ? AND o.user_id = ? AND e.event_status IN ('Draft','Published')`,
        [reason || null, eventId, userId]);
    return result.affectedRows;
}

async function completeOrganizerEvent(userId, eventId, now) {
    return withTransaction(async (conn) => {
        const [rows] = await q(conn,
            `SELECT e.event_status, DATE_FORMAT(e.end_at, '%Y-%m-%dT%H:%i:%s') AS end_at
               FROM sport_events e JOIN event_organizers o ON o.event_organizers_id = e.event_organizers_id
              WHERE e.sport_event_id = ? AND o.user_id = ? FOR UPDATE`, [eventId, userId]);
        if (!rows[0]) return 'not_found';
        if (rows[0].event_status !== 'Published') return 'closed';
        if (rows[0].end_at > now.replace(' ', 'T')) return 'not_ended';
        await q(conn, "UPDATE sport_events SET event_status = 'Completed' WHERE sport_event_id = ?", [eventId]);
        return 'ok';
    });
}

async function registerParticipant(userId, eventId, now) {
    return withTransaction(async (conn) => {
        const [events] = await q(conn, `SELECT sport_event_id, event_status,
                DATE_FORMAT(end_at, '%Y-%m-%dT%H:%i:%s') AS end_at,
                DATE_FORMAT(registration_deadline, '%Y-%m-%dT%H:%i:%s') AS registration_deadline,
                max_capacity, price, currency, approval_mode FROM sport_events WHERE sport_event_id = ? FOR UPDATE`, [eventId]);
        const event = events[0];
        if (!event || event.event_status !== 'Published') return { kind: 'not_open' };
        const nowIso = now.replace(' ', 'T');
        const deadline = event.registration_deadline;
        if (event.end_at <= nowIso || (deadline && deadline <= nowIso)) return { kind: 'closed' };

        const [existingRows] = await q(conn,
            'SELECT event_registration_id, registration_status FROM event_registrations WHERE sport_event_id = ? AND user_id = ? FOR UPDATE',
            [eventId, userId]);
        if (existingRows[0] && existingRows[0].registration_status !== 'Canceled') return { kind: 'duplicate', status: existingRows[0].registration_status };

        const [[{ count }]] = await q(conn,
            "SELECT COUNT(*) AS count FROM event_registrations WHERE sport_event_id = ? AND registration_status = 'Confirmed'", [eventId]);
        const price = Number(event.price);
        const full = Number(count) >= event.max_capacity;
        const status = full ? 'Waitlisted' : price > 0 ? 'Pending' : event.approval_mode === 'Manual' ? 'Pending' : 'Confirmed';
        const paymentStatus = price > 0 ? 'Pending' : 'NotRequired';
        if (existingRows[0]) {
            await q(conn,
                `UPDATE event_registrations SET registration_status = ?, payment_status = ?, amount_due = ?, currency = ?,
                    registration_date = NOW(), confirmed_at = IF(? = 'Confirmed', NOW(), NULL), canceled_at = NULL,
                    canceled_by = NULL, cancel_reason = NULL WHERE event_registration_id = ?`,
                [status, paymentStatus, price.toFixed(2), event.currency, status, existingRows[0].event_registration_id]);
        } else {
            await q(conn,
                `INSERT INTO event_registrations (sport_event_id, user_id, registration_status, payment_status, amount_due, currency, confirmed_at)
                 VALUES (?, ?, ?, ?, ?, ?, IF(? = 'Confirmed', NOW(), NULL))`,
                [eventId, userId, status, paymentStatus, price.toFixed(2), event.currency, status]);
        }
        return { kind: 'created', status, payment_status: paymentStatus, amount_due: price, currency: event.currency };
    });
}

async function listParticipantRegistrations(userId) {
    const [rows] = await pool.promise().query(
        `SELECT r.event_registration_id AS id, r.sport_event_id AS event_id, e.title, e.sport,
                r.registration_status AS status, r.payment_status, r.amount_due, r.currency,
                r.registration_date, DATE_FORMAT(e.start_at, '%Y-%m-%dT%H:%i:%s') AS start_at,
                DATE_FORMAT(e.end_at, '%Y-%m-%dT%H:%i:%s') AS end_at, e.event_status AS event_status
           FROM event_registrations r JOIN sport_events e ON e.sport_event_id = r.sport_event_id
          WHERE r.user_id = ? ORDER BY r.registration_date DESC`, [userId]);
    return rows.map((r) => ({ ...r, amount_due: Number(r.amount_due) }));
}

async function cancelParticipantRegistration(userId, eventId, now) {
    return withTransaction(async (conn) => {
        const [events] = await q(conn, "SELECT event_status, DATE_FORMAT(end_at, '%Y-%m-%dT%H:%i:%s') AS end_at FROM sport_events WHERE sport_event_id = ? FOR UPDATE", [eventId]);
        if (!events[0]) return 'not_found';
        if (events[0].event_status === 'Completed' || events[0].end_at <= now.replace(' ', 'T')) return 'closed';
        const [result] = await q(conn,
            `UPDATE event_registrations SET registration_status = 'Canceled', canceled_at = NOW(), canceled_by = 'Participant'
              WHERE sport_event_id = ? AND user_id = ? AND registration_status IN ('Pending','Confirmed','Waitlisted')`, [eventId, userId]);
        return result.affectedRows ? 'ok' : 'not_found';
    });
}

async function listEventRegistrationsForOrganizer(userId, eventId) {
    const [events] = await pool.promise().query(
        'SELECT e.sport_event_id FROM sport_events e JOIN event_organizers o ON o.event_organizers_id = e.event_organizers_id WHERE e.sport_event_id = ? AND o.user_id = ?', [eventId, userId]);
    if (!events.length) return null;
    const [rows] = await pool.promise().query(
        `SELECT r.event_registration_id AS id, r.user_id, u.full_name, u.email,
                r.registration_status AS status, r.payment_status, r.amount_due, r.currency, r.registration_date
           FROM event_registrations r JOIN users u ON u.user_id = r.user_id
          WHERE r.sport_event_id = ? ORDER BY r.registration_date`, [eventId]);
    return rows.map((r) => ({ ...r, amount_due: Number(r.amount_due) }));
}

async function updateEventRegistration(userId, eventId, registrationId, status) {
    return withTransaction(async (conn) => {
        const [events] = await q(conn,
            'SELECT e.max_capacity, e.event_status FROM sport_events e JOIN event_organizers o ON o.event_organizers_id = e.event_organizers_id WHERE e.sport_event_id = ? AND o.user_id = ? FOR UPDATE',
            [eventId, userId]);
        if (!events[0]) return 'not_found';
        const [rows] = await q(conn,
            'SELECT registration_status, payment_status FROM event_registrations WHERE event_registration_id = ? AND sport_event_id = ? FOR UPDATE',
            [registrationId, eventId]);
        if (!rows[0] || rows[0].registration_status === 'Canceled') return 'not_found';
        if (status === 'Confirmed') {
            if (rows[0].registration_status === 'Confirmed') return 'ok';
            if (!['Pending', 'Waitlisted'].includes(rows[0].registration_status)) return 'not_found';
            if (events[0].event_status !== 'Published') return 'event_closed';
            if (rows[0].payment_status !== 'NotRequired' && rows[0].payment_status !== 'Paid') return 'payment_required';
            const [[{ count }]] = await q(conn,
                "SELECT COUNT(*) AS count FROM event_registrations WHERE sport_event_id = ? AND registration_status = 'Confirmed'", [eventId]);
            if (Number(count) >= events[0].max_capacity) return 'full';
            await q(conn,
                "UPDATE event_registrations SET registration_status = 'Confirmed', confirmed_at = NOW(), canceled_at = NULL WHERE event_registration_id = ?",
                [registrationId]);
            return 'ok';
        }
        await q(conn,
            "UPDATE event_registrations SET registration_status = 'Canceled', canceled_at = NOW(), canceled_by = 'Organizer' WHERE event_registration_id = ?",
            [registrationId]);
        return 'ok';
    });
}

module.exports = { listOrganizerEvents, createEvent, updateOrganizerEvent, cancelOrganizerEvent, completeOrganizerEvent, registerParticipant,
    listParticipantRegistrations, cancelParticipantRegistration, listEventRegistrationsForOrganizer, updateEventRegistration };

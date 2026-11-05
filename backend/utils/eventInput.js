const MODALITIES = new Set(['InPerson', 'Virtual', 'Hybrid']);
const APPROVAL_MODES = new Set(['Automatic', 'Manual']);
const EVENT_STATUSES = new Set(['Draft', 'Published']);
const isString = (value) => typeof value === 'string';

function parseDateTime(value) {
    if (!isString(value) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return null;
    const normalized = value.length === 16 ? `${value}:00` : value;
    const date = new Date(`${normalized}Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 19) !== normalized) return null;
    return normalized.replace('T', ' ');
}

function validImage(value) {
    if (value == null || value === '') return true;
    if (!isString(value) || value.length > 500 || /(^|\/)\.\.(\/|$)/.test(value)) return false;
    return /^https:\/\/[^\s<>"'`\\]+$/i.test(value) || /^\/?[A-Za-z0-9_-][A-Za-z0-9_\-./ ()]*$/.test(value);
}

function parseEventInput(body, { partial = false } = {}) {
    const src = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const data = {};
    const invalid = [];
    const fields = ['title', 'sport', 'event_description', 'start_at', 'end_at', 'modality', 'max_capacity', 'price', 'currency', 'registration_deadline', 'approval_mode', 'event_status', 'cover_image', 'online_url', 'club_id', 'venue_name', 'venue_address', 'venue_city'];
    const present = (key) => Object.prototype.hasOwnProperty.call(src, key);
    const requiredFields = ['title', 'sport', 'start_at', 'end_at', 'modality', 'max_capacity', 'price'];
    const required = (key) => { if (!partial && requiredFields.includes(key) && !present(key)) invalid.push(key); };

    for (const key of fields) {
        if (!present(key)) { required(key); continue; }
        const value = src[key];
        if (key === 'title' || key === 'sport') {
            const max = key === 'title' ? 150 : 50;
            if (!isString(value) || !value.trim() || value.trim().length > max) invalid.push(key);
            else data[key] = value.trim();
        } else if (key === 'event_description') {
            if (value != null && (!isString(value) || Buffer.byteLength(value, 'utf8') > 65535)) invalid.push(key);
            else data[key] = value == null ? null : value.trim();
        } else if (key === 'start_at' || key === 'end_at' || key === 'registration_deadline') {
            if ((value == null || value === '') && key === 'registration_deadline') data[key] = null;
            else {
                const parsed = parseDateTime(value);
                if (!parsed) invalid.push(key); else data[key] = parsed;
            }
        } else if (key === 'modality') {
            if (!MODALITIES.has(value)) invalid.push(key); else data[key] = value;
        } else if (key === 'max_capacity') {
            if (!(typeof value === 'number' || (isString(value) && value.trim() !== ''))) { invalid.push(key); continue; }
            const n = Number(value);
            if (!Number.isInteger(n) || n < 1 || n > 2147483647) invalid.push(key); else data[key] = n;
        } else if (key === 'price') {
            if (!(typeof value === 'number' || (isString(value) && value.trim() !== ''))) { invalid.push(key); continue; }
            const n = Number(value);
            if (!Number.isFinite(n) || n < 0 || n > 99999999.99 || Math.abs(n * 100 - Math.round(n * 100)) > 1e-8) invalid.push(key);
            else data[key] = n.toFixed(2);
        } else if (key === 'currency') {
            if (!isString(value) || !/^[A-Z]{3}$/.test(value)) invalid.push(key); else data[key] = value;
        } else if (key === 'approval_mode') {
            if (!APPROVAL_MODES.has(value)) invalid.push(key); else data[key] = value;
        } else if (key === 'event_status') {
            if (!EVENT_STATUSES.has(value)) invalid.push(key); else data[key] = value;
        } else if (key === 'cover_image') {
            if (!validImage(value)) invalid.push(key); else data[key] = value || null;
        } else if (key === 'online_url') {
            if (value == null || value === '') data[key] = null;
            else if (!isString(value) || value.length > 500 || !/^https:\/\/[^\s<>"'`\\]+$/i.test(value)) invalid.push(key);
            else data[key] = value;
        } else if (key === 'club_id') {
            if (value == null || value === '') data[key] = null;
            else {
                const n = Number(value);
                if (!Number.isInteger(n) || n < 1 || n > 2147483647) invalid.push(key);
                else data[key] = n;
            }
        } else if (['venue_name', 'venue_address', 'venue_city'].includes(key)) {
            if (value != null && (!isString(value) || value.trim().length > (key === 'venue_name' ? 120 : 255))) invalid.push(key);
            else data[key] = value == null ? '' : value.trim();
        }
    }

    if (!partial) {
        if (!present('event_description')) data.event_description = null;
        if (!present('currency')) data.currency = 'COP';
        if (!present('registration_deadline')) data.registration_deadline = null;
        if (!present('approval_mode')) data.approval_mode = 'Automatic';
        if (!present('event_status')) data.event_status = 'Draft';
        if (!present('cover_image')) data.cover_image = null;
        if (!present('online_url')) data.online_url = null;
        if (!present('club_id')) data.club_id = null;
        if (!present('venue_name')) data.venue_name = '';
        if (!present('venue_address')) data.venue_address = '';
        if (!present('venue_city')) data.venue_city = '';
    }

    if (data.start_at && data.end_at && data.end_at <= data.start_at) invalid.push('end_at');
    if (data.registration_deadline && data.end_at && data.registration_deadline > data.end_at) invalid.push('registration_deadline');
    if (data.modality && data.modality !== 'Virtual') {
        for (const field of ['venue_name', 'venue_address', 'venue_city']) {
            if (!partial && !data[field]) invalid.push(field);
        }
    }
    if (!partial && data.modality === 'Virtual' && !data.online_url) invalid.push('online_url');
    if (partial && data.modality === 'Virtual') {
        data.venue_name = '';
        data.venue_address = '';
        data.venue_city = '';
    }

    return { data, invalid: [...new Set(invalid)] };
}

module.exports = { parseEventInput, parseDateTime, validImage };

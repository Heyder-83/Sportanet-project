// backend/utils/userInput.js
// Validación de los datos de una cuenta, compartida por routes/auth.js (register / login) y routes/users.js.
// Una sola fuente de reglas: si register aceptara algo que /api/users rechaza (o al revés), el fallo
// aparecería como un error de BD en lugar de un 400 claro.

// Mismas reglas de formato de email que el frontend (JS/header.js).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isString = (v) => typeof v === 'string';

// Los límites coinciden con las columnas de `users` en Base de Datos/schema.sql.
const validators = {
    full_name: (v) => isString(v) && v.trim().length >= 1 && v.trim().length <= 100,
    email: (v) => isString(v) && v.trim().length <= 100 && EMAIL_RE.test(v.trim()),
    phone: (v) => isString(v) && v.trim().length >= 1 && v.trim().length <= 20,
    // bcrypt ignora en silencio todo lo que pase de 72 bytes: se rechaza en lugar de truncar.
    pwd: (v) => isString(v) && v.length >= 1 && Buffer.byteLength(v, 'utf8') <= 72
};

// Devuelve { data, invalid }. Con requireAll todos los campos son obligatorios (creación);
// si no, solo se validan los presentes. Compatibilidad con la versión anterior: en una
// actualización, pwd vacío o null significa "no cambiar la contraseña".
// Solo se copian a `data` los 4 campos conocidos: cualquier otra clave del body (role, is_active...) se ignora.
function validateBody(body, { requireAll }) {
    const src = body && typeof body === 'object' ? body : {};
    const data = {};
    const invalid = [];

    for (const field of ['full_name', 'email', 'phone', 'pwd']) {
        let value = src[field];
        if (field === 'pwd' && !requireAll && (value === '' || value === null)) value = undefined;
        if (value === undefined) {
            if (requireAll) invalid.push(field);
            continue;
        }
        if (!validators[field](value)) {
            invalid.push(field);
            continue;
        }
        data[field] = field === 'pwd' ? value : value.trim();
    }
    return { data, invalid };
}

// Login: solo comprueba que email y pwd sean TEXTO no vacío. No aplica la política de creación
// (p. ej. los 72 bytes): una cuenta antigua podría tener una contraseña que hoy no se aceptaría al crearla.
// Rechazar otros tipos evita que bcrypt.compare lance con valores como números u objetos.
// Devuelve { email, pwd } o null.
function validateLogin(body) {
    const src = body && typeof body === 'object' ? body : {};
    const { email, pwd } = src;
    if (!isString(email) || !isString(pwd)) return null;
    const trimmed = email.trim();
    if (trimmed.length === 0 || trimmed.length > 100 || pwd.length === 0) return null;
    return { email: trimmed, pwd };
}

// Lista blanca del tipo de cuenta del formulario público. Un Map (no un objeto) para que claves como
// 'constructor' o '__proto__' no resuelvan a nada. Admin no está: las cuentas Admin solo se crean desde la BD.
const ACCOUNT_TYPES = new Map([
    ['Atleta', 'Participant'],
    ['Organizador', 'Organizer']
]);

// Devuelve el rol de BD para account_type, o null si no es válido. Si no se envía, es Atleta
// (compatibilidad con clientes anteriores al selector).
function resolveAccountType(value) {
    if (value === undefined) return 'Participant';
    if (!isString(value)) return null;
    return ACCOUNT_TYPES.get(value) || null;
}

function badRequest(res, invalid) {
    return res.status(400).json({
        error: `Invalid or missing fields: ${invalid.join(', ')}`,
        code: 'VALIDATION_ERROR',
        fields: invalid
    });
}

module.exports = { validators, validateBody, validateLogin, resolveAccountType, badRequest };
